#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <memory>
#include <optional>
#include <unordered_map>

namespace realbench {

// Profiling mode
enum class ProfileMode {
    SAMPLING,   // Standard sampling mode with flamegraphs
    STAT        // perf stat mode with hardware counters
};

// Counter result from perf stat
struct CounterResult {
    std::string name;
    uint64_t value;
    double unit_ratio;
    std::string unit_name;
    std::string comment;
};

// Context switch statistics
struct ContextSwitchStats {
    uint64_t total_switches = 0;
    uint64_t voluntary_switches = 0;
    uint64_t involuntary_switches = 0;
    uint64_t migrations = 0;
    double avg_switch_interval_ms = 0.0;
    uint32_t unique_threads = 0;
    uint32_t most_active_thread = 0;
};

// Stack frame information
struct StackFrame {
    std::string symbol;
    std::string file;
    uint64_t address;
    int line;
};

// Individual context switch event
struct ContextSwitchEvent {
    double timestamp_ms = 0.0;
    int cpu = 0;
    uint32_t prev_pid = 0;
    uint32_t next_pid = 0;
    std::string prev_comm;
    std::string next_comm;
    bool is_wakeup = false;
    std::vector<StackFrame> stack;
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

// Profiling configuration
struct ProfileConfig {
    uint32_t frequency_hz = 99;         // Sampling frequency
    uint32_t duration_seconds = 30;     // Profiling duration
    bool include_kernel = false;        // Include kernel stacks
    bool capture_cpu = true;            // CPU profiling
    bool capture_memory = false;        // Memory profiling
    std::string output_format = "svg";  // svg, json, or both
    
    // P0: perf stat mode
    ProfileMode mode = ProfileMode::SAMPLING;
    bool stat_detailed = false;
    
    // P0/P1: Hardware counters
    HardwareCounters hw_counters;
    
    // P1b: Context switch tracing
    bool trace_context_switches = false;
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
    
    // P0: perf stat mode results
    bool is_stat_mode = false;
    double time_elapsed_seconds = 0.0;
    double cpu_utilization_percent = 0.0;
    
    // P0/P1: Hardware counter results
    std::vector<CounterResult> counters;
    
    // P1b: Context switch tracing results
    bool has_context_switch_data = false;
    ContextSwitchStats cs_stats;
    std::vector<ContextSwitchEvent> context_switches;
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
