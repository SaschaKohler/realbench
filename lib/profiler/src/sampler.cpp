#include "profiler.h"
#include <unistd.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <cerrno>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <stdexcept>
#include <unordered_map>
#include <algorithm>
#include <chrono>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <array>
#include <cstdint>

namespace realbench {

// ---------------------------------------------------------------------------
// Function cost record (shared by callgrind and perf parsers)
// ---------------------------------------------------------------------------
struct FnCost {
    std::string name;
    uint64_t ir      = 0;  // self instruction references
    // caller → total IR attributed to that caller (for call-graph)
    std::unordered_map<std::string, uint64_t> callers;
};

// ---------------------------------------------------------------------------
// ELF binary type detection
// ---------------------------------------------------------------------------
enum class BinaryRuntime { UNKNOWN, NATIVE, GO, RUST };

static BinaryRuntime detect_binary_runtime(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return BinaryRuntime::UNKNOWN;

    // Read ELF header (64 bytes)
    unsigned char ehdr[64];
    if (!f.read(reinterpret_cast<char*>(ehdr), sizeof(ehdr))) return BinaryRuntime::UNKNOWN;
    if (ehdr[0] != 0x7f || ehdr[1] != 'E' || ehdr[2] != 'L' || ehdr[3] != 'F')
        return BinaryRuntime::UNKNOWN;

    // Section header offset / entry size / count (ELF64)
    uint64_t shoff  = 0;
    uint16_t shentsize = 0, shnum = 0, shstrndx = 0;
    memcpy(&shoff,     ehdr + 40, 8);
    memcpy(&shentsize, ehdr + 58, 2);
    memcpy(&shnum,     ehdr + 60, 2);
    memcpy(&shstrndx,  ehdr + 62, 2);

    if (shoff == 0 || shentsize == 0 || shnum == 0 || shstrndx == 0)
        return BinaryRuntime::NATIVE;

    // Read section name string table header
    f.seekg(static_cast<std::streamoff>(shoff + (uint64_t)shstrndx * shentsize));
    unsigned char shdr[64];
    if (!f.read(reinterpret_cast<char*>(shdr), sizeof(shdr))) return BinaryRuntime::NATIVE;
    uint64_t strtab_off = 0, strtab_size = 0;
    memcpy(&strtab_off,  shdr + 24, 8);
    memcpy(&strtab_size, shdr + 32, 8);
    if (strtab_off == 0 || strtab_size > 1024 * 1024) return BinaryRuntime::NATIVE;

    std::string strtab(strtab_size, '\0');
    f.seekg(static_cast<std::streamoff>(strtab_off));
    if (!f.read(&strtab[0], strtab_size)) return BinaryRuntime::NATIVE;

    bool has_go_buildid = false;
    bool has_rustc = false;

    for (int i = 0; i < shnum; ++i) {
        f.seekg(static_cast<std::streamoff>(shoff + (uint64_t)i * shentsize));
        unsigned char sh[64];
        if (!f.read(reinterpret_cast<char*>(sh), sizeof(sh))) break;
        uint32_t name_idx = 0;
        memcpy(&name_idx, sh, 4);
        if (name_idx >= strtab_size) continue;
        std::string sname(strtab.c_str() + name_idx);
        if (sname == ".go.buildinfo" || sname == ".gosymtab" || sname == ".gopclntab")
            has_go_buildid = true;
        if (sname == ".rustc" || sname.find(".debug_info") == 0) {
            // .rustc section is unique to rustc-compiled binaries
            if (sname == ".rustc") has_rustc = true;
        }
    }

    if (has_go_buildid) return BinaryRuntime::GO;
    if (has_rustc)      return BinaryRuntime::RUST;
    return BinaryRuntime::NATIVE;
}

// ---------------------------------------------------------------------------
// perf script folded-stack parser
//
// perf script output format (one sample per block):
//   <comm> <pid>/<tid> [cpu] <time>: <count> cycles:u:
//          <addr> <symbol> (<dso>)
//          ...
// We convert this to the same FnCost structure as callgrind.
// ---------------------------------------------------------------------------
static std::vector<FnCost> parse_perf_script_output(const std::string& path) {
    std::unordered_map<std::string, FnCost> fn_map;

    std::ifstream f(path);
    if (!f.is_open()) {
        fprintf(stderr, "[perf] output file not found: %s\n", path.c_str());
        fflush(stderr);
        return {};
    }
    fprintf(stderr, "[perf] parsing output file: %s\n", path.c_str());
    fflush(stderr);

    // Collect one stack at a time. A blank line separates samples.
    std::vector<std::string> stack;
    bool in_sample = false;

    auto flush_stack = [&]() {
        if (stack.empty()) return;
        // stack[0] = innermost (leaf), stack.back() = outermost
        // Attribute self-cost to leaf, record call edges
        const std::string& leaf = stack[0];
        fn_map[leaf].name = leaf;
        fn_map[leaf].ir += 1;
        for (size_t i = 1; i < stack.size(); ++i) {
            const std::string& callee = stack[i - 1];
            const std::string& caller = stack[i];
            fn_map[caller].name = caller;
            fn_map[callee].callers[caller] += 1;
        }
        stack.clear();
        in_sample = false;
    };

    std::string line;
    while (std::getline(f, line)) {
        if (line.empty()) {
            flush_stack();
            continue;
        }
        // Header line: doesn't start with whitespace
        if (line[0] != '\t' && line[0] != ' ') {
            flush_stack();
            in_sample = true;
            continue;
        }
        if (!in_sample) continue;
        // Frame line: "\t<addr> <symbol> (<dso>)"
        std::istringstream iss(line);
        std::string addr, sym;
        if (!(iss >> addr >> sym)) continue;
        // Skip unknown symbols
        if (sym == "[unknown]" || sym.empty()) continue;
        // Strip trailing DSO annotation if present (the remaining tokens)
        stack.push_back(sym);
    }
    flush_stack();

    std::vector<FnCost> result;
    result.reserve(fn_map.size());
    for (auto& [name, cost] : fn_map) {
        if (cost.ir > 0 || !cost.callers.empty())
            result.push_back(std::move(cost));
    }
    fprintf(stderr, "[perf] parsed %zu functions\n", result.size());
    fflush(stderr);
    return result;
}

// ---------------------------------------------------------------------------
// Callgrind output parser
//
// Callgrind format uses compressed symbol references:
//   fn=(42) real_name   – defines id 42 → "real_name", sets current fn
//   fn=(42)             – references id 42 (already defined)
//   fn=real_name        – no id, plain name
//   cfn=(43) callee     – called function (same compression)
//   calls=N pos         – followed by cost line for that call edge
//   <pos> <Ir> ...      – self-cost line for current fn
// ---------------------------------------------------------------------------

// Parse a compressed name token: "(42) real_name", "(42)", or "real_name"
// Updates id_map if a new definition is seen. Returns the resolved name.
static std::string resolve_sym(const std::string& token,
                                std::unordered_map<int, std::string>& id_map) {
    if (token.empty()) return token;
    if (token[0] == '(') {
        size_t close = token.find(')');
        if (close == std::string::npos) return token;
        int id = std::stoi(token.substr(1, close - 1));
        std::string rest = (close + 1 < token.size()) ? token.substr(close + 1) : "";
        // strip leading space
        if (!rest.empty() && rest[0] == ' ') rest = rest.substr(1);
        if (!rest.empty()) {
            id_map[id] = rest;
            return rest;
        }
        auto it = id_map.find(id);
        return (it != id_map.end()) ? it->second : ("id:" + std::to_string(id));
    }
    return token;
}

static std::vector<FnCost> parse_callgrind_output(const std::string& path) {
    std::unordered_map<std::string, FnCost> fn_map;
    std::unordered_map<int, std::string> sym_ids;  // compressed id → name

    std::ifstream f(path);
    if (!f.is_open()) {
        fprintf(stderr, "[callgrind] output file not found: %s\n", path.c_str());
        fflush(stderr);
        return {};
    }
    fprintf(stderr, "[callgrind] parsing output file: %s\n", path.c_str());
    fflush(stderr);

    std::string current_fn;
    std::string current_cfn;   // current callee (cfn=)
    bool next_cost_is_call = false;  // true if next cost line belongs to cfn

    std::string line;
    while (std::getline(f, line)) {
        if (line.empty()) { current_cfn.clear(); next_cost_is_call = false; continue; }

        // fn= : set current function
        if (line.rfind("fn=", 0) == 0) {
            current_fn = resolve_sym(line.substr(3), sym_ids);
            fn_map[current_fn].name = current_fn;
            current_cfn.clear();
            next_cost_is_call = false;
            continue;
        }

        // cfn= : upcoming calls= + cost line is for this callee
        if (line.rfind("cfn=", 0) == 0) {
            current_cfn = resolve_sym(line.substr(4), sym_ids);
            fn_map[current_cfn].name = current_cfn;
            continue;
        }

        // calls= : next cost line is the inclusive cost of the call edge
        if (line.rfind("calls=", 0) == 0) {
            next_cost_is_call = true;
            continue;
        }

        // Cost line: starts with digit, +, -, or *
        char first = line[0];
        if (!std::isdigit(first) && first != '+' && first != '-' && first != '*') continue;
        if (current_fn.empty()) continue;

        std::istringstream iss(line);
        std::string pos_token;
        iss >> pos_token;   // position column – skip
        uint64_t ir = 0;
        if (!(iss >> ir)) continue;

        if (next_cost_is_call && !current_cfn.empty()) {
            // This is inclusive cost of a call from current_fn → current_cfn.
            // We record it on the callee so flamegraph can show hierarchy.
            fn_map[current_cfn].callers[current_fn] += ir;
            next_cost_is_call = false;
            current_cfn.clear();
        } else {
            // Self cost of current_fn
            fn_map[current_fn].ir += ir;
        }
    }

    std::vector<FnCost> result;
    result.reserve(fn_map.size());
    for (auto& [name, cost] : fn_map) {
        if (cost.ir > 0 || !cost.callers.empty())
            result.push_back(std::move(cost));
    }
    fprintf(stderr, "[callgrind] parsed %zu functions\n", result.size());
    fflush(stderr);
    return result;
}

// Forward declaration
static int run_and_wait_capture(const std::vector<std::string>& argv, std::string& out_output);

// ---------------------------------------------------------------------------
// Run a command, capture its combined stdout+stderr, wait for it.
// Prints command, output, and exit code to our stderr for diagnostics.
// ---------------------------------------------------------------------------
static int run_and_wait(const std::vector<std::string>& argv) {
    std::string dummy;
    return run_and_wait_capture(argv, dummy);
}

// Run a command, capture its combined stdout+stderr to out_output, wait for it.
// Prints command, output, and exit code to our stderr for diagnostics.
static int run_and_wait_capture(const std::vector<std::string>& argv, std::string& out_output) {
    std::vector<char*> c_argv;
    c_argv.reserve(argv.size() + 1);

    std::string cmd_log = "[callgrind] running:";
    for (const auto& s : argv) {
        cmd_log += ' ';
        cmd_log += s;
        c_argv.push_back(const_cast<char*>(s.c_str()));
    }
    c_argv.push_back(nullptr);
    fprintf(stderr, "%s\n", cmd_log.c_str());
    fflush(stderr);

    // Pipe to capture child's stderr (valgrind writes errors there)
    int pipefd[2];
    if (pipe(pipefd) == -1) {
        throw ProfilerException(std::string("pipe failed: ") + strerror(errno));
    }

    pid_t child = fork();
    if (child == -1) {
        close(pipefd[0]); close(pipefd[1]);
        throw ProfilerException(std::string("fork failed: ") + strerror(errno));
    }
    if (child == 0) {
        close(pipefd[0]);
        dup2(pipefd[1], STDERR_FILENO);
        dup2(pipefd[1], STDOUT_FILENO);
        close(pipefd[1]);
        execvp(c_argv[0], c_argv.data());
        _exit(127);
    }

    close(pipefd[1]);

    // Read all output
    out_output.clear();
    std::array<char, 512> buf;
    ssize_t n;
    while ((n = read(pipefd[0], buf.data(), buf.size())) > 0) {
        out_output.append(buf.data(), n);
        if (out_output.size() > 8192) break; // cap at 8 KB
    }
    close(pipefd[0]);

    int status = 0;
    waitpid(child, &status, 0);
    int rc = WIFEXITED(status) ? WEXITSTATUS(status) : -1;

    if (!out_output.empty()) {
        fprintf(stderr, "[callgrind] output:\n%s\n", out_output.c_str());
    }
    fprintf(stderr, "[callgrind] exit code: %d\n", rc);
    fflush(stderr);
    return rc;
}

// ---------------------------------------------------------------------------
// Build a ProfileResult from parsed callgrind cost data
// ---------------------------------------------------------------------------
static ProfileResult build_result(std::vector<FnCost>& costs,
                                  const std::string& binary_path,
                                  uint32_t duration_ms) {
    // total_ir = sum of all self costs (used for percentages)
    uint64_t total_ir = 0;
    for (const auto& c : costs) total_ir += c.ir;

    // Build inclusive cost map: total = self + all incoming call-edge IR
    std::unordered_map<std::string, uint64_t> inclusive;
    for (const auto& c : costs) {
        inclusive[c.name] += c.ir;
        for (const auto& [caller, ir] : c.callers) {
            (void)caller;
            inclusive[c.name] = std::max(inclusive[c.name], c.ir);
        }
    }

    std::sort(costs.begin(), costs.end(),
              [](const FnCost& a, const FnCost& b) { return a.ir > b.ir; });

    ProfileResult result;
    result.target_binary = binary_path;
    result.duration_ms   = duration_ms;
    result.total_samples = total_ir;

    size_t limit = std::min<size_t>(50, costs.size());
    for (size_t i = 0; i < limit; ++i) {
        Hotspot h;
        h.symbol        = costs[i].name;
        h.self_samples  = costs[i].ir;
        h.total_samples = inclusive.count(costs[i].name) ? inclusive[costs[i].name] : costs[i].ir;
        h.call_count    = costs[i].ir;
        h.self_pct      = (total_ir > 0) ? (100.0 * costs[i].ir / total_ir) : 0.0;
        h.total_pct     = (total_ir > 0) ? (100.0 * h.total_samples / total_ir) : 0.0;
        result.hotspots.push_back(h);
    }

    // Populate call graph edges
    for (const auto& c : costs) {
        for (const auto& [caller, ir] : c.callers) {
            result.call_graph.push_back({caller, c.name, ir});
        }
    }

    extern std::string generate_flamegraph_svg(const ProfileResult& result);
    extern std::string generate_flamegraph_json(const std::vector<Hotspot>& hotspots);

    result.flamegraph_svg  = generate_flamegraph_svg(result);
    result.flamegraph_json = generate_flamegraph_json(result.hotspots);

    return result;
}

// ---------------------------------------------------------------------------
// Temp file helper
// ---------------------------------------------------------------------------
static std::string make_tmp_path(const std::string& prefix) {
    char buf[256];
    snprintf(buf, sizeof(buf), "/tmp/%s.%d", prefix.c_str(), static_cast<int>(getpid()));
    return std::string(buf);
}

static void remove_if_exists(const std::string& path) {
    ::unlink(path.c_str());
}

// ---------------------------------------------------------------------------
// Profiler::Impl
// ---------------------------------------------------------------------------
class Profiler::Impl {
public:
    explicit Impl(const ProfileConfig& config) : config_(config) {}

