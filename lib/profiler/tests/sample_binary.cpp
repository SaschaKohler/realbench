#include <iostream>
#include <vector>
#include <chrono>
#include <thread>

void compute_intensive() {
    volatile double result = 0.0;
    for (int i = 0; i < 10000000; ++i) {
        result += i * 3.14159;
    }
}

void memory_intensive() {
    std::vector<int> data;
    for (int i = 0; i < 1000000; ++i) {
        data.push_back(i);
    }
    volatile int sum = 0;
    for (auto val : data) {
        sum += val;
    }
}

void nested_call_1() {
    compute_intensive();
}

void nested_call_2() {
    nested_call_1();
}

int main() {
    std::cout << "Starting sample program for profiling..." << std::endl;
    
    auto start = std::chrono::steady_clock::now();
    auto end = start + std::chrono::seconds(60);
    
    while (std::chrono::steady_clock::now() < end) {
        nested_call_2();
        memory_intensive();
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    
    std::cout << "Sample program finished." << std::endl;
    return 0;
}
