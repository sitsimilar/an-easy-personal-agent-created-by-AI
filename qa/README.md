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
- `qa/mocks/electron.ts`：替换 `electron` 模块（app/BrowserWindow/screen/clipboard/globalShortcut 均可配置）。
- `qa/mocks/cloud.ts`：替换 `web/src/lib/cloud.ts`（llm.models.list / llm.chat.completions.create / database.from 查询链均可配置）。
- 测试使用 Node 内置 `node:test` + `node:assert/strict`，无额外测试框架依赖。
