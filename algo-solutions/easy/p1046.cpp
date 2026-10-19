// P1046 [NOIP2005 普及组] 陶陶摘苹果
// 核心算法：数组遍历
// 时间复杂度：O(10)；空间复杂度：O(10)
#include <iostream>

int main() {
    const int N = 10;
    int height[N];
    for (int i = 0; i < N; ++i) {
        std::cin >> height[i];
    }
    int reach;
    std::cin >> reach;
    reach += 30;  // 踩 30cm 凳子后的最大高度
    int count = 0;
    for (int i = 0; i < N; ++i) {
        if (height[i] <= reach) {
            ++count;
        }
    }
    std::cout << count << '\n';
    return 0;
}
