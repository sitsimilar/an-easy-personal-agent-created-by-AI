// P1223 排队接水
// 核心算法：贪心 + 排序（短作业优先 SPT）
// 时间复杂度：O(n log n)；空间复杂度：O(n)
#include <iostream>
#include <vector>
#include <algorithm>
#include <iomanip>

struct Person {
    int id;    // 输入下标（从 1 开始）
    long long time;  // 接水时间
};

int main() {
    int n;
    std::cin >> n;
    std::vector<Person> people(n);
    for (int i = 0; i < n; ++i) {
        people[i].id = i + 1;
        std::cin >> people[i].time;
    }
    // 接水时间短的排前面；时间相同时按下标升序（稳定，保证唯一顺序）
    std::sort(people.begin(), people.end(),
              [](const Person& a, const Person& b) {
                  if (a.time != b.time) {
                      return a.time < b.time;
                  }
                  return a.id < b.id;
              });
    long long total_wait = 0;
    long long acc = 0;  // 前面所有人的接水时间之和
    for (int i = 0; i < n; ++i) {
        total_wait += acc;       // 当前人的等待时间 = 前面累计时间
        acc += people[i].time;
    }
    double avg = static_cast<double>(total_wait) / n;
    std::cout << std::fixed << std::setprecision(2) << avg << '\n';
    for (int i = 0; i < n; ++i) {
        std::cout << people[i].id;
        if (i == n - 1) {
            std::cout << '\n';
        } else {
            std::cout << ' ';
        }
    }
    return 0;
}
