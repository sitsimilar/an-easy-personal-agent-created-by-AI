# 插件系统 MVP 实现规格

> 状态：已确认方案，待落地。本文档是插件的**唯一设计事实来源**，实现与 QA 均以此为准。
> 决策组合（用户已确认）：**纯前端 ESM 包 + 云 storage（含 plugins 元数据表）+ 粗粒度权限声明**。

---

## 1. 功能边界

MVP 只做「插件生命周期管理」，不做复杂 UI 注入系统。

**范围内（5 项，与需求一一对应）：**

1. **插件启停**：多插件并发启停，互不影响；启用 = 加载 + 运行，停用 = 释放资源。
2. **插件列表展示**：展示已安装插件的名称、版本、简介、权限、启停状态、安装来源。
3. **从 GitHub 网址安装**：输入仓库 URL → 拉取 `plugin.json` manifest → 校验 → 展示权限清单 → 用户确认 → 下载代码 → 入库。
4. **状态持久化**：插件元数据 + `enabled` 状态存云数据库（跨设备一致）；插件自身数据用 `ctx.storage`（localStorage 前缀隔离，MVP 不建新表）。
5. **异常处理**：单插件 import / activate / 运行异常全部 try/catch 隔离，标记该插件为 `error` 状态，绝不拖垮主界面或其他插件。

**范围外（明确不做）：**

- 带云函数后端（定时任务、服务端密钥、后台长任务）——留待后续按需扩展。
- 细粒度运行时逐项授权（MVP 用安装时一次性确认）。
- 插件 UI 注入（往主界面任意位置挂面板）——MVP 插件只通过 `ctx.registerTool` 注册「工具入口」。
- 插件自动更新、版本回滚、插件市场/商店。
- 构建服务：仓库需自带已编译好的单文件 ESM（见 §3.1），本系统不代编译。

---

## 2. 数据模型

### 2.1 云数据库 `plugins` 表（元数据）

```sql
CREATE TABLE IF NOT EXISTS public.plugins (
  id           BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id     TEXT         NOT NULL DEFAULT auth.uid(),
  plugin_id    TEXT         NOT NULL,                 -- manifest 里的 id，如 com.example.demo
  name         TEXT         NOT NULL,
  version      TEXT         NOT NULL,                 -- semver，如 1.0.0
  description  TEXT         NOT NULL DEFAULT '',
  author       TEXT,
  repo_url     TEXT,                                   -- GitHub 仓库地址（安装来源）
  permissions  TEXT[]       NOT NULL DEFAULT '{}',     -- 权限声明 token 数组
  entry_path   TEXT         NOT NULL,                  -- storage 代码包路径（含版本）
  enabled      BOOLEAN      NOT NULL DEFAULT false,
  installed_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS plugins_owner_plugin_uniq ON public.plugins (owner_id, plugin_id);
CREATE INDEX IF NOT EXISTS plugins_owner_created_idx ON public.plugins (owner_id, installed_at DESC);
```

**RLS**：与现有 7 表同构 —— `owner_id = auth.uid()` 四条策略（select/insert/update/delete）。执行方式见 §6。

**代码包存云 storage**：路径 `cloud.storage.userPath(ownerId, 'plugins/<plugin_id>/<version>/index.js')`，即 `entry_path` 字段的值。元数据在 `plugins` 表，代码在 storage，二者通过 `entry_path` 关联。

### 2.2 类型

| 位置 | 内容 |
|---|---|
| `web/src/lib/database.types.ts` | 追加 `PluginsRow` 接口 + `Database.Tables.plugins` |
| `shared/types/domain.ts` | 追加 `Plugin`（camelCase 领域类型）、`PluginInstallInput` |

`PluginsRow`（snake_case，与 DDL 一致）：

```ts
export interface PluginsRow {
  id: number
  owner_id: string
  plugin_id: string
  name: string
  version: string
  description: string
  author: string | null
  repo_url: string | null
  permissions: string[]
  entry_path: string
  enabled: boolean
  installed_at: string
  updated_at: string
}
```

