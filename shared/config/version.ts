/**
 * 应用更新检测配置（唯一注入点）。
 *
 * - 更新源：线上站点的 `/version.json` 端点（由部署 server.js 动态返回当前部署版本），
 *   内容约定 `{ version, url?, notes? }`。
 * - 当前版本号：由 vite 构建时从 package.json 注入为全局常量 `__APP_VERSION__`，
 *   不在本文件硬编码，避免发版时遗漏同步。
 */
import { publicConfig } from './publicConfig'

/** 更新源 URL。 */
export const UPDATE_SOURCE_URL = `${publicConfig.endpoint}/version.json`

/** 运行期间自动检查更新的间隔（毫秒），默认 30 分钟。 */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000
