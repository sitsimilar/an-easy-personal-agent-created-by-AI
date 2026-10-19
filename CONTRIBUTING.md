# 贡献指南

感谢你对「个人信息管家 Agent」的关注与贡献！以下约定帮助你高效地参与本项目。

## 行为准则

请保持友善、专业与相互尊重。我们欢迎一切建设性讨论，拒绝任何形式的攻击、骚扰与歧视。

## 如何参与

### 报告问题（Issue）

在提交 Issue 前，请先搜索是否已有相同问题。提交时请尽量包含：

- **环境信息**：操作系统、Node.js / npm 版本、桌面端（Electron）或 Web 端。
- **复现步骤**：清晰、可复现的最小步骤。
- **期望行为与实际行为**：说明差异。
- **截图 / 日志**：如涉及界面或报错，附上截图或关键日志（注意脱敏，勿贴密钥、令牌、手机号）。

### 提交代码（Pull Request）

1. Fork 本仓库并克隆到本地。
2. 基于 `main` 创建特性分支，命名建议 `feat/xxx`、`fix/xxx`、`docs/xxx`。
3. 实现改动，保持变更最小且聚焦单一目的。
4. 本地自测通过后再提交：

   ```bash
   npm run typecheck:web       # Web 类型检查
   npm run typecheck:desktop   # 桌面端类型检查
   npm run test:qa             # 单元测试
   ```

5. 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范，例如 `fix: 修复悬浮窗登录态不同步`。
6. 推送分支并发起 PR，在描述中说明改动动机、实现方式与测试情况。

## 代码规范

- **语言**：TypeScript，全中文界面文案。
- **类型**：启用严格模式（`strict: true`），避免 `any`。
- **目录边界**：跨端共享类型放 `shared/`；Web 专属逻辑放 `web/`；桌面主进程逻辑放 `desktop/src/main/`。
- **云服务配置**：`endpoint` / `publishableKey` 等一律经 `shared/config/publicConfig.ts`（Web）或 `desktop/src/shared/ipc-contract.ts`（桌面）读取环境变量，**禁止散落硬编码**。
- **密钥安全**：任何密钥、令牌、真实账号信息都不得写入代码或提交到仓库；本地敏感值只放在已忽略的 `.env` 中。

## 测试

- 单元测试位于 `qa/*.test.ts`，通过 `node qa/run-tests.mjs` 运行（esbuild + node:test）。
- 新增或修改功能时，请补充或更新对应测试。
- 涉及云数据库 / 大模型的集成测试需要真实登录态，本地环境通常无法运行，这类改动请重点保证类型检查与逻辑单测通过。

## 提交前检查清单

- [ ] `npm run typecheck:web` 通过
- [ ] `npm run typecheck:desktop` 通过
- [ ] `npm run test:qa` 通过
- [ ] 未包含任何密钥 / 令牌 / 真实凭据
- [ ] 提交信息符合 Conventional Commits

再次感谢你的贡献！
