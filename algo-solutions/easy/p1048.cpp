// P1048 [NOIP2005 普及组] 采药
// 核心算法：01 背包 / 动态规划（滚动数组）
// 时间复杂度：O(T*M)；空间复杂度：O(T)
#include <iostream>
#include <vector>
#include <algorithm>

int main() {
    int T, M;
    std::cin >> T >> M;
    std::vector<int> dp(T + 1, 0);
    for (int i = 0; i < M; ++i) {
        int t, v;
        std::cin >> t >> v;
        // 倒序遍历，保证每株药最多采一次
        for (int j = T; j >= t; --j) {
            dp[j] = std::max(dp[j], dp[j - t] + v);
        }
    }
    std::cout << dp[T] << '\n';
    return 0;
}
