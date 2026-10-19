// P1028 [NOIP2001 普及组] 数的计算
// 核心算法：递推 / 记忆化（前缀和优化）
// 时间复杂度：O(n)；空间复杂度：O(n)
// f[i] = 1 + sum(f[1..i/2])：以 i 开头的合法序列总数
#include <iostream>
#include <vector>

int main() {
    int n;
    std::cin >> n;
    std::vector<long long> f(n + 1, 0);
    std::vector<long long> pre(n + 1, 0);  // pre[i] = f[1] + ... + f[i]
    f[1] = 1;
    pre[1] = 1;
    for (int i = 2; i <= n; ++i) {
        f[i] = 1 + pre[i / 2];     // 左边可接 1..i/2 中任意数开头的序列
        pre[i] = pre[i - 1] + f[i];
    }
    std::cout << f[n] << '\n';
    return 0;
}
