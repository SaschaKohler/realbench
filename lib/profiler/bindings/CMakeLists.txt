cmake_minimum_required(VERSION 3.20)

execute_process(
    COMMAND node -p "require('node-addon-api').include"
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    OUTPUT_VARIABLE NODE_ADDON_API_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
)

add_library(profiler_node SHARED node_addon.cpp)

set_target_properties(profiler_node PROPERTIES
    PREFIX ""
    SUFFIX ".node"
    CXX_STANDARD 20
)

target_include_directories(profiler_node PRIVATE
    ${NODE_ADDON_API_DIR}
    ${CMAKE_SOURCE_DIR}/include
    ${CMAKE_JS_INC}
)

target_link_libraries(profiler_node
    realbench_profiler
    ${CMAKE_JS_LIB}
)

target_compile_definitions(profiler_node PRIVATE
    NAPI_VERSION=8
)
