<h1 align="center">DNova for Copilot Chat</h1>

<p align="center">
  <!-- marketplace-readme:remove-start -->
  <a href="https://marketplace.visualstudio.com/items?itemName=luketebo.dnova-for-copilot"><img src="https://img.shields.io/badge/VS%20Code%20Marketplace-Install-007ACC?logo=visualstudiocode&logoColor=white&style=for-the-badge" alt="从 VS Code Marketplace 安装"></a>
  <a href="https://open-vsx.org/extension/luketebo/dnova-for-copilot"><img src="https://img.shields.io/badge/Open%20VSX-Install-6A4FB6?style=for-the-badge" alt="从 Open VSX 安装"></a>
  <br/>
  <!-- marketplace-readme:remove-end -->
  <img src="https://img.shields.io/github/v/release/luketebo/DNova-for-copilot?style=for-the-badge&label=Version" alt="版本" />
</p>

<p align="center">
  <a href="https://github.com/luketebo/DNova-for-copilot/blob/main/README.md">English</a> |
  简体中文
</p>

**在 Copilot Chat 模型选择器中直接使用 DNova（GLM-5.2），同时内置一套能直接操作 SAP 的 ABAP ADT MCP——全部使用你自己的 API Key。**

一个扩展，两件事：

1. **把 DNova 用作 Copilot 模型** —— 将 **DNova GLM-5.2** 直接接入 Copilot Chat 模型选择器。BYOK，零配置。
2. **内置 ABAP ADT MCP** —— 随扩展打包一套完整的 SAP ABAP 工具集（`@mcp-abap-adt/core`，206 个工具），你可以在 Copilot Chat 里直接读取、创建、更新、激活 SAP 中的 ABAP 对象。

## 为什么选这个扩展？

- **增强 Copilot，而非替换它。** 没有新的侧边栏，没有新的聊天界面要学——只是在你已用的模型选择器里多一个模型，在你已有的聊天里多一套 ABAP 工具。
- **Agent 模式、工具调用、Instructions、Skills——全部正常运作。** Copilot 的完整能力栈，现在跑在 DNova 上。
- **内置 ABAP ADT MCP（dnova-abap-mcp）。** `@mcp-abap-adt/core` 服务器已随扩展打包——无需单独安装、无需 `npx`。启用它、填上你的 SAP 系统信息，就能用自然语言操作 ABAP 对象。
- **BYOK，直接向 DNova 付费。** 你的 API Key、你的账单、你的速率限制。密钥存于操作系统钥匙串，不落盘。

## 功能特性

### DNova GLM-5.2 出现在模型选择器中

DNova 模型与 GPT-4o、Claude 等并列在 Copilot Chat 的模型选择器中。对话中途可切换模型，不丢失历史。

### 内置 ABAP ADT MCP（dnova-abap-mcp）

随扩展打包一套完整的 SAP ABAP 工具集：

- **206 个 ABAP 工具** —— 读 / 建 / 改 / 删 / 激活 / 检查、运行时与调试、搜索
- **支持本地部署（ECC/S4HANA）、ABAP Cloud（BTP）和旧版** SAP 系统
- **本地 Streamable HTTP 方式**，由扩展在本机固定端口运行 facade（默认 `127.0.0.1:3000/mcp`）
- **5 个门面（facade）工具** —— Copilot 只看到 `abap_tool_search`、`abap_read`、`abap_search`、`abap_write`、`abap_execute`；完整目录一次搜索即可获得
- **Agent 指引与 Skill** —— 内置 ABAP skill，并可在 ABAP 工作区自动生成 `AGENTS.md`，让 Copilot 优先使用这套工具
- **用大白话操作** —— "读取类 ZCL_BOOKING 的源码"、"创建表 ZT_ORDER"、"运行这个类的单元测试"

工具族示例：`GetTableContents` · `GetPackageContents` · `SearchSource` · `GetSqlQuery` · `CreateClass` · `UpdateProgram` · `ActivateTable` · `CheckClass` · `RuntimeRunProgram` · `ListTransports` …

#### 工具集与 Copilot 的 128 工具限制

