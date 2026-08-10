<h1 align="center">DNova for Copilot Chat</h1>

<p align="center">
  <!-- marketplace-readme:remove-start -->
  <a href="https://marketplace.visualstudio.com/items?itemName=luke.dnova-for-copilot"><img src="https://img.shields.io/badge/VS%20Code%20Marketplace-Install-007ACC?logo=visualstudiocode&logoColor=white&style=for-the-badge" alt="从 VS Code Marketplace 安装"></a>
  <a href="https://open-vsx.org/extension/luke/dnova-for-copilot"><img src="https://img.shields.io/badge/Open%20VSX-Install-6A4FB6?style=for-the-badge" alt="从 Open VSX 安装"></a>
  <br/>
  <!-- marketplace-readme:remove-end -->
  <img src="https://img.shields.io/github/v/release/luke/dnova-for-copilot?style=for-the-badge&label=Version" alt="版本" />
</p>

<p align="center">
  <a href="https://github.com/luke/dnova-for-copilot/blob/main/README.md">English</a> |
  简体中文
</p>

**在 Copilot Chat 模型选择器中直接使用 DNova（GLM-5.2），同时内置一套能直接操作 SAP 的 ABAP ADT MCP——全部使用你自己的 API Key。**

<p align="center">
  <img src="resources/screenshots/01-picker.png" alt="DNova GLM-5.2 出现在 Copilot Chat 模型选择器中" width="800">
</p>

一个扩展，两件事：

1. **把 DNova 用作 Copilot 模型** —— 将 **DNova GLM-5.2** 直接接入 Copilot Chat 模型选择器。BYOK，零配置。
2. **内置 ABAP ADT MCP** —— 随扩展打包一套完整的 SAP ABAP 工具集（`@mcp-abap-adt/core`，206 个工具），你可以在 Copilot Chat 里直接读取、创建、更新、激活 SAP 中的 ABAP 对象。

## 为什么选这个扩展？

- **增强 Copilot，而非替换它。** 没有新的侧边栏，没有新的聊天界面要学——只是在你已用的模型选择器里多一个模型，在你已有的聊天里多一套 ABAP 工具。
- **Agent 模式、工具调用、Instructions、Skills——全部正常运作。** Copilot 的完整能力栈，现在跑在 DNova 上。
- **内置 ABAP ADT MCP（DTT ABAP ADT）。** `@mcp-abap-adt/core` 服务器已随扩展打包——无需单独安装、无需 `npx`。启用它、填上你的 SAP 系统信息，就能用自然语言操作 ABAP 对象。
- **BYOK，直接向 DNova 付费。** 你的 API Key、你的账单、你的速率限制。密钥存于操作系统钥匙串，不落盘。

## 功能特性

### DNova GLM-5.2 出现在模型选择器中

DNova 模型与 GPT-4o、Claude 等并列在 Copilot Chat 的模型选择器中。对话中途可切换模型，不丢失历史。

### 内置 ABAP ADT MCP（DTT ABAP ADT）

随扩展打包一套完整的 SAP ABAP 工具集：

- **206 个 ABAP 工具** —— 读 / 建 / 改 / 删 / 激活 / 检查、运行时与调试、搜索
- **支持本地部署（ECC/S4HANA）、ABAP Cloud（BTP）和旧版** SAP 系统
- **stdio 方式**，你在聊天时由 VS Code 自动拉起——无需额外安装 MCP 服务器
- **用大白话操作** —— "读取类 ZCL_BOOKING 的源码"、"创建表 ZT_ORDER"、"运行这个类的单元测试"

工具族示例：`GetTableContents` · `GetPackageContents` · `SearchSource` · `GetSqlQuery` · `CreateClass` · `UpdateProgram` · `ActivateTable` · `CheckClass` · `RuntimeRunProgram` · `ListTransports` …

<p align="center">
  <img src="resources/screenshots/04-agent.png" alt="ABAP ADT MCP 工具在 Copilot Agent 模式中运行" width="800">
</p>

### 透明视觉代理

DNova GLM-5.2 是纯文本模型。当你把截图拖入聊天时，扩展会先把图片交给另一个已安装的视觉模型生成描述，再把描述喂给 DNova——全程透明。

<p align="center">
  <img src="resources/screenshots/03-vision.png" alt="在 Copilot Chat 中拖入图片并使用 DNova 视觉代理" width="800">
</p>

### 默认安全

- **DNova API Key** 存于 VS Code `SecretStorage`（操作系统钥匙串）——绝不写入 `settings.json` 或进入 Git 历史。
- **SAP 密码** 也可以通过 `DNova: Set ABAP ADT MCP Password` 存进 `SecretStorage`，而不是明文写在 `settings.json` 里。

### 零运行时依赖

纯 VS Code API + Node.js 内置模块，外加打包的 `@mcp-abap-adt/core` MCP。无需 Python、无需 Docker、无需单独维护的服务器。

## 快速开始

### 环境要求

- VS Code 1.116 或更高版本
- 一个 **DNova API Key**（BYOK）——扩展零配置，你自带 Key 和端点

