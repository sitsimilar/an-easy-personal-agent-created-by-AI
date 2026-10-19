// P1216 [USACO1.5] 数字三角形
// 核心算法：动态规划（自底向上）
// 时间复杂度：O(r^2)；空间复杂度：O(r^2)
#include <iostream>
#include <vector>
#include <algorithm>

int main() {
    int r;
    std::cin >> r;
    std::vector<std::vector<long long>> tri(r);
    for (int i = 0; i < r; ++i) {
        tri[i].resize(i + 1);
        for (int j = 0; j <= i; ++j) {
            std::cin >> tri[i][j];
        }
    }
    // 自底向上：每个点累加其下方两个邻点中的较大值
    for (int i = r - 2; i >= 0; --i) {
        for (int j = 0; j <= i; ++j) {
            tri[i][j] += std::max(tri[i + 1][j], tri[i + 1][j + 1]);
        }
    }
    std::cout << tri[0][0] << '\n';
    return 0;
}
