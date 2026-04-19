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
