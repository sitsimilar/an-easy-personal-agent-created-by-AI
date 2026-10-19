// P1903 [国家集训队] 数颜色 / 维护队列（带修莫队）
// 核心算法：莫队扩展到三维 (l, r, t)，t 为时间（已应用的修改次数）。
//   块大小取 n^(2/3)，排序按 (l/block, r/block, t) 升序，使指针移动总复杂度约 O(n^(5/3))。
//   修改用「交换法」应用：apply(t) 交换 a[pos] 与 mods[t].col，天然可逆，前进/后退同一函数。
// 复杂度：约 O(n^(5/3))，空间 O(n + maxColor)。
#include <iostream>
#include <vector>
#include <algorithm>
#include <cmath>

struct Query {
    int l, r;
    int t;      // 该查询发生前已应用的修改次数
    int id;     // 原始输入顺序
};

struct Modify {
    int pos;
    int col;    // 当前待交换进数组的颜色
};

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n, m;
    std::cin >> n >> m;
    std::vector<int> a(n + 1, 0);
    for (int i = 1; i <= n; ++i) std::cin >> a[i];

    std::vector<Query> queries;
    std::vector<Modify> mods;
    queries.reserve(m);
    mods.reserve(m);

    for (int i = 0; i < m; ++i) {
        char op;
        std::cin >> op;
        if (op == 'Q') {
            int l, r;
            std::cin >> l >> r;
            queries.push_back({l, r, static_cast<int>(mods.size()), static_cast<int>(queries.size())});
        } else {
            int p, c;
            std::cin >> p >> c;
            mods.push_back({p, c});
        }
    }

    int block = std::max(1, static_cast<int>(std::pow(static_cast<double>(n), 2.0 / 3.0)));
    std::sort(queries.begin(), queries.end(), [&](const Query& x, const Query& y) {
        int xlb = x.l / block, ylb = y.l / block;
        if (xlb != ylb) return xlb < ylb;
        int xrb = x.r / block, yrb = y.r / block;
        if (xrb != yrb) return xrb < yrb;
        return x.t < y.t;
    });

    const int MAXC = 1000005;
    std::vector<int> cnt(MAXC, 0);
    int curAns = 0;

    auto add = [&](int pos) {
        int c = a[pos];
        if (cnt[c]++ == 0) curAns++;
    };
    auto remove = [&](int pos) {
        int c = a[pos];
        if (--cnt[c] == 0) curAns--;
    };
    // 应用/撤销第 t 次修改（交换法，前进后退通用）
    auto applyTime = [&](int t, int l, int r) {
        int pos = mods[t].pos;
        if (l <= pos && pos <= r) {
            if (--cnt[a[pos]] == 0) curAns--;
            if (cnt[mods[t].col]++ == 0) curAns++;
        }
        std::swap(a[pos], mods[t].col);
    };

    std::vector<int> ans(queries.size(), 0);
    int l = 1, r = 0, t = 0;
    for (const Query& q : queries) {
        // 先扩展区间，再收缩区间，最后移动时间
        while (l > q.l) add(--l);
        while (r < q.r) add(++r);
        while (l < q.l) remove(l++);
        while (r > q.r) remove(r--);
        while (t < q.t) applyTime(t++, l, r);
        while (t > q.t) applyTime(--t, l, r);
        ans[q.id] = curAns;
    }

    for (int v : ans) std::cout << v << '\n';
    return 0;
}
