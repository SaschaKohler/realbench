#include <gtest/gtest.h>
#include "profiler.h"
#include <unistd.h>

using namespace realbench;

TEST(ProfilerTest, CreateProfiler) {
    ProfileConfig config;
    config.frequency_hz = 99;
    config.duration_seconds = 1;
    
    EXPECT_NO_THROW({
        Profiler profiler(config);
    });
}

TEST(ProfilerTest, ProfileSelf) {
    ProfileConfig config;
    config.frequency_hz = 99;
    config.duration_seconds = 1;
    
    Profiler profiler(config);
    
    pid_t self_pid = getpid();
    
    EXPECT_NO_THROW({
        ProfileResult result = profiler.profile_pid(self_pid);
        EXPECT_GT(result.total_samples, 0);
        EXPECT_GT(result.duration_ms, 0);
    });
}

TEST(ProfilerTest, DiffResults) {
    ProfileResult baseline;
    baseline.total_samples = 1000;
    baseline.hotspots = {
        {"func1", 100, 100, 10, 10.0, 10.0},
        {"func2", 200, 200, 20, 20.0, 20.0},
    };
    
    ProfileResult current;
    current.total_samples = 1000;
    current.hotspots = {
        {"func1", 150, 150, 15, 15.0, 15.0},
        {"func2", 180, 180, 18, 18.0, 18.0},
    };
    
    auto diff = Profiler::diff(baseline, current);
    
    EXPECT_FALSE(diff.regressions.empty() || diff.improvements.empty());
}

TEST(ProfilerTest, FlamegraphGeneration) {
    ProfileResult result;
    result.total_samples = 1000;
    result.hotspots = {
        {"main", 500, 1000, 1, 50.0, 100.0},
        {"compute", 300, 300, 100, 30.0, 30.0},
        {"allocate", 200, 200, 50, 20.0, 20.0},
    };
    
    extern std::string generate_flamegraph_svg(const ProfileResult& result);
    std::string svg = generate_flamegraph_svg(result);
    
    EXPECT_FALSE(svg.empty());
    EXPECT_NE(svg.find("<svg"), std::string::npos);
    EXPECT_NE(svg.find("</svg>"), std::string::npos);
}

int main(int argc, char** argv) {
    ::testing::InitGoogleTest(&argc, argv);
    return RUN_ALL_TESTS();
}
