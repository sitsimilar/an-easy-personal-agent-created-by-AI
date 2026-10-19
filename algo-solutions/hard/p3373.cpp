// P3373 【模板】线段树 2（区间乘 + 区间加 + 区间求和，双懒标记）
// 核心算法：线段树维护两个懒标记 mul（乘法）与 add（加法），统一约定「先乘后加」：
//           对节点应用 (mul, add) 时，sum = sum * mul + add * len；
//           下传时子节点 add = 子.add * 父.mul + 父.add，子.mul = 子.mul * 父.mul。
// 复杂度：O((n + q) * log n)，空间 O(n)。
#include <iostream>
#include <vector>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n, q;
    long long mod;
    std::cin >> n >> q >> mod;

    std::vector<long long> a(n + 1, 0);
    for (int i = 1; i <= n; ++i) std::cin >> a[i];

    std::vector<long long> sum(4 * n + 5, 0);
    std::vector<long long> mul(4 * n + 5, 1);  // 乘法懒标记，初始为 1
    std::vector<long long> add(4 * n + 5, 0);  // 加法懒标记，初始为 0

    auto pushUp = [&](int o) {
        sum[o] = (sum[o << 1] + sum[o << 1 | 1]) % mod;
    };

    auto build = [&](auto&& self, int o, int l, int r) -> void {
        if (l == r) {
            sum[o] = a[l] % mod;
            return;
        }
        int mid = (l + r) >> 1;
        self(self, o << 1, l, mid);
        self(self, o << 1 | 1, mid + 1, r);
        pushUp(o);
    };

    // 对节点应用乘法标记 k 与加法标记 k2（先乘后加）
    auto applyMulAdd = [&](int o, int len, long long kMul, long long kAdd) {
        sum[o] = (sum[o] * kMul + kAdd % mod * len % mod) % mod;
        mul[o] = mul[o] * kMul % mod;
        add[o] = (add[o] * kMul + kAdd) % mod;
    };

    auto pushDown = [&](int o, int l, int r) {
        int mid = (l + r) >> 1;
        if (mul[o] != 1 || add[o] != 0) {
            applyMulAdd(o << 1, mid - l + 1, mul[o], add[o]);
            applyMulAdd(o << 1 | 1, r - mid, mul[o], add[o]);
            mul[o] = 1;
            add[o] = 0;
        }
    };

    auto rangeMul = [&](auto&& self, int o, int l, int r, int ql, int qr, long long k) -> void {
        if (ql <= l && r <= qr) {
            applyMulAdd(o, r - l + 1, k, 0);
            return;
        }
        pushDown(o, l, r);
        int mid = (l + r) >> 1;
        if (ql <= mid) self(self, o << 1, l, mid, ql, qr, k);
        if (qr > mid) self(self, o << 1 | 1, mid + 1, r, ql, qr, k);
        pushUp(o);
    };

    auto rangeAdd = [&](auto&& self, int o, int l, int r, int ql, int qr, long long k) -> void {
        if (ql <= l && r <= qr) {
            applyMulAdd(o, r - l + 1, 1, k);
            return;
        }
        pushDown(o, l, r);
        int mid = (l + r) >> 1;
        if (ql <= mid) self(self, o << 1, l, mid, ql, qr, k);
        if (qr > mid) self(self, o << 1 | 1, mid + 1, r, ql, qr, k);
        pushUp(o);
    };

    auto rangeSum = [&](auto&& self, int o, int l, int r, int ql, int qr) -> long long {
        if (ql <= l && r <= qr) return sum[o];
        pushDown(o, l, r);
        int mid = (l + r) >> 1;
        long long res = 0;
        if (ql <= mid) res = (res + self(self, o << 1, l, mid, ql, qr)) % mod;
        if (qr > mid) res = (res + self(self, o << 1 | 1, mid + 1, r, ql, qr)) % mod;
        return res;
    };

    build(build, 1, 1, n);

    while (q--) {
        int op, l, r;
        long long k;
        std::cin >> op >> l >> r;
        if (op == 1) {
            std::cin >> k;
            rangeMul(rangeMul, 1, 1, n, l, r, k);
        } else if (op == 2) {
            std::cin >> k;
            rangeAdd(rangeAdd, 1, 1, n, l, r, k);
        } else {
            std::cout << rangeSum(rangeSum, 1, 1, n, l, r) << '\n';
        }
    }
    return 0;
}
