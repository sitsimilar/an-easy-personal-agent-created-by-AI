// P3384 【模板】树链剖分（重链剖分 + 线段树）
// 核心算法：重链剖分将树映射到 DFS 序（重儿子优先），使一条重链上的点在序列上连续，
//           子树内的点在序列上连续；路径操作拆成 O(log n) 段重链，交给线段树区间加/区间和。
// 复杂度：O((n + m) * log^2 n)，空间 O(n)。
#include <iostream>
#include <vector>

static int n, m, root, mod;
static std::vector<int> val;                       // 原始点权
static std::vector<std::vector<int>> g;            // 邻接表

static std::vector<int> fa, dep, siz, son;         // 父节点、深度、子树大小、重儿子
static std::vector<int> top, dfn, rnk;             // 链顶、DFS 序、DFS 序反查原编号
static int timer = 0;

// ---------------- 线段树（区间加 + 区间求和，结果对 mod 取模） ----------------
static std::vector<long long> segSum;              // 节点区间和（已取模）
static std::vector<long long> segLazy;             // 区间加法懒标记（未取模，可能为负）

static void segPushUp(int o) {
    segSum[o] = (segSum[o << 1] + segSum[o << 1 | 1]) % mod;
}

static void segApply(int o, int len, long long k) {
    segSum[o] = (segSum[o] + (k % mod + mod) % mod * len % mod) % mod;
    segLazy[o] = (segLazy[o] + k) % mod;
}

static void segPushDown(int o, int l, int r) {
    if (segLazy[o] == 0) return;
    int mid = (l + r) >> 1;
    segApply(o << 1, mid - l + 1, segLazy[o]);
    segApply(o << 1 | 1, r - mid, segLazy[o]);
    segLazy[o] = 0;
}

static void segBuild(int o, int l, int r) {
    if (l == r) {
        segSum[o] = val[rnk[l]] % mod;
        return;
    }
    int mid = (l + r) >> 1;
    segBuild(o << 1, l, mid);
    segBuild(o << 1 | 1, mid + 1, r);
    segPushUp(o);
}

static void segAdd(int o, int l, int r, int ql, int qr, long long k) {
    if (ql <= l && r <= qr) {
        segApply(o, r - l + 1, k);
        return;
    }
    segPushDown(o, l, r);
    int mid = (l + r) >> 1;
    if (ql <= mid) segAdd(o << 1, l, mid, ql, qr, k);
    if (qr > mid) segAdd(o << 1 | 1, mid + 1, r, ql, qr, k);
    segPushUp(o);
}

static long long segQuery(int o, int l, int r, int ql, int qr) {
    if (ql <= l && r <= qr) return segSum[o];
    segPushDown(o, l, r);
    int mid = (l + r) >> 1;
    long long res = 0;
    if (ql <= mid) res = (res + segQuery(o << 1, l, mid, ql, qr)) % mod;
    if (qr > mid) res = (res + segQuery(o << 1 | 1, mid + 1, r, ql, qr)) % mod;
    return res;
}

// ---------------- 第一次 DFS：求 fa/dep/siz/son ----------------
static void dfs1(int u, int f) {
    fa[u] = f;
    dep[u] = dep[f] + 1;
    siz[u] = 1;
    int heavy = 0;
    for (int v : g[u]) {
        if (v == f) continue;
        dfs1(v, u);
        siz[u] += siz[v];
        if (siz[v] > siz[heavy]) heavy = v;
    }
    son[u] = heavy;
}

// ---------------- 第二次 DFS：重链优先，分配 dfn ----------------
static void dfs2(int u, int t) {
    top[u] = t;
    dfn[u] = ++timer;
    rnk[timer] = u;
    if (son[u] != 0) dfs2(son[u], t);              // 先走重儿子，保证重链连续
    for (int v : g[u]) {
        if (v == fa[u] || v == son[u]) continue;
        dfs2(v, v);                                 // 轻儿子作为新链顶
    }
}

// ---------------- 路径与子树操作 ----------------
static void pathAdd(int x, int y, long long k) {
    while (top[x] != top[y]) {
        if (dep[top[x]] < dep[top[y]]) std::swap(x, y);
        segAdd(1, 1, n, dfn[top[x]], dfn[x], k);
        x = fa[top[x]];
    }
    if (dep[x] > dep[y]) std::swap(x, y);
    segAdd(1, 1, n, dfn[x], dfn[y], k);
}

static long long pathSum(int x, int y) {
    long long res = 0;
    while (top[x] != top[y]) {
        if (dep[top[x]] < dep[top[y]]) std::swap(x, y);
        res = (res + segQuery(1, 1, n, dfn[top[x]], dfn[x])) % mod;
        x = fa[top[x]];
    }
    if (dep[x] > dep[y]) std::swap(x, y);
    res = (res + segQuery(1, 1, n, dfn[x], dfn[y])) % mod;
    return res;
}

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    std::cin >> n >> m >> root >> mod;
    val.assign(n + 1, 0);
    for (int i = 1; i <= n; ++i) std::cin >> val[i];

    g.assign(n + 1, std::vector<int>());
    for (int i = 1; i < n; ++i) {
        int u, v;
        std::cin >> u >> v;
        g[u].push_back(v);
        g[v].push_back(u);
    }

    fa.assign(n + 1, 0);
    dep.assign(n + 1, 0);
    siz.assign(n + 1, 0);
    son.assign(n + 1, 0);
    top.assign(n + 1, 0);
    dfn.assign(n + 1, 0);
    rnk.assign(n + 1, 0);
    segSum.assign(4 * n + 5, 0);
    segLazy.assign(4 * n + 5, 0);

    dfs1(root, 0);
    dfs2(root, root);
    segBuild(1, 1, n);

    while (m--) {
        int op, x, y;
        long long z;
        std::cin >> op;
        if (op == 1) {
            std::cin >> x >> y >> z;
            pathAdd(x, y, z);
        } else if (op == 2) {
            std::cin >> x >> y;
            std::cout << pathSum(x, y) << '\n';
        } else if (op == 3) {
            std::cin >> x >> z;
            // 子树在 dfn 上对应连续区间 [dfn[x], dfn[x] + siz[x] - 1]
            segAdd(1, 1, n, dfn[x], dfn[x] + siz[x] - 1, z);
        } else {
            std::cin >> x;
            std::cout << segQuery(1, 1, n, dfn[x], dfn[x] + siz[x] - 1) << '\n';
        }
    }
    return 0;
}
