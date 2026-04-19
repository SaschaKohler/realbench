#include <iostream>
#include <vector>
#include <memory>
#include <random>
#include <algorithm>
#include <chrono>
#include <thread>

// Memory allocation patterns for profiler testing

class MemoryAllocator {
private:
    std::vector<std::unique_ptr<int[]>> large_arrays;
    std::vector<std::vector<double>> dynamic_matrices;
    
public:
    void allocate_large_chunks() {
        std::cout << "Allocating large memory chunks..." << std::endl;
        
        for (int i = 0; i < 50; ++i) {
            size_t size = 100000 + i * 10000;  // Variable sizes
            auto array = std::make_unique<int[]>(size);
            
            // Fill with data to ensure actual memory allocation
            for (size_t j = 0; j < size; ++j) {
                array[j] = static_cast<int>(i * j);
            }
            
            large_arrays.push_back(std::move(array));
        }
    }
    
    void allocate_matrices() {
        std::cout << "Allocating dynamic matrices..." << std::endl;
        
        for (int i = 0; i < 20; ++i) {
            size_t rows = 500 + i * 50;
            size_t cols = 500 + i * 50;
            
            std::vector<double> matrix(rows * cols);
            
            // Fill with computational data
            for (size_t r = 0; r < rows; ++r) {
                for (size_t c = 0; c < cols; ++c) {
                    matrix[r * cols + c] = std::sin(r * 0.01) * std::cos(c * 0.01);
                }
            }
            
            dynamic_matrices.push_back(matrix);
        }
    }
    
    void pattern_allocation() {
        std::cout << "Testing allocation patterns..." << std::endl;
        
        // Pattern 1: Many small allocations
        std::vector<std::unique_ptr<char[]>> small_chunks;
        for (int i = 0; i < 1000; ++i) {
            auto chunk = std::make_unique<char[]>(1024);  // 1KB chunks
            std::fill_n(chunk.get(), 1024, static_cast<char>(i % 256));
            small_chunks.push_back(std::move(chunk));
        }
        
        // Pattern 2: Growing allocations
        std::vector<std::unique_ptr<double[]>> growing_chunks;
        for (int i = 0; i < 100; ++i) {
            size_t size = (i + 1) * 1000;  // Growing sizes
            auto chunk = std::make_unique<double[]>(size);
            
            for (size_t j = 0; j < size; ++j) {
                chunk[j] = std::sqrt(j) * std::log(j + 1);
            }
            
            growing_chunks.push_back(std::move(chunk));
        }
        
        // Pattern 3: Random sized allocations
        std::random_device rd;
        std::mt19937 gen(rd());
        std::uniform_int_distribution<> size_dis(100, 10000);
        
        std::vector<std::unique_ptr<int[]>> random_chunks;
        for (int i = 0; i < 200; ++i) {
            size_t size = size_dis(gen);
            auto chunk = std::make_unique<int[]>(size);
            
            for (size_t j = 0; j < size; ++j) {
                chunk[j] = i * j + size;
            }
            
            random_chunks.push_back(std::move(chunk));
        }
    }
    
    void memory_pressure_test() {
        std::cout << "Running memory pressure test..." << std::endl;
        
        const size_t total_mb = 500;  // Allocate 500MB
        const size_t chunk_size = 1024 * 1024;  // 1MB chunks
        const size_t num_chunks = total_mb;
        
        std::vector<std::unique_ptr<char[]>> pressure_chunks;
        
        for (size_t i = 0; i < num_chunks; ++i) {
            auto chunk = std::make_unique<char[]>(chunk_size);
            
            // Touch each page to ensure allocation
            for (size_t j = 0; j < chunk_size; j += 4096) {  // Page size
                chunk[j] = static_cast<char>(i);
            }
            
            pressure_chunks.push_back(std::move(chunk));
            
            // Small delay to simulate real usage
            if (i % 100 == 0) {
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
            }
        }
    }
    
    void deallocation_patterns() {
        std::cout << "Testing deallocation patterns..." << std::endl;
        
        // Allocate first
        std::vector<std::unique_ptr<double[]>> temp_arrays;
        for (int i = 0; i < 100; ++i) {
            auto array = std::make_unique<double[]>(10000);
            for (int j = 0; j < 10000; ++j) {
                array[j] = std::sin(j * 0.001) * i;
            }
            temp_arrays.push_back(std::move(array));
        }
        
        // Deallocate in different patterns
        // Pattern 1: Sequential deallocation
        for (int i = 0; i < 50; ++i) {
            temp_arrays.erase(temp_arrays.begin());
        }
        
        // Pattern 2: Random deallocation
        std::random_device rd;
        std::mt19937 gen(rd());
        
        while (!temp_arrays.empty()) {
            size_t index = gen() % temp_arrays.size();
            temp_arrays.erase(temp_arrays.begin() + index);
        }
    }
};

class CachePerformanceTester {
private:
    static constexpr size_t CACHE_SIZE = 32 * 1024;  // L1 cache size
    static constexpr size_t ARRAY_SIZE = CACHE_SIZE * 64;  // Much larger than cache
    
    std::vector<int> large_array;
    
public:
    CachePerformanceTester() : large_array(ARRAY_SIZE) {
        // Initialize array
        for (size_t i = 0; i < ARRAY_SIZE; ++i) {
            large_array[i] = i;
        }
    }
    
    void sequential_access() {
        std::cout << "Testing sequential memory access..." << std::endl;
        volatile long long sum = 0;
        
        for (int iteration = 0; iteration < 100; ++iteration) {
            for (size_t i = 0; i < ARRAY_SIZE; ++i) {
                sum += large_array[i];
            }
        }
    }
    
    void random_access() {
        std::cout << "Testing random memory access..." << std::endl;
        
        std::vector<size_t> indices;
        for (size_t i = 0; i < ARRAY_SIZE; ++i) {
            indices.push_back(i);
        }
        
        std::random_device rd;
        std::mt19937 gen(rd());
        std::shuffle(indices.begin(), indices.end(), gen);
        
        volatile long long sum = 0;
        for (int iteration = 0; iteration < 100; ++iteration) {
            for (size_t i = 0; i < ARRAY_SIZE; ++i) {
                sum += large_array[indices[i]];
            }
        }
    }
    
    void stride_access() {
        std::cout << "Testing strided memory access..." << std::endl;
        volatile long long sum = 0;
        
        const size_t stride = 64;  // Cache line size
        for (int iteration = 0; iteration < 100; ++iteration) {
            for (size_t i = 0; i < ARRAY_SIZE; i += stride) {
                sum += large_array[i];
            }
        }
    }
};

int main() {
    std::cout << "Starting memory allocation profiler test..." << std::endl;
    
    MemoryAllocator allocator;
    CachePerformanceTester cache_tester;
    
    // Test different memory patterns
    allocator.allocate_large_chunks();
    allocator.allocate_matrices();
    allocator.pattern_allocation();
    
    // Test cache performance
    cache_tester.sequential_access();
    cache_tester.random_access();
    cache_tester.stride_access();
    
    // Memory pressure test
    allocator.memory_pressure_test();
    
    // Deallocation patterns
    allocator.deallocation_patterns();
    
    std::cout << "Memory allocation test completed!" << std::endl;
    return 0;
}
