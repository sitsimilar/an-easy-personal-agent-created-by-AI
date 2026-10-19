// 洛谷 P3375 【模板】KMP 字符串匹配
// 核心算法：KMP（前缀函数 / next 数组）
// 时间复杂度：O(n + m)，其中 n 为主串长度、m 为模式串长度

#include <iostream>
#include <string>
#include <vector>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    std::string s1, s2;
    std::cin >> s1 >> s2;
    int n = static_cast<int>(s1.size());
    int m = static_cast<int>(s2.size());

    // 1. 求模式串 s2 的前缀函数 pi（即题目中的 next 数组）
    //    pi[i] = s2[0..i] 的最长相等前后缀长度
    std::vector<int> pi(m, 0);
    for (int i = 1; i < m; ++i) {
        int j = pi[i - 1];
        while (j > 0 && s2[i] != s2[j]) {
            j = pi[j - 1];
        }
        if (s2[i] == s2[j]) {
            ++j;
        }
        pi[i] = j;
    }

    // 2. KMP 匹配：在主串 s1 中找出所有 s2 的出现位置（下标从 1 开始）
    int j = 0;
    for (int i = 0; i < n; ++i) {
        while (j > 0 && s1[i] != s2[j]) {
            j = pi[j - 1];
        }
        if (s1[i] == s2[j]) {
            ++j;
        }
        if (j == m) {
            // 匹配成功，起始下标 = i - m + 1（0-based），转为 1-based 再加 1
            std::cout << (i - m + 1) + 1 << '\n';
            j = pi[j - 1];  // 继续寻找下一个匹配
        }
    }

    // 3. 输出 next 数组（前缀函数），空格分隔
    for (int i = 0; i < m; ++i) {
        if (i > 0) {
            std::cout << ' ';
        }
        std::cout << pi[i];
    }
    std::cout << '\n';

    return 0;
}
