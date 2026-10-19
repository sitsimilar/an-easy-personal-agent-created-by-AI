# 个人信息管家 VS 助手（VSIX 插件）

在 Visual Studio 内展示「个人信息管家」桌面伴侣生成的代码优化建议。本插件**只读本地文件、不联网、不调 LLM**：桌面伴侣在每次分析完成后把结果写入 `%LOCALAPPDATA%\PersonalAgent\`，插件按当前解决方案路径读取并展示。

> ⚠️ **本工程需在 Visual Studio 中打开并 Build**。本机 `dotnet` CLI 环境异常，未在本会话产出 `.vsix`；源码已按 VSIX 标准工程结构编写，在 VS 2022（及更高版本）中可直接打开 `vsix/PersonalAgentVsix.sln` Build 与 F5 调试。

## 数据文件约定（由桌面伴侣生成）

| 文件 | 内容 |
|------|------|
| `%LOCALAPPDATA%\PersonalAgent\index.json` | `{ "version":1, "solutions": { "<solutionPath>": {"solutionName","file","analyzedAt"} } }` |
| `%LOCALAPPDATA%\PersonalAgent\analyses\<sha1(path).slice(0,16)>.json` | 每解决方案最新分析结果 |
| `%LOCALAPPDATA%\PersonalAgent\latest-analysis.json` | 最近一次分析结果副本 |

## 构建

### 方式一（推荐）：Visual Studio 内 Build

1. 打开 `vsix/PersonalAgentVsix.sln`。
2. 首次打开会自动还原 NuGet 包（`Microsoft.VisualStudio.SDK 17.*`、`Microsoft.VSSDK.BuildTools 17.*`、`Newtonsoft.Json 13.*`）。
3. 菜单 `Build > Build Solution`（或 `Ctrl+Shift+B`），产出 `bin\Debug\PersonalAgentVsix.vsix`。
4. 按 `F5` 启动「实验实例」调试：`视图 > 其他窗口 > 个人信息管家`。

### 方式二：dotnet build（若 SDK 可用）

```powershell
cd vsix\PersonalAgentVsix
dotnet restore
dotnet build -c Debug
# 产物：bin\Debug\PersonalAgentVsix.vsix
```

> 若 `dotnet build` 报「MSB4062 / VSSDK targets 未找到」，多为 `Microsoft.VSSDK.BuildTools` 未还原或本机缺 .NET Framework 4.7.2 目标包——改用方式一在 VS 内 Build 即可。

## 安装

1. Build 产出 `.vsix`。
2. 双击 `.vsix`（或 `VSIXInstaller.exe <path>.vsix`）。
3. 重启 Visual Studio，在 `视图 > 其他窗口 > 个人信息管家` 打开工具窗口。

## 界面与状态（全中文）

| 场景 | 展示 |
|------|------|
| 当前未打开解决方案 | 「当前未打开解决方案」 |
| 无分析文件 | 「暂无分析结果。请在桌面伴侣中完成一次 VS 分析」 |
| 结果文件格式异常 | 「分析结果文件格式异常，请重新分析」 |
| 分析失败 | 「分析失败」+ message（红色） |
| 正常 | 摘要 + 着色问题列表（error 红 / warning 橙 / suggestion 蓝），点击问题项跳转 `file:line` |

- 「刷新」按钮：重读 index + 结果文件并重新渲染。
- 「专业版 / 大白话版」切换：问题标题/描述/建议支持两种措辞风格——专业版用规范术语、面向技术人员；大白话版通俗口语化、面向普通用户。两套内容一致、仅表达不同，历史结果缺失大白话字段时自动回退专业版。
- 「立即分析」：MVP 未接入（P2 通过本地信号文件触发桌面伴侣），暂不提供。

## 工程结构

```
PersonalAgentVsix/
├── PersonalAgentVsixPackage.cs          # AsyncPackage + ProvideToolWindow
├── AnalysisToolWindow.cs                # ToolWindowPane（Caption「个人信息管家」）
├── AnalysisToolWindowControl.xaml(.cs)  # WPF 界面与加载/刷新/跳转逻辑
├── Models/AnalysisResult.cs             # 结果 DTO（与导出 JSON 对齐）
├── Services/AnalysisFileService.cs      # 读 index → analyses\<slug>.json + 兜底 latest
├── Services/SolutionService.cs          # DTE.Solution.FullName
├── Services/EditorNavigationService.cs  # OpenFile + GotoLine
├── Converters/SeverityToBrushConverter.cs
├── Assets/icon.png                      # 占位图标（P2 接入 manifest）
└── source.extension.vsixmanifest
```

## 说明

- GUID：包 `A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D`，工具窗口 `2B3C4D5E-6F7A-4B8C-9D0E-1F2A3B4C5D6E`。
- `Assets/icon.png` 为占位图标，尚未在 `.vsixmanifest` 中引用。
- 若本机 VS 主版本为 18.x（下一代），请将 `.vsixmanifest` 中 `InstallationTarget Version` 由 `[17.0,18.0)` 调整为 `[17.0,19.0)`。
