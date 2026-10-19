// P1012 [NOIP1998 提高组] 拼数
// 核心算法：贪心 + 字符串排序（a+b > b+a 则 a 排前面）
// 时间复杂度：O(n log n * L)，L 为数字字符串长度；空间复杂度：O(n)
#include <iostream>
#include <vector>
#include <string>
#include <algorithm>

int main() {
    int n;
    std::cin >> n;
    std::vector<std::string> nums(n);
    for (int i = 0; i < n; ++i) {
        std::cin >> nums[i];
    }
    // 拼接结果字典序更大的字符串排前面
    std::sort(nums.begin(), nums.end(),
              [](const std::string& a, const std::string& b) {
                  return a + b > b + a;
              });
    for (int i = 0; i < n; ++i) {
        std::cout << nums[i];
    }
    std::cout << '\n';
    return 0;
}
