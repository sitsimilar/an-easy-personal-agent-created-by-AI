// P3690 【模板】动态树（Link Cut Tree）
// 核心算法：LCT 用 Splay 维护实链（偏爱路径），实现动态树的连边、断边、改点权与路径异或和。
//   关键操作：
//   - access(x)：打通根到 x 的实路径；
//   - makeRoot(x)：access + splay + 打翻转标记，把 x 变为所在树的根；
//   - split(x,y)：makeRoot(x) + access(y) + splay(y)，之后 y 的 Splay 子树即 x→y 路径；
//   - findRoot：判断连通性；link/cut 前需 makeRoot。
//   每个 Splay 节点维护子树的权值异或和 xsum，翻转标记 rev 延迟下传。
// 复杂度：均摊 O(m * log n)，空间 O(n)。
#include <iostream>
#include <algorithm>

static const int MAXN = 100005;

static int ch[MAXN][2];   // 左右儿子
static int fa[MAXN];      // 父亲（Splay 内父或路径父）
static int val[MAXN];     // 节点权值
static int xsum[MAXN];    // Splay 子树权值异或和
static bool rev[MAXN];    // 子树翻转懒标记

// 判断 x 是否为其所在 Splay 的根（LCT 判定：父亲不认它为儿子）
static bool isRoot(int x) {
    int f = fa[x];
    return f == 0 || (ch[f][0] != x && ch[f][1] != x);
}

static void pushUp(int x) {
    xsum[x] = xsum[ch[x][0]] ^ xsum[ch[x][1]] ^ val[x];
}

static void pushRev(int x) {
    std::swap(ch[x][0], ch[x][1]);
    rev[x] = !rev[x];
}

static void pushDown(int x) {
    if (rev[x]) {
        if (ch[x][0]) pushRev(ch[x][0]);
        if (ch[x][1]) pushRev(ch[x][1]);
        rev[x] = false;
    }
}

// 返回 x 是父亲的哪个儿子（0=左，1=右）
static int dir(int x) {
    return ch[fa[x]][1] == x ? 1 : 0;
}

static void rotate(int x) {
    int y = fa[x], z = fa[y];
    int d = dir(x);
    int c = ch[x][d ^ 1];
    if (!isRoot(y)) ch[z][dir(y)] = x;   // y 不是根时，用 x 替换 y 在 z 下的位置
    fa[x] = z;
    ch[x][d ^ 1] = y;
    fa[y] = x;
    ch[y][d] = c;
    if (c) fa[c] = y;
    pushUp(y);
    pushUp(x);
}

static void splay(int x) {
    // 先把根到 x 路径上的懒标记全部下传
    static int stk[MAXN];
    int top = 0;
    int y = x;
    stk[++top] = y;
    while (!isRoot(y)) {
        y = fa[y];
        stk[++top] = y;
    }
    while (top > 0) pushDown(stk[top--]);

    while (!isRoot(x)) {
        y = fa[x];
        int z = fa[y];
        if (!isRoot(y)) {
            if (dir(x) == dir(y)) rotate(y);   // 一字型先转 y
            else rotate(x);                    // 之字型先转 x
        }
        rotate(x);
    }
}

// 打通根到 x 的实路径，使 x 成为其 Splay 的根，且 x 无右儿子
static void access(int x) {
    int y = 0;
    while (x) {
        splay(x);
        ch[x][1] = y;                          // 原右子树成为虚边，y 成为新的实儿子
        pushUp(x);
        y = x;
        x = fa[x];
    }
}

// 把 x 变成所在树的根
static void makeRoot(int x) {
    access(x);
    splay(x);
    pushRev(x);
}

// 找 x 所在树的根（用于判连通）
static int findRoot(int x) {
    access(x);
    splay(x);
    while (ch[x][0]) {
        pushDown(x);
        x = ch[x][0];
    }
    splay(x);
    return x;
}

// 提取 x→y 路径，之后 y 的 Splay 子树就是该路径
static void split(int x, int y) {
    makeRoot(x);
    access(y);
    splay(y);
}

// 连边（若 x、y 已连通则不操作）
static void link(int x, int y) {
    makeRoot(x);
    if (findRoot(y) != x) fa[x] = y;
}

// 断边（若边 (x,y) 不存在则不操作）
static void cut(int x, int y) {
    makeRoot(x);
    access(y);
    splay(y);
    // 若 y 的左儿子恰为 x 且 x 无右儿子，说明二者直接相连
    if (ch[y][0] == x && ch[x][1] == 0) {
        ch[y][0] = 0;
        fa[x] = 0;
        pushUp(y);
    }
}

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n, m;
    std::cin >> n >> m;
    for (int i = 1; i <= n; ++i) {
        std::cin >> val[i];
        xsum[i] = val[i];
    }

    while (m--) {
        int op, x, y;
        std::cin >> op >> x >> y;
        if (op == 0) {              // 查询 x→y 路径异或和
            split(x, y);
            std::cout << xsum[y] << '\n';
        } else if (op == 1) {       // 连边
            link(x, y);
        } else if (op == 2) {       // 断边
            cut(x, y);
        } else {                    // 改点权
            access(x);
            splay(x);
            val[x] = y;
            pushUp(x);
        }
    }
    return 0;
}
