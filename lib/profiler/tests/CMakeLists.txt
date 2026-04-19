include(FetchContent)

FetchContent_Declare(
  googletest
  GIT_REPOSITORY https://github.com/google/googletest.git
  GIT_TAG        v1.14.0
)

FetchContent_MakeAvailable(googletest)

enable_testing()

add_executable(profiler_test test_profiler.cpp)

target_link_libraries(profiler_test
  realbench_profiler
  GTest::gtest_main
)

include(GoogleTest)
gtest_discover_tests(profiler_test)

add_executable(sample_binary sample_binary.cpp)
target_compile_options(sample_binary PRIVATE -g -O0)