`Plugin`（camelCase，service 层映射）：

```ts
export interface Plugin {
  id: number
  pluginId: string
  name: string
  version: string
  description: string
  author?: string | null
  repoUrl?: string | null
  permissions: string[]
  entryPath: string
  enabled: boolean
  installedAt: string
  updatedAt: string
}
```

---

## 3. 插件包格式

### 3.1 仓库结构约定

安装的 GitHub 仓库**根目录**需包含：

```
plugin.json          # manifest（必填）
dist/index.js        # 单文件自包含 ESM bundle（entry 指向这里，默认）
```

`plugin.json`：

```json
{
  "id": "com.example.hello",
  "name": "Hello 插件",
  "version": "1.0.0",
  "description": "示例插件",
  "author": "someone",
  "entry": "dist/index.js",
  "permissions": ["storage"]
}
```

**约束（MVP 强制）：**

- `dist/index.js` 必须是**单文件自包含 ESM**：不 `import` 任何相对路径/第三方模块（bundle 后无外部依赖）。原因：运行时用 Blob URL `import()` 加载，Blob URL 无法解析相对 import。
- `permissions` 只能是 §5 白名单内的 token，未知 token 安装时提示并忽略。
- 无签名/无构建：仓库直接提供可运行的 JS 源码（字符串）即可。

### 3.2 入口导出契约

插件模块必须导出以下生命周期钩子（均为可选，缺省视为空实现）：

```js
export async function activate(ctx) { /* 启动时调用一次 */ }
export async function deactivate()   { /* 停用时调用一次，做清理 */ }
```

`activate` 抛异常 → 该插件进入 `error` 状态，不影响其他插件。

---

## 4. 运行时加载器

目录：`web/src/plugins/`

| 文件 | 职责 |
|---|---|
| `types.ts` | `PluginManifest`、`PluginModule`、`PluginContext`、`PluginRuntimeState`（`idle/loading/running/error`） |
| `permissions.ts` | `KNOWN_PERMISSIONS` 白名单 + `hasPermission(manifest, token)` + `assertPermissions(manifest, ctx)` |
| `loader.ts` | `loadPlugin(entryPath)`：`cloud.storage.download(entryPath)` → Blob → `URL.createObjectURL` → `import(blobUrl)` → 返回模块与 `revoke` 清理函数 |
| `registry.ts` | 运行时注册表：`activate(id)` / `deactivate(id)` / `getState(id)` / `listStates()`，管理多插件实例与 Blob URL 生命周期，单插件异常隔离 |

### 4.1 加载流程（loader.ts）

```
download(entry_path)  // 拿 Blob
  → blob.text()       // 源码字符串（存 Blob URL 亦可，取决于 CSP，见 §8.1）
  → const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  → const mod = await import(/* @vite-ignore */ url)   // 动态 import Blob URL
  → 返回 { mod, cleanup: () => URL.revokeObjectURL(url) }
```

> 注意：`import()` 一个运行时才确定的 Blob URL，需 `/* @vite-ignore */` 避免 Vite 构建期解析。

### 4.2 注册表状态机（registry.ts）

```
idle ──enable──▶ loading ──activate 成功──▶ running
                     │
                     └─activate 抛异常──▶ error（保留错误信息，可停用/重试）
running ──disable──▶ idle（调用 deactivate + revoke Blob URL）
error   ──disable──▶ idle
```

- 每个插件一个 `PluginInstance`，持有 `{ plugin, module, ctx, cleanup, state, error }`。
- `activate` 与 `deactivate` 各用 `try/catch` 包裹，异常只影响本实例。
- 停用/卸载必须调用 `cleanup()`（revoke Blob URL），防内存泄漏。

---

## 5. 权限白名单与 ctx API

### 5.1 权限 token（粗粒度）

