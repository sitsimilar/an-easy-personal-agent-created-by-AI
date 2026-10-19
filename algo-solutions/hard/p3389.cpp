// P3389 【模板】高斯消元法
// 核心算法：高斯消元（列主元）将增广矩阵化为上三角，再回代求解；
//           若某步主元绝对值小于 eps，则矩阵奇异（无解或无穷解），输出 No Solution。
// 复杂度：O(n^3)，空间 O(n^2)。
#include <iostream>
#include <vector>
#include <cmath>
#include <iomanip>

static const double EPS = 1e-9;

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    int n;
    std::cin >> n;
    std::vector<std::vector<double>> a(n, std::vector<double>(n + 1, 0.0));
    for (int i = 0; i < n; ++i) {
        for (int j = 0; j <= n; ++j) {
            std::cin >> a[i][j];
        }
    }

    for (int col = 0; col < n; ++col) {
        // 选择当前列绝对值最大的行作为主元（列主元消去，提高数值稳定性）
        int pivot = col;
        for (int i = col + 1; i < n; ++i) {
            if (std::fabs(a[i][col]) > std::fabs(a[pivot][col])) pivot = i;
        }
        if (std::fabs(a[pivot][col]) < EPS) {
            std::cout << "No Solution\n";
            return 0;
        }
        std::swap(a[col], a[pivot]);

        // 消去下方各行当前列
        for (int i = col + 1; i < n; ++i) {
            double factor = a[i][col] / a[col][col];
            for (int j = col; j <= n; ++j) {
                a[i][j] -= factor * a[col][j];
            }
        }
    }

    // 回代求解
    std::vector<double> x(n, 0.0);
    for (int i = n - 1; i >= 0; --i) {
        double val = a[i][n];
        for (int j = i + 1; j < n; ++j) {
            val -= a[i][j] * x[j];
        }
        x[i] = val / a[i][i];
    }

    std::cout << std::fixed << std::setprecision(2);
    for (int i = 0; i < n; ++i) {
        // 避免 -0.00 输出，将极小负数归零
        double out = x[i];
        if (std::fabs(out) < 0.005) out = 0.0;
        std::cout << out << '\n';
    }
    return 0;
}
