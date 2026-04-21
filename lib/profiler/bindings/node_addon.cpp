#include <napi.h>
#include "../include/profiler.h"
#include <memory>
#include <string>
#include <vector>

using namespace Napi;
using namespace realbench;

class ProfilerWrapper : public ObjectWrap<ProfilerWrapper> {
public:
    static Object Init(Napi::Env env, Object exports) {
        Function func = DefineClass(env, "Profiler", {
            InstanceMethod("profilePid", &ProfilerWrapper::ProfilePid),
            InstanceMethod("profileBinary", &ProfilerWrapper::ProfileBinary),
            StaticMethod("diff", &ProfilerWrapper::Diff),
        });

        exports.Set("Profiler", func);
        return exports;
    }

    ProfilerWrapper(const CallbackInfo& info) 
        : ObjectWrap<ProfilerWrapper>(info) {
        
        ProfileConfig config;
        
        if (info.Length() > 0 && info[0].IsObject()) {
            Object opts = info[0].As<Object>();
            
            // Basic options
            if (opts.Has("frequencyHz")) {
                config.frequency_hz = opts.Get("frequencyHz").As<Number>().Uint32Value();
            }
            if (opts.Has("durationSeconds")) {
                config.duration_seconds = opts.Get("durationSeconds").As<Number>().Uint32Value();
            }
            if (opts.Has("includeKernel")) {
                config.include_kernel = opts.Get("includeKernel").As<Boolean>().Value();
            }
            
            // P0: perf stat mode options
            if (opts.Has("mode")) {
                std::string mode = opts.Get("mode").As<String>().Utf8Value();
                if (mode == "stat") {
                    config.mode = ProfileMode::STAT;
                } else {
                    config.mode = ProfileMode::SAMPLING;
                }
            }
            if (opts.Has("statDetailed")) {
                config.stat_detailed = opts.Get("statDetailed").As<Boolean>().Value();
            }
            
            // P0/P1: Hardware counter configuration
            if (opts.Has("hwCounters") && opts.Get("hwCounters").IsObject()) {
                Object hw = opts.Get("hwCounters").As<Object>();
                ParseHardwareCounters(hw, config.hw_counters);
            }
            
            // P1b: Context switch tracing
            if (opts.Has("traceContextSwitches")) {
                config.trace_context_switches = opts.Get("traceContextSwitches").As<Boolean>().Value();
            }
        }
        
        profiler_ = std::make_unique<Profiler>(config);
    }

    static void ParseHardwareCounters(Object& hw, HardwareCounters& counters) {
        // Basic counters
        if (hw.Has("cycles")) counters.cycles = hw.Get("cycles").As<Boolean>().Value();
        if (hw.Has("instructions")) counters.instructions = hw.Get("instructions").As<Boolean>().Value();
        if (hw.Has("cacheReferences")) counters.cache_references = hw.Get("cacheReferences").As<Boolean>().Value();
        if (hw.Has("cacheMisses")) counters.cache_misses = hw.Get("cacheMisses").As<Boolean>().Value();
        if (hw.Has("branchInstructions")) counters.branch_instructions = hw.Get("branchInstructions").As<Boolean>().Value();
        if (hw.Has("branchMisses")) counters.branch_misses = hw.Get("branchMisses").As<Boolean>().Value();
        if (hw.Has("stalledCyclesFrontend")) counters.stalled_cycles_frontend = hw.Get("stalledCyclesFrontend").As<Boolean>().Value();
        if (hw.Has("stalledCyclesBackend")) counters.stalled_cycles_backend = hw.Get("stalledCyclesBackend").As<Boolean>().Value();
        if (hw.Has("contextSwitches")) counters.context_switches = hw.Get("contextSwitches").As<Boolean>().Value();
        if (hw.Has("cpuMigrations")) counters.cpu_migrations = hw.Get("cpuMigrations").As<Boolean>().Value();
        if (hw.Has("pageFaults")) counters.page_faults = hw.Get("pageFaults").As<Boolean>().Value();
        
        // P1: Detailed L1 Data Cache counters
        if (hw.Has("l1DcacheLoads")) counters.l1_dcache_loads = hw.Get("l1DcacheLoads").As<Boolean>().Value();
        if (hw.Has("l1DcacheLoadMisses")) counters.l1_dcache_load_misses = hw.Get("l1DcacheLoadMisses").As<Boolean>().Value();
        if (hw.Has("l1DcacheStores")) counters.l1_dcache_stores = hw.Get("l1DcacheStores").As<Boolean>().Value();
        if (hw.Has("l1DcacheStoreMisses")) counters.l1_dcache_store_misses = hw.Get("l1DcacheStoreMisses").As<Boolean>().Value();
        
        // P1: L1 Instruction Cache counters
        if (hw.Has("l1IcacheLoads")) counters.l1_icache_loads = hw.Get("l1IcacheLoads").As<Boolean>().Value();
        if (hw.Has("l1IcacheLoadMisses")) counters.l1_icache_load_misses = hw.Get("l1IcacheLoadMisses").As<Boolean>().Value();
        
        // P1: LLC counters
        if (hw.Has("llcLoads")) counters.llc_loads = hw.Get("llcLoads").As<Boolean>().Value();
        if (hw.Has("llcLoadMisses")) counters.llc_load_misses = hw.Get("llcLoadMisses").As<Boolean>().Value();
        if (hw.Has("llcStores")) counters.llc_stores = hw.Get("llcStores").As<Boolean>().Value();
        if (hw.Has("llcStoreMisses")) counters.llc_store_misses = hw.Get("llcStoreMisses").As<Boolean>().Value();
        
        // P1: Data TLB counters
        if (hw.Has("dtlbLoads")) counters.dtlb_loads = hw.Get("dtlbLoads").As<Boolean>().Value();
        if (hw.Has("dtlbLoadMisses")) counters.dtlb_load_misses = hw.Get("dtlbLoadMisses").As<Boolean>().Value();
        if (hw.Has("dtlbStores")) counters.dtlb_stores = hw.Get("dtlbStores").As<Boolean>().Value();
        if (hw.Has("dtlbStoreMisses")) counters.dtlb_store_misses = hw.Get("dtlbStoreMisses").As<Boolean>().Value();
        
        // P1: Instruction TLB counters
        if (hw.Has("itlbLoads")) counters.itlb_loads = hw.Get("itlbLoads").As<Boolean>().Value();
        if (hw.Has("itlbLoadMisses")) counters.itlb_load_misses = hw.Get("itlbLoadMisses").As<Boolean>().Value();
        
        // Custom counters
        if (hw.Has("custom") && hw.Get("custom").IsArray()) {
            Array custom = hw.Get("custom").As<Array>();
            for (uint32_t i = 0; i < custom.Length(); ++i) {
                if (custom.Get(i).IsString()) {
                    counters.custom.push_back(custom.Get(i).As<String>().Utf8Value());
                }
            }
        }
    }

private:
    std::unique_ptr<Profiler> profiler_;

