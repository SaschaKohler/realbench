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
            
            if (opts.Has("frequencyHz")) {
                config.frequency_hz = opts.Get("frequencyHz").As<Number>().Uint32Value();
            }
            if (opts.Has("durationSeconds")) {
                config.duration_seconds = opts.Get("durationSeconds").As<Number>().Uint32Value();
            }
            if (opts.Has("includeKernel")) {
                config.include_kernel = opts.Get("includeKernel").As<Boolean>().Value();
            }
        }
        
        profiler_ = std::make_unique<Profiler>(config);
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
            hotspots[i] = HotspotToObject(env, result.hotspots[i]);
        }
        
        obj.Set("hotspots", hotspots);
        obj.Set("flamegraphSvg", String::New(env, result.flamegraph_svg));
        obj.Set("flamegraphJson", String::New(env, result.flamegraph_json));
        obj.Set("totalSamples", Number::New(env, result.total_samples));
        obj.Set("durationMs", Number::New(env, result.duration_ms));
        obj.Set("targetBinary", String::New(env, result.target_binary));
        obj.Set("commitSha", String::New(env, result.commit_sha));
        
        return obj;
    }

    static Object HotspotToObject(Napi::Env env, const Hotspot& hotspot) {
        Object obj = Object::New(env);
        
        obj.Set("symbol", String::New(env, hotspot.symbol));
        obj.Set("selfSamples", Number::New(env, hotspot.self_samples));
        obj.Set("totalSamples", Number::New(env, hotspot.total_samples));
        obj.Set("callCount", Number::New(env, hotspot.call_count));
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