    // Returns exit code via out_rc, captures output in out_output
    void profile_binary_callgrind(const std::string& binary_path,
                                    const std::vector<std::string>& args,
                                    const std::string& out_file,
                                    int& out_rc,
                                    std::string& out_output) {
        std::vector<std::string> cmd;
        cmd.push_back("valgrind");
        cmd.push_back("--tool=callgrind");
        cmd.push_back("--callgrind-out-file=" + out_file);
        if (!config_.include_kernel) {
            cmd.push_back("--separate-threads=no");
        }
        cmd.push_back("--");
        cmd.push_back(binary_path);
        for (const auto& arg : args) cmd.push_back(arg);

        // Run and capture both exit code and output
        out_rc = run_and_wait_capture(cmd, out_output);
        if (out_rc == 127) {
            throw ProfilerException("valgrind not found – please install valgrind");
        }
    }

    void profile_binary_perf(const std::string& binary_path,
                                      const std::vector<std::string>& args,
                                      const std::string& perf_data,
                                      const std::string& script_out) {
        // perf record
        {
            std::vector<std::string> cmd;
            cmd.push_back("perf");
            cmd.push_back("record");
            cmd.push_back("-F");
            cmd.push_back(std::to_string(config_.frequency_hz));
            cmd.push_back("-g");
            cmd.push_back("--call-graph");
            cmd.push_back("dwarf,65528");
            if (!config_.include_kernel) cmd.push_back("--user-callchains");
            cmd.push_back("-o"); cmd.push_back(perf_data);
            cmd.push_back("--");
            cmd.push_back(binary_path);
            for (const auto& arg : args) cmd.push_back(arg);

            int rc = run_and_wait(cmd);
            if (rc == 127) {
                throw ProfilerException("perf not found – please install linux-perf");
            }
        }
        // perf script → text
        {
            std::vector<std::string> cmd;
            cmd.push_back("perf");
            cmd.push_back("script");
            cmd.push_back("-i"); cmd.push_back(perf_data);
            // redirect stdout to script_out via shell wrapper not available;
            // run_and_wait captures output — write it manually
            std::vector<char*> c_argv;
            for (auto& s : cmd) c_argv.push_back(const_cast<char*>(s.c_str()));
            c_argv.push_back(nullptr);

            int pipefd[2];
            if (pipe(pipefd) == -1)
                throw ProfilerException(std::string("pipe: ") + strerror(errno));
            pid_t child = fork();
            if (child == -1) { close(pipefd[0]); close(pipefd[1]);
                throw ProfilerException(std::string("fork: ") + strerror(errno)); }
            if (child == 0) {
                close(pipefd[0]);
                dup2(pipefd[1], STDOUT_FILENO);
                close(pipefd[1]);
                execvp(c_argv[0], c_argv.data());
                _exit(127);
            }
            close(pipefd[1]);
            // Write piped output to script_out file
            FILE* out = fopen(script_out.c_str(), "w");
            if (!out) { close(pipefd[0]); throw ProfilerException("fopen script_out"); }
            std::array<char, 4096> buf;
            ssize_t n;
            while ((n = read(pipefd[0], buf.data(), buf.size())) > 0)
                fwrite(buf.data(), 1, n, out);
            fclose(out);
            close(pipefd[0]);
            int status = 0; waitpid(child, &status, 0);
            int rc = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
            fprintf(stderr, "[perf] script exit code: %d\n", rc);
            fflush(stderr);
        }
    }

