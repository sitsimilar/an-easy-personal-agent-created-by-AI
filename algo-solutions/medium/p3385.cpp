// 洛谷 P3385 【模板】负环
// 核心算法：SPFA 判负环
// 时间复杂度：最坏 O(nm)，本模板题数据下可接受
// 判负环原理：若某点最短路经过的边数 >= n，说明路径上有 n+1 个点，必出现重复点，即存在负环

#include <iostream>
#include <queue>
#include <vector>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int T;
    std::cin >> T;
    while (T--) {
        int n, m;
        std::cin >> n >> m;

        // 邻接表存有向边，边权 w 可为负数
        std::vector<std::vector<std::pair<int, long long>>> g(n + 1);
        for (int i = 0; i < m; ++i) {
            int u, v;
            long long w;
            std::cin >> u >> v >> w;
            g[u].push_back({v, w});
        }

        // dist 初始全 0，等价于一个虚拟源点以 0 权边连向所有点，
        // 从而能检测到图中任意连通块内的负环
        std::vector<long long> dist(n + 1, 0);
        std::vector<int> cnt(n + 1, 0);          // 当前最短路经过的边数
        std::vector<bool> inq(n + 1, false);     // 是否在队列中
        std::queue<int> q;
        for (int i = 1; i <= n; ++i) {
            q.push(i);
            inq[i] = true;
        }

        bool hasNegativeCycle = false;
        while (!q.empty() && !hasNegativeCycle) {
            int u = q.front();
            q.pop();
            inq[u] = false;
            for (const auto& e : g[u]) {
                int v = e.first;
                long long w = e.second;
                if (dist[u] + w < dist[v]) {
                    dist[v] = dist[u] + w;
                    cnt[v] = cnt[u] + 1;
                    if (cnt[v] >= n) {
                        hasNegativeCycle = true;
                        break;
                    }
                    if (!inq[v]) {
                        q.push(v);
                        inq[v] = true;
                    }
                }
            }
        }

        std::cout << (hasNegativeCycle ? "YES" : "NO") << '\n';
    }
    return 0;
}
