// P1035 [NOIP2002 普及组] 级数求和
// 核心算法：循环 / 枚举 / 浮点累加
// 时间复杂度：O(答案)；空间复杂度：O(1)
#include <iostream>

int main() {
    int k;
    std::cin >> k;
    double sum = 0.0;
    int n = 0;
    // 累加 1 + 1/2 + 1/3 + ... 直到首次超过 K
    while (sum <= k) {
        ++n;
        sum += 1.0 / n;
    }
    std::cout << n << '\n';
    return 0;
}