### 1. 把 DNova GLM-5.2 用作 Copilot 模型

1. 命令面板（`Cmd+Shift+P`）运行 **DNova: 设置 API Key**
2. 粘贴你的 DNova API Key
3. 打开 Copilot Chat，点击模型选择器，选择 **DNova（GLM-5.2）**
4. 完成，开始对话

> 端点通过 `dnova-copilot.baseUrl` 配置（默认官方 DNova 端点）。

### 2. 用内置的 ABAP ADT MCP 连接你的 SAP

1. 打开设置，填写 SAP 连接信息（`dnova-copilot.mcp.abapAdt.*`）：
   - `url` —— SAP 系统地址（如 `https://my-sap:44304`）
   - `client` —— SAP 客户端号（如 `100`）
   - `username` / `password` —— 基础认证凭据
   - `systemType` —— `onprem` / `cloud` / `legacy`
   - （可选）`envPath` —— 指向一个含 `SAP_URL`、`SAP_CLIENT`、`SAP_USERNAME`、`SAP_PASSWORD` 等的 `.env` 文件
2. 重载窗口（`Developer: Reload Window`）
3. 在 Copilot Chat 里让它使用 ABAP 工具——例如 *"读取类 ZCL_BOOKING 的源码"*
4. 首次使用工具时可能弹出 **允许本次会话**（VS Code 的 MCP 信任提示）——点击允许即可

常用命令：
- **DNova: 显示 ABAP ADT MCP 配置** —— 显示 `.env` 的确切路径、启动参数和健康检查（哪些设置缺失）
- **DNova: 配置 ABAP ADT MCP** —— 把服务器写入全局 / 工作区 `mcp.json`
- **DNova: 设置 ABAP ADT MCP 密码** —— 把 SAP 密码存进操作系统钥匙串

> 扩展会在你修改设置时自动重新生成 `.env`——大多数改动无需重载窗口。

## 模型

| 模型 | 适用场景 |
| --- | --- |
| **DNova GLM-5.2** | 编码、Agent 任务、ABAP 开发 |

## 设置

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| `dnova-copilot.baseUrl` | `https://nova.deloitte.com.cn/del/v1` | DNova API 基础地址 |
| `dnova-copilot.maxTokens` | `0` | 最大输出 Token 数（`0` = 不限制） |
| `dnova-copilot.modelIdOverrides` | `{ "glm-5.2": "glm-5.2" }` | 发送给 API 的模型 ID |
| `dnova-copilot.debugMode` | `minimal` | `minimal` / `metadata` / `verbose` 诊断级别 |
| `dnova-copilot.mcp.abapAdt.enabled` | `true` | 启用内置的 ABAP ADT MCP 服务器 |
| `dnova-copilot.mcp.abapAdt.url` | `""` | SAP 系统地址 |
| `dnova-copilot.mcp.abapAdt.client` | `100` | SAP 客户端号 |
| `dnova-copilot.mcp.abapAdt.username` | `""` | SAP 用户名 |
| `dnova-copilot.mcp.abapAdt.password` | `""` | SAP 密码（建议用 `useSecretStorage`） |
| `dnova-copilot.mcp.abapAdt.useSecretStorage` | `false` | 将 SAP 密码存入操作系统钥匙串 |
| `dnova-copilot.mcp.abapAdt.envPath` | `""` | 可选：指向含 SAP 凭据的 `.env` 文件 |
| `dnova-copilot.mcp.abapAdt.language` | `EN` | SAP 登录语言 |
| `dnova-copilot.mcp.abapAdt.systemType` | `onprem` | `onprem` / `cloud` / `legacy` |
| `dnova-copilot.mcp.abapAdt.authType` | `basic` | `basic` / `jwt` |

## 命令

| 命令 | 说明 |
| --- | --- |
| `DNova: 设置 API Key` | 把 DNova API Key 存入操作系统钥匙串 |
| `DNova: 获取 API Key` | 显示是否已配置 API Key |
| `DNova: 清除 API Key` | 移除已保存的 API Key |
| `DNova: 打开设置` | 打开扩展设置 |
| `DNova: 显示日志` | 打开扩展输出通道 |
| `DNova: 打开请求 Dump 目录` | 打开详细调试的 dump 目录 |
| `DNova: 设置 ABAP ADT MCP 密码` | 把 SAP 密码存入操作系统钥匙串 |
| `DNova: 配置 ABAP ADT MCP` | 把 MCP 服务器写入 `mcp.json`（全局或工作区） |
| `DNova: 显示 ABAP ADT MCP 配置` | 显示 `.env` 路径、启动参数和连接健康检查 |

## 安全

- API Key 和 SAP 密码都可存入 VS Code `SecretStorage`（操作系统钥匙串）。
- 设置 `dnova-copilot.mcp.abapAdt.useSecretStorage` 为 `true` 并使用 **DNova: 设置 ABAP ADT MCP 密码**，可避免 SAP 密码明文出现在 `settings.json` 中。

## 许可证

[MIT](LICENSE)
