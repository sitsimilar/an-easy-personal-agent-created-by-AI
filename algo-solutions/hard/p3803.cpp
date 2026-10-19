// P3803 【模板】多项式乘法（FFT）
// 核心算法：迭代 Cooley-Tukey 快速傅里叶变换，将多项式点值相乘后逆变换得到卷积系数。
//           系数为整数，使用 std::complex<double> 计算后四舍五入输出。
// 复杂度：O(N log N)，N 为不小于 n+m+1 的 2 的幂；空间 O(N)。
#include <iostream>
#include <vector>
#include <complex>
#include <cmath>

using cd = std::complex<double>;

// 迭代 FFT：invert=false 正变换，invert=true 逆变换（结果除以 n）
static void fft(std::vector<cd>& a, bool invert) {
    int n = static_cast<int>(a.size());

    // 位逆序置换
    for (int i = 1, j = 0; i < n; ++i) {
        int bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) std::swap(a[i], a[j]);
    }

    // 蝴蝶变换
    for (int len = 2; len <= n; len <<= 1) {
        double ang = 2.0 * std::acos(-1.0) / len * (invert ? -1 : 1);
        cd wlen(std::cos(ang), std::sin(ang));
        for (int i = 0; i < n; i += len) {
            cd w(1.0, 0.0);
            for (int j = 0; j < len / 2; ++j) {
                cd u = a[i + j];
                cd v = a[i + j + len / 2] * w;
                a[i + j] = u + v;
                a[i + j + len / 2] = u - v;
                w *= wlen;
            }
        }
    }

    if (invert) {
        for (cd& x : a) x /= n;
    }
}

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n, m;
    std::cin >> n >> m;

    std::vector<cd> fa, fb;
    int sz = 1;
    while (sz < n + m + 1) sz <<= 1;   // 卷积结果长度为 n+m+1
    fa.resize(sz);
    fb.resize(sz);

    for (int i = 0; i <= n; ++i) {
        int c;
        std::cin >> c;
        fa[i] = cd(static_cast<double>(c), 0.0);
    }
    for (int i = 0; i <= m; ++i) {
        int c;
        std::cin >> c;
        fb[i] = cd(static_cast<double>(c), 0.0);
    }

    fft(fa, false);
    fft(fb, false);
    for (int i = 0; i < sz; ++i) fa[i] *= fb[i];
    fft(fa, true);

    for (int i = 0; i <= n + m; ++i) {
        long long val = static_cast<long long>(std::llround(fa[i].real()));
        std::cout << val << (i == n + m ? '\n' : ' ');
    }
    return 0;
}
