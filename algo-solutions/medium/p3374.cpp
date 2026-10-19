// 洛谷 P3374 【模板】树状数组 1
// 核心算法：树状数组（Fenwick Tree，单点修改 + 区间查询）
// 时间复杂度：单点修改 O(log n)，区间查询 O(log n)；空间 O(n)
// 注意：区间和累加会超过 int 范围，统一使用 long long 存储

#include <iostream>
#include <vector>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n, m;
    std::cin >> n >> m;

    // 树状数组下标从 1 开始
    std::vector<long long> tree(n + 1, 0);

    // 单点加：第 x 个数加上 k
    auto add = [&](int x, long long k) {
        for (; x <= n; x += x & (-x)) {
            tree[x] += k;
        }
    };

    // 前缀和：求前 x 个数的和
    auto query = [&](int x) {
        long long s = 0;
        for (; x > 0; x -= x & (-x)) {
            s += tree[x];
        }
        return s;
    };

    // 建树：逐个插入初始值
    for (int i = 1; i <= n; ++i) {
        long long a;
        std::cin >> a;
        add(i, a);
    }

    while (m--) {
        int op;
        std::cin >> op;
        if (op == 1) {
            int x;
            long long k;
            std::cin >> x >> k;
            add(x, k);
        } else {
            int x, y;
            std::cin >> x >> y;
            // 区间和 = 前缀和[y] - 前缀和[x-1]
            std::cout << query(y) - query(x - 1) << '\n';
        }
    }
    return 0;
}
