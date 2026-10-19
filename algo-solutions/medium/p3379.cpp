// 洛谷 P3379 【模板】最近公共祖先（LCA）
// 核心算法：倍增 LCA（树上倍增）
// 时间复杂度：预处理 O(n log n)，单次查询 O(log n)
// 实现要点：树可能极深（n 可达 5e5），全部用迭代（BFS + 循环）实现，避免递归爆栈

#include <iostream>
#include <queue>
#include <vector>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n, m, s;
    std::cin >> n >> m >> s;

    // 链式前向星存储无向树（边数为 2*(n-1)）
    std::vector<int> head(n + 1, -1);
    std::vector<int> to(2 * n + 2, 0);
    std::vector<int> nxt(2 * n + 2, -1);
    int ecnt = 0;
    auto addEdge = [&](int u, int v) {
        to[ecnt] = v;
        nxt[ecnt] = head[u];
        head[u] = ecnt++;
    };

    for (int i = 0; i < n - 1; ++i) {
        int u, v;
        std::cin >> u >> v;
        addEdge(u, v);
        addEdge(v, u);
    }

    // LOG = 20，因为 2^19 = 524288 >= 5e5，足够表示最大深度
    const int LOG = 20;
    std::vector<int> depth(n + 1, 0);
    std::vector<std::vector<int>> up(LOG, std::vector<int>(n + 1, 0));

    // 迭代 BFS 求深度和 1 级祖先 up[0]
    std::queue<int> q;
    depth[s] = 1;
    up[0][s] = s;  // 根的父亲指向自己，避免越界
    q.push(s);
    while (!q.empty()) {
        int u = q.front();
        q.pop();
        for (int e = head[u]; e != -1; e = nxt[e]) {
            int v = to[e];
            if (v == up[0][u]) {
                continue;  // 跳过父节点，避免回退
            }
            depth[v] = depth[u] + 1;
            up[0][v] = u;
            q.push(v);
        }
    }

    // 预处理倍增表（迭代）：up[k][u] = u 向上 2^k 步的祖先
    for (int k = 1; k < LOG; ++k) {
        for (int u = 1; u <= n; ++u) {
            up[k][u] = up[k - 1][up[k - 1][u]];
        }
    }

    // 倍增查询 LCA（迭代）
    auto lca = [&](int u, int v) {
        if (depth[u] < depth[v]) {
            std::swap(u, v);
        }
        // 1. 把较深的 u 上提到与 v 同深度
        int diff = depth[u] - depth[v];
        for (int k = 0; k < LOG; ++k) {
            if (diff & (1 << k)) {
                u = up[k][u];
            }
        }
        if (u == v) {
            return u;
        }
        // 2. 从高到低一起向上跳，跳到 LCA 的下一层
        for (int k = LOG - 1; k >= 0; --k) {
            if (up[k][u] != up[k][v]) {
                u = up[k][u];
                v = up[k][v];
            }
        }
        return up[0][u];
    };

    while (m--) {
        int u, v;
        std::cin >> u >> v;
        std::cout << lca(u, v) << '\n';
    }
    return 0;
}
