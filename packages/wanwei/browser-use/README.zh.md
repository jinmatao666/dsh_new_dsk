---
description: "配置万维桌面运行时中的官方 Playwright MCP 浏览器提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-browser-use

[English](README.md) | 中文

## 概述

Agent 可以通过固定版本的官方 Playwright 提供方查看和操作 Chromium 浏览器。每个存活会话独占一条浏览器连接。桌面配置控制启用状态与窗口显示；纯内网模式拒绝浏览器工具。本包不会下载浏览器。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

设置卡片默认收起。点击标题展开或收起权限控件，不改变已保存的偏好；开关立即保存，展开时显示保存失败提示。

在创建会话前挂载此插件。不指定 `executablePath` 时，Windows/macOS 按 Chrome、Edge 顺序检查标准安装目录；Linux 在 PATH 中查找 Chrome、Chromium 和 Edge 命令。自定义绝对可执行文件路径优先，必须是可访问的可执行文件。找不到浏览器时返回中文工具说明，不自动下载。安装浏览器或修改路径后需要重启桌面端并新建会话。

```yaml
- name: '@deepseek-ai/dsh-wanwei-browser-use'
  config:
    enabled: true
    headless: false
```

“浏览器助手”卡片位于设置 → 插件 → 插件配置的首位。开关默认启用，通过主机设置文档自动保存 `wanwei-browser-use.enabled`。停用会隐藏浏览器工具定义，并拒绝后续调用，包括已有会话已知的工具；不会强制终止正在执行的操作或会话资源。重新启用后恢复后续调用，无需重装。纯内网模式将开关置灰并拒绝浏览器工具，不覆盖已保存的偏好。桌面层支持通过 `DSH_BROWSER_USE_ENABLED=0` 设置组装层默认值，并通过 `DSH_BROWSER_EXECUTABLE` 接收可执行文件路径；已保存的偏好优先于默认值。修改可执行文件路径需要创建新会话。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

仅提供方使用的 Context 提供经过验证的会话工作目录和可取消初始化信号。提示词组装等待初始化完成，并在首次请求进入前重新收集工具定义。Agent 和插件释放会等待其拥有的启动任务；官方运行时负责 MCP 串行执行与进程清理。共享 Agent 注册表和循环保持不变。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [桌面组合包](../../bundle/wanwei-desktop/README.zh.md)——产品组装。
- [MCP 客户端](../../mcp/mcp-client/README.zh.md)——工具发现和传输。
- [官方提供方](https://github.com/deepseek-ai/deepseek-harness/blob/d743267/packages/experimental/browser-use-playwright-mcp/README.md)——提供方行为。

-----

<a id="model-experience"></a>
## 模型体验

### 浏览器工具

#### 模型可见内容

官方提供方贡献 `mcp__playwright-mcp__` 工具和 MCP 指引。快照文件链接以会话工作目录为基准解析。纯内网模式隐藏浏览器工具定义，并以 `纯内网环境暂不开放浏览器自动化` 拒绝直接执行。浏览器指引要求模型在启动失败后停止，不下载浏览器或改用 Shell/CDP 脚本；可识别的启动错误在工具结果中先返回中文处理说明，再保留原始诊断。这是模型行为指引，不是全面禁止 Shell 执行。验证码需要用户手动处理。

#### Token 影响

工具定义、浏览器指引和结果增加模型输入 token；浏览器任务使用当前选择的模型路由。

#### KV Cache 影响

稳定的工具定义复用提示词前缀；启用状态或策略变化会改变工具目录。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

当前接入有明确的部署限制。

- 官方提供方是实验功能，固定为 `0.2.1-alpha.2`；其 peer 版本与本运行时不同，需要集成测试。
- 在完成浏览器网络约束之前，纯内网模式禁用浏览器自动化；本插件不是防火墙。
- 非标准安装位置需要设置 `executablePath` 或 `DSH_BROWSER_EXECUTABLE`；本包不内置 Chromium，不提供 Firefox/WebKit 选择，也不保证第三方 Chromium 浏览器兼容。设置卡片展示权限状态，不代表浏览器连接就绪。
- 跨平台安装包和实际模型驱动的问答验证仍然必需。

<a id="dev-note"></a>
### 开发备注

无。
