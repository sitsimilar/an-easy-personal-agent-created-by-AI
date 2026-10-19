// P1055 [NOIP2008 普及组] ISBN 号码
// 核心算法：字符串模拟
// 时间复杂度：O(13)；空间复杂度：O(1)
#include <iostream>
#include <string>

int main() {
    std::string isbn;
    std::cin >> isbn;
    // 前 9 位数字加权求和（权重 1~9，跳过 '-'）
    int sum = 0;
    int weight = 1;
    for (char c : isbn) {
        if (c == '-') {
            continue;
        }
        if (weight <= 9) {
            sum += (c - '0') * weight;
            ++weight;
        }
    }
    int check = sum % 11;
    char expected = (check == 10) ? 'X' : static_cast<char>('0' + check);
    if (isbn.back() == expected) {
        std::cout << "Right\n";
    } else {
        isbn.back() = expected;  // 修正校验位
        std::cout << isbn << '\n';
    }
    return 0;
}
