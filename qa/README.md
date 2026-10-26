# QA 测试说明（个人信息管家 Agent）

本目录存放 QA（严过关）编写的纯逻辑单元测试与运行脚本。

## 测试范围

> 由于云服务需要真实登录态才能跑 DB/LLM 集成测试，本阶段**只做纯逻辑单元测试 + 构建/类型校验 + 静态一致性审查**，不做端到端登录测试。

| 测试文件 | 覆盖源码 | 覆盖点 |
|---------|---------|--------|
| `qa/llm.test.ts` | `shared/utils/llm.ts` | `collectStream()` 累积 delta、跳过空/role/null 帧、`onDelta` 回调；`parseJsonLoose()` 剥离 markdown 围栏、截取首个 `{...}`/`[...]`、处理前后杂文本、嵌套/转义、非法 JSON 返回 null |
| `qa/constants.test.ts` | `shared/constants/categories.ts`、`prompts.ts` | 分类结构完整性；五类 + 选区分析 system prompt 非空/约束 JSON |
| `qa/solution-reader.test.ts` | `desktop/src/main/solution-reader.ts` | `.sln`/`.csproj` 解析、扩展名白名单、目录跳过、大小限制、增量 hash、空 sln 回退 |
| `qa/store.test.ts` | `desktop/src/main/store.ts` | JSON roundtrip、默认值、损坏容错；新增 mainWindowPosition/mainWindowMaximized/selectionShortcut 字段 |
| `qa/analysis-orchestrator.test.ts` | `desktop/src/main/analysis-orchestrator.ts` | 30s 冷却去重（activate 受冷却、start/manual 不受）、状态回填、手动触发降级提示 |
| `qa/selection-analyzer.test.ts` | `desktop/src/main/selection-analyzer.ts` | readClipboardSelection 四态（ok/empty/non-text/error）+ 截断；快捷键注册成败与回调推送 |
| `qa/main-window.test.ts` | `desktop/src/main/main-window.ts` | 位置/尺寸 clamp、越界回退居中、窗口标志、最大化态持久化、关闭=隐藏到托盘 |
| `qa/aiService-selection.test.ts` | `web/src/services/aiService.ts` | analyzeSelection 结构化解析/截断/降级（cloud.llm 已 mock） |
| `qa/aiService-p1.test.ts` | `web/src/services/aiService.ts` | generateReview / extractKeyPoints / organizeTodos 结构化解析、截断、降级（cloud.llm 已 mock） |
| `qa/recordService-listByRange.test.ts` | `web/src/services/recordService.ts` | listByRange 查询链顺序/参数与结果映射（cloud.database 已 mock） |
| `qa/cheatsheet.test.ts` | `shared/constants/cheatsheet.ts` | matchKnowledgePoints 关键字/运算符/语法/函数命中；条目 id 唯一、字段完整 |
| `qa/cpp-runner.test.ts` | `desktop/src/main/cpp-runner.ts` | MSVC/MinGW 编译命令拼接、运行与错误码解析 |
| `qa/toolchain.test.ts` | `desktop/src/main/toolchain.ts` | VS-first + MinGW 配对（selectPairing）、vcvars 反推、MSVC 版本号解析 |
| `qa/cdb-parse.test.ts` | `desktop/src/main/cdb-*.ts` | cdb 调试器 MI 输出解析（断点/变量/调用栈） |
| `qa/provision.test.ts` | `desktop/src/main/provision.ts` | MinGW 一键部署：SHA256 空哈希灰开关（无网络不下载）、进度回调 |
| `qa/analysis-exporter.test.ts` | `desktop/src/main/analysis-exporter.ts` | 导出目录基准（LOCALAPPDATA 缺失回落 TEMP）、Markdown/JSON 序列化 |
| `qa/floating-geometry.test.ts` | `desktop/src/main/floating-geometry.ts` | 悬浮窗贴边/缩放/全屏几何计算纯函数 |
| `qa/mindtree.test.ts` | `web/src/components/mindtree/dimensions.ts`、`web/src/services/aiService.ts`、`web/src/services/mindtree-parse.ts` | 5 维度模板/压感归一化/线宽/节点工厂/维度标签配色；generateMindTree 结构化解析、截断、结果缓存、LLM 硬契约、空维度抛错（cloud.llm 已 mock）；extractCompletedDimensions 截断/闭合/转义/中文引号容错 |
| `qa/mindforest-store.test.ts` | `web/src/services/mindforest-store.ts` | 树林文档工厂/CRUD；legacy 单树迁移；schema 校验与悬挂链接过滤；删除树/节点/移出树林级联；交叉判定（suggested/confirmed）；交叉伙伴反查；无序对去重；localStorage 容错 |
| `qa/mindforest-cross.test.ts` | `web/src/services/mindforest-cross.ts` | 展平前序编号/prompt 构造/节点抽样截断；解析容错（同树/越界/未知编号丢弃、markdown 围栏、无序对去重） |
| `qa/mindforest-cloud.test.ts` | `web/src/services/mindforest-cloud.ts` | 云端同步合并策略：空文档判定、最近写入时间戳、本地空→云端（新设备）vs 主动清空、最近写入优先 |

### P0 增量（系统提醒 / 待办循环 / 链接元数据）

