// P3376 【模板】网络最大流（Dinic）
// 核心算法：Dinic 算法——每次 BFS 构建分层图，再沿分层图做多路增广（DFS），
//           配合当前弧优化；容量与流量使用 long long。
// 复杂度：一般图 O(V^2 * E)，实际远快于此；空间 O(V + E)。
#include <iostream>
#include <vector>
#include <queue>
#include <algorithm>

struct Edge {
    int to;          // 目标顶点
    int rev;         // 反向边在邻接表中的下标
    long long cap;   // 剩余容量
};

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n, m, s, t;
    std::cin >> n >> m >> s >> t;

    std::vector<std::vector<Edge>> g(n + 1);
    auto addEdge = [&](int u, int v, long long cap) {
        Edge f{v, static_cast<int>(g[v].size()), cap};
        Edge b{u, static_cast<int>(g[u].size()), 0};
        g[u].push_back(f);
        g[v].push_back(b);
    };

    for (int i = 0; i < m; ++i) {
        int u, v;
        long long w;
        std::cin >> u >> v >> w;
        addEdge(u, v, w);
    }

    std::vector<int> level(n + 1, -1);
    std::vector<int> iter(n + 1, 0);

    auto bfs = [&]() -> bool {
        std::fill(level.begin(), level.end(), -1);
        std::queue<int> q;
        level[s] = 0;
        q.push(s);
        while (!q.empty()) {
            int u = q.front();
            q.pop();
            for (const Edge& e : g[u]) {
                if (e.cap > 0 && level[e.to] < 0) {
                    level[e.to] = level[u] + 1;
                    q.push(e.to);
                }
            }
        }
        return level[t] >= 0;
    };

    // 多路增广：返回从 u 出发到 t 的增广流量，流入量为 flow 上限
    auto dfs = [&](auto&& self, int u, long long flow) -> long long {
        if (u == t) return flow;
        for (int& i = iter[u]; i < static_cast<int>(g[u].size()); ++i) {
            Edge& e = g[u][i];
            if (e.cap > 0 && level[e.to] == level[u] + 1) {
                long long d = self(self, e.to, std::min(flow, e.cap));
                if (d > 0) {
                    e.cap -= d;
                    g[e.to][e.rev].cap += d;
                    return d;
                }
            }
        }
        return 0;
    };

    long long maxFlow = 0;
    while (bfs()) {
        std::fill(iter.begin(), iter.end(), 0);
        long long f;
        while ((f = dfs(dfs, s, 1LL << 60)) > 0) {
            maxFlow += f;
        }
    }

    std::cout << maxFlow << '\n';
    return 0;
}
