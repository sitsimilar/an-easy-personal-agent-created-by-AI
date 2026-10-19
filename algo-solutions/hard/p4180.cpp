// P4180 [BJWC2010] 严格次小生成树
// 核心算法：Kruskal 求最小生成树，再对每条非树边 (u,v,w)，在 MST 的 u→v 路径上
//           找「最大边」与「严格次大边」。由环切性质有 w >= 最大边：
//           - 若最大边 < w，则删最大边；
//           - 若最大边 == w，则删严格次大边（必 < w）；
//           用倍增 LCA 维护路径最大/次大边，取所有替换方案的最小增量。
// 复杂度：O(m log m + m log n)，空间 O(n log n + m)。
#include <iostream>
#include <vector>
#include <algorithm>
#include <climits>

struct Edge {
    int u, v;
    long long w;
    bool inTree;
};

static const int LOG = 20;

// 将两组「最大/次大」合并成新的「最大/严格次大」（-1 表示不存在）
static void mergePair(long long a1, long long a2, long long b1, long long b2,
                      long long& r1, long long& r2) {
    long long arr[4] = {a1, a2, b1, b2};
    std::sort(arr, arr + 4, std::greater<long long>());
    r1 = arr[0];
    r2 = -1;
    for (int i = 1; i < 4; ++i) {
        if (arr[i] != r1 && arr[i] != -1) {
            r2 = arr[i];
            break;
        }
    }
}

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n, m;
    std::cin >> n >> m;
    std::vector<Edge> edges(m);
    for (int i = 0; i < m; ++i) {
        std::cin >> edges[i].u >> edges[i].v >> edges[i].w;
        edges[i].inTree = false;
    }

    // ---------------- Kruskal ----------------
    std::sort(edges.begin(), edges.end(), [](const Edge& a, const Edge& b) {
        return a.w < b.w;
    });

    std::vector<int> dsu(n + 1);
    for (int i = 1; i <= n; ++i) dsu[i] = i;

    auto find = [&](auto&& self, int x) -> int {
        if (dsu[x] != x) dsu[x] = self(self, dsu[x]);
        return dsu[x];
    };

    long long mstSum = 0;
    int usedCnt = 0;
    std::vector<std::vector<std::pair<int, long long>>> tree(n + 1);
    for (Edge& e : edges) {
        int a = find(find, e.u);
        int b = find(find, e.v);
        if (a != b) {
            dsu[a] = b;
            e.inTree = true;
            mstSum += e.w;
            usedCnt++;
            tree[e.u].push_back({e.v, e.w});
            tree[e.v].push_back({e.u, e.w});
            if (usedCnt == n - 1) break;
        }
    }

    // ---------------- 倍增 LCA + 路径最大/次大边 ----------------
    std::vector<std::vector<int>> up(LOG, std::vector<int>(n + 1, 1));
    std::vector<std::vector<long long>> mx1(LOG, std::vector<long long>(n + 1, -1));
    std::vector<std::vector<long long>> mx2(LOG, std::vector<long long>(n + 1, -1));
    std::vector<int> depth(n + 1, 0);

    // 迭代 DFS 求父节点与深度（避免深树递归爆栈）
    std::vector<int> stack;
    stack.reserve(n);
    stack.push_back(1);
    up[0][1] = 1;
    depth[1] = 0;
    while (!stack.empty()) {
        int u = stack.back();
        stack.pop_back();
        for (auto& [v, w] : tree[u]) {
            if (v == up[0][u]) continue;
            up[0][v] = u;
            depth[v] = depth[u] + 1;
            mx1[0][v] = w;
            mx2[0][v] = -1;
            stack.push_back(v);
        }
    }

    for (int k = 1; k < LOG; ++k) {
        for (int v = 1; v <= n; ++v) {
            int mid = up[k - 1][v];
            up[k][v] = up[k - 1][mid];
            mergePair(mx1[k - 1][v], mx2[k - 1][v],
                      mx1[k - 1][mid], mx2[k - 1][mid],
                      mx1[k][v], mx2[k][v]);
        }
    }

    // 查询 u→v 路径上的最大边与严格次大边
    auto pathMax = [&](int u, int v) -> std::pair<long long, long long> {
        long long r1 = -1, r2 = -1;
        if (depth[u] < depth[v]) std::swap(u, v);
        int diff = depth[u] - depth[v];
        for (int k = 0; k < LOG; ++k) {
            if ((diff >> k) & 1) {
                mergePair(r1, r2, mx1[k][u], mx2[k][u], r1, r2);
                u = up[k][u];
            }
        }
        if (u == v) return {r1, r2};
        for (int k = LOG - 1; k >= 0; --k) {
            if (up[k][u] != up[k][v]) {
                mergePair(r1, r2, mx1[k][u], mx2[k][u], r1, r2);
                mergePair(r1, r2, mx1[k][v], mx2[k][v], r1, r2);
                u = up[k][u];
                v = up[k][v];
            }
        }
        mergePair(r1, r2, mx1[0][u], mx2[0][u], r1, r2);
        mergePair(r1, r2, mx1[0][v], mx2[0][v], r1, r2);
        return {r1, r2};
    };

    // ---------------- 枚举非树边求严格次小 ----------------
    long long ans = LLONG_MAX;
    for (const Edge& e : edges) {
        if (e.inTree) continue;
        auto [m1, m2] = pathMax(e.u, e.v);
        if (m1 != -1 && m1 < e.w) {
            ans = std::min(ans, mstSum - m1 + e.w);
        } else if (m2 != -1 && m2 < e.w) {
            ans = std::min(ans, mstSum - m2 + e.w);
        }
    }
    std::cout << ans << '\n';
    return 0;
}
