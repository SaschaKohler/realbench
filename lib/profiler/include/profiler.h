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

// Profiling mode: sampling vs counting
enum class ProfileMode {
    SAMPLING,    // perf record - stack traces
    STAT         // perf stat - hardware/software counters
};

// Hardware counter configuration for perf stat mode
struct HardwareCounters {
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
    std::vector<std::string> custom;    // Custom counter names
};

// Profiling configuration
struct ProfileConfig {
    uint32_t frequency_hz = 99;         // Sampling frequency (SAMPLING mode)
    uint32_t duration_seconds = 30;     // Profiling duration
    bool include_kernel = false;        // Include kernel stacks
    bool capture_cpu = true;            // CPU profiling
    bool capture_memory = false;        // Memory profiling
    std::string output_format = "svg";  // svg, json, or both
    
    // New: perf stat mode configuration
    ProfileMode mode = ProfileMode::SAMPLING;  // Profiling mode
    HardwareCounters hw_counters;               // Hardware counter selection
    bool stat_detailed = false;               // perf stat -d (detailed mode)
    
    // New: context switch tracing (SAMPLING mode)
    bool trace_context_switches = false;      // Trace all context switches with stacks
};

// A directed call edge: caller invoked callee with this many IR
struct CallEdge {
    std::string caller;
    std::string callee;
    uint64_t ir;
};

// Hardware counter result (perf stat mode)
struct CounterResult {
    std::string name;                   // Counter name
    uint64_t value = 0;                 // Raw counter value
    double unit_ratio = 0.0;            // Ratio (e.g., IPC = insns/cycle)
    std::string unit_name;              // Name of ratio (e.g., "insn per cycle")
    std::string comment;                // Additional info (e.g., "7.90% of all L1-dcache hits")
};

// Context switch event (for multithreading analysis)
struct ContextSwitchEvent {
    double timestamp_ms;                // Time relative to profile start
    uint32_t cpu;                       // CPU where switch occurred
    pid_t prev_pid;                     // Previous process/thread ID
    pid_t next_pid;                     // Next process/thread ID
    std::string prev_comm;              // Previous process name
    std::string next_comm;              // Next process name
    std::vector<StackFrame> stack;      // Stack trace at switch point
    bool is_wakeup;                     // True if this is a wakeup (not a yield)
};

// Context switch summary statistics
struct ContextSwitchStats {
    uint64_t total_switches = 0;        // Total context switches
    uint64_t voluntary_switches = 0;    // Thread yielded CPU
    uint64_t involuntary_switches = 0;  // Thread was preempted
    uint64_t migrations = 0;            // Switches to different CPU
    double avg_switch_interval_ms = 0;  // Average time between switches
    uint32_t unique_threads = 0;        // Number of threads seen
    pid_t most_active_thread = 0;         // Thread with most switches
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
    
    // New: perf stat mode results
    std::vector<CounterResult> counters;        // Hardware/software counter values
    double time_elapsed_seconds = 0.0;            // Wall-clock time
    uint32_t cpu_utilization_percent = 0;         // CPU utilization (0-999%)
    bool is_stat_mode = false;                    // Result came from stat mode
    
    // New: context switch tracing results
    std::vector<ContextSwitchEvent> context_switches;  // Raw switch events
    ContextSwitchStats cs_stats;                      // Switch statistics
    bool has_context_switch_data = false;               // True if tracing was enabled
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
