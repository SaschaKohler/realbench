#include <iostream>
#include <vector>
#include <algorithm>
#include <random>
#include <chrono>
#include <map>
#include <unordered_map>
#include <set>
#include <string>
#include <climits>

// Algorithmic complexity patterns for profiler testing

class SortingAlgorithms {
private:
    std::vector<int> generate_random_data(size_t size) {
        std::vector<int> data(size);
        std::random_device rd;
        std::mt19937 gen(rd());
        std::uniform_int_distribution<> dis(1, 1000000);
        
        for (size_t i = 0; i < size; ++i) {
            data[i] = dis(gen);
        }
        
        return data;
    }
    
    std::vector<int> generate_sorted_data(size_t size) {
        std::vector<int> data(size);
        for (size_t i = 0; i < size; ++i) {
            data[i] = static_cast<int>(i);
        }
        return data;
    }
    
    std::vector<int> generate_reverse_sorted_data(size_t size) {
        std::vector<int> data(size);
        for (size_t i = 0; i < size; ++i) {
            data[i] = static_cast<int>(size - i);
        }
        return data;
    }
    
public:
    // O(n^2) bubble sort - worst case
    void bubble_sort(std::vector<int>& arr) {
        size_t n = arr.size();
        for (size_t i = 0; i < n - 1; ++i) {
            for (size_t j = 0; j < n - i - 1; ++j) {
                if (arr[j] > arr[j + 1]) {
                    std::swap(arr[j], arr[j + 1]);
                }
            }
        }
    }
    
    // O(n log n) quicksort implementation
    void quick_sort(std::vector<int>& arr, int low, int high) {
        if (low < high) {
            int pivot = partition(arr, low, high);
            quick_sort(arr, low, pivot - 1);
            quick_sort(arr, pivot + 1, high);
        }
    }
    
    int partition(std::vector<int>& arr, int low, int high) {
        int pivot = arr[high];
        int i = low - 1;
        
        for (int j = low; j < high; ++j) {
            if (arr[j] < pivot) {
                i++;
                std::swap(arr[i], arr[j]);
            }
        }
        std::swap(arr[i + 1], arr[high]);
        return i + 1;
    }
    
    // O(n log n) merge sort implementation
    void merge_sort(std::vector<int>& arr, int left, int right) {
        if (left < right) {
            int mid = left + (right - left) / 2;
            merge_sort(arr, left, mid);
            merge_sort(arr, mid + 1, right);
            merge(arr, left, mid, right);
        }
    }
    
    void merge(std::vector<int>& arr, int left, int mid, int right) {
        int n1 = mid - left + 1;
        int n2 = right - mid;
        
        std::vector<int> L(n1), R(n2);
        
        for (int i = 0; i < n1; ++i)
            L[i] = arr[left + i];
        for (int j = 0; j < n2; ++j)
            R[j] = arr[mid + 1 + j];
        
        int i = 0, j = 0, k = left;
        
        while (i < n1 && j < n2) {
            if (L[i] <= R[j]) {
                arr[k] = L[i];
                i++;
            } else {
                arr[k] = R[j];
                j++;
            }
            k++;
        }
        
        while (i < n1) {
            arr[k] = L[i];
            i++;
            k++;
        }
        
        while (j < n2) {
            arr[k] = R[j];
            j++;
            k++;
        }
    }
    
    void test_sorting_algorithms() {
        std::cout << "Testing sorting algorithms..." << std::endl;
        
        const size_t data_size = 10000;
        
        // Test bubble sort (O(n^2))
        auto bubble_data = generate_reverse_sorted_data(data_size);
        bubble_sort(bubble_data);
        
        // Test quicksort (O(n log n))
        auto quick_data = generate_random_data(data_size);
        quick_sort(quick_data, 0, quick_data.size() - 1);
        
        // Test merge sort (O(n log n))
        auto merge_data = generate_random_data(data_size);
        merge_sort(merge_data, 0, merge_data.size() - 1);
        
        // Test std::sort (highly optimized O(n log n))
        auto std_data = generate_random_data(data_size);
        std::sort(std_data.begin(), std_data.end());
    }
};

class SearchAlgorithms {
private:
    std::vector<int> sorted_data;
    
public:
    SearchAlgorithms(size_t size) {
        sorted_data.resize(size);
        for (size_t i = 0; i < size; ++i) {
            sorted_data[i] = static_cast<int>(i * 2);  // Even numbers
        }
    }
    
    // O(n) linear search
    int linear_search(int target) {
        for (size_t i = 0; i < sorted_data.size(); ++i) {
            if (sorted_data[i] == target) {
                return static_cast<int>(i);
            }
        }
        return -1;
    }
    
