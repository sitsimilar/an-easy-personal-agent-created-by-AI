// P1177 【模板】快速排序
// 核心算法：排序 / 分治（std::sort 内省排序，避免朴素快排最坏 O(n^2)）
// 时间复杂度：O(n log n)；空间复杂度：O(n)
#include <iostream>
#include <vector>
#include <algorithm>

int main() {
    int n;
    std::cin >> n;
    std::vector<long long> a(n);
    for (int i = 0; i < n; ++i) {
        std::cin >> a[i];
    }
    std::sort(a.begin(), a.end());
    for (int i = 0; i < n; ++i) {
        std::cout << a[i];
        if (i == n - 1) {
            std::cout << '\n';
        } else {
            std::cout << ' ';
        }
    }
    return 0;
}
