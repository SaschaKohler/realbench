#include <iostream>
#include <vector>
#include <cmath>
#include <random>
#include <thread>
#include <chrono>

// CPU-intensive computational functions for profiler testing

class MatrixMultiplier {
private:
    std::vector<std::vector<double>> matrix_a;
    std::vector<std::vector<double>> matrix_b;
    size_t size;
    
public:
    MatrixMultiplier(size_t n) : size(n) {
        matrix_a.resize(n, std::vector<double>(n));
        matrix_b.resize(n, std::vector<double>(n));
        
        // Initialize with random values
        std::random_device rd;
        std::mt19937 gen(rd());
        std::uniform_real_distribution<> dis(0.0, 1.0);
        
        for (size_t i = 0; i < n; ++i) {
            for (size_t j = 0; j < n; ++j) {
                matrix_a[i][j] = dis(gen);
                matrix_b[i][j] = dis(gen);
            }
        }
    }
    
    double multiply_matrices() {
        std::vector<std::vector<double>> result(size, std::vector<double>(size, 0.0));
        double sum = 0.0;
        
        for (size_t i = 0; i < size; ++i) {
            for (size_t j = 0; j < size; ++j) {
                for (size_t k = 0; k < size; ++k) {
                    result[i][j] += matrix_a[i][k] * matrix_b[k][j];
                }
                sum += result[i][j];
            }
        }
        
        return sum;
    }
};

class PrimeCalculator {
public:
    bool is_prime(int n) {
        if (n <= 1) return false;
        if (n <= 3) return true;
        if (n % 2 == 0 || n % 3 == 0) return false;
        
        for (int i = 5; i * i <= n; i += 6) {
            if (n % i == 0 || n % (i + 2) == 0) {
                return false;
            }
        }
        return true;
    }
    
    int count_primes_up_to(int limit) {
        int count = 0;
        for (int i = 2; i <= limit; ++i) {
            if (is_prime(i)) {
                count++;
            }
        }
        return count;
    }
    
    void expensive_prime_calculation() {
        volatile int result = 0;
        for (int i = 0; i < 1000; ++i) {
            result += count_primes_up_to(10000 + i * 100);
        }
    }
};

class MemoryIntensive {
private:
    std::vector<std::vector<int>> large_data;
    
public:
    void allocate_and_process() {
        const size_t size = 1000;
        large_data.resize(size, std::vector<int>(size));
        
        // Fill with data
        for (size_t i = 0; i < size; ++i) {
            for (size_t j = 0; j < size; ++j) {
                large_data[i][j] = i * j + (i + j);
            }
        }
        
        // Process data
        volatile long long sum = 0;
        for (size_t i = 0; i < size; ++i) {
            for (size_t j = 0; j < size; ++j) {
                sum += large_data[i][j] * large_data[(i + 1) % size][(j + 1) % size];
            }
        }
    }
};

class RecursiveFunctions {
public:
    long long fibonacci_recursive(int n) {
        if (n <= 1) return n;
        return fibonacci_recursive(n - 1) + fibonacci_recursive(n - 2);
    }
    
    double expensive_recursive_calculation(int depth) {
        if (depth <= 0) return 1.0;
        return std::sqrt(depth) + expensive_recursive_calculation(depth - 1) * 1.1;
    }
    
    void run_recursive_tests() {
        volatile long long fib_result = fibonacci_recursive(35);
        volatile double rec_result = expensive_recursive_calculation(50);
        
        // Use results to prevent compiler optimization
        volatile double combined = fib_result + rec_result;
        (void)combined; // Suppress unused variable warning
    }
};

class FloatingPointIntensive {
public:
    double compute_monte_carlo_pi(int samples) {
        std::random_device rd;
        std::mt19937 gen(rd());
        std::uniform_real_distribution<> dis(-1.0, 1.0);
        
        int inside_circle = 0;
        for (int i = 0; i < samples; ++i) {
            double x = dis(gen);
            double y = dis(gen);
            if (x * x + y * y <= 1.0) {
                inside_circle++;
            }
        }
        
        return 4.0 * inside_circle / samples;
    }
    
    void intensive_floating_point() {
        volatile double result = 0.0;
        for (int i = 0; i < 100; ++i) {
            result += compute_monte_carlo_pi(100000);
            result += std::sin(i) * std::cos(i) + std::tan(i / 100.0);
            result += std::exp(i / 1000.0) * std::log(i + 1);
        }
    }
};

void simulate_io_bound_work() {
    // Simulate I/O bound operations with sleep
    for (int i = 0; i < 10; ++i) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        // Do some light work during "I/O"
        volatile int dummy = 0;
        for (int j = 0; j < 100000; ++j) {
            dummy += j;
        }
    }
}

int main() {
    std::cout << "Starting CPU-intensive profiler test..." << std::endl;
    
    MatrixMultiplier matrix_mul(200);  // 200x200 matrix multiplication
    PrimeCalculator prime_calc;
    MemoryIntensive mem_intensive;
    RecursiveFunctions recursive;
    FloatingPointIntensive fp_intensive;
    
    // Run different computational patterns
    std::cout << "Running matrix multiplication..." << std::endl;
    volatile double matrix_result = matrix_mul.multiply_matrices();
    std::cout << "Matrix multiplication result: " << matrix_result << std::endl;
    
    std::cout << "Running prime calculations..." << std::endl;
    prime_calc.expensive_prime_calculation();
    
    std::cout << "Running memory-intensive operations..." << std::endl;
    mem_intensive.allocate_and_process();
    
    std::cout << "Running recursive functions..." << std::endl;
    recursive.run_recursive_tests();
    
    std::cout << "Running floating-point intensive operations..." << std::endl;
    fp_intensive.intensive_floating_point();
    
    std::cout << "Simulating I/O bound work..." << std::endl;
    simulate_io_bound_work();
    
    std::cout << "Profiler test completed!" << std::endl;
    return 0;
}