    // O(log n) binary search
    int binary_search(int target) {
        int left = 0;
        int right = static_cast<int>(sorted_data.size()) - 1;
        
        while (left <= right) {
            int mid = left + (right - left) / 2;
            
            if (sorted_data[mid] == target) {
                return mid;
            } else if (sorted_data[mid] < target) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        
        return -1;
    }
    
    // O(n) pattern matching (naive string search)
    int pattern_search(const std::string& text, const std::string& pattern) {
        size_t n = text.length();
        size_t m = pattern.length();
        
        for (size_t i = 0; i <= n - m; ++i) {
            size_t j;
            for (j = 0; j < m; ++j) {
                if (text[i + j] != pattern[j]) {
                    break;
                }
            }
            if (j == m) {
                return static_cast<int>(i);
            }
        }
        
        return -1;
    }
    
    void test_search_algorithms() {
        std::cout << "Testing search algorithms..." << std::endl;
        
        const int iterations = 100000;
        volatile int found_count = 0;
        
        // Test linear search
        for (int i = 0; i < iterations; ++i) {
            int target = i * 3;  // Some will be found, some won't
            if (linear_search(target) != -1) {
                found_count++;
            }
        }
        
        // Test binary search
        for (int i = 0; i < iterations; ++i) {
            int target = i * 3;
            if (binary_search(target) != -1) {
                found_count++;
            }
        }
        
        // Test pattern search
        std::string long_text(10000, 'a');
        for (size_t i = 0; i < long_text.length(); i += 100) {
            long_text[i] = 'b';
        }
        
        std::string pattern = "ba";
        for (int i = 0; i < 1000; ++i) {
            if (pattern_search(long_text, pattern) != -1) {
                found_count++;
            }
        }
    }
};

class DataStructures {
public:
    // O(n^2) matrix operations
    void matrix_multiplication() {
        const int size = 300;
        std::vector<std::vector<int>> a(size, std::vector<int>(size));
        std::vector<std::vector<int>> b(size, std::vector<int>(size));
        std::vector<std::vector<int>> c(size, std::vector<int>(size, 0));
        
        // Initialize matrices
        for (int i = 0; i < size; ++i) {
            for (int j = 0; j < size; ++j) {
                a[i][j] = i + j;
                b[i][j] = i * j;
            }
        }
        
        // Multiply matrices
        for (int i = 0; i < size; ++i) {
            for (int j = 0; j < size; ++j) {
                for (int k = 0; k < size; ++k) {
                    c[i][j] += a[i][k] * b[k][j];
                }
            }
        }
    }
    
    // O(log n) tree operations simulation
    void tree_operations() {
        std::map<int, std::string> balanced_tree;
        std::unordered_map<int, std::string> hash_map;
        
        // Insert operations
        for (int i = 0; i < 100000; ++i) {
            balanced_tree[i] = "value_" + std::to_string(i);
            hash_map[i] = "value_" + std::to_string(i);
        }
        
        // Lookup operations
        volatile int found_count = 0;
        for (int i = 0; i < 100000; ++i) {
            if (balanced_tree.find(i) != balanced_tree.end()) {
                found_count++;
            }
            if (hash_map.find(i) != hash_map.end()) {
                found_count++;
            }
        }
        
        // Range queries (expensive for balanced tree)
        for (int i = 0; i < 1000; ++i) {
            auto start = balanced_tree.lower_bound(i * 10);
            auto end = balanced_tree.upper_bound(i * 10 + 100);
            
            volatile int count = 0;
            for (auto it = start; it != end; ++it) {
                count++;
            }
        }
    }
    
    // O(n log n) graph operations simulation
    void graph_operations() {
        std::set<std::pair<int, int>> edges;
        const int num_nodes = 1000;
        const int num_edges = 10000;
        
        // Create edges
        std::random_device rd;
        std::mt19937 gen(rd());
        std::uniform_int_distribution<> dis(0, num_nodes - 1);
        
        for (int i = 0; i < num_edges; ++i) {
            int u = dis(gen);
            int v = dis(gen);
            if (u != v) {
                edges.insert({std::min(u, v), std::max(u, v)});
            }
        }
        
        // Find neighbors (O(log n) per lookup)
        volatile int neighbor_count = 0;
        for (int node = 0; node < 100; ++node) {
            for (const auto& edge : edges) {
                if (edge.first == node || edge.second == node) {
                    neighbor_count++;
                }
            }
        }
    }
    
    void test_data_structures() {
        std::cout << "Testing data structure operations..." << std::endl;
        
        matrix_multiplication();
        tree_operations();
        graph_operations();
    }
};

class RecursiveAlgorithms {
public:
    // O(2^n) exponential - fibonacci
    long long fibonacci_recursive(int n) {
        if (n <= 1) return n;
        return fibonacci_recursive(n - 1) + fibonacci_recursive(n - 2);
    }
    
