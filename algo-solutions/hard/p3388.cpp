// P3388 【模板】割点（割顶）
// 核心算法：Tarjan 求无向图割点。DFS 生成搜索树：
//   - 根节点：若在搜索树中有 >= 2 个儿子，则为割点；
//   - 非根节点 u：若存在儿子 v 满足 low[v] >= dfn[u]，则 u 为割点。
// 复杂度：O(n + m)，空间 O(n + m)。
#include <iostream>
#include <vector>
#include <algorithm>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n, m;
    std::cin >> n >> m;
    std::vector<std::vector<int>> g(n + 1);
    for (int i = 0; i < m; ++i) {
        int u, v;
        std::cin >> u >> v;
        g[u].push_back(v);
        g[v].push_back(u);
    }

    std::vector<int> dfn(n + 1, 0), low(n + 1, 0);
    std::vector<bool> isCut(n + 1, false);
    int timer = 0;

    // tarjan(u, isRoot)：返回以 u 为根的搜索树中，u 的儿子数量（用于根节点判断）
    auto tarjan = [&](auto&& self, int u, bool isRoot) -> void {
        dfn[u] = low[u] = ++timer;
        int child = 0;
        for (int v : g[u]) {
            if (dfn[v] == 0) {
                child++;
                self(self, v, false);
                low[u] = std::min(low[u], low[v]);
                // 非根节点判定：儿子无法绕过 u 回到 u 的祖先
                if (!isRoot && low[v] >= dfn[u]) isCut[u] = true;
            } else {
                low[u] = std::min(low[u], dfn[v]);
            }
        }
        if (isRoot && child >= 2) isCut[u] = true;
    };

    for (int i = 1; i <= n; ++i) {
        if (dfn[i] == 0) tarjan(tarjan, i, true);
    }

    std::vector<int> ans;
    for (int i = 1; i <= n; ++i) {
        if (isCut[i]) ans.push_back(i);
    }
    std::cout << ans.size() << '\n';
    for (size_t i = 0; i < ans.size(); ++i) {
        std::cout << ans[i] << (i + 1 == ans.size() ? '\n' : ' ');
    }
    return 0;
}
