// 洛谷 P3371 【模板】单源最短路径（弱化版）
// 核心算法：Dijkstra + 二叉堆优化（边权非负）
// 时间复杂度：O((n + m) log m)，其中 n 为点数、m 为边数
// 不可达的点输出 2147483647（题面规定的标记值）

#include <functional>
#include <iostream>
#include <queue>
#include <vector>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n, m, s;
    std::cin >> n >> m >> s;

    // 邻接表存有向边（u -> v，边权 w，w >= 0）
    std::vector<std::vector<std::pair<int, long long>>> g(n + 1);
    for (int i = 0; i < m; ++i) {
        int u, v;
        long long w;
        std::cin >> u >> v >> w;
        g[u].push_back({v, w});
    }

    const long long INF = 0x3f3f3f3f3f3f3f3fLL;
    std::vector<long long> dist(n + 1, INF);
    dist[s] = 0;

    // 小根堆：存储 (当前最短距离, 节点编号)
    using P = std::pair<long long, int>;
    std::priority_queue<P, std::vector<P>, std::greater<P>> pq;
    pq.push({0, s});

    while (!pq.empty()) {
        auto [d, u] = pq.top();
        pq.pop();
        if (d != dist[u]) {
            continue;  // 惰性删除：该状态已过期
        }
        for (const auto& e : g[u]) {
            int v = e.first;
            long long nd = d + e.second;
            if (nd < dist[v]) {
                dist[v] = nd;
                pq.push({nd, v});
            }
        }
    }

    for (int i = 1; i <= n; ++i) {
        if (dist[i] >= INF) {
            std::cout << 2147483647;
        } else {
            std::cout << dist[i];
        }
        if (i < n) {
            std::cout << ' ';
        }
    }
    std::cout << '\n';
    return 0;
}