| 测试文件 | 覆盖源码 | 覆盖点 |
|---------|---------|--------|
| `qa/reminder-schedule.test.ts` | `web/src/lib/reminder-schedule.ts` | 免打扰跨零点、提前量、12h 丢弃、去重键、时区参数化 |
| `qa/p0-a-reminder-schedule-adversarial.test.ts` | 同上 | **边界值对抗**：22:00/21:59/08:00/07:59、`start===end`、跨零点 release 归属、恰好 12h vs 12h+1ms、lead 0/10/负值、键稳定性 |
| `qa/p0-a-reminder-service.test.ts` | `web/src/services/reminderService.ts` | **调度器集成**：总开关关闭短路、到点通知、去重键落 localStorage、免打扰 23:00→08:00 补发、超 12h 丢弃、提前量、空标题兜底、通道失败不抛错 |
| `qa/p0-a-notification-provider.test.ts` | `web/src/services/notification.ts` | desktop > web > inapp 择优、权限被拒降级且 `ok:false`、Web 点击回传 recordId、requestPermission 容错 |
| `qa/p0-a-desktop-notifier.test.ts` | `desktop/src/main/notifier.ts` | 入参校验矩阵、`isSupported()` 分支、show()、点击→`showMainWindow()`+`desktop:notify-clicked` |
| `qa/p0-a-notification-chain.test.ts` | 桌面 IPC/preload/主进程 + Layout/ReminderScheduler/TodoPage/SettingsPage | **静态链路核对**（A1/A2 无法在无 GUI 环境实机点验时的替代证据） |
| `qa/recurrence.test.ts` | `web/src/lib/recurrence.ts` | daily/weekly/monthly 推进、31 日夹取、endDate 等值、空 remindAt、中文描述 |
| `qa/p0-b-recurrence-adversarial.test.ts` | 同上 | **边界值对抗**：interval=3 跨月跨年、weekly [1,3]+interval=2 跳周、锚定 31 全链、endDate ±1 天、脏规则不抛错 |
| `qa/recurrence-service.test.ts` | `web/src/services/recurrenceService.ts` | 条件更新 0 行幂等、正常推进、规则结束、补偿、回写失败 |
| `qa/p0-b-recurrence-service-adversarial.test.ts` | 同上 | **写入载荷逐字段核对**：字段复制、remind_at 精确续期、parent_id、next_id 回写、0 行时无任何写操作 |
| `qa/link-preview.test.ts` | `server/link-preview.js` | SSRF 地址矩阵、OG 解析、限流、错误码（fake req/res） |
| `qa/p0-c-link-preview-http.test.ts` | 同上 | **真实 HTTP 层**：node:http 起 fixture + 预览服务，200/413/415/404/502/504、重定向逐跳复验与 3 跳上限、429 |
| `qa/p0-c-server-smoke.test.ts` | `server.js` | **真实启动部署服务**（PORT=3410）：静态托管、`/version.json`、代理路由优先级、405/400/403 拒绝 |
| `qa/p0-e-frontend-safety.test.ts` | `LinkCover`/`RecordDetail`/`linkPreviewService`/`recordService` | C1/C4/C5/C6：封面 http(s) 守卫 + onError 隐藏 + 16:9、6s 超时降级、fire-and-forget 静态验证、标题回填不覆盖、`listReminderCandidates` 查询链 |

## 复跑方式

前置：项目依赖已安装（`web/node_modules` 与 `desktop/node_modules` 均存在）。

### 方式一：Node 脚本（推荐）

```bash
cd D:/司凤项目/personal-agent
node qa/run-tests.mjs
```

### 方式二：bash 脚本（等价封装）

```bash
cd D:/司凤项目/personal-agent
bash qa/run-tests.sh
```

### 方式三：手动（了解 alias 细节）

`qa/run-tests.mjs` 内部用 esbuild **JS API** 传 alias（避免 Git Bash 对 `@/lib/cloud` 等参数做路径改写）。关键 alias：

- `electron` → `qa/mocks/electron.ts`（store / selection-analyzer / main-window 三个测试）
- `@/lib/cloud` → `qa/mocks/cloud.ts`（aiService-selection 测试，替换云单例）
- `@` → `web/src`、`@shared` → `shared`（解析 Web 端路径别名）

## 其它校验

```bash
# Web 类型校验
cd web && npx tsc --noEmit

# Desktop 类型校验
cd desktop && npx tsc --noEmit
```

## 说明

- `qa/dist/` 为编译产物，可随时删除重建。
- `qa/mocks/electron.ts`：替换 `electron` 模块（app/BrowserWindow/screen/clipboard/globalShortcut/Notification 均可配置）。
- `qa/mocks/cloud.ts`：替换 `web/src/lib/cloud.ts`（llm.models.list / llm.chat.completions.create / database.from 查询链均可配置；`__dbInserts`/`__dbUpdates` 可断言写入载荷）。
- 测试使用 Node 内置 `node:test` + `node:assert/strict`，无额外测试框架依赖。
- `qa/p0-c-server-smoke.test.ts` 会占用端口 **3410** 并启动 `node server.js` 子进程，运行前请确保该端口空闲、`web/dist` 已构建（缺失时 server.js 会自动构建，耗时更长）。
- `qa/p0-c-server-smoke.test.ts` 中的公网用例（`https://example.com`）在无外网环境会自动 `skip`（记为「未验证」而非失败）。