    // O(n!) factorial permutations
    void generate_permutations(std::vector<int>& arr, int start, std::vector<std::vector<int>>& result) {
        if (start == arr.size()) {
            result.push_back(arr);
            return;
        }
        
        for (int i = start; i < arr.size(); ++i) {
            std::swap(arr[start], arr[i]);
            generate_permutations(arr, start + 1, result);
            std::swap(arr[start], arr[i]);  // Backtrack
        }
    }
    
    // O(n log n) divide and conquer - maximum subarray
    int max_subarray_divide_conquer(const std::vector<int>& arr, int left, int right) {
        if (left == right) {
            return arr[left];
        }
        
        int mid = left + (right - left) / 2;
        
        int left_max = max_subarray_divide_conquer(arr, left, mid);
        int right_max = max_subarray_divide_conquer(arr, mid + 1, right);
        
        // Find maximum crossing subarray
        int left_sum = INT_MIN;
        int sum = 0;
        for (int i = mid; i >= left; --i) {
            sum += arr[i];
            left_sum = std::max(left_sum, sum);
        }
        
        int right_sum = INT_MIN;
        sum = 0;
        for (int i = mid + 1; i <= right; ++i) {
            sum += arr[i];
            right_sum = std::max(right_sum, sum);
        }
        
        int cross_max = left_sum + right_sum;
        
        return std::max({left_max, right_max, cross_max});
    }
    
    void test_recursive_algorithms() {
        std::cout << "Testing recursive algorithms..." << std::endl;
        
        // Test fibonacci (expponential - be careful with large n)
        volatile long long fib_result = fibonacci_recursive(35);
        
        // Test permutations (factorial complexity - keep n small)
        std::vector<int> perm_arr = {1, 2, 3, 4, 5, 6, 7, 8};
        std::vector<std::vector<int>> permutations;
        generate_permutations(perm_arr, 0, permutations);
        
        // Test divide and conquer
        std::vector<int> test_array;
        std::random_device rd;
        std::mt19937 gen(rd());
        std::uniform_int_distribution<> dis(-1000, 1000);
        
        for (int i = 0; i < 1000; ++i) {
            test_array.push_back(dis(gen));
        }
        
        volatile int max_subarray = max_subarray_divide_conquer(test_array, 0, test_array.size() - 1);
        
        // Use results to prevent compiler optimization
        volatile double combined = fib_result + max_subarray + permutations.size();
        std::cout << "Recursive algorithms completed with combined result: " << combined << std::endl;
    }
};

class DynamicProgramming {
public:
    // O(n^2) DP - longest common subsequence
    int longest_common_subsequence(const std::string& s1, const std::string& s2) {
        int m = s1.length();
        int n = s2.length();
        
        std::vector<std::vector<int>> dp(m + 1, std::vector<int>(n + 1, 0));
        
        for (int i = 1; i <= m; ++i) {
            for (int j = 1; j <= n; ++j) {
                if (s1[i - 1] == s2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = std::max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }
        
        return dp[m][n];
    }
    
    // O(n^3) DP - matrix chain multiplication
    int matrix_chain_order(const std::vector<int>& dims) {
        int n = dims.size() - 1;
        std::vector<std::vector<int>> dp(n, std::vector<int>(n, 0));
        
        for (int length = 2; length <= n; ++length) {
            for (int i = 0; i <= n - length; ++i) {
                int j = i + length - 1;
                dp[i][j] = INT_MAX;
                
                for (int k = i; k < j; ++k) {
                    int cost = dp[i][k] + dp[k + 1][j] + dims[i] * dims[k + 1] * dims[j + 1];
                    dp[i][j] = std::min(dp[i][j], cost);
                }
            }
        }
        
        return dp[0][n - 1];
    }
    
    void test_dynamic_programming() {
        std::cout << "Testing dynamic programming algorithms..." << std::endl;
        
        // Test LCS
        std::string s1 = "AGGTABABABABABABABABABABABABABABAB";
        std::string s2 = "GXTXAYBABABABABABABABABABABABABABAB";
        volatile int lcs_result = longest_common_subsequence(s1, s2);
        
        // Test matrix chain multiplication
        std::vector<int> dims = {10, 20, 30, 40, 50, 60, 70, 80};
        volatile int mcm_result = matrix_chain_order(dims);
        
        // Use results to prevent compiler optimization
        volatile double combined = lcs_result + mcm_result;
        std::cout << "Dynamic programming completed with combined result: " << combined << std::endl;
    }
};

int main() {
    std::cout << "Starting algorithmic complexity profiler test..." << std::endl;
    
    SortingAlgorithms sorter;
    SearchAlgorithms searcher(50000);
    DataStructures ds;
    RecursiveAlgorithms recursive;
    DynamicProgramming dp;
    
    sorter.test_sorting_algorithms();
    searcher.test_search_algorithms();
    ds.test_data_structures();
    recursive.test_recursive_algorithms();
    dp.test_dynamic_programming();
    
    std::cout << "Algorithmic complexity test completed!" << std::endl;
    return 0;
}
