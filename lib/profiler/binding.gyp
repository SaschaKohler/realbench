{
  "targets": [
    {
      "target_name": "profiler",
      "sources": [
        "bindings/node_addon.cpp",
        "src/sampler.cpp",
        "src/flamegraph.cpp",
        "src/diff.cpp",
        "src/symbol_resolver.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "include"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++20", "-Wall", "-Wextra"],
      "libraries": ["-ldl"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        [
          "OS=='linux'",
          {
            "libraries": ["-ldl"]
          }
        ],
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "10.15",
              "OTHER_CPLUSPLUSFLAGS": ["-std=c++20"]
            }
          }
        ]
      ]
    }
  ]
}
