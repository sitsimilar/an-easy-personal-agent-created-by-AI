// P3391 【模板】文艺平衡树（FHQ Treap 区间翻转）
// 核心算法：FHQ Treap（无旋 Treap）按子树大小分裂 + 合并，支持区间翻转：
//           对 [l, r] 翻转时，先按大小把树拆成 [1,l-1]、[l,r]、[r+1,n] 三棵，
//           给中间打翻转懒标记，再合并回去；懒标记在分裂/合并前下传。
// 复杂度：O((n + m) * log n)，空间 O(n)。
#include <iostream>
#include <vector>
#include <random>
#include <cstdint>

struct Node {
    int lc, rc;        // 左右儿子
    int sz;            // 子树大小
    int val;           // 节点权值（此处即序列值）
    uint32_t pri;      // 随机优先级（大根堆）
    bool rev;          // 区间翻转懒标记
};

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n, m;
    std::cin >> n >> m;

    std::vector<Node> t;
    t.push_back({0, 0, 0, 0, 0, false});          // 下标 0 为空节点
    std::mt19937 rng(static_cast<uint32_t>(123456789u));

    auto newNode = [&](int v) -> int {
        t.push_back({0, 0, 1, v, rng(), false});
        return static_cast<int>(t.size()) - 1;
    };

    auto sz = [&](int x) -> int { return x == 0 ? 0 : t[x].sz; };

    auto pushUp = [&](int x) {
        if (x != 0) t[x].sz = 1 + sz(t[x].lc) + sz(t[x].rc);
    };

    auto pushDown = [&](int x) {
        if (x != 0 && t[x].rev) {
            std::swap(t[x].lc, t[x].rc);
            if (t[x].lc) t[t[x].lc].rev ^= true;
            if (t[x].rc) t[t[x].rc].rev ^= true;
            t[x].rev = false;
        }
    };

    // 按大小分裂：前 k 个节点进左树，其余进右树
    auto split = [&](auto&& self, int x, int k, int& a, int& b) -> void {
        if (x == 0) {
            a = b = 0;
            return;
        }
        pushDown(x);
        if (sz(t[x].lc) + 1 <= k) {
            a = x;
            self(self, t[x].rc, k - sz(t[x].lc) - 1, t[a].rc, b);
            pushUp(a);
        } else {
            b = x;
            self(self, t[x].lc, k, a, t[b].lc);
            pushUp(b);
        }
    };

    // 合并：左树所有键值小于右树（此处按优先级合并）
    auto merge = [&](auto&& self, int a, int b) -> int {
        if (a == 0 || b == 0) return a == 0 ? b : a;
        if (t[a].pri > t[b].pri) {
            pushDown(a);
            t[a].rc = self(self, t[a].rc, b);
            pushUp(a);
            return a;
        } else {
            pushDown(b);
            t[b].lc = self(self, a, t[b].lc);
            pushUp(b);
            return b;
        }
    };

    int root = 0;
    for (int i = 1; i <= n; ++i) root = merge(merge, root, newNode(i));

    while (m--) {
        int l, r;
        std::cin >> l >> r;
        int a, b, c;
        split(split, root, l - 1, a, b);
        split(split, b, r - l + 1, b, c);
        if (b != 0) t[b].rev ^= true;             // 给中间区间打翻转标记
        root = merge(merge, merge(merge, a, b), c);
    }

    // 中序遍历输出最终序列
    std::vector<int> ans;
    auto inorder = [&](auto&& self, int x) -> void {
        if (x == 0) return;
        pushDown(x);
        self(self, t[x].lc);
        ans.push_back(t[x].val);
        self(self, t[x].rc);
    };
    inorder(inorder, root);
    for (int i = 0; i < n; ++i) {
        std::cout << ans[i] << (i + 1 == n ? '\n' : ' ');
    }
    return 0;
}
