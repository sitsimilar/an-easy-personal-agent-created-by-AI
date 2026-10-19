// P3834 【模板】可持久化线段树 2（主席树）
// 核心算法：对值域离散化后建可持久化权值线段树，版本 i 在前一版本基础上插入 a[i]；
//           查询区间 [l, r] 第 k 小时，用版本 r 与版本 l-1 两棵线段树作差，在值域上二分。
// 复杂度：O((n + q) * log n)，空间 O(n * log n)。
#include <iostream>
#include <vector>
#include <algorithm>

struct Node {
    int lc;   // 左儿子编号
    int rc;   // 右儿子编号
    int cnt;  // 值域区间内数的个数
};

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n, q;
    std::cin >> n >> q;
    std::vector<int> a(n + 1, 0);
    std::vector<int> vals;              // 用于离散化
    vals.reserve(n);
    for (int i = 1; i <= n; ++i) {
        std::cin >> a[i];
        vals.push_back(a[i]);
    }

    // 离散化
    std::sort(vals.begin(), vals.end());
    vals.erase(std::unique(vals.begin(), vals.end()), vals.end());
    int m = static_cast<int>(vals.size());

    std::vector<Node> tree;             // 动态开点：tree[0] 为空节点
    tree.push_back({0, 0, 0});

    std::vector<int> root(n + 1, 0);    // root[i]：插入前 i 个数后的版本根

    // 在上一版本 prev 基础上，在位置 pos（值域下标 1..m）插入一个数
    auto update = [&](int prev, int pos) -> int {
        tree.push_back(tree[prev]);     // 复制上一版本节点
        int cur = static_cast<int>(tree.size()) - 1;
        tree[cur].cnt++;
        int lo = 1, hi = m;
        int node = cur;
        while (lo < hi) {
            int mid = (lo + hi) >> 1;
            if (pos <= mid) {
                int oldLc = tree[prev].lc;
                tree.push_back(tree[oldLc]);
                int newLc = static_cast<int>(tree.size()) - 1;
                tree[node].lc = newLc;
                tree[newLc].cnt++;
                node = newLc;
                prev = oldLc;
                hi = mid;
            } else {
                int oldRc = tree[prev].rc;
                tree.push_back(tree[oldRc]);
                int newRc = static_cast<int>(tree.size()) - 1;
                tree[node].rc = newRc;
                tree[newRc].cnt++;
                node = newRc;
                prev = oldRc;
                lo = mid + 1;
            }
        }
        return cur;
    };

    for (int i = 1; i <= n; ++i) {
        int pos = static_cast<int>(std::lower_bound(vals.begin(), vals.end(), a[i]) - vals.begin()) + 1;
        root[i] = update(root[i - 1], pos);
    }

    while (q--) {
        int l, r, k;
        std::cin >> l >> r >> k;
        int u = root[r];
        int v = root[l - 1];
        int lo = 1, hi = m;
        while (lo < hi) {
            int mid = (lo + hi) >> 1;
            // 左子树中的数个数 = 版本 r 左子树 - 版本 l-1 左子树
            int leftCnt = tree[tree[u].lc].cnt - tree[tree[v].lc].cnt;
            if (k <= leftCnt) {
                u = tree[u].lc;
                v = tree[v].lc;
                hi = mid;
            } else {
                k -= leftCnt;
                u = tree[u].rc;
                v = tree[v].rc;
                lo = mid + 1;
            }
        }
        std::cout << vals[lo - 1] << '\n';
    }
    return 0;
}
