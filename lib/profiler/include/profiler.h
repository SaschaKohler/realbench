#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <memory>
#include <optional>
#include <unordered_map>

namespace realbench {

// Stack frame information
struct StackFrame {
    std::string symbol;
    std::string file;
    uint64_t address;
    int line;
};

// Performance hotspot
struct Hotspot {
    std::string symbol;
    uint64_t self_samples;
    uint64_t total_samples;
    uint64_t call_count;
    double self_pct;
    double total_pct;
};

// Profiling configuration
struct ProfileConfig {
    uint32_t frequency_hz = 99;         // Sampling frequency
    uint32_t duration_seconds = 30;     // Profiling duration
    bool include_kernel = false;        // Include kernel stacks
    bool capture_cpu = true;            // CPU profiling
    bool capture_memory = false;        // Memory profiling
    std::string output_format = "svg";  // svg, json, or both
};

// A directed call edge: caller invoked callee with this many IR
struct CallEdge {
    std::string caller;
    std::string callee;
    uint64_t ir;
};

// Hardware counter configuration for perf stat mode
struct HardwareCounters {
    // Basic counters
    bool cycles = true;                 // CPU cycles
    bool instructions = true;           // Instructions retired
    bool cache_references = true;         // Cache accesses
    bool cache_misses = true;             // Cache misses
    bool branch_instructions = false;     // Branches executed
    bool branch_misses = false;           // Branch mispredictions
    bool stalled_cycles_frontend = false; // Frontend stalls
    bool stalled_cycles_backend = false;  // Backend stalls
    bool context_switches = false;        // Context switches
    bool cpu_migrations = false;          // CPU migrations
    bool page_faults = false;             // Page faults (minor + major)
    
    // Detailed L1 Data Cache counters
    bool l1_dcache_loads = false;         // L1 data cache loads
    bool l1_dcache_load_misses = false;   // L1 data cache load misses
    bool l1_dcache_stores = false;        // L1 data cache stores
    bool l1_dcache_store_misses = false;  // L1 data cache store misses
    
    // Detailed L1 Instruction Cache counters
    bool l1_icache_loads = false;         // L1 instruction cache loads
    bool l1_icache_load_misses = false;   // L1 instruction cache load misses
    
    // Last Level Cache (LLC/L3) counters
    bool llc_loads = false;               // LLC loads
    bool llc_load_misses = false;         // LLC load misses
    bool llc_stores = false;              // LLC stores
    bool llc_store_misses = false;        // LLC store misses
    
    // Data TLB counters
    bool dtlb_loads = false;              // Data TLB loads
    bool dtlb_load_misses = false;        // Data TLB load misses
    bool dtlb_stores = false;             // Data TLB stores
    bool dtlb_store_misses = false;       // Data TLB store misses
    
    // Instruction TLB counters
    bool itlb_loads = false;              // Instruction TLB loads
    bool itlb_load_misses = false;        // Instruction TLB load misses
    
    std::vector<std::string> custom;    // Custom counter names
};

// Profiling result
struct ProfileResult {
    std::vector<Hotspot> hotspots;
    std::vector<CallEdge> call_graph;   // caller → callee edges
    std::string flamegraph_svg;
    std::string flamegraph_json;
    uint64_t total_samples;
    uint32_t duration_ms;
    std::string target_binary;
    std::string commit_sha;
    int exit_code = 0;                  // Binary execution exit code (0 = success)
    std::string error_message;          // Error message if profiling failed
};

// Main profiler class
class Profiler {
public:
    explicit Profiler(const ProfileConfig& config);
    ~Profiler();

    // Disable copy
    Profiler(const Profiler&) = delete;
    Profiler& operator=(const Profiler&) = delete;

    // Profile a running process
    ProfileResult profile_pid(pid_t pid);
    
    // Profile a binary (spawns and profiles)
    ProfileResult profile_binary(const std::string& binary_path,
                                 const std::vector<std::string>& args = {});
    
    // Compare two profiles
    struct DiffResult {
        std::vector<Hotspot> regressions;   // Functions that got slower
        std::vector<Hotspot> improvements;  // Functions that got faster
        double overall_speedup;             // Positive = faster, negative = slower
    };
    
    static DiffResult diff(const ProfileResult& baseline,
                          const ProfileResult& current);

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};

// Exception types
class ProfilerException : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

class PermissionException : public ProfilerException {
public:
    PermissionException()
        : ProfilerException("Insufficient permissions to profile the target process. "
                            "Try running with sudo or granting ptrace capabilities.") {}
};

} // namespace realbench
