// P1085 [NOIP2004 普及组] 不高兴的津津
// 核心算法：枚举 / 条件判断
// 时间复杂度：O(7)；空间复杂度：O(1)
#include <iostream>

int main() {
    int max_total = 0;
    int day = 0;
    for (int i = 1; i <= 7; ++i) {
        int school, extra;
        std::cin >> school >> extra;
        int total = school + extra;
        // 记录总时长最大的一天；相等时保留靠前的一天
        if (total > max_total) {
            max_total = total;
            day = i;
        }
    }
    // 超过 8 小时才不高兴，否则输出 0
    if (max_total > 8) {
        std::cout << day << '\n';
    } else {
        std::cout << 0 << '\n';
    }
    return 0;
}
