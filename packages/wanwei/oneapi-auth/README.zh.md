---
description: "使用 OneAPI 登录万维桌面，并在不向浏览器暴露生成令牌的情况下使用后台管理的模型、搜索和专家网页票据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-oneapi-auth

[English](README.md) | 中文

## 概述

在账户设置中成功退出登录后，设置面板自动关闭并显示登录页。退出失败时保留面板并显示错误。

检查登录状态和退出登录后使用相同的表单与固定高度的内容区域。登录页每次显示时重新计算缩放，字体布局不继承工作区设置。

桌面登录布局使用以 Windows 为基准的分栏尺寸和明确的文字行高。字体仍使用本地系统字体，因此字形渲染可能不同。WebKit 使用带前缀的背景模糊规则。

用户登录配置的 OneAPI 服务并使用账户获准的模型。桌面读取后台管理的模型目录，不提供本地提供方编辑。Host 还会获取已上架专家资料与一次性网站票据，并把 OneAPI token 留在 Client 之外。

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

万维产品组合包挂载 Host 和 Client 两部分。浏览器只接收认证状态和模型标识，不接收密码或生成令牌。

### 配置

网络环境及各环境独立的自动化、连接器入口可见性由配置的后台系统设置决定。Host 在登录前和认证刷新时读取 `/api/desktop-config`，并通过 `wanwei-network.mode` 缓存后台已确认的策略。窗口聚焦、页面恢复可见和既有五分钟认证计时器也会刷新。缺少功能配置时默认两种环境均开启自动化、仅互联网开启连接器；显式无效开关会拒绝刷新，不替换已提交的 Client 状态。配置读取失败时阻止登录，不假定为互联网。纯内网模式保留配置的登录、模型、平台技能与本地操作，但禁用 SkillHub 访问和已安装 SkillHub 技能执行、专家及公网搜索。公网 HTTP(S) 链接被拦截；开启连接器入口不会解除此限制。私有地址、本地 DNS 名称及配置的 OneAPI 来源仍可访问。额外内网域名需要明确补充分类规则。

忘记密码通过独立弹窗读取后台运维联系人。短信和扫码登录只提示未开放，不替换账号登录表单。登录卡片保留既有尺寸，不提供注册或模拟认证控件。

纯内网模式会拒绝可识别的、直接访问公网依赖源的包管理命令。已安装依赖、离线选项和明确的内网镜像仍可使用。使用配置文件或尚未解析的源变量时，交由包管理器解析。识别到缺失依赖或依赖下载失败时，保留原始工具输出，并在工具结果中补充中文处理说明。模型被要求仅在必需依赖没有可用离线替代方案时说明任务受阻，不得声称完成。

这是应用策略，不是防火墙或 Shell 沙箱；不能全面识别嵌套脚本和任意下载命令。依赖提示段落在后续提示词组装时跟随后台已确认的环境，历史消息不被改写。互联网模式不增加依赖提示段落、拦截或反馈。

[产品补丁](../../bundle/wanwei-desktop/cordis.patch.yml)提供提供方路由和生成令牌引用。Host 优先使用显式 OneAPI 地址，其次读取启动环境中的 `DSH_ONEAPI_URL`，最后使用本地开发地址。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `DSH_ONEAPI_URL`，其次 `http://127.0.0.1:3000` | 不含 `/v1` 的显式 OneAPI 地址优先于启动环境。 |
| `provider` | `dsh-server` | 受管理的 DSH 模型提供方路由。 |
| `credentialRef` | `DSH_ONEAPI_TOKEN` | 已存储的生成令牌引用。 |
| `tokenName` | `DSH Desktop Auto Token` | 自动创建的 OneAPI 令牌名称。 |
| `defaultModel` | 可选 | 首选默认模型标识。 |
| `defaultInput` | `[text]` | 模型标识公开的输入模态；仅在支持时启用图像。 |
| `installId` | 可选 | 新安装后要求登录的构建标记。 |
| `developmentBypass` | `false` | 仅供源码开发环境跳过登录浮层。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

回环 Host 向 OneAPI 交换凭据，将生成令牌交给 DSH 凭据提供方，读取可用模型并配置受管理的 pi-ai 提供方。Client 通过 slot 渲染登录页、账户区和只读模型区。Host 使用同一已登录令牌调用配置的 `oneapi-bailian` 搜索提供方，并申请一次性专家打开票据。只有网站地址与短时票据传给 Client。

主机还会向 OneAPI 上报由官方注入器成功解析的技能引用，以及模型每次发出的 `skill` 工具调用。服务端分别保留 `user_explicit` 和 `model_auto` 类型，管理员统计将两类合并。同一事件的网络重试由稳定事件编号去重，不会合并不同调用。桌面进程运行期间会在内存中重试；退出前仍未送达的事件不会在重启后补报。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [产品组合](../../bundle/wanwei-desktop/README.zh.md) — 挂载顺序与模型设置覆盖。
- [独立专家计划](../../../WANWEI_EXPERT_WEB_INTEGRATION_PLAN.md) — 网页身份和验收范围。

-----

<a id="model-experience"></a>
## Model Experience

### 受管理的模型请求

#### What the model sees

`dsh-server` 提供方仅提供已登录 OneAPI 账户获准的模型。登录状态和生成令牌不会加入模型提示词。

#### Token effect

登录和读取模型目录不消耗模型 token。用户请求通过所选模型及标准 DSH LLM 提供方处理，并使用通常的用量统计。

#### KV Cache effect

认证本身不改变提示词或缓存键。模型选择和后续请求遵循通常的提供方缓存行为。

### 受管理的网页搜索

#### What the model sees

`oneapi-bailian` 搜索提供方通过现有 DSH 网页工具路径返回结果；后台选择的搜索模型和令牌不作为提示词文本出现。

#### Token effect

搜索请求使用已配置的 OneAPI 服务。当 agent 使用结果时，工具结果 token 按通常方式进入模型上下文。

#### KV Cache effect

不同搜索结果可能改变后续提示词及缓存复用；本包不管理模型缓存。

### 纯内网依赖反馈

#### What the model sees

仅纯内网模式在系统提示词中增加依赖处理指引。下载被拒绝或识别到缺失依赖时，通过普通工具结果返回中文说明，模型和对话界面均可看到。不插入独立弹窗或伪造的助手消息。

#### Token effect

内网指引和追加的工具反馈按通常方式消耗上下文 token。互联网模式不增加这些内容。

#### KV Cache effect

后台确认的环境变化会改变依赖提示段落，可能影响前缀缓存复用。本包不管理模型缓存。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 模型发现、受管理搜索和专家目录需要可访问的 OneAPI 服务。桌面没有本地编辑提供方的兜底方式。
- 独立专家打开需要另行部署 OneAPI `/api/expert-web` 接口和数据库表；普通登录接口不包含该能力。
- 网站票据和子 Webview 权限仍需真实服务与跨平台桌面验收。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护人员的工作上下文 — 点击展开</summary>

无。

</details>
客户端认证忽略过期状态响应及与登录、退出重叠的刷新结果；已取消的刷新不会发布离线状态。这只约束客户端状态更新顺序，不会取消 Host 已受理的认证操作。
