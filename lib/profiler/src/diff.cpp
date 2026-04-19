#include "profiler.h"
#include <algorithm>
#include <unordered_map>

namespace realbench {

Profiler::DiffResult Profiler::diff(const ProfileResult& baseline,
                                    const ProfileResult& current) {
    DiffResult result;
    
    // Build lookup maps
    std::unordered_map<std::string, const Hotspot*> baseline_map;
    for (const auto& h : baseline.hotspots) {
        baseline_map[h.symbol] = &h;
    }
    
    std::unordered_map<std::string, const Hotspot*> current_map;
    for (const auto& h : current.hotspots) {
        current_map[h.symbol] = &h;
    }
    
    // Find regressions and improvements
    for (const auto& [symbol, current_hotspot] : current_map) {
        auto it = baseline_map.find(symbol);
        if (it != baseline_map.end()) {
            const Hotspot* baseline_hotspot = it->second;
            double delta = current_hotspot->self_pct - baseline_hotspot->self_pct;
            
            if (delta > 0.1) {  // Regression: got slower (more samples)
                Hotspot diff_hotspot = *current_hotspot;
                // Store delta as call_count for now (hacky but works)
                result.regressions.push_back(diff_hotspot);
            } else if (delta < -0.1) {  // Improvement: got faster
                Hotspot diff_hotspot = *current_hotspot;
                result.improvements.push_back(diff_hotspot);
            }
        } else {
            // New hotspot (didn't exist in baseline)
            result.regressions.push_back(*current_hotspot);
        }
    }
    
    // Calculate overall speedup
    // Positive = faster, negative = slower
    double baseline_total = 0;
    double current_total = 0;
    
    for (const auto& h : baseline.hotspots) {
        baseline_total += h.self_pct;
    }
    
    for (const auto& h : current.hotspots) {
        current_total += h.self_pct;
    }
    
    if (baseline_total > 0) {
        result.overall_speedup = ((baseline_total - current_total) / baseline_total) * 100.0;
    }
    
    // Sort by magnitude
    std::sort(result.regressions.begin(), result.regressions.end(),
             [](const Hotspot& a, const Hotspot& b) {
                 return a.self_pct > b.self_pct;
             });
    
    std::sort(result.improvements.begin(), result.improvements.end(),
             [](const Hotspot& a, const Hotspot& b) {
                 return a.self_pct > b.self_pct;
             });
    
    return result;
}

} // namespace realbench