Copilot 每次请求暴露给 Agent 的工具**上限为 128 个**。全部暴露 206 个工具可能触发 Copilot 的**工具延迟加载（deferral）**——部分工具被标记为“延迟”，直接调用时会报 *“Tool X is currently disabled by the user”*（措辞有误导性，其实只是还没加载）。扩展通过 `dnova-copilot.mcp.abapAdt.exposition` 设置来避免此问题：

- `readonly`（**默认**）——约 68 个安全只读工具（Get/Read/Search/SQL/类型信息、分析）。不会触发延迟，全部直接可用。
- `compact`——约 22 个精选高层工具（CRUD + 激活/锁定 + 单元测试 + 运行时 + 传输）。不会触发延迟。
- `readonly,high`——完整的 206 个工具，但可能触发延迟。

Copilot 只会收到**固定 5 个门面（facade）工具**——`abap_tool_search`、`abap_read`、`abap_search`、`abap_write`、`abap_execute`——永远不会直接暴露数百个底层 core 工具。完整目录从运行中的服务器按需获取：

1. `abap_tool_search` —— 按工具名或能力关键词查找准确 core 工具；省略 query 可浏览整个目录（分页）。
2. 把返回的工具经对应 facade 转发——读取走 `abap_read`，仓库 / 源码搜索走 `abap_search`，写 / 激活走 `abap_write`，其余走 `abap_execute`。

例如：先搜索 `GetClass`，然后调用 `abap_read`，传入 `tool: "GetClass"` 以及搜索结果中的 `arguments`。这样底层完整工具仍然可用，而 Copilot 无需管理数百个单独的工具。

facade 以本地 Streamable HTTP 服务运行，可按需设置 `dnova-copilot.mcp.abapAdt.httpHost` 与 `httpPort`。关闭 `dnova-copilot.mcp.abapAdt.httpEnabled` 后 MCP 会完全停止，不会回退到 stdio 模式。

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
- 较新的 **Node.js** 运行时（≥ 22），用于内置的 ABAP ADT MCP 服务器（回退使用 VS Code 内置运行时）

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
2. 仅首次需要重载窗口（`Developer: Reload Window`）以注册 MCP 服务器；之后的设置改动会自动生效——扩展会重新生成 `.env` 并重启服务器，无需重载。
3. 在 Copilot Chat 里让它使用 ABAP 工具——例如 *"读取类 ZCL_BOOKING 的源码"*
4. 首次使用工具时可能弹出 **允许本次会话**（VS Code 的 MCP 信任提示）——点击允许即可

常用命令：

- **DNova: 检查 ABAP ADT MCP 连接** —— 立即对 SAP 运行一次连接健康检查（启动几秒后也会自动执行一次）
- **DNova: 显示 ABAP ADT MCP 配置** —— 显示 `.env` 的确切路径、启动参数和哪些设置缺失
- **DNova: 配置 ABAP ADT MCP** —— 把服务器写入全局 / 工作区 `mcp.json`
- **DNova: 设置 ABAP ADT MCP 密码** —— 把 SAP 密码存进操作系统钥匙串
- **DNova: 更新 ABAP Agent 指引** / **DNova: 移除 ABAP Agent 指引** —— 写入或移除 `AGENTS.md` 指引，让 Copilot 优先使用这套 ABAP 工具（在 ABAP 工作区自动创建）

> 扩展会在你修改设置时自动重新生成 `.env`——大多数改动无需重载窗口。

## 模型


| 模型              | 适用场景                    |
| ------------------- | ----------------------------- |
| **DNova GLM-5.2** | 编码、Agent 任务、ABAP 开发 |

## 设置


