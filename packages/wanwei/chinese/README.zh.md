---
description: "配置万维桌面的中文优先对话策略与中文界面词典。"
kind: "package-reference"
---

# 万维中文对话插件

[English](README.md) | 中文

## 概述

私有桌面组合包加载 `@deepseek-ai/dsh-wanwei-chinese`。宿主通过 `systemPrompt.section()` 贡献独立的语言策略段落。客户端注册 `zh-CN`，回退到官方 `zh` 词典，并补充对话相关交互的翻译。不翻译历史消息、工具结果、代码、路径、命令 id 或权限值。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

`instruction` 是可配置的中文优先策略，包含遵循用户明确语言要求的例外。客户端加载时选择中文语言包，用户之后仍可在通用设置中更换界面语言。移除或停用 `wanwei-chinese` Loader 项会释放提示词段落和词典。仅在插件自己的语言仍被选中时，客户端才恢复此前选择，不覆盖用户后续的语言选择。官方客户端图不投影宿主配置，因此 Loader 项是两端统一的启用/停用控制。

产品 profile 可以使用以下 `cordis.patch.yml` 项停用插件：

```yaml
- id: wanwei-chinese
  disabled: true
```

<a id="model-experience"></a>
## 模型体验

### 中文优先对话策略

#### 模型可见内容

**模型可见效果：**`wanwei:conversation-language` 语言策略段落要求整轮沟通使用简体中文，包括候选文件确认、澄清问题及选项标签、进度、总结和工具参数中的自然语言说明。技能说明、文件内容和历史消息中的英文不代表用户要求英文沟通。用户明确的语言要求仍优先；机器标识、文件名、路径和原始工具结果保持原样。语言段落位于工具说明之后、结构化输出指令之前。专家提示词和工具 schema 不变。官方提示词组装通过正常的请求日志记录所贡献的文字。

#### Token 效果

启用期间，一段简短固定文字增加提示词 token。界面翻译不增加模型调用或 token。

#### KV Cache 效果

切换或停用策略会改变提示词前缀，可能降低前缀缓存复用率。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 按照官方组装规则，完整提示词模式有意排除额外的系统段落。插件不覆盖该保护，也不保证模型完全遵循指令或内部推理的语言。部署显式配置的 `instruction` 替换默认策略。历史消息不改写。未知提供方标签和命令描述保持原样。市场内容与全应用汉化不属于此包的范围。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
