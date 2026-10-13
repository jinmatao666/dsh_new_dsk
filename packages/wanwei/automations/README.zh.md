---
description: "配置持久化的万维本机任务，通过普通会话执行，并查看真实运行记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-automations

[English](README.md) | 中文

## 概述

用户可以创建本机任务、暂停任务、立即执行并打开执行会话。任务和运行记录在关闭页面及重启桌面端后保留。桌面端必须保持运行并登录；错过的计划不补跑。现有入口显示及纯内网限制仍由提供方管理；本包不启用云端调度。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

万维桌面产品通过[组合补丁](../../bundle/wanwei-desktop/cordis.patch.yml)挂载本插件。[Host 配置](src/runtime.ts)控制存储、调度间隔、延迟容忍、执行超时和保留数量。

桌面端只显示 Host 已保存的任务，支持启用/暂停筛选、编辑和批量操作。创建时填写存在的绝对工作目录和本地执行时间。启用表示允许按计划使用默认模型执行；暂停的任务也可立即执行。每次执行新建普通会话并使用工作区写入权限；需要审批的操作仍须人工确认。

新建菜单提供手动新建、从任务新建和从模板新建。从任务新建打开新对话，在输入框预填 `帮我创建一个定时任务：`；不自动发送消息，也不自动保存定时任务。六个办公模板打开可编辑、默认暂停的草稿。保存前须确认说明、工作目录、时间和启用状态。模板不会作为示例任务写入存储。批量操作栏固定在页面底部。

默认任务文件位于 Harness 主目录下的 automations.json。读取按账号隔离；修改使用文件锁和原子替换。存储异常会明确报错，不重置任务。修复损坏文件或遗留的同名锁文件前须关闭桌面端，并在修复前保留副本。

停用本插件的配置项会移除其入口；不需要停用其他业务插件。共用鉴权、渲染和侧边栏服务仍由各提供方负责。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Client 拥有选择状态和提示，通过鉴权的本机 RPC 读取已提交数据，编辑后拒绝过时的轮询响应。它使用 feature-panels 提供展示和导航。控制器在侧边栏导航或退出登录时关闭页面。

[Host 运行时](src/runtime.ts)持久化领取到期任务后调用现有会话控制器。它在启动前推进下次执行时间，并阻止同一任务重叠执行。成功依据已完成回合记录，而不只看空闲状态；超时、中断和执行失败均会记录。卸载停止调度并取消所属执行。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [产品组合](../../bundle/wanwei-desktop/README.zh.md) — profile 归属。
- [鉴权与网络策略](../oneapi-auth/README.zh.md) — 共用服务。
- [独立页面决策](../../../.agents/notes/implemented/architecture/2026-10-10-independent-wanwei-pages.zh.md) — 生命周期和依赖依据。

-----

<a id="model-experience"></a>
## Model Experience

间接：调度器把用户编写的任务说明提交给普通会话控制器；现有 Agent 和模型提供方负责请求组装、工具和 token 消耗。

#### KV Cache effect

每次执行新建会话；本包不复用以前的任务对话，也不修改提供方的缓存策略。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 只提供每天、周一至周五和每周五的周期；不解释法定节假日。
- 不提供云端执行或错过计划补跑。退出登录停止接收执行；超时默认十分钟，包含等待审批的时间。
- 记录保留会话链接，不单独复制产物。删除任务不删除会话或工作文件。
- 账号隔离使用本机登录用户名；不同部署需要独立的 Harness 主目录。
- 真实模型及 UOS、macOS、Windows 原生验收属于部署检查；自动集成测试替代外部模型响应。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护人员的工作上下文 — 点击展开</summary>

无。

</details>