    Napi::Value ProfilePid(const CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1 || !info[0].IsNumber()) {
            TypeError::New(env, "PID expected as number").ThrowAsJavaScriptException();
            return env.Null();
        }
        
        pid_t pid = info[0].As<Number>().Int32Value();
        
        try {
            ProfileResult result = profiler_->profile_pid(pid);
            return ResultToObject(env, result);
        } catch (const ProfilerException& e) {
            Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    Napi::Value ProfileBinary(const CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 1 || !info[0].IsString()) {
            TypeError::New(env, "Binary path expected as string").ThrowAsJavaScriptException();
            return env.Null();
        }
        
        std::string binary_path = info[0].As<String>().Utf8Value();
        std::vector<std::string> args;
        
        if (info.Length() > 1 && info[1].IsArray()) {
            Array arr = info[1].As<Array>();
            for (uint32_t i = 0; i < arr.Length(); ++i) {
                Napi::Value val = arr.Get(i);
                if (val.IsString()) {
                    args.push_back(val.As<String>().Utf8Value());
                }
            }
        }
        
        try {
            ProfileResult result = profiler_->profile_binary(binary_path, args);
            return ResultToObject(env, result);
        } catch (const ProfilerException& e) {
            Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    static Napi::Value Diff(const CallbackInfo& info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsObject()) {
            TypeError::New(env, "Two profile results expected").ThrowAsJavaScriptException();
            return env.Null();
        }
        
        ProfileResult baseline = ObjectToResult(env, info[0].As<Object>());
        ProfileResult current = ObjectToResult(env, info[1].As<Object>());
        
        try {
            Profiler::DiffResult diff = Profiler::diff(baseline, current);
            return DiffResultToObject(env, diff);
        } catch (const ProfilerException& e) {
            Error::New(env, e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }
    }

    static Object ResultToObject(Napi::Env env, const ProfileResult& result) {
        Object obj = Object::New(env);

        Array hotspots = Array::New(env, result.hotspots.size());
        for (size_t i = 0; i < result.hotspots.size(); ++i) {
            if (env.IsExceptionPending()) return env.Null().As<Object>();
            hotspots[i] = HotspotToObject(env, result.hotspots[i]);
        }
        if (env.IsExceptionPending()) return env.Null().As<Object>();
        obj.Set("hotspots", hotspots);

        // Handle potentially large flamegraph strings safely
        const std::string& svg = result.flamegraph_svg;
        obj.Set("flamegraphSvg", String::New(env,
            svg.size() > 10 * 1024 * 1024 ? "<svg>Data too large</svg>" : svg));
        if (env.IsExceptionPending()) return env.Null().As<Object>();

        const std::string& fjson = result.flamegraph_json;
        obj.Set("flamegraphJson", String::New(env,
            fjson.size() > 5 * 1024 * 1024 ? "{}" : fjson));
        if (env.IsExceptionPending()) return env.Null().As<Object>();

        obj.Set("totalSamples", Number::New(env, static_cast<double>(result.total_samples)));
        obj.Set("durationMs", Number::New(env, result.duration_ms));
        obj.Set("targetBinary", String::New(env, result.target_binary));
        if (env.IsExceptionPending()) return env.Null().As<Object>();
        obj.Set("commitSha", String::New(env, result.commit_sha));
        if (env.IsExceptionPending()) return env.Null().As<Object>();
        obj.Set("exitCode", Number::New(env, result.exit_code));
        obj.Set("errorMessage", String::New(env, result.error_message));
        if (env.IsExceptionPending()) return env.Null().As<Object>();
        
        // P0: perf stat mode results
        obj.Set("isStatMode", Boolean::New(env, result.is_stat_mode));
        obj.Set("timeElapsedSeconds", Number::New(env, result.time_elapsed_seconds));
        obj.Set("cpuUtilizationPercent", Number::New(env, result.cpu_utilization_percent));
        if (env.IsExceptionPending()) return env.Null().As<Object>();
        
        // P0/P1: Hardware counter results
        Array counters = Array::New(env, result.counters.size());
        for (size_t i = 0; i < result.counters.size(); ++i) {
            if (env.IsExceptionPending()) return env.Null().As<Object>();
            counters[i] = CounterResultToObject(env, result.counters[i]);
        }
        obj.Set("counters", counters);
        if (env.IsExceptionPending()) return env.Null().As<Object>();
        
        // P1b: Context switch tracing results
        obj.Set("hasContextSwitchData", Boolean::New(env, result.has_context_switch_data));
        if (result.has_context_switch_data) {
            obj.Set("contextSwitchStats", ContextSwitchStatsToObject(env, result.cs_stats));
            
            Array switches = Array::New(env, result.context_switches.size());
            for (size_t i = 0; i < result.context_switches.size(); ++i) {
                if (env.IsExceptionPending()) return env.Null().As<Object>();
                switches[i] = ContextSwitchEventToObject(env, result.context_switches[i]);
            }
            obj.Set("contextSwitches", switches);
        }
        if (env.IsExceptionPending()) return env.Null().As<Object>();

        return obj;
    }
    
    static Object CounterResultToObject(Napi::Env env, const CounterResult& counter) {
        Object obj = Object::New(env);
        obj.Set("name", String::New(env, counter.name));
        obj.Set("value", Number::New(env, static_cast<double>(counter.value)));
        obj.Set("unitRatio", Number::New(env, counter.unit_ratio));
        obj.Set("unitName", String::New(env, counter.unit_name));
        obj.Set("comment", String::New(env, counter.comment));
        return obj;
    }
    
    static Object ContextSwitchStatsToObject(Napi::Env env, const ContextSwitchStats& stats) {
        Object obj = Object::New(env);
        obj.Set("totalSwitches", Number::New(env, static_cast<double>(stats.total_switches)));
        obj.Set("voluntarySwitches", Number::New(env, static_cast<double>(stats.voluntary_switches)));
        obj.Set("involuntarySwitches", Number::New(env, static_cast<double>(stats.involuntary_switches)));
        obj.Set("migrations", Number::New(env, static_cast<double>(stats.migrations)));
        obj.Set("avgSwitchIntervalMs", Number::New(env, stats.avg_switch_interval_ms));
        obj.Set("uniqueThreads", Number::New(env, stats.unique_threads));
        obj.Set("mostActiveThread", Number::New(env, stats.most_active_thread));
        return obj;
    }
    
    static Object ContextSwitchEventToObject(Napi::Env env, const ContextSwitchEvent& evt) {
        Object obj = Object::New(env);
        obj.Set("timestampMs", Number::New(env, evt.timestamp_ms));
        obj.Set("cpu", Number::New(env, evt.cpu));
        obj.Set("prevPid", Number::New(env, evt.prev_pid));
        obj.Set("nextPid", Number::New(env, evt.next_pid));
        obj.Set("prevComm", String::New(env, evt.prev_comm));
        obj.Set("nextComm", String::New(env, evt.next_comm));
        obj.Set("isWakeup", Boolean::New(env, evt.is_wakeup));
        
        Array stack = Array::New(env, evt.stack.size());
        for (size_t i = 0; i < evt.stack.size(); ++i) {
            stack[i] = StackFrameToObject(env, evt.stack[i]);
        }
        obj.Set("stack", stack);
        return obj;
    }
    
    static Object StackFrameToObject(Napi::Env env, const StackFrame& frame) {
        Object obj = Object::New(env);
        obj.Set("symbol", String::New(env, frame.symbol));
        obj.Set("file", String::New(env, frame.file));
        obj.Set("address", Number::New(env, static_cast<double>(frame.address)));
        obj.Set("line", Number::New(env, frame.line));
        return obj;
    }

    static Object HotspotToObject(Napi::Env env, const Hotspot& hotspot) {
        if (env.IsExceptionPending()) return env.Null().As<Object>();
        Object obj = Object::New(env);

        // Sanitize symbol: strip NUL bytes and ensure valid UTF-8.
        // Drop NUL bytes only; do not replace non-ASCII bytes individually
        // as that would corrupt multi-byte UTF-8 sequences.
        // Replace any invalid UTF-8 byte sequences with the replacement
        // character U+FFFD encoded as UTF-8 (0xEF 0xBF 0xBD).
        std::string safe_symbol;
        safe_symbol.reserve(hotspot.symbol.size());
        const unsigned char* s =
            reinterpret_cast<const unsigned char*>(hotspot.symbol.data());
        size_t len = hotspot.symbol.size();
        for (size_t i = 0; i < len; ) {
            unsigned char c = s[i];
            if (c == 0) { ++i; continue; } // drop embedded NUL
            int seq = 0;
            if      (c < 0x80)                       seq = 1;
            else if ((c & 0xE0) == 0xC0 && c > 0xC1) seq = 2;
            else if ((c & 0xF0) == 0xE0)              seq = 3;
            else if ((c & 0xF8) == 0xF0 && c <= 0xF4) seq = 4;
            bool valid = seq > 0;
            if (valid) {
                for (int j = 1; j < seq && valid; ++j)
                    valid = (i + j < len) && ((s[i + j] & 0xC0) == 0x80);
            }
            if (valid) {
                for (int j = 0; j < seq; ++j)
                    safe_symbol.push_back(static_cast<char>(s[i + j]));
                i += seq;
            } else {
                // Replace invalid byte with U+FFFD
                safe_symbol.append("\xEF\xBF\xBD");
                ++i;
            }
        }
        if (safe_symbol.empty())
            safe_symbol = "<unknown>";

        obj.Set("symbol", String::New(env, safe_symbol));
        if (env.IsExceptionPending()) return env.Null().As<Object>();
        obj.Set("selfSamples", Number::New(env, static_cast<double>(hotspot.self_samples)));
        obj.Set("totalSamples", Number::New(env, static_cast<double>(hotspot.total_samples)));
        obj.Set("callCount", Number::New(env, static_cast<double>(hotspot.call_count)));
        obj.Set("selfPct", Number::New(env, hotspot.self_pct));
        obj.Set("totalPct", Number::New(env, hotspot.total_pct));

        return obj;
    }

    static Object DiffResultToObject(Napi::Env env, const Profiler::DiffResult& diff) {
        Object obj = Object::New(env);
        
        Array regressions = Array::New(env, diff.regressions.size());
        for (size_t i = 0; i < diff.regressions.size(); ++i) {
            regressions[i] = HotspotToObject(env, diff.regressions[i]);
        }
        
        Array improvements = Array::New(env, diff.improvements.size());
        for (size_t i = 0; i < diff.improvements.size(); ++i) {
            improvements[i] = HotspotToObject(env, diff.improvements[i]);
        }
        
        obj.Set("regressions", regressions);
        obj.Set("improvements", improvements);
        obj.Set("overallSpeedup", Number::New(env, diff.overall_speedup));
        
        return obj;
    }

    static ProfileResult ObjectToResult(Napi::Env env, Object obj) {
        ProfileResult result;
        
        if (obj.Has("totalSamples")) {
            result.total_samples = obj.Get("totalSamples").As<Number>().Uint32Value();
        }
        if (obj.Has("durationMs")) {
            result.duration_ms = obj.Get("durationMs").As<Number>().Uint32Value();
        }
        
        if (obj.Has("hotspots")) {
            Array arr = obj.Get("hotspots").As<Array>();
            for (uint32_t i = 0; i < arr.Length(); ++i) {
                Object hobj = arr.Get(i).As<Object>();
                Hotspot h;
                h.symbol = hobj.Get("symbol").As<String>().Utf8Value();
                h.self_pct = hobj.Get("selfPct").As<Number>().DoubleValue();
                h.total_pct = hobj.Get("totalPct").As<Number>().DoubleValue();
                h.call_count = hobj.Get("callCount").As<Number>().Uint32Value();
                result.hotspots.push_back(h);
            }
        }
        
        return result;
    }
};

Object Init(Env env, Object exports) {
    return ProfilerWrapper::Init(env, exports);
}

NODE_API_MODULE(profiler, Init)
