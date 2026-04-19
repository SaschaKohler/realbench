#include <iostream>
#include <thread>
#include <vector>
#include <atomic>
#include <mutex>
#include <condition_variable>
#include <chrono>
#include <random>
#include <cmath>
#include <functional>
#include <queue>

// Multithreading scenarios for profiler testing

class ThreadWorker {
private:
    std::atomic<int> counter{0};
    std::mutex mtx;
    std::condition_variable cv;
    bool ready = false;
    
public:
    void cpu_bound_worker(int thread_id, int iterations) {
        volatile double result = 0.0;
        std::random_device rd;
        std::mt19937 gen(rd() + thread_id);
        std::uniform_real_distribution<> dis(0.0, 1.0);
        
        for (int i = 0; i < iterations; ++i) {
            result += std::sin(dis(gen)) * std::cos(dis(gen));
            result += std::sqrt(i * 1.0) * std::log(i + 1);
            counter++;
        }
        
        std::cout << "Thread " << thread_id << " completed with result: " << result << std::endl;
    }
    
    void memory_bound_worker(int thread_id, size_t array_size) {
        std::vector<double> large_array(array_size);
        
        for (size_t i = 0; i < array_size; ++i) {
            large_array[i] = std::sin(i * 0.001) * std::cos(i * 0.001);
        }
        
        volatile double sum = 0.0;
        for (size_t i = 0; i < array_size; ++i) {
            sum += large_array[i] * large_array[(i + 1) % array_size];
        }
        
        counter++;
        std::cout << "Memory thread " << thread_id << " processed " << array_size << " elements" << std::endl;
    }
    
    void contested_mutex_worker(int thread_id, int operations) {
        for (int i = 0; i < operations; ++i) {
            std::unique_lock<std::mutex> lock(mtx);
            
            // Simulate work while holding lock
            std::this_thread::sleep_for(std::chrono::microseconds(10));
            
            counter++;
            
            // Wait for condition
            cv.wait(lock, [this] { return ready; });
            
            // More work (use thread_id to prevent unused warning)
            volatile int dummy = 0;
            for (int j = 0; j < 1000; ++j) {
                dummy += j + thread_id;
            }
        }
    }
    
    void signal_ready() {
        {
            std::lock_guard<std::mutex> lock(mtx);
            ready = true;
        }
        cv.notify_all();
    }
    
    int get_counter() const { return counter.load(); }
};

class ProducerConsumer {
private:
    std::vector<int> buffer;
    std::mutex buffer_mutex;
    std::condition_variable producer_cv, consumer_cv;
    std::atomic<bool> done{false};
    const size_t buffer_size;
    
public:
    ProducerConsumer(size_t size) : buffer_size(size) {
        buffer.reserve(size);
    }
    
    void producer(int thread_id, int items_to_produce) {
        std::random_device rd;
        std::mt19937 gen(rd() + thread_id);
        std::uniform_int_distribution<> dis(1, 1000);
        
        for (int i = 0; i < items_to_produce; ++i) {
            {
                std::unique_lock<std::mutex> lock(buffer_mutex);
                producer_cv.wait(lock, [this] { return buffer.size() < buffer_size; });
                
                buffer.push_back(dis(gen));
                
                // Simulate production work
                std::this_thread::sleep_for(std::chrono::microseconds(50));
            }
            
            consumer_cv.notify_one();
        }
    }
    
    void consumer(int thread_id, int items_to_consume) {
        int consumed = 0;
        
        while (consumed < items_to_consume) {
            {
                std::unique_lock<std::mutex> lock(buffer_mutex);
                consumer_cv.wait(lock, [this] { return !buffer.empty() || done.load(); });
                
                if (buffer.empty() && done.load()) break;
                
                if (!buffer.empty()) {
                    int item = buffer.back();
                    buffer.pop_back();
                    consumed++;
                    
                    // Simulate consumption work (use thread_id to prevent unused warning)
                    volatile int processed = item * item + thread_id;
                    for (int i = 0; i < 100; ++i) {
                        processed += i;
                    }
                }
            }
            
            producer_cv.notify_one();
        }
    }
    
    void finish_production() {
        done = true;
        consumer_cv.notify_all();
    }
};

class ThreadSynchronization {
private:
    std::mutex sync_mutex;
    std::condition_variable sync_cv;
    int waiting_threads = 0;
    int total_threads;
    std::atomic<int> phase_counter{0};
    
public:
    ThreadSynchronization(int num_threads) : total_threads(num_threads) {}
    
    void synchronized_worker(int thread_id, int phases) {
        for (int phase = 0; phase < phases; ++phase) {
            // Do some work
            volatile double result = 0.0;
            for (int i = 0; i < 100000; ++i) {
                result += std::sin(i * 0.01) * std::cos(i * 0.01);
            }
            
            // Synchronize with other threads (C++17 compatible)
            {
                std::unique_lock<std::mutex> lock(sync_mutex);
                waiting_threads++;
                if (waiting_threads == total_threads) {
                    // Last thread to arrive, wake everyone
                    waiting_threads = 0;
                    lock.unlock();
                    sync_cv.notify_all();
                } else {
                    // Wait for other threads
                    sync_cv.wait(lock, [this] { return waiting_threads == 0; });
                }
            }
            
            phase_counter++;
            
            std::cout << "Thread " << thread_id << " completed phase " << phase << std::endl;
        }
    }
};

class ThreadPoolSimulation {
private:
    struct Task {
        int task_id;
        int workload;
        
        Task(int id, int work) : task_id(id), workload(work) {}
    };
    