| token | 含义 | 控制的能力 |
|---|---|---|
| `storage` | 允许使用插件私有持久化存储 | `ctx.storage` |
| `network` | 允许发网络请求 | `ctx.fetch` |

未知 token：安装时给出提示、**剔除后**入库（不阻断安装）。

### 5.2 `PluginContext`（受控 ctx，只暴露已授权能力）

```ts
export interface PluginContext {
  /** 插件自身元信息 */
  meta: { id: string; name: string; version: string }
  /** 日志（写到 console，MVP 不落库） */
  log: (level: 'info' | 'warn' | 'error', ...args: unknown[]) => void
  /** 注册一个「工具入口」，展示在插件页，点击后执行 run */
  registerTool: (tool: { id: string; label: string; description?: string; run: () => void | Promise<void> }) => void
  /** 插件私有持久化（localStorage 前缀 plugin:<id>: 隔离），需 storage 权限 */
  storage: {
    get(key: string): string | null
    set(key: string, value: string): void
    remove(key: string): void
  }
  /** 受控 fetch（需 network 权限；仍受浏览器 CORS 限制） */
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}
```

- `ctx.storage` / `ctx.fetch` 在无对应权限时返回**抛错**的占位（或直接不注入），由 `permissions.ts` 的 `buildContext(manifest)` 决定注入哪些能力。
- `ctx` 不含任何密钥/云 SDK 实例 —— 插件拿不到 `cloud`、`authService`、`recordService` 等内部对象。**这是安全底线。**

---

## 6. 关键流程

### 6.1 安装（从 GitHub 网址）

```
输入仓库 URL
 → 解析 owner/repo（支持 https://github.com/o/r、git@github.com:o/r.git、o/r）
 → 探测默认分支：HEAD main → 失败则 master
 → GET https://raw.githubusercontent.com/{o}/{r}/{branch}/plugin.json
 → 校验 manifest（id/name/version 必填；permissions 过滤未知 token）
 → GET entry（dist/index.js）源码
 → 展示「确认安装」弹窗：名称/版本/简介/作者/权限清单
 → 用户确认：
    1. cloud.storage.upload(userPath(ownerId, 'plugins/<id>/<version>/index.js'), 源码)
    2. cloud.database.from('plugins').insert({...}).select()  // 不传 owner_id
    3. 重装（owner_id+plugin_id 冲突）→ 走覆盖更新（删除旧 storage 对象 + update 行）
```

- 已安装同 `plugin_id` 再次安装 = **更新**：上传新版本对象（覆盖同版本路径 or 换版本路径），update 行。
- 安装失败：清理已上传的孤儿对象（参考 `imageService` 回滚模式）。

### 6.2 启用 / 停用

```
启用：update enabled=true → registry.activate(plugin)（download→import→activate(ctx)）
停用：update enabled=false → registry.deactivate(id)（deactivate + revoke）
```

- 持久化优先：先写库成功，再动运行时；运行时失败不影响库里的 `enabled`，但会以 `error` 状态反馈到 UI。

### 6.3 启动恢复

应用启动（`bootstrap` 后）扫描 `plugins` 表中 `enabled=true` 的插件，逐个 `registry.activate`；任一失败仅标记 `error`，继续加载其余。

### 6.4 异常处理

| 环节 | 处理 |
|---|---|
| manifest 拉取失败/非法 | 安装弹窗报错，不入库 |
| 下载 entry 失败 | 安装弹窗报错 |
| `import(blobUrl)` 失败 | 标记 `error`，展示「加载失败」+ 可重试 |
| `activate` 抛异常 | 标记 `error`，不影响其他插件 |
| 工具 `run` 抛异常 | `registry` 捕获，log error，UI 弹错误提示 |

---

## 7. 文件落点清单

