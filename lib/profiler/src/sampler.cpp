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

namespace realbench {

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
struct FnCost {
    std::string name;
    uint64_t ir      = 0;  // self instruction references
    // caller → total IR attributed to that caller (for call-graph)
    std::unordered_map<std::string, uint64_t> callers;
};

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

// ---------------------------------------------------------------------------
// Run a command, capture its combined stdout+stderr, wait for it.
// Prints command, output, and exit code to our stderr for diagnostics.
// ---------------------------------------------------------------------------
static int run_and_wait(const std::vector<std::string>& argv) {
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
    std::string output;
    std::array<char, 512> buf;
    ssize_t n;
    while ((n = read(pipefd[0], buf.data(), buf.size())) > 0) {
        output.append(buf.data(), n);
        if (output.size() > 8192) break; // cap at 8 KB
    }
    close(pipefd[0]);

    int status = 0;
    waitpid(child, &status, 0);
    int rc = WIFEXITED(status) ? WEXITSTATUS(status) : -1;

    if (!output.empty()) {
        fprintf(stderr, "[callgrind] output:\n%s\n", output.c_str());
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

    ProfileResult profile_binary(const std::string& binary_path,
                                 const std::vector<std::string>& args) {
        auto start = std::chrono::steady_clock::now();

        std::string out_file = make_tmp_path("callgrind_out");
        remove_if_exists(out_file);

        // Build valgrind command:
        //   valgrind --tool=callgrind --callgrind-out-file=<out>
        //            [--collect-systime=yes if kernel requested]
        //            -- <binary> [args...]
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

        int rc = run_and_wait(cmd);
        if (rc == 127) {
            throw ProfilerException("valgrind not found – please install valgrind");
        }

        auto end = std::chrono::steady_clock::now();
        uint32_t duration_ms = static_cast<uint32_t>(
            std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count());

        std::vector<FnCost> costs = parse_callgrind_output(out_file);
        remove_if_exists(out_file);

        if (costs.empty()) {
            throw ProfilerException(
                "callgrind produced no output (rc=" + std::to_string(rc) +
                "). Check that the binary exists and runs correctly.");
        }

        return build_result(costs, binary_path, duration_ms);
    }

    ProfileResult profile_pid(pid_t pid) {
        auto start = std::chrono::steady_clock::now();

        std::string out_file = make_tmp_path("callgrind_pid_out");
        remove_if_exists(out_file);

        // callgrind --pid attaches to a running process (requires ptrace permission)
        std::vector<std::string> cmd;
        cmd.push_back("valgrind");
        cmd.push_back("--tool=callgrind");
        cmd.push_back("--callgrind-out-file=" + out_file);
        cmd.push_back("--pid=" + std::to_string(pid));

        int rc = run_and_wait(cmd);
        if (rc == 127) {
            throw ProfilerException("valgrind not found – please install valgrind");
        }

        auto end = std::chrono::steady_clock::now();
        uint32_t duration_ms = static_cast<uint32_t>(
            std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count());

        std::vector<FnCost> costs = parse_callgrind_output(out_file);
        remove_if_exists(out_file);

        if (costs.empty()) {
            throw ProfilerException(
                "callgrind produced no output for pid " + std::to_string(pid) +
                " (rc=" + std::to_string(rc) + ")");
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