    std::queue<Task> task_queue;
    std::mutex queue_mutex;
    std::condition_variable queue_cv;
    std::atomic<bool> shutdown{false};
    std::vector<std::thread> workers;
    
public:
    ThreadPoolSimulation(size_t num_workers) {
        for (size_t i = 0; i < num_workers; ++i) {
            workers.emplace_back([this, i] {
                worker_thread(static_cast<int>(i));
            });
        }
    }
    
    ~ThreadPoolSimulation() {
        shutdown = true;
        queue_cv.notify_all();
        for (auto& worker : workers) {
            worker.join();
        }
    }
    
    void add_task(int task_id, int workload) {
        Task task(task_id, workload);
        
        {
            std::lock_guard<std::mutex> lock(queue_mutex);
            task_queue.push(task);
        }
        
        queue_cv.notify_one();
    }
    
private:
    void worker_thread(int worker_id) {
        while (!shutdown) {
            Task task(0, 0);
            bool has_task = false;
            
            {
                std::unique_lock<std::mutex> lock(queue_mutex);
                queue_cv.wait(lock, [this] { return !task_queue.empty() || shutdown; });
                
                if (shutdown) break;
                
                task = task_queue.front();
                task_queue.pop();
                has_task = true;
            }
            
            if (has_task) {
                execute_task(task.task_id + worker_id, task.workload); // Use worker_id to prevent warning
            }
        }
    }
    
    void execute_task(int task_id, int workload) {
        volatile double result = 0.0;
        for (int i = 0; i < workload; ++i) {
            result += std::sqrt(i) * std::log(i + 1);
        }
        
        std::cout << "Worker completed task " << task_id << " with workload " << workload << std::endl;
    }
};

void test_cpu_parallelism() {
    std::cout << "\n=== Testing CPU Parallelism ===" << std::endl;
    
    ThreadWorker worker;
    const int num_threads = std::thread::hardware_concurrency();
    const int iterations_per_thread = 1000000;
    
    std::vector<std::thread> threads;
    
    // Launch CPU-bound threads
    for (int i = 0; i < num_threads; ++i) {
        threads.emplace_back([&worker, i, iterations_per_thread]() {
            worker.cpu_bound_worker(i, iterations_per_thread);
        });
    }
    
    // Wait for all threads to complete
    for (auto& t : threads) {
        t.join();
    }
    
    std::cout << "Final counter value: " << worker.get_counter() << std::endl;
}

void test_memory_parallelism() {
    std::cout << "\n=== Testing Memory Parallelism ===" << std::endl;
    
    ThreadWorker worker;
    const int num_threads = 4;
    const size_t array_size = 1000000;
    
    std::vector<std::thread> threads;
    
    // Launch memory-bound threads
    for (int i = 0; i < num_threads; ++i) {
        threads.emplace_back([&worker, i, array_size]() {
            worker.memory_bound_worker(i, array_size);
        });
    }
    
    for (auto& t : threads) {
        t.join();
    }
}

void test_mutex_contention() {
    std::cout << "\n=== Testing Mutex Contention ===" << std::endl;
    
    ThreadWorker worker;
    const int num_threads = 8;
    const int operations_per_thread = 100;
    
    std::vector<std::thread> threads;
    
    // Launch threads with contested mutex
    for (int i = 0; i < num_threads; ++i) {
        threads.emplace_back([&worker, i, operations_per_thread]() {
            worker.contested_mutex_worker(i, operations_per_thread);
        });
    }
    
    // Signal ready after a delay
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
    worker.signal_ready();
    
    for (auto& t : threads) {
        t.join();
    }
}

void test_producer_consumer() {
    std::cout << "\n=== Testing Producer-Consumer ===" << std::endl;
    
    ProducerConsumer pc(100);  // Buffer size of 100
    const int num_producers = 3;
    const int num_consumers = 2;
    const int items_per_producer = 50;
    
    std::vector<std::thread> threads;
    
    // Launch producers
    for (int i = 0; i < num_producers; ++i) {
        threads.emplace_back([&pc, i, items_per_producer]() {
            pc.producer(i, items_per_producer);
        });
    }
    
    // Launch consumers
    int consumer_items = items_per_producer * num_producers / num_consumers;
    for (int i = 0; i < num_consumers; ++i) {
        threads.emplace_back([&pc, i, consumer_items]() {
            pc.consumer(i, consumer_items);
        });
    }
    
    // Wait for producers to finish
    for (int i = 0; i < num_producers; ++i) {
        threads[i].join();
    }
    
    pc.finish_production();
    
    // Wait for consumers to finish
    for (int i = num_producers; i < threads.size(); ++i) {
        threads[i].join();
    }
}

void test_thread_pool() {
    std::cout << "\n=== Testing Thread Pool Simulation ===" << std::endl;
    
    ThreadPoolSimulation pool(4);  // 4 worker threads
    
    // Add tasks
    for (int i = 0; i < 20; ++i) {
        pool.add_task(i, 100000 + i * 10000);  // Variable workloads
    }
    
    // Give time for tasks to complete
    std::this_thread::sleep_for(std::chrono::seconds(2));
}

int main() {
    std::cout << "Starting multithreading profiler test..." << std::endl;
    std::cout << "Hardware concurrency: " << std::thread::hardware_concurrency() << " threads" << std::endl;
    
    test_cpu_parallelism();
    test_memory_parallelism();
    test_mutex_contention();
    test_producer_consumer();
    test_thread_pool();
    
    std::cout << "\nMultithreading test completed!" << std::endl;
    return 0;
}
