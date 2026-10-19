// P1089 [NOIP2004 提高组] 津津的储蓄计划
// 核心算法：模拟
// 时间复杂度：O(12)；空间复杂度：O(1)
#include <iostream>

int main() {
    int saved = 0;  // 存到妈妈处的本金（整百元）
    int hand = 0;   // 手头保留的零钱
    for (int month = 1; month <= 12; ++month) {
        int budget;
        std::cin >> budget;
        hand += 300;     // 每月先领 300 元零用钱
        hand -= budget;  // 扣除当月预算
        if (hand < 0) {  // 不够花，输出负月份并结束
            std::cout << -month << '\n';
            return 0;
        }
        saved += hand / 100 * 100;  // 把整百元交给妈妈存起来
        hand %= 100;                // 剩余零钱留在手里
    }
    // 年末：妈妈返还本金 + 20% 利息，再加上手头零钱
    // saved 必为 100 的倍数，saved / 5 即 20% 利息
    int total = hand + saved + saved / 5;
    std::cout << total << '\n';
    return 0;
}