| 设置项                                       | 默认值                                | 说明                                                                |
| ---------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| `dnova-copilot.baseUrl`                      | `https://nova.deloitte.com.cn/del/v1` | DNova API 基础地址                                                  |
| `dnova-copilot.maxTokens`                    | `0`                                   | 最大输出 Token 数（`0` = 不限制）                                   |
| `dnova-copilot.modelIdOverrides`             | `{ "glm-5.2": "glm-5.2" }`            | 发送给 API 的模型 ID                                                |
| `dnova-copilot.debugMode`                    | `minimal`                             | `minimal` / `metadata` / `verbose` 诊断级别                         |
| `dnova-copilot.mcp.abapAdt.enabled`          | `true`                                | 启用内置的 ABAP ADT MCP 服务器                                      |
| `dnova-copilot.mcp.abapAdt.httpEnabled`      | `true`                                | 启用本地 Streamable HTTP MCP 服务；关闭后 MCP 不可用                |
| `dnova-copilot.mcp.abapAdt.httpHost`         | `127.0.0.1`                           | HTTP 服务监听地址                                                   |
| `dnova-copilot.mcp.abapAdt.httpPort`         | `3000`                                | HTTP 服务监听端口                                                   |
| `dnova-copilot.mcp.abapAdt.url`              | `""`                                  | SAP 系统地址                                                        |
| `dnova-copilot.mcp.abapAdt.client`           | `100`                                 | SAP 客户端号                                                        |
| `dnova-copilot.mcp.abapAdt.username`         | `""`                                  | SAP 用户名                                                          |
| `dnova-copilot.mcp.abapAdt.password`         | `""`                                  | SAP 密码（建议用`useSecretStorage`）                                |
| `dnova-copilot.mcp.abapAdt.useSecretStorage` | `false`                               | 将 SAP 密码存入操作系统钥匙串                                       |
| `dnova-copilot.mcp.abapAdt.envPath`          | `""`                                  | 可选：指向含 SAP 凭据的`.env` 文件                                  |
| `dnova-copilot.mcp.abapAdt.language`         | `EN`                                  | SAP 登录语言                                                        |
| `dnova-copilot.mcp.abapAdt.systemType`       | `onprem`                              | `onprem` / `cloud` / `legacy`                                       |
| `dnova-copilot.mcp.abapAdt.authType`         | `basic`                               | `basic` / `jwt`                                                     |
| `dnova-copilot.mcp.abapAdt.startupCheck`     | `true`                                | 启动几秒后自动执行一次 GetSession 健康检查                          |
| `dnova-copilot.mcp.abapAdt.exposition`       | `readonly`                            | 核心工具面：`readonly` / `compact` / `readonly,high` / …           |
| `dnova-copilot.abap.agentGuide.autoCreate`   | `true`                                | 在 ABAP 工作区自动写入`AGENTS.md`                                   |
| `dnova-copilot.abap.agentGuide.file`         | `AGENTS.md`                           | 要写入的指引文件（`AGENTS.md` / `.github/copilot-instructions.md`） |

## 命令


| 命令                            | 说明                                        |
| --------------------------------- | --------------------------------------------- |
| `DNova: 设置 API Key`           | 把 DNova API Key 存入操作系统钥匙串         |
| `DNova: 获取 API Key`           | 显示是否已配置 API Key                      |
| `DNova: 清除 API Key`           | 移除已保存的 API Key                        |
| `DNova: 打开设置`               | 打开扩展设置                                |
| `DNova: 显示日志`               | 打开扩展输出通道                            |
| `DNova: 打开请求 Dump 目录`     | 打开详细调试的 dump 目录                    |
| `DNova: 设置 ABAP ADT MCP 密码` | 把 SAP 密码存入操作系统钥匙串               |
| `DNova: 配置 ABAP ADT MCP`      | 把 MCP 服务器写入`mcp.json`（全局或工作区） |
| `DNova: 显示 ABAP ADT MCP 配置` | 显示`.env` 路径、启动参数和连接健康检查     |
| `DNova: 检查 ABAP ADT MCP 连接` | 立即对 SAP 运行一次连接健康检查             |
| `DNova: 更新 ABAP Agent 指引`   | 为本工作区写入 / 刷新`AGENTS.md` 指引       |
| `DNova: 移除 ABAP Agent 指引`   | 从工作区移除`AGENTS.md` 指引块              |

## 安全

- API Key 和 SAP 密码都可存入 VS Code `SecretStorage`（操作系统钥匙串）。
- 设置 `dnova-copilot.mcp.abapAdt.useSecretStorage` 为 `true` 并使用 **DNova: 设置 ABAP ADT MCP 密码**，可避免 SAP 密码明文出现在 `settings.json` 中。

## 许可证

[MIT](LICENSE)
