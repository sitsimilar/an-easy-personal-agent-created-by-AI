# 个人信息管家 Agent

程序员的「个人第二大脑」：记录零散的想法、资料与待办，自动分类、总结并关联相关内容，支持关键词检索与智能问答；桌面伴侣常驻后台，监听 Visual Studio 启动并自动分析代码、推送优化建议。

<p align="center">
  <strong>Web 应用</strong>（Vite + React + TypeScript + MUI + Tailwind）
  ·
  <strong>桌面伴侣</strong>（Electron + electron-vite）
  ·
  <strong>云端</strong>（WorkBuddy 云服务：数据库 / 认证 / 存储 / 免密钥大模型）
</p>

## 功能特性

### 信息管理（Web）
- **多类型记录**：想法 / 资料 / 待办，支持优先级、标签与软删除回收站。
- **自动分类与总结**：接入大模型，对录入内容自动归类、生成摘要。
- **智能关联**：自动发现记录之间的关联并展示相关内容。
- **关键词检索**：全字段关键词搜索，支持标签维度检索。
- **智能问答**：基于个人内容库的对话式问答。
- **思维导图（MindTree）**：把零散信息沉淀为可视化思维树。
- **待办与日历**：待办整理与日历视图。

### 桌面伴侣（Electron）
- **系统托盘**：常驻状态、显隐悬浮窗、打开主界面、立即分析、暂停/恢复监听。
- **悬浮窗**：无边框置顶，默认右下角，可拖动 / 吸附边缘 / 折叠；提供快速记录、选区分析、代码建议卡片。
- **VS 进程监听**：监听 `devenv.exe` 启动与前台激活，自动唤醒并读取解决方案源码。
- **代码分析**：读取 `.sln → .csproj → 源码`，云端大模型给出语法错误 / 潜在缺陷 / 风格规范建议。
- **选区分析**：全局快捷键 `Ctrl+Shift+A` 读取剪贴板文本并结构化分析。
- **隐私可控**：设置页可关闭「代码上传」，关闭后不读取、不推送源码。

## 目录结构

```
personal-agent/
├── shared/            # 共享层：领域类型、IPC 类型、prompt 常量、LLM 工具、云配置
├── web/               # Web 应用（Vite + React）
├── desktop/           # Electron 桌面伴侣（托盘 + 悬浮窗 + VS 监听 + 源码读取）
├── docs/              # 设计文档、数据库 DDL 存档
├── qa/                # 单元测试与测试入口
└── package.json       # 根脚本聚合
```

## 技术栈

- **Web**：Vite + React 18 + TypeScript + MUI + Tailwind CSS + Zustand
- **桌面**：Electron + electron-vite + electron-builder
- **云端**：WorkBuddy 云服务（`@tencent-ai/workbuddy-cloud-sdk`）：数据库、认证、对象存储、免密钥大模型

## 环境要求

- Node.js ≥ 18（推荐 20+）
- npm ≥ 9
- Windows 10 / 11（桌面伴侣）

## 快速开始

### 1. 配置云服务

本项目依赖 WorkBuddy 云服务（数据库 / 认证 / 存储 / 大模型）。你需要先有一个云应用，然后：

```bash
# Web 端配置
cp web/.env.example web/.env
# 编辑 web/.env，填入你的云应用 endpoint / publishableKey

# 桌面端配置
cp desktop/.env.example desktop/.env
# 编辑 desktop/.env，填入你的 Web 应用发布域名
```

> `.env` 已加入 `.gitignore`，不会提交到版本库；仓库中只保留 `.env.example` 模板。

### 2. 启动 Web 应用

```bash
cd web
npm install
npm run dev        # 本地开发（http://localhost:5173）
npm run typecheck  # TypeScript 类型检查
npm run build      # 产出 dist/
```

### 3. 启动桌面伴侣

```bash
cd desktop
npm install        # 只想做类型检查可加 ELECTRON_SKIP_BINARY_DOWNLOAD=1
npm run typecheck  # TypeScript 类型检查
npm run dev        # 本地开发
npm run build      # electron-vite 构建到 out/
npm run dist       # electron-builder 打包（NSIS 安装包）
```

## 数据库

数据库共 6 张表（`records` / `record_links` / `code_analyses` / `qa_sessions` / `chat_messages` / `settings`），由云服务托管并在建表时启用 RLS（行级安全）。应用代码不执行 DDL；等价 DDL 存档见 `docs/db-setup.sql`。数据按 `owner_id = auth.uid()` 隔离，前端永不发送 `owner_id`。

## 发布上线

1. **Web**：构建 `web/dist` 后发布上线，得到 HTTPS 域名。
2. **回填地址**：将发布域名写入 `web/.env` 的 `VITE_CLOUD_ENDPOINT`，以及 `desktop/.env` 的 `VITE_WEB_APP_URL`。
3. **桌面**：`cd desktop && npm run dist` 产出安装包，分发安装。

## 贡献

欢迎提交 Issue 与 Pull Request。参与方式、代码规范与提交流程请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

本项目采用 [MIT License](LICENSE)。你可以自由使用、修改与分发，但须保留版权声明。

---

> 提示：登录支持手机号验证码与微信扫码；微信登录需在已发布 HTTPS 域名上验证。