| 事项 | 文件 |
|---|---|
| DDL 存档（追加表 + RLS 数组加 `plugins`） | `docs/db-setup.sql` |
| 数据库行类型 | `web/src/lib/database.types.ts` |
| 领域类型 | `shared/types/domain.ts` |
| 数据访问层（新建） | `web/src/services/pluginService.ts` |
| 运行时：类型/权限/加载器/注册表（新建） | `web/src/plugins/types.ts`、`permissions.ts`、`loader.ts`、`registry.ts` |
| 状态管理（新建） | `web/src/store/pluginStore.ts` |
| 页面（新建） | `web/src/pages/PluginsPage.tsx` |
| 安装对话框（新建） | `web/src/components/PluginInstallDialog.tsx` |
| 路由注册 | `web/src/App.tsx`（加 `<Route path="/plugins">`） |
| 菜单注册 | `web/src/components/Layout.tsx`（`NAV_GROUPS` 加「插件」项，放「系统」组） |

**实现范式参照：**

- service：照搬 `recordService.ts` 的 `cloud.database.from(...)` + `unwrap` + `mapPlugin` 转换。
- store：照搬 `recordStore.ts:31-52` 的 `data/loading/error` + `loadSeq` 竞态保护。
- 页面：参照 `RecordsPage.tsx` 四态渲染 + `DevToolsPage.tsx` 目录式结构；MUI `sx`，勿混用 Tailwind。
- 弹窗：照搬 `RecordCreateDialog.tsx` 的 `Dialog` 结构。
- storage 回滚：参照 `imageService.ts:60-115` 的「写库占位→upload→回填→失败回滚」。

---

## 8. 风险点

1. **Blob URL import 与 CSP**：远程站点当前未设严格 CSP，Blob URL 动态 import 可用；若将来加 CSP，需 `script-src 'self' blob:`。Electron renderer 默认 sandbox 不影响 Blob URL 加载。
2. **单文件 ESM 约束**：Blob URL 无法解析相对 import，插件必须 bundle 成单文件；文档需向插件作者声明此约束，否则会报「无法解析模块」。
3. **XSS 面**：插件代码以「同源脚本」身份运行，能碰当前页 DOM 与 localStorage 全部数据。**缓解**：来源仅限用户主动输入并确认的 GitHub 仓库 + 权限声明展示；MVP 不提供 `DOM`/`document` 能力封装（但插件代码本质可自取），需在安装确认弹窗明确提示「插件可访问当前页面数据，请仅安装可信来源」。
4. **storage 成本**：插件代码包存云 storage，有流量/容量开销。**缓解**：MVP 限制单包 ≤ 1MB、单用户插件数 ≤ 50，超限拒绝。
5. **CORS 限制**：`ctx.fetch` 与安装时的 GitHub raw 拉取受浏览器 CORS 约束（`raw.githubusercontent.com` 允许跨域，可放心；插件自行 fetch 第三方 API 可能受限）。
6. **运行时与库状态不一致**：`enabled=true` 但 `activate` 失败时，库与运行时状态分叉。**缓解**：UI 用 `registry` 实时状态 + 库 `enabled` 双源渲染，`error` 状态显式标出并提供「重试/停用」。

---

## 9. 验收标准（QA）

1. 安装合法仓库 → 列表出现该插件，状态 `enabled=false`（默认停用）。
2. 启用 → 状态转 `running`，`activate` 被调用；刷新页面后仍为 `enabled`（持久化生效）。
3. 停用 → `deactivate` 被调用，Blob URL 被 revoke，状态转 `idle`。
4. 多插件并发：A 启用、B 启用、A 停用，互不影响。
5. 安装一个 `activate` 抛异常的插件 → 该插件 `error`，其余插件正常，主界面无崩溃。
6. 安装 `permissions` 含未知 token → 未知 token 被剔除并提示，其余权限保留。
7. 输入非法 GitHub 地址 / 无 `plugin.json` 的仓库 → 弹窗报错，不入库。
8. `ctx.storage` 无 `storage` 权限时调用 → 抛错，不写入。
9. 卸载/更新流程无孤儿 storage 对象残留。
