// P4717 【模板】快速莫比乌斯/沃尔什变换（FWT）
// 核心算法：FWT 计算集合幂级数的或卷积、与卷积、异或卷积。
//   - 或卷积正变换：a[j+len] += a[j]；逆变换：a[j+len] -= a[j]。
//   - 与卷积正变换：a[j] += a[j+len]；逆变换：a[j] -= a[j+len]。
//   - 异或卷积正变换：x'=x+y, y'=x-y；逆变换：x'=(x+y)/2, y'=(x-y)/2。
// 复杂度：O(n * 2^n)，空间 O(2^n)。
#include <iostream>
#include <vector>

static const long long MOD = 998244353;

static long long power(long long a, long long b) {
    long long res = 1;
    a %= MOD;
    while (b > 0) {
        if (b & 1) res = res * a % MOD;
        a = a * a % MOD;
        b >>= 1;
    }
    return res;
}

// op: 1=或, 2=与, 3=异或
static void fwt(std::vector<long long>& a, int op, bool invert) {
    int n = static_cast<int>(a.size());
    for (int len = 1; len < n; len <<= 1) {
        for (int i = 0; i < n; i += len << 1) {
            for (int j = 0; j < len; ++j) {
                long long x = a[i + j];
                long long y = a[i + j + len];
                if (op == 1) {                    // 或卷积
                    if (!invert) {
                        a[i + j + len] = (y + x) % MOD;
                    } else {
                        a[i + j + len] = (y - x + MOD) % MOD;
                    }
                } else if (op == 2) {             // 与卷积
                    if (!invert) {
                        a[i + j] = (x + y) % MOD;
                    } else {
                        a[i + j] = (x - y + MOD) % MOD;
                    }
                } else {                          // 异或卷积
                    if (!invert) {
                        a[i + j] = (x + y) % MOD;
                        a[i + j + len] = (x - y + MOD) % MOD;
                    } else {
                        a[i + j] = (x + y) % MOD * power(2, MOD - 2) % MOD;
                        a[i + j + len] = (x - y + MOD) % MOD * power(2, MOD - 2) % MOD;
                    }
                }
            }
        }
    }
}

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n;
    std::cin >> n;
    int sz = 1 << n;
    std::vector<long long> A(sz), B(sz);
    for (int i = 0; i < sz; ++i) std::cin >> A[i];
    for (int i = 0; i < sz; ++i) std::cin >> B[i];

    std::vector<long long> a, b, c;

    a = A; b = B;
    fwt(a, 1, false); fwt(b, 1, false);
    for (int i = 0; i < sz; ++i) c.push_back(a[i] * b[i] % MOD);
    fwt(c, 1, true);
    for (int i = 0; i < sz; ++i) std::cout << c[i] << (i + 1 == sz ? '\n' : ' ');

    a = A; b = B;
    fwt(a, 2, false); fwt(b, 2, false);
    for (int i = 0; i < sz; ++i) c[i] = a[i] * b[i] % MOD;
    fwt(c, 2, true);
    for (int i = 0; i < sz; ++i) std::cout << c[i] << (i + 1 == sz ? '\n' : ' ');

    a = A; b = B;
    fwt(a, 3, false); fwt(b, 3, false);
    for (int i = 0; i < sz; ++i) c[i] = a[i] * b[i] % MOD;
    fwt(c, 3, true);
    for (int i = 0; i < sz; ++i) std::cout << c[i] << (i + 1 == sz ? '\n' : ' ');

    return 0;
}
