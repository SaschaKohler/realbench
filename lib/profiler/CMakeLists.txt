cmake_minimum_required(VERSION 3.20)
project(realbench_profiler VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Options
option(BUILD_TESTS "Build tests" ON)
option(BUILD_NODE_ADDON "Build Node.js addon" ON)

# Dependencies
find_package(Threads REQUIRED)

# Source files
set(PROFILER_SOURCES
    src/sampler.cpp
    src/flamegraph.cpp
    src/diff.cpp
    src/symbol_resolver.cpp
)

# Main library
add_library(realbench_profiler STATIC ${PROFILER_SOURCES})

target_include_directories(realbench_profiler PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(realbench_profiler
    Threads::Threads
    dl
)

# Compiler warnings
target_compile_options(realbench_profiler PRIVATE
    -Wall -Wextra -Wpedantic -Werror
)

# Node.js addon
if(BUILD_NODE_ADDON)
    add_subdirectory(bindings)
endif()

# Tests
if(BUILD_TESTS)
    enable_testing()
    add_subdirectory(tests)
endif()

# Install
install(TARGETS realbench_profiler
    LIBRARY DESTINATION lib
    ARCHIVE DESTINATION lib
)

install(DIRECTORY include/
    DESTINATION include
)