    ProfileResult profile_binary(const std::string& binary_path,
                                 const std::vector<std::string>& args) {
        auto start = std::chrono::steady_clock::now();

        BinaryRuntime rt = detect_binary_runtime(binary_path);
        fprintf(stderr, "[profiler] detected runtime: %s\n",
            rt == BinaryRuntime::GO   ? "go"   :
            rt == BinaryRuntime::RUST ? "rust" : "native");
        fflush(stderr);

        std::vector<FnCost> costs;

        // Use perf sampling for all ELF binaries - much faster than callgrind
        // (5-10% overhead vs 10-50x slowdown) and captures real execution
        std::string perf_data   = make_tmp_path("perf_data");
        std::string script_out  = make_tmp_path("perf_script");
        remove_if_exists(perf_data);
        remove_if_exists(script_out);

        profile_binary_perf(binary_path, args, perf_data, script_out);

        auto end = std::chrono::steady_clock::now();
        uint32_t duration_ms = static_cast<uint32_t>(
            std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count());

        costs = parse_perf_script_output(script_out);
        remove_if_exists(perf_data);
        remove_if_exists(script_out);

        if (costs.empty()) {
            throw ProfilerException(
                "perf produced no output for " + binary_path +
                ". Ensure perf_event_paranoid <= 1 and binary has debug info.");
        }
        return build_result(costs, binary_path, duration_ms);
    }

