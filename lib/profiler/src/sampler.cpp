#include "profiler.h"
#include <algorithm>
#include <array>
#include <cerrno>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#include <unordered_map>
#include <vector>

namespace realbench {

// ---------------------------------------------------------------------------
// Rust demangling function
// ---------------------------------------------------------------------------
static std::string demangle_rust(const std::string& mangled) {
  // Rust symbols start with _R (Rust 1.37+) or _ZN (legacy)
  if (mangled.empty() || (mangled.substr(0, 2) != "_R" && mangled.substr(0, 3) != "_ZN")) {
    return mangled;
  }
  
  // Try to use rustc --print demangle if available
  std::vector<std::string> cmd;
  cmd.push_back("rustc");
  cmd.push_back("--print");
  cmd.push_back("demangle");
  cmd.push_back(mangled);
  
  std::vector<char*> c_argv;
  for (auto& s : cmd)
    c_argv.push_back(const_cast<char*>(s.c_str()));
  c_argv.push_back(nullptr);
  
  int pipefd[2];
  if (pipe(pipefd) == -1)
    return mangled; // fallback to original
    
  pid_t child = fork();
  if (child == -1) {
    close(pipefd[0]);
    close(pipefd[1]);
    return mangled; // fallback to original
  }
  
  if (child == 0) {
    close(pipefd[0]);
    dup2(pipefd[1], STDOUT_FILENO);
    close(pipefd[1]);
    execvp(c_argv[0], c_argv.data());
    _exit(127); // rustc not found
  }
  
  close(pipefd[1]);
  
  // Read demangled output
  std::string output;
  std::array<char, 1024> buf;
  ssize_t n;
  while ((n = read(pipefd[0], buf.data(), buf.size())) > 0)
    output.append(buf.data(), n);
  close(pipefd[0]);
  
  int status = 0;
  waitpid(child, &status, 0);
  int rc = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
  
  // If rustc demangle succeeded and produced output, use it
  if (rc == 0 && !output.empty()) {
    // Remove trailing newline
    if (!output.empty() && output.back() == '\n')
      output.pop_back();
    return output;
  }
  
  // Fallback: basic Rust symbol cleanup for _ZN format
  if (mangled.substr(0, 3) == "_ZN") {
    // Basic _ZN demangling: _ZN4mainE -> main
    std::string result;
    size_t i = 3; // skip _ZN
    while (i < mangled.length()) {
      // Parse length prefix
      size_t len = 0;
      while (i < mangled.length() && std::isdigit(mangled[i])) {
        len = len * 10 + (mangled[i] - '0');
        i++;
      }
      if (len == 0 || i + len > mangled.length())
        break;
      
      // Extract the component
      std::string component = mangled.substr(i, len);
      if (!result.empty())
        result += "::";
      result += component;
      i += len;
    }
    return result;
  }
  
  return mangled; // fallback to original
}

// ---------------------------------------------------------------------------
// Function cost record (shared by callgrind and perf parsers)
// ---------------------------------------------------------------------------
struct FnCost {
  std::string name;
  uint64_t ir = 0; // self instruction references
  // caller → total IR attributed to that caller (for call-graph)
  std::unordered_map<std::string, uint64_t> callers;
};

// ---------------------------------------------------------------------------
// ELF binary type detection
// ---------------------------------------------------------------------------
enum class BinaryRuntime { UNKNOWN, NATIVE, GO, RUST };

static BinaryRuntime detect_binary_runtime(const std::string &path) {
  std::ifstream f(path, std::ios::binary);
  if (!f)
    return BinaryRuntime::UNKNOWN;

  // Read ELF header (64 bytes)
  unsigned char ehdr[64];
  if (!f.read(reinterpret_cast<char *>(ehdr), sizeof(ehdr)))
    return BinaryRuntime::UNKNOWN;
  if (ehdr[0] != 0x7f || ehdr[1] != 'E' || ehdr[2] != 'L' || ehdr[3] != 'F')
    return BinaryRuntime::UNKNOWN;

  // Section header offset / entry size / count (ELF64)
  uint64_t shoff = 0;
  uint16_t shentsize = 0, shnum = 0, shstrndx = 0;
  memcpy(&shoff, ehdr + 40, 8);
  memcpy(&shentsize, ehdr + 58, 2);
  memcpy(&shnum, ehdr + 60, 2);
  memcpy(&shstrndx, ehdr + 62, 2);

  if (shoff == 0 || shentsize == 0 || shnum == 0 || shstrndx == 0)
    return BinaryRuntime::NATIVE;

  // Read section name string table header
  f.seekg(static_cast<std::streamoff>(shoff + (uint64_t)shstrndx * shentsize));
  unsigned char shdr[64];
  if (!f.read(reinterpret_cast<char *>(shdr), sizeof(shdr)))
    return BinaryRuntime::NATIVE;
  uint64_t strtab_off = 0, strtab_size = 0;
  memcpy(&strtab_off, shdr + 24, 8);
  memcpy(&strtab_size, shdr + 32, 8);
  if (strtab_off == 0 || strtab_size > 1024 * 1024)
    return BinaryRuntime::NATIVE;

  std::string strtab(strtab_size, '\0');
  f.seekg(static_cast<std::streamoff>(strtab_off));
  if (!f.read(&strtab[0], strtab_size))
    return BinaryRuntime::NATIVE;

  bool has_go_buildid = false;
  bool has_rustc = false;

  for (int i = 0; i < shnum; ++i) {
    f.seekg(static_cast<std::streamoff>(shoff + (uint64_t)i * shentsize));
    unsigned char sh[64];
    if (!f.read(reinterpret_cast<char *>(sh), sizeof(sh)))
      break;
    uint32_t name_idx = 0;
    memcpy(&name_idx, sh, 4);
    if (name_idx >= strtab_size)
      continue;
    std::string sname(strtab.c_str() + name_idx);
    if (sname == ".go.buildinfo" || sname == ".gosymtab" ||
        sname == ".gopclntab")
      has_go_buildid = true;
    if (sname == ".rustc" || sname.find(".debug_info") == 0) {
      // .rustc section is unique to rustc-compiled binaries
      if (sname == ".rustc")
        has_rustc = true;
    }
  }

  if (has_go_buildid)
    return BinaryRuntime::GO;
  if (has_rustc)
    return BinaryRuntime::RUST;
  return BinaryRuntime::NATIVE;
}

// ---------------------------------------------------------------------------
// addr2line batch resolution
//
// Groups {addr, raw_sym} pairs by DSO binary, then calls addr2line once per
// binary to resolve addresses to "function @ file:line" strings.
// Falls back to raw_sym if addr2line is unavailable or the binary has no
// DWARF debug info (i.e. addr2line returns "??" for file or function).
// ---------------------------------------------------------------------------
struct AddrEntry {
  uint64_t addr;       // virtual address from perf
  std::string raw_sym; // symbol name as reported by perf (may contain +0xOFF)
  std::string dso;     // path to the ELF binary
};

static std::string strip_offset(const std::string &sym) {
  // Remove "+0xHEX" suffix so we can use the bare function name
  auto plus = sym.rfind("+0x");
  if (plus != std::string::npos)
    return sym.substr(0, plus);
  return sym;
}

static std::unordered_map<std::string, std::string>
resolve_addrs_with_addr2line(const std::vector<AddrEntry> &entries) {
  // key: "dso:addr" → resolved label
  std::unordered_map<std::string, std::string> result;

  // Group by dso
  std::unordered_map<std::string, std::vector<const AddrEntry *>> by_dso;
  for (const auto &e : entries) {
    if (!e.dso.empty() && e.dso[0] == '/') {
      by_dso[e.dso].push_back(&e);
    }
  }

  for (const auto &[dso, group] : by_dso) {
    // Build addr2line command
    std::vector<std::string> cmd;
    cmd.push_back("addr2line");
    cmd.push_back("-e");
    cmd.push_back(dso);
    cmd.push_back("-f"); // print function name
    cmd.push_back("-C"); // demangle
    for (const auto *e : group) {
      char buf[32];
      snprintf(buf, sizeof(buf), "0x%lx", e->addr);
      cmd.push_back(buf);
    }

    // Pipe addr2line output
    std::vector<char *> c_argv;
    for (auto &s : cmd)
      c_argv.push_back(const_cast<char *>(s.c_str()));
    c_argv.push_back(nullptr);

    int pfd[2];
    if (pipe(pfd) == -1)
      continue;
    pid_t child = fork();
    if (child == -1) {
      close(pfd[0]);
      close(pfd[1]);
      continue;
    }
    if (child == 0) {
      close(pfd[0]);
      dup2(pfd[1], STDOUT_FILENO);
      // silence stderr from addr2line
      int devnull = open("/dev/null", O_WRONLY);
      if (devnull >= 0) {
        dup2(devnull, STDERR_FILENO);
        close(devnull);
      }
      close(pfd[1]);
      execvp(c_argv[0], c_argv.data());
      _exit(127);
    }
    close(pfd[1]);

    // Read all output
    std::string output;
    std::array<char, 4096> buf;
    ssize_t n;
    while ((n = read(pfd[0], buf.data(), buf.size())) > 0)
      output.append(buf.data(), n);
    close(pfd[0]);
    int status = 0;
    waitpid(child, &status, 0);
    int rc = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
    if (rc == 127) {
      fprintf(stderr,
              "[perf] addr2line not found, skipping DWARF resolution\n");
      fflush(stderr);
      break; // no point trying other DSOs
    }

    // addr2line output (without -i): exactly 2 lines per address:
    //   line 1: demangled function name  (or "??" if unknown)
    //   line 2: file:line               (or "??:0" if unknown)
    std::istringstream ss(output);
    std::string fn_line, loc_line;
    for (size_t idx = 0; idx < group.size(); ++idx) {
      if (!std::getline(ss, fn_line) || !std::getline(ss, loc_line))
        break;

      const AddrEntry *e = group[idx];
      char addr_key[64];
      snprintf(addr_key, sizeof(addr_key), "%s:0x%lx", dso.c_str(), e->addr);

      bool fn_known = (fn_line != "??" && !fn_line.empty());
      bool loc_known = (loc_line.find("??") == std::string::npos &&
                        loc_line != "?:?" && !loc_line.empty());

      if (fn_known && loc_known) {
        std::string loc = loc_line;
        auto slash = loc.rfind('/');
        if (slash != std::string::npos)
          loc = loc.substr(slash + 1);
        result[addr_key] = fn_line + " @ " + loc;
      } else if (fn_known) {
        result[addr_key] = fn_line;
      }
      // else: no DWARF info → leave unset, fallback to raw_sym
    }
  }
  return result;
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
static std::vector<FnCost>
parse_perf_script_output(const std::string &path,
                         const std::string &binary_path) {
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
  // Also collect all (addr, sym, dso) tuples for batch addr2line resolution.
  struct RawFrame {
    uint64_t addr;
    std::string sym;
    std::string dso;
  };
  std::vector<std::vector<RawFrame>> all_stacks;
  std::vector<RawFrame> cur_stack;
  bool in_sample = false;

  auto flush_stack = [&]() {
    if (!cur_stack.empty()) {
      all_stacks.push_back(cur_stack);
      cur_stack.clear();
    }
    in_sample = false;
  };

  std::string line;
  while (std::getline(f, line)) {
    if (line.empty()) {
      flush_stack();
      continue;
    }
    if (line[0] != '\t' && line[0] != ' ') {
      flush_stack();
      in_sample = true;
      continue;
    }
    if (!in_sample)
      continue;
    // Frame line: "\t<addr> <symbol> (<dso>)"
    // Note: <symbol> may contain spaces (C++ templates like "std::vector<int, std::allocator<int>>")
    // Strategy: find address first, find DSO (in parentheses) last, everything between is symbol
    std::istringstream iss(line);
    std::string addr_str;
    if (!(iss >> addr_str))
      continue;

    // Parse hex address
    uint64_t addr = 0;
    try {
      addr = std::stoull(addr_str, nullptr, 16);
    } catch (...) {
      continue;
    }

    // Find DSO: look for '(' and ')' at the end of the line
    size_t paren_open = line.find('(', addr_str.length());
    size_t paren_close = line.rfind(')');

    std::string sym;
    std::string dso;

    if (paren_open != std::string::npos && paren_close != std::string::npos && paren_close > paren_open) {
      // Extract DSO (inside parentheses)
      dso = line.substr(paren_open + 1, paren_close - paren_open - 1);
      // Extract symbol: everything between address and opening parenthesis, trimmed
      size_t sym_start = addr_str.length();
      while (sym_start < paren_open && std::isspace(line[sym_start]))
        ++sym_start;
      size_t sym_end = paren_open;
      while (sym_end > sym_start && std::isspace(line[sym_end - 1]))
        --sym_end;
      sym = line.substr(sym_start, sym_end - sym_start);
    } else {
      // Fallback: use old parsing if parentheses not found
      std::string rest;
      if (iss >> sym >> rest) {
        if (!rest.empty() && rest.front() == '(') {
          dso = rest.substr(1);
          if (!dso.empty() && dso.back() == ')')
            dso.pop_back();
        }
      }
    }

    if (sym == "[unknown]" || sym.empty())
      continue;
    // Prefer the profiled binary itself for resolution
    if (dso.empty() || dso == "[unknown]")
      dso = binary_path;

    cur_stack.push_back({addr, sym, dso});
  }
  flush_stack();

  // --- addr2line batch resolution ---
  // Collect unique (addr, dso) pairs
  std::vector<AddrEntry> addr_entries;
  {
    std::unordered_map<std::string, bool> seen;
    for (const auto &stk : all_stacks) {
      for (const auto &fr : stk) {
        if (fr.addr == 0)
          continue;
        char key[128];
        snprintf(key, sizeof(key), "%s:0x%lx", fr.dso.c_str(), fr.addr);
        if (!seen[key]) {
          seen[key] = true;
          addr_entries.push_back({fr.addr, fr.sym, fr.dso});
        }
      }
    }
  }
  auto resolved = resolve_addrs_with_addr2line(addr_entries);

  // --- Build fn_map using resolved names where available ---
  auto resolve_sym_name = [&](const RawFrame &fr) -> std::string {
    if (fr.addr != 0) {
      char key[128];
      snprintf(key, sizeof(key), "%s:0x%lx", fr.dso.c_str(), fr.addr);
      auto it = resolved.find(key);
      if (it != resolved.end())
        return it->second;
    }
    // Fallback: strip +0xOFFSET suffix for cleaner display
    std::string name = strip_offset(fr.sym);
    if (name.empty()) {
      // Symbol was only an offset (e.g. "+0x1234") — use raw address so
      // we still have a non-empty key and a meaningful display string.
      char buf[32];
      snprintf(buf, sizeof(buf), "0x%lx", fr.addr);
      return std::string(buf);
    }
    return name;
  };

  for (const auto &stk : all_stacks) {
    if (stk.empty())
      continue;
    std::string leaf = resolve_sym_name(stk[0]);
    fn_map[leaf].name = leaf;
    fn_map[leaf].ir += 1;
    for (size_t i = 1; i < stk.size(); ++i) {
      std::string callee = resolve_sym_name(stk[i - 1]);
      std::string caller = resolve_sym_name(stk[i]);
      fn_map[caller].name = caller;
      fn_map[callee].callers[caller] += 1;
    }
  }

  std::vector<FnCost> result;
  result.reserve(fn_map.size());
  for (auto &[name, cost] : fn_map) {
    if (cost.ir > 0 || !cost.callers.empty())
      result.push_back(std::move(cost));
  }
  fprintf(stderr,
          "[perf] parsed %zu functions (addr2line resolved %zu addrs)\n",
          result.size(), resolved.size());
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
static std::string resolve_sym(const std::string &token,
                               std::unordered_map<int, std::string> &id_map) {
  if (token.empty())
    return token;
  if (token[0] == '(') {
    size_t close = token.find(')');
    if (close == std::string::npos)
      return token;
    int id = std::stoi(token.substr(1, close - 1));
    std::string rest =
        (close + 1 < token.size()) ? token.substr(close + 1) : "";
    // strip leading space
    if (!rest.empty() && rest[0] == ' ')
      rest = rest.substr(1);
    if (!rest.empty()) {
      id_map[id] = rest;
      return rest;
    }
    auto it = id_map.find(id);
    return (it != id_map.end()) ? it->second : ("id:" + std::to_string(id));
  }
  return token;
}

static std::vector<FnCost> parse_callgrind_output(const std::string &path) {
  std::unordered_map<std::string, FnCost> fn_map;
  std::unordered_map<int, std::string> sym_ids; // compressed id → name

  std::ifstream f(path);
  if (!f.is_open()) {
    fprintf(stderr, "[callgrind] output file not found: %s\n", path.c_str());
    fflush(stderr);
    return {};
  }
  fprintf(stderr, "[callgrind] parsing output file: %s\n", path.c_str());
  fflush(stderr);

  std::string current_fn;
  std::string current_cfn;        // current callee (cfn=)
  bool next_cost_is_call = false; // true if next cost line belongs to cfn

  std::string line;
  while (std::getline(f, line)) {
    if (line.empty()) {
      current_cfn.clear();
      next_cost_is_call = false;
      continue;
    }

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
    if (!std::isdigit(first) && first != '+' && first != '-' && first != '*')
      continue;
    if (current_fn.empty())
      continue;

    std::istringstream iss(line);
    std::string pos_token;
    iss >> pos_token; // position column – skip
    uint64_t ir = 0;
    if (!(iss >> ir))
      continue;

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
  for (auto &[name, cost] : fn_map) {
    if (cost.ir > 0 || !cost.callers.empty())
      result.push_back(std::move(cost));
  }
  fprintf(stderr, "[callgrind] parsed %zu functions\n", result.size());
  fflush(stderr);
  return result;
}

// ---------------------------------------------------------------------------
// Run a command, capture its combined stdout+stderr to out_output, wait for it.
// Prints command, output, and exit code to our stderr for diagnostics.
// ---------------------------------------------------------------------------
static int run_and_wait_capture(const std::vector<std::string> &argv,
                                std::string &out_output) {
  std::vector<char *> c_argv;
  c_argv.reserve(argv.size() + 1);

  std::string cmd_log = "[profiler] running:";
  for (const auto &s : argv) {
    cmd_log += ' ';
    cmd_log += s;
    c_argv.push_back(const_cast<char *>(s.c_str()));
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
    close(pipefd[0]);
    close(pipefd[1]);
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
    if (out_output.size() > 8192)
      break; // cap at 8 KB
  }
  close(pipefd[0]);

  int status = 0;
  waitpid(child, &status, 0);
  int rc = WIFEXITED(status) ? WEXITSTATUS(status) : -1;

  if (!out_output.empty()) {
    fprintf(stderr, "[profiler] output:\n%s\n", out_output.c_str());
  }
  fprintf(stderr, "[profiler] exit code: %d\n", rc);
  fflush(stderr);
  return rc;
}

static int run_and_wait(const std::vector<std::string> &argv) {
  std::string dummy;
  return run_and_wait_capture(argv, dummy);
}

// ---------------------------------------------------------------------------
// Fork a child, run argv[0] with argv, pipe its stdout to out_path.
// ---------------------------------------------------------------------------
static void run_and_pipe_to_file(const std::vector<std::string> &argv,
                                 const std::string &out_path) {
  std::vector<char *> c_argv;
  for (const auto &s : argv)
    c_argv.push_back(const_cast<char *>(s.c_str()));
  c_argv.push_back(nullptr);

  int pipefd[2];
  if (pipe(pipefd) == -1)
    throw ProfilerException(std::string("pipe: ") + strerror(errno));
  pid_t child = fork();
  if (child == -1) {
    close(pipefd[0]);
    close(pipefd[1]);
    throw ProfilerException(std::string("fork: ") + strerror(errno));
  }
  if (child == 0) {
    close(pipefd[0]);
    dup2(pipefd[1], STDOUT_FILENO);
    close(pipefd[1]);
    execvp(c_argv[0], c_argv.data());
    _exit(127);
  }
  close(pipefd[1]);

  FILE *out = fopen(out_path.c_str(), "w");
  if (!out) {
    close(pipefd[0]);
    throw ProfilerException("fopen: " + out_path);
  }
  std::array<char, 4096> buf;
  ssize_t n;
  while ((n = read(pipefd[0], buf.data(), buf.size())) > 0)
    fwrite(buf.data(), 1, n, out);
  fclose(out);
  close(pipefd[0]);

  int status = 0;
  waitpid(child, &status, 0);
  int rc = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
  fprintf(stderr, "[perf] script exit code: %d\n", rc);
  fflush(stderr);
}

// ---------------------------------------------------------------------------
// Build a ProfileResult from parsed callgrind cost data
// ---------------------------------------------------------------------------
static ProfileResult build_result(std::vector<FnCost> &costs,
                                  const std::string &binary_path,
                                  uint32_t duration_ms) {
  // Detect binary runtime for appropriate demangling (SPEC §12)
  BinaryRuntime rt = BinaryRuntime::NATIVE; // default
  if (!binary_path.empty()) {
    rt = detect_binary_runtime(binary_path);
  }

  // Apply runtime-specific demangling to function names
  for (auto &c : costs) {
    if (rt == BinaryRuntime::RUST) {
      c.name = demangle_rust(c.name);
    }
    // Note: C++ demangling is already handled by addr2line -C flag
    // Note: Go symbols don't need demangling
  }

  // total_ir = sum of all self costs (used for percentages)
  uint64_t total_ir = 0;
  for (const auto &c : costs)
    total_ir += c.ir;

  // Build inclusive cost map: total = self + all incoming call-edge IR
  std::unordered_map<std::string, uint64_t> inclusive;
  for (const auto &c : costs) {
    inclusive[c.name] += c.ir;
    for (const auto &[caller, ir] : c.callers) {
      (void)caller;
      inclusive[c.name] = std::max(inclusive[c.name], c.ir);
    }
  }

  // Aggregate costs by base symbol name (strip addresses/offsets for grouping)
  // This handles cases where same function appears at multiple addresses
  auto get_base_name = [](const std::string& name) -> std::string {
    // Strip leading hex address if present (e.g., "0xabc memory_stress_test")
    size_t first_space = name.find(' ');
    if (first_space != std::string::npos) {
      std::string prefix = name.substr(0, first_space);
      // Check if prefix looks like a hex address (starts with 0x or is all hex digits)
      bool is_hex = true;
      for (size_t i = 0; i < prefix.size(); ++i) {
        char c = prefix[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
          is_hex = false;
          break;
        }
      }
      if (is_hex && prefix.length() >= 4) {
        // Return just the function name part
        std::string rest = name.substr(first_space + 1);
        // Also strip any +0xOFFSET suffix
        size_t plus = rest.rfind("+0x");
        if (plus != std::string::npos) {
          return rest.substr(0, plus);
        }
        return rest;
      }
    }
    // Strip +0xOFFSET suffix from non-address-prefixed names
    size_t plus = name.rfind("+0x");
    if (plus != std::string::npos) {
      return name.substr(0, plus);
    }
    return name;
  };

  std::unordered_map<std::string, uint64_t> aggregated_self;
  std::unordered_map<std::string, uint64_t> aggregated_total;
  for (const auto &c : costs) {
    std::string base = get_base_name(c.name);
    aggregated_self[base] += c.ir;
    aggregated_total[base] += inclusive.count(c.name) ? inclusive[c.name] : c.ir;
  }

  // Convert aggregated data to sorted vector
  std::vector<std::pair<std::string, uint64_t>> aggregated;
  for (const auto &[name, ir] : aggregated_self) {
    aggregated.push_back({name, ir});
  }
  std::sort(aggregated.begin(), aggregated.end(),
            [](const auto &a, const auto &b) { return a.second > b.second; });

  ProfileResult result;
  result.target_binary = binary_path;
  result.duration_ms = duration_ms;
  result.total_samples = total_ir;

  size_t limit = std::min<size_t>(50, aggregated.size());
  for (size_t i = 0; i < limit; ++i) {
    const auto& [name, self_ir] = aggregated[i];
    Hotspot h;
    h.symbol = name;
    h.self_samples = self_ir;
    h.total_samples = aggregated_total[name];
    h.call_count = self_ir;
    h.self_pct = (total_ir > 0) ? (100.0 * self_ir / total_ir) : 0.0;
    h.total_pct = (total_ir > 0) ? (100.0 * h.total_samples / total_ir) : 0.0;
    result.hotspots.push_back(h);
  }

  // Populate call graph edges
  for (const auto &c : costs) {
    for (const auto &[caller, ir] : c.callers) {
      result.call_graph.push_back({caller, c.name, ir});
    }
  }

  extern std::string generate_flamegraph_svg(const ProfileResult &result);
  extern std::string generate_flamegraph_json(
      const std::vector<Hotspot> &hotspots);

  result.flamegraph_svg = generate_flamegraph_svg(result);
  result.flamegraph_json = generate_flamegraph_json(result.hotspots);

  return result;
}

// ---------------------------------------------------------------------------
// Temp file helper
// ---------------------------------------------------------------------------
static std::string make_tmp_path(const std::string &prefix) {
  char buf[256];
  snprintf(buf, sizeof(buf), "/tmp/%s.%d", prefix.c_str(),
           static_cast<int>(getpid()));
  return std::string(buf);
}

static void remove_if_exists(const std::string &path) {
  ::unlink(path.c_str());
}

// ---------------------------------------------------------------------------
// Profiler::Impl
// ---------------------------------------------------------------------------
class Profiler::Impl {
public:
  explicit Impl(const ProfileConfig &config) : config_(config) {}

  // Returns exit code via out_rc, captures output in out_output
  void profile_binary_callgrind(const std::string &binary_path,
                                const std::vector<std::string> &args,
                                const std::string &out_file, int &out_rc,
                                std::string &out_output) {
    std::vector<std::string> cmd;
    cmd.push_back("valgrind");
    cmd.push_back("--tool=callgrind");
    cmd.push_back("--callgrind-out-file=" + out_file);
    if (!config_.include_kernel) {
      cmd.push_back("--separate-threads=no");
    }
    cmd.push_back("--");
    cmd.push_back(binary_path);
    for (const auto &arg : args)
      cmd.push_back(arg);

    // Run and capture both exit code and output
    out_rc = run_and_wait_capture(cmd, out_output);
    if (out_rc == 127) {
      throw ProfilerException("valgrind not found – please install valgrind");
    }
  }

  void profile_binary_perf(const std::string &binary_path,
                           const std::vector<std::string> &args,
                           const std::string &perf_data,
                           const std::string &script_out) {
    // Detect binary runtime to choose appropriate call-graph strategy (SPEC §12)
    BinaryRuntime rt = detect_binary_runtime(binary_path);

    // perf record
    {
      auto cmd = build_perf_record_cmd(perf_data);
      // Override call-graph for Go (frame-pointer instead of DWARF)
      auto it = std::find(cmd.begin(), cmd.end(), "dwarf,65528");
      if (it != cmd.end() && rt == BinaryRuntime::GO)
        *it = "fp";
      cmd.push_back("--");
      cmd.push_back(binary_path);
      for (const auto &arg : args)
        cmd.push_back(arg);

      int rc = run_and_wait(cmd);
      if (rc == 127)
        throw ProfilerException("perf not found – please install linux-perf");
    }
    // perf script → text
    run_and_pipe_to_file({"perf", "script", "-i", perf_data}, script_out);
  }

  // ---------------------------------------------------------------------------
  // Build perf record command arguments (shared by profile_binary_perf and profile_pid)
  // ---------------------------------------------------------------------------
  std::vector<std::string> build_perf_record_cmd(const std::string &out_file) const {
    std::vector<std::string> cmd;
    cmd.push_back("perf");
    cmd.push_back("record");
    cmd.push_back("-F");
    cmd.push_back(std::to_string(config_.frequency_hz));
    cmd.push_back("-g");
    cmd.push_back("--call-graph");
    cmd.push_back("dwarf,65528");
    cmd.push_back("-m");
    cmd.push_back("16M");
    if (!config_.include_kernel)
      cmd.push_back("--user-callchains");
    cmd.push_back("-o");
    cmd.push_back(out_file);
    return cmd;
  }

  // ---------------------------------------------------------------------------
  // Build perf stat command arguments from hardware counter config
  // ---------------------------------------------------------------------------
  static std::vector<std::string> build_stat_events(const HardwareCounters &hw) {
    std::vector<std::string> events;
    if (hw.cycles) events.push_back("cycles");
    if (hw.instructions) events.push_back("instructions");
    if (hw.cache_references) events.push_back("cache-references");
    if (hw.cache_misses) events.push_back("cache-misses");
    if (hw.branch_instructions) events.push_back("branches");
    if (hw.branch_misses) events.push_back("branch-misses");
    if (hw.stalled_cycles_frontend) events.push_back("stalled-cycles-frontend");
    if (hw.stalled_cycles_backend) events.push_back("stalled-cycles-backend");
    if (hw.context_switches) events.push_back("cs");
    if (hw.cpu_migrations) events.push_back("migrations");
    if (hw.page_faults) {
      events.push_back("page-faults");
    }
    // Add custom counters
    for (const auto &custom : hw.custom) {
      events.push_back(custom);
    }
    // Default if nothing selected
    if (events.empty()) {
      events = {"cycles", "instructions", "cache-references", "cache-misses"};
    }
    return events;
  }

  // ---------------------------------------------------------------------------
  // Parse perf stat -x, output (CSV format)
  // Format: counter_value,unit,event_name,run_time,percentage,comment
  // Example: 5491605997,,cycles,1.614165346,40.18%,3.409 GHz
  // ---------------------------------------------------------------------------
  static std::vector<CounterResult> parse_perf_stat_output(const std::string &output) {
    std::vector<CounterResult> results;
    std::istringstream iss(output);
    std::string line;
    
    while (std::getline(iss, line)) {
      if (line.empty() || line[0] == '#') continue;
      
      std::istringstream line_iss(line);
      std::string value_str, unit, event_name, run_time, percentage, comment;
      
      if (!std::getline(line_iss, value_str, ',')) continue;
      if (!std::getline(line_iss, unit, ',')) continue;
      if (!std::getline(line_iss, event_name, ',')) continue;
      
      // Parse value (may be empty for not-supported counters)
      auto trim = [](std::string &s) {
        size_t start = s.find_first_not_of(" \t");
        size_t end = s.find_last_not_of(" \t");
        if (start == std::string::npos) s = "";
        else s = s.substr(start, end - start + 1);
      };
      trim(value_str);
      trim(event_name);
      trim(unit);

      CounterResult result;
      result.name = event_name;
      
      if (!value_str.empty() && value_str != "<not supported>" && value_str != "<not counted>") {
        try {
          // Handle numbers with commas (thousands separator)
          std::string value_clean = value_str;
          value_clean.erase(std::remove(value_clean.begin(), value_clean.end(), ','), value_clean.end());
          result.value = std::stoull(value_clean);
        } catch (...) {
          result.value = 0;
        }
      }
      
      // Read optional fields if present
      if (std::getline(line_iss, run_time, ',')) {
        trim(run_time);
        // run_time contains the time in seconds as string, not needed per counter
      }
      if (std::getline(line_iss, percentage, ',')) {
        trim(percentage);
        result.comment = percentage;
      }
      // Remaining fields go into comment
      std::string extra;
      while (std::getline(line_iss, extra, ',')) {
        trim(extra);
        if (!extra.empty() && result.comment.empty()) {
          result.comment = extra;
        }
      }
      
      results.push_back(result);
    }
    
    // Post-process: calculate IPC and other ratios
    uint64_t cycles = 0, instructions = 0;
    for (const auto &r : results) {
      if (r.name == "cycles") cycles = r.value;
      if (r.name == "instructions") instructions = r.value;
    }
    if (cycles > 0 && instructions > 0) {
      for (auto &r : results) {
        if (r.name == "instructions") {
          r.unit_ratio = static_cast<double>(instructions) / cycles;
          r.unit_name = "insn per cycle";
        }
      }
    }
    
    return results;
  }

  // ---------------------------------------------------------------------------
  // Profile binary using perf stat (counter mode - low overhead)
  // ---------------------------------------------------------------------------
  ProfileResult profile_binary_stat(const std::string &binary_path,
                                    const std::vector<std::string> &args) {
    auto start = std::chrono::steady_clock::now();
    
    // Build events list
    auto events = build_stat_events(config_.hw_counters);
    std::string events_str;
    for (size_t i = 0; i < events.size(); ++i) {
      if (i > 0) events_str += ",";
      events_str += events[i];
    }
    
    fprintf(stderr, "[profiler] stat mode with events: %s\n", events_str.c_str());
    fflush(stderr);
    
    // Run perf stat with CSV output
    std::vector<std::string> cmd;
    cmd.push_back("perf");
    cmd.push_back("stat");
    cmd.push_back("-x,");  // CSV separator
    cmd.push_back("-e");
    cmd.push_back(events_str);
    if (config_.stat_detailed) {
      cmd.push_back("-d");
    }
    cmd.push_back("-o");
    std::string stat_output = make_tmp_path("perf_stat");
    remove_if_exists(stat_output);
    cmd.push_back(stat_output);
    cmd.push_back("--");
    cmd.push_back(binary_path);
    for (const auto &arg : args) {
      cmd.push_back(arg);
    }
    
    int rc = run_and_wait(cmd);
    if (rc == 127) {
      remove_if_exists(stat_output);
      throw ProfilerException("perf not found – please install linux-perf");
    }
    
    auto end = std::chrono::steady_clock::now();
    uint32_t duration_ms = static_cast<uint32_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count());
    
    // Read and parse output
    std::ifstream f(stat_output);
    std::string output((std::istreambuf_iterator<char>(f)),
                       std::istreambuf_iterator<char>());
    remove_if_exists(stat_output);
    
    auto counters = parse_perf_stat_output(output);
    
    // Extract time elapsed and CPU utilization from perf stat summary
    double time_elapsed = 0.0;
    uint32_t cpu_util = 0;
    
    // Parse "seconds time elapsed" line which is always printed
    std::istringstream time_iss(output);
    std::string line;
    while (std::getline(time_iss, line)) {
      // Look for line containing "seconds time elapsed"
      auto pos = line.find("seconds time elapsed");
      if (pos != std::string::npos) {
        // Extract the number before it
        std::string prefix = line.substr(0, pos);
        // Remove commas and parse
        prefix.erase(std::remove(prefix.begin(), prefix.end(), ','), prefix.end());
        try {
          time_elapsed = std::stod(prefix);
        } catch (...) {}
      }
      // Look for "CPUs utilized"
      pos = line.find("CPUs utilized");
      if (pos != std::string::npos) {
        std::string prefix = line.substr(0, pos);
        try {
          double util = std::stod(prefix);
          cpu_util = static_cast<uint32_t>(util * 100);  // 0-999%
        } catch (...) {}
      }
    }
    
    // Build result (no hotspots/callgraph in stat mode)
    ProfileResult result;
    result.target_binary = binary_path;
    result.duration_ms = duration_ms;
    result.total_samples = 0;  // Not applicable in stat mode
    result.exit_code = rc;
    result.counters = counters;
    result.time_elapsed_seconds = time_elapsed > 0 ? time_elapsed : duration_ms / 1000.0;
    result.cpu_utilization_percent = cpu_util;
    result.is_stat_mode = true;
    
    // Derive summary metrics from counters
    uint64_t cycles_val = 0, instructions_val = 0, cache_refs_val = 0, cache_misses_val = 0;
    for (const auto &c : counters) {
      if (c.name == "cycles")            cycles_val       = c.value;
      if (c.name == "instructions")      instructions_val = c.value;
      if (c.name == "cache-references")  cache_refs_val   = c.value;
      if (c.name == "cache-misses")      cache_misses_val = c.value;
    }
    double ipc = (cycles_val > 0 && instructions_val > 0)
        ? static_cast<double>(instructions_val) / cycles_val : 0.0;
    double cache_miss_rate = (cache_refs_val > 0 && cache_misses_val > 0)
        ? 100.0 * cache_misses_val / cache_refs_val : 0.0;

    // Count non-zero counters for height calculation
    std::vector<const CounterResult*> visible;
    for (const auto &c : counters)
      if (c.value > 0) visible.push_back(&c);

    uint64_t max_val = 0;
    for (const auto *c : visible)
      if (c->value > max_val) max_val = c->value;

    // Layout constants
    const int svg_w     = 900;
    const int top_pad   = 70;   // title + subtitle
    const int row_h     = 34;   // height per counter row
    const int bot_pad   = 90;   // space for summary metrics at bottom
    const int label_w   = 190;  // left column for label
    const int bar_x     = label_w + 10;
    const int bar_max_w = svg_w - bar_x - 120; // max bar width
    int svg_h = top_pad + static_cast<int>(visible.size()) * row_h + bot_pad;

    // Helper: format large numbers
    auto fmt_val = [](uint64_t v, char *buf, size_t sz) {
      if (v >= 1000000000ULL) snprintf(buf, sz, "%.3f B", v / 1000000000.0);
      else if (v >= 1000000ULL) snprintf(buf, sz, "%.3f M", v / 1000000.0);
      else if (v >= 1000ULL)    snprintf(buf, sz, "%.3f K", v / 1000.0);
      else                      snprintf(buf, sz, "%lu", v);
    };

    std::ostringstream svg;
    svg << R"(<?xml version="1.0" standalone="no"?>)" "\n"
        << "<svg version=\"1.1\""
        << " width=\"" << svg_w << "\" height=\"" << svg_h << "\""
        << " viewBox=\"0 0 " << svg_w << " " << svg_h << "\""
        << " xmlns=\"http://www.w3.org/2000/svg\">\n"
        << "  <rect width=\"100%\" height=\"100%\" fill=\"#1a1a2e\"/>\n"
        // Title
        << "  <text x=\"" << svg_w/2 << "\" y=\"24\""
        << " font-family=\"'Segoe UI',Verdana,sans-serif\" font-size=\"15\""
        << " fill=\"#e0e0e0\" text-anchor=\"middle\" font-weight=\"bold\">"
        << "Hardware Performance Counters (perf stat)</text>\n";

    // Subtitle: time + CPU util (stored as CPUs*100, e.g. 340 = 3.40 CPUs)
    {
      char subtitle[128];
      double cpus_utilized = result.cpu_utilization_percent / 100.0;
      if (cpus_utilized > 0.0) {
        snprintf(subtitle, sizeof(subtitle), "%.3f s wall time · %.2f CPUs utilized",
                 result.time_elapsed_seconds, cpus_utilized);
      } else {
        snprintf(subtitle, sizeof(subtitle), "%.3f s wall time",
                 result.time_elapsed_seconds);
      }
      svg << "  <text x=\"" << svg_w/2 << "\" y=\"44\""
          << " font-family=\"'Segoe UI',Verdana,sans-serif\" font-size=\"11\""
          << " fill=\"#888\" text-anchor=\"middle\">" << subtitle << "</text>\n";
    }

    // Counter rows: label | proportional bar | value + annotation
    int row = 0;
    for (const auto *c : visible) {
      int y_top = top_pad + row * row_h;
      int y_mid = y_top + row_h / 2;
      int y_text = y_mid + 5;

      // Alternating row background
      if (row % 2 == 0) {
        svg << "  <rect x=\"0\" y=\"" << y_top << "\" width=\"" << svg_w
            << "\" height=\"" << row_h << "\" fill=\"#1e1e36\"/>\n";
      }

      // Label
      svg << "  <text x=\"" << (label_w - 6) << "\" y=\"" << y_text << "\""
          << " font-family=\"'Segoe UI',Verdana,sans-serif\" font-size=\"12\""
          << " fill=\"#bbb\" text-anchor=\"end\">" << c->name << "</text>\n";

      // Bar
      double bar_frac = (max_val > 0) ? static_cast<double>(c->value) / max_val : 0.0;
      int bar_w = static_cast<int>(bar_frac * bar_max_w);
      if (bar_w < 2) bar_w = 2;

      // Color: blue for cycles/instructions, orange for cache, green for branches
      std::string bar_color = "#4a90d9";
      if (c->name.find("cache") != std::string::npos || c->name.find("miss") != std::string::npos)
        bar_color = "#e8a23a";
      else if (c->name.find("branch") != std::string::npos)
        bar_color = "#5cb85c";
      else if (c->name.find("stall") != std::string::npos)
        bar_color = "#d9534f";
      else if (c->name.find("tlb") != std::string::npos)
        bar_color = "#9b59b6";

      svg << "  <rect x=\"" << bar_x << "\" y=\"" << (y_mid - 7)
          << "\" width=\"" << bar_w << "\" height=\"14\""
          << " fill=\"" << bar_color << "\" rx=\"3\""
          << " opacity=\"0.85\"/>\n";

      // Value text after bar
      char value_buf[64];
      fmt_val(c->value, value_buf, sizeof(value_buf));
      std::string val_label = value_buf;
      if (!c->unit_name.empty()) {
        char ratio_buf[48];
        snprintf(ratio_buf, sizeof(ratio_buf), " · %.2f %s", c->unit_ratio, c->unit_name.c_str());
        val_label += ratio_buf;
      } else if (!c->comment.empty()) {
        val_label += "  " + c->comment;
      }

      svg << "  <text x=\"" << (bar_x + bar_w + 8) << "\" y=\"" << y_text << "\""
          << " font-family=\"'Segoe UI',Verdana,sans-serif\" font-size=\"11.5\""
          << " fill=\"#ddd\">" << val_label << "</text>\n";

      ++row;
    }

    // Summary metrics panel at bottom
    int panel_y = top_pad + static_cast<int>(visible.size()) * row_h + 12;
    svg << "  <rect x=\"10\" y=\"" << panel_y
        << "\" width=\"" << (svg_w - 20) << "\" height=\"65\""
        << " fill=\"#252540\" rx=\"6\" stroke=\"#3a3a5a\" stroke-width=\"1\"/>\n"
        << "  <text x=\"22\" y=\"" << (panel_y + 18) << "\""
        << " font-family=\"'Segoe UI',Verdana,sans-serif\" font-size=\"12\""
        << " fill=\"#aaa\" font-weight=\"bold\">Derived Metrics</text>\n";

    int mx = 22;
    // IPC
    if (ipc > 0.0) {
      const char* ipc_quality = ipc < 1.0 ? "memory/branch bound" : ipc > 3.0 ? "compute efficient" : "moderate";
      const char* ipc_color   = ipc < 1.0 ? "#e74c3c" : ipc > 3.0 ? "#2ecc71" : "#f39c12";
      char ipc_buf[64];
      snprintf(ipc_buf, sizeof(ipc_buf), "IPC: %.2f (%s)", ipc, ipc_quality);
      svg << "  <text x=\"" << mx << "\" y=\"" << (panel_y + 38) << "\""
          << " font-family=\"'Segoe UI',Verdana,sans-serif\" font-size=\"13\""
          << " fill=\"" << ipc_color << "\">" << ipc_buf << "</text>\n";
      mx += 260;
    }
    // Cache miss rate
    if (cache_miss_rate > 0.0) {
      const char* miss_color = cache_miss_rate > 10.0 ? "#e74c3c"
                             : cache_miss_rate > 3.0  ? "#f39c12" : "#2ecc71";
      char miss_buf[64];
      snprintf(miss_buf, sizeof(miss_buf), "L3 Miss Rate: %.2f%%", cache_miss_rate);
      svg << "  <text x=\"" << mx << "\" y=\"" << (panel_y + 38) << "\""
          << " font-family=\"'Segoe UI',Verdana,sans-serif\" font-size=\"13\""
          << " fill=\"" << miss_color << "\">" << miss_buf << "</text>\n";
      mx += 240;
    }
    // Wall time
    {
      char t_buf[48];
      snprintf(t_buf, sizeof(t_buf), "Wall time: %.3f s", result.time_elapsed_seconds);
      svg << "  <text x=\"" << mx << "\" y=\"" << (panel_y + 38) << "\""
          << " font-family=\"'Segoe UI',Verdana,sans-serif\" font-size=\"13\""
          << " fill=\"#ccc\">" << t_buf << "</text>\n";
    }

    svg << "  <text x=\"22\" y=\"" << (panel_y + 57) << "\""
        << " font-family=\"'Segoe UI',Verdana,sans-serif\" font-size=\"10\""
        << " fill=\"#555\">bar width proportional to counter magnitude · IPC &lt; 1.0 = memory or branch bound · higher IPC = better instruction throughput</text>\n";

    svg << "</svg>\n";
    result.flamegraph_svg = svg.str();
    
    // Build JSON with counters
    std::ostringstream json;
    json << "{\n  \"mode\": \"stat\",\n  \"counters\": [\n";
    for (size_t i = 0; i < counters.size(); ++i) {
      const auto &c = counters[i];
      json << "    {\n"
           << "      \"name\": \"" << c.name << "\",\n"
           << "      \"value\": " << c.value << ",\n"
           << "      \"unitRatio\": " << c.unit_ratio << ",\n"
           << "      \"unitName\": \"" << c.unit_name << "\",\n"
           << "      \"comment\": \"" << c.comment << "\"\n"
           << "    }";
      if (i + 1 < counters.size()) json << ",";
      json << "\n";
    }
    json << "  ],\n  \"timeElapsed\": " << result.time_elapsed_seconds << ",\n";
    json << "  \"cpuUtilization\": " << result.cpu_utilization_percent / 100.0 << "\n}";
    result.flamegraph_json = json.str();
    
    fprintf(stderr, "[profiler] stat mode complete: %zu counters, %.3f seconds\n",
            counters.size(), result.time_elapsed_seconds);
    fflush(stderr);
    
    return result;
  }

  ProfileResult profile_binary(const std::string &binary_path,
                               const std::vector<std::string> &args) {
    // Route to appropriate profiling mode
    if (config_.mode == ProfileMode::STAT) {
      return profile_binary_stat(binary_path, args);
    }
    
    // Default: SAMPLING mode
    auto start = std::chrono::steady_clock::now();

    BinaryRuntime rt = detect_binary_runtime(binary_path);
    fprintf(stderr, "[profiler] detected runtime: %s (sampling mode)\n",
            rt == BinaryRuntime::GO     ? "go"
            : rt == BinaryRuntime::RUST ? "rust"
                                        : "native");
    fflush(stderr);

    std::vector<FnCost> costs;

    // Use perf sampling for all ELF binaries - much faster than callgrind
    // (5-10% overhead vs 10-50x slowdown) and captures real execution
    std::string perf_data = make_tmp_path("perf_data");
    std::string script_out = make_tmp_path("perf_script");
    remove_if_exists(perf_data);
    remove_if_exists(script_out);

    profile_binary_perf(binary_path, args, perf_data, script_out);

    auto end = std::chrono::steady_clock::now();
    uint32_t duration_ms = static_cast<uint32_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(end - start)
            .count());

    costs = parse_perf_script_output(script_out, binary_path);
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

    std::string perf_data = make_tmp_path("perf_pid_data");
    std::string script_out = make_tmp_path("perf_pid_script");
    remove_if_exists(perf_data);
    remove_if_exists(script_out);

    // perf attach to running process (assume native/C++ for PID profiling)
    {
      auto cmd = build_perf_record_cmd(perf_data);
      cmd.push_back("-p");
      cmd.push_back(std::to_string(pid));
      cmd.push_back("--duration");
      cmd.push_back(std::to_string(config_.duration_seconds));

      int rc = run_and_wait(cmd);
      if (rc == 127)
        throw ProfilerException("perf not found – please install linux-perf");
    }

    // perf script → text
    run_and_pipe_to_file({"perf", "script", "-i", perf_data}, script_out);

    auto end = std::chrono::steady_clock::now();
    uint32_t duration_ms = static_cast<uint32_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(end - start)
            .count());

    std::vector<FnCost> costs = parse_perf_script_output(script_out, "");
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
Profiler::Profiler(const ProfileConfig &config)
    : impl_(std::make_unique<Impl>(config)) {}

Profiler::~Profiler() = default;

ProfileResult Profiler::profile_pid(pid_t pid) {
  return impl_->profile_pid(pid);
}

ProfileResult Profiler::profile_binary(const std::string &binary_path,
                                       const std::vector<std::string> &args) {
  return impl_->profile_binary(binary_path, args);
}

} // namespace realbench
