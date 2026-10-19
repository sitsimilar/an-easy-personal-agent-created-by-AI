// 洛谷 P3372 【模板】线段树 1
// 核心算法：线段树 + 懒标记（区间加法、区间求和）
// 时间复杂度：建树 O(n)，单次修改/查询 O(log n)；空间 O(n)
// 注意：区间和累加会超过 int 范围，统一使用 long long 存储

#include <iostream>
#include <vector>

// 线段树：sum[node] 维护区间和，lazy[node] 为懒标记（本节点已加、子节点未加）
struct SegTree {
    int n;
    std::vector<long long> sum;
    std::vector<long long> lazy;

    explicit SegTree(int n) : n(n), sum(4 * n + 5, 0), lazy(4 * n + 5, 0) {}

    // 建树：把初始数组 a[1..n] 写入线段树
    void build(int node, int l, int r, const std::vector<long long>& a) {
        if (l == r) {
            sum[node] = a[l];
            return;
        }
        int mid = (l + r) >> 1;
        build(node << 1, l, mid, a);
        build(node << 1 | 1, mid + 1, r, a);
        sum[node] = sum[node << 1] + sum[node << 1 | 1];
    }

    // 下放懒标记到左右儿子
    void pushDown(int node, int l, int r) {
        if (lazy[node] == 0) {
            return;
        }
        int mid = (l + r) >> 1;
        int lc = node << 1;
        int rc = node << 1 | 1;
        // 左儿子区间长度 mid - l + 1
        sum[lc] += lazy[node] * (mid - l + 1);
        lazy[lc] += lazy[node];
        // 右儿子区间长度 r - mid
        sum[rc] += lazy[node] * (r - mid);
        lazy[rc] += lazy[node];
        lazy[node] = 0;
    }

    // 区间 [ql, qr] 每个数加上 k
    void update(int node, int l, int r, int ql, int qr, long long k) {
        if (ql <= l && r <= qr) {
            sum[node] += k * (r - l + 1);
            lazy[node] += k;
            return;
        }
        pushDown(node, l, r);
        int mid = (l + r) >> 1;
        if (ql <= mid) {
            update(node << 1, l, mid, ql, qr, k);
        }
        if (qr > mid) {
            update(node << 1 | 1, mid + 1, r, ql, qr, k);
        }
        sum[node] = sum[node << 1] + sum[node << 1 | 1];
    }

    // 查询区间 [ql, qr] 的和
    long long query(int node, int l, int r, int ql, int qr) {
        if (ql <= l && r <= qr) {
            return sum[node];
        }
        pushDown(node, l, r);
        int mid = (l + r) >> 1;
        long long res = 0;
        if (ql <= mid) {
            res += query(node << 1, l, mid, ql, qr);
        }
        if (qr > mid) {
            res += query(node << 1 | 1, mid + 1, r, ql, qr);
        }
        return res;
    }
};

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n, m;
    std::cin >> n >> m;
    std::vector<long long> a(n + 1, 0);
    for (int i = 1; i <= n; ++i) {
        std::cin >> a[i];
    }

    SegTree seg(n);
    seg.build(1, 1, n, a);

    while (m--) {
        int op;
        std::cin >> op;
        if (op == 1) {
            int l, r;
            long long k;
            std::cin >> l >> r >> k;
            seg.update(1, 1, n, l, r, k);
        } else {
            int l, r;
            std::cin >> l >> r;
            std::cout << seg.query(1, 1, n, l, r) << '\n';
        }
    }
    return 0;
}