    ProfileResult profile_pid(pid_t pid) {
        auto start = std::chrono::steady_clock::now();

        std::string perf_data   = make_tmp_path("perf_pid_data");
        std::string script_out  = make_tmp_path("perf_pid_script");
        remove_if_exists(perf_data);
        remove_if_exists(script_out);

        // perf attach to running process
        {
            std::vector<std::string> cmd;
            cmd.push_back("perf");
            cmd.push_back("record");
            cmd.push_back("-F");
            cmd.push_back(std::to_string(config_.frequency_hz));
            cmd.push_back("-g");
            cmd.push_back("--call-graph");
            cmd.push_back("dwarf,65528");
            if (!config_.include_kernel) cmd.push_back("--user-callchains");
            cmd.push_back("-p"); cmd.push_back(std::to_string(pid));
            cmd.push_back("-o"); cmd.push_back(perf_data);
            cmd.push_back("--duration"); cmd.push_back(std::to_string(config_.duration_seconds));

            int rc = run_and_wait(cmd);
            if (rc == 127) {
                throw ProfilerException("perf not found – please install linux-perf");
            }
        }

        // perf script → text
        {
            std::vector<std::string> cmd;
            cmd.push_back("perf");
            cmd.push_back("script");
            cmd.push_back("-i"); cmd.push_back(perf_data);

            std::vector<char*> c_argv;
            for (auto& s : cmd) c_argv.push_back(const_cast<char*>(s.c_str()));
            c_argv.push_back(nullptr);

            int pipefd[2];
            if (pipe(pipefd) == -1)
                throw ProfilerException(std::string("pipe: ") + strerror(errno));
            pid_t child = fork();
            if (child == -1) { close(pipefd[0]); close(pipefd[1]);
                throw ProfilerException(std::string("fork: ") + strerror(errno)); }
            if (child == 0) {
                close(pipefd[0]);
                dup2(pipefd[1], STDOUT_FILENO);
                close(pipefd[1]);
                execvp(c_argv[0], c_argv.data());
                _exit(127);
            }
            close(pipefd[1]);
            FILE* out = fopen(script_out.c_str(), "w");
            if (!out) { close(pipefd[0]); throw ProfilerException("fopen script_out"); }
            std::array<char, 4096> buf;
            ssize_t n;
            while ((n = read(pipefd[0], buf.data(), buf.size())) > 0)
                fwrite(buf.data(), 1, n, out);
            fclose(out);
            close(pipefd[0]);
            int status = 0; waitpid(child, &status, 0);
        }

        auto end = std::chrono::steady_clock::now();
        uint32_t duration_ms = static_cast<uint32_t>(
            std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count());

        std::vector<FnCost> costs = parse_perf_script_output(script_out);
        remove_if_exists(perf_data);
        remove_if_exists(script_out);

        if (costs.empty()) {
            throw ProfilerException(
                "perf produced no output for pid " + std::to_string(pid) +
                ". Ensure perf_event_paranoid <= 1 and process has debug info.");
        }

        return build_result(costs, "", duration_ms);
    }

private:
    ProfileConfig config_;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
Profiler::Profiler(const ProfileConfig& config)
    : impl_(std::make_unique<Impl>(config)) {}

Profiler::~Profiler() = default;

ProfileResult Profiler::profile_pid(pid_t pid) {
    return impl_->profile_pid(pid);
}

ProfileResult Profiler::profile_binary(const std::string& binary_path,
                                       const std::vector<std::string>& args) {
    return impl_->profile_binary(binary_path, args);
}

} // namespace realbench
