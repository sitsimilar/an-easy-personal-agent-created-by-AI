/**
 * 应用更新检测：从配置的更新源获取最新版本号，与当前版本比较。
 *
 * 边界处理：
 * - 网络异常 / 更新源不可用 → 返回 error，不抛异常（自动检查静默、手动检查提示）；
 * - 版本号解析失败 → error = '版本号解析失败'；
 * - 最新版本 ≤ 当前版本 → hasUpdate = false。
 */
import { UPDATE_SOURCE_URL } from '@shared/config/version'

/** 更新源返回的信息。 */
export interface UpdateInfo {
  version: string
  url?: string
  notes?: string
}

/** 检查结果。 */
export interface CheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion?: string
  info?: UpdateInfo
  error?: string
}

/** 语义化版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0（容忍 v 前缀与非数字段）。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.trim().replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.trim().replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

/** 当前应用版本（vite 构建时注入的全局常量）。 */
export function currentVersion(): string {
  try {
    return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** 检查更新：从更新源获取最新版本号并与当前版本比较（8s 超时兜底）。 */
export async function checkForUpdate(): Promise<CheckResult> {
  const current = currentVersion()
  let data: UpdateInfo | null = null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const resp = await fetch(UPDATE_SOURCE_URL, { cache: 'no-store', signal: controller.signal })
    if (!resp.ok) {
      return { hasUpdate: false, currentVersion: current, error: `更新源不可用（HTTP ${resp.status}）` }
    }
    data = (await resp.json()) as UpdateInfo | null
  } catch {
    return { hasUpdate: false, currentVersion: current, error: '网络异常，无法连接更新源' }
  } finally {
    clearTimeout(timer)
  }

  if (!data || typeof data.version !== 'string' || !data.version.trim()) {
    return { hasUpdate: false, currentVersion: current, error: '版本号解析失败' }
  }
  const latest = data.version.trim()
  const hasUpdate = compareVersions(latest, current) > 0
  return { hasUpdate, currentVersion: current, latestVersion: latest, info: data }
}
