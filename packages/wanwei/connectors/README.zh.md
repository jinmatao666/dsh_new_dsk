---
description: "展示独立的万维连接器页面，入口显示由后台控制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-connectors

[English](README.md) | 中文

## 概述

自动化编辑器在权限右侧下拉菜单中提供飞书、钉钉、微信三个独立推送开关，默认关闭。授权复用连接器弹窗并保留任务草稿。Host 自动发送最终回答或失败、等待状态，不依赖模型调用发送工具；运行记录单独保存推送状态，失败可单独重试。飞书以机器人身份发给已授权本人，钉钉以个人登录身份发给本人账号，微信复用最近的本人入站会话。微信首次推送前需要先向助理发一条消息，回复会话过期时推送失败并提示重试。文件只列出电脑上的产物路径，暂不上传附件。旧的连接器工具选择不自动开启推送。

用户可以浏览连接器分类并查看演示弹窗。钉钉卡片连接本机钉钉 Workspace CLI（`dws`）个人授权，并把 `dws-cli` 技能安装到 `$DSH_HOME/skills`。微信助理卡片通过腾讯 iLink 扫码（应用内二维码）绑定个人微信，并运行入站聊天桥接，使手机消息驱动桌面 Session、结果回传到微信；桌面任务执行期间微信显示「对方正在输入…」。系统设置分别控制互联网和纯内网部署的入口；默认互联网开启、纯内网隐藏。

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

万维桌面产品通过[组合补丁](../../bundle/wanwei-desktop/cordis.patch.yml)挂载本插件。它没有单独的插件配置字段。

飞书使用固定为 1.0.98 的官方 `lark-cli`。构建时导出二进制内嵌的官方 `lark-*` Skill 正文与参考文档，放在可执行文件旁。用户授权探测成功后，把这些技能安装到 `$DSH_HOME/skills`，并补充通过 `feishu_cli` 执行命令的桌面说明。存在同名且非本连接器拥有的技能时停止安装。解绑只移除连接器拥有的技能目录。普通对话与自动化先读取 `lark-shared` 和对应业务技能；应用配置与登录仍由连接器页面管理。

飞书双向任务使用同一个自建应用的机器人身份，通过长连接订阅 `im.message.receive_v1`。Host 会用已授权用户校验每条事件，只接收该用户的个人私聊文本，复用或创建桌面 Session，再通过机器人回传结果。应用必须开启机器人、事件订阅以及机器人收发消息权限；解绑会关闭通道，不会转发任意群聊或其他用户的消息。

连接时自动校验发送消息权限并开启双向通道；推荐授权未涵盖的发送权限会继续引导授权。通道就绪后才显示已连接，页面保留“去试试”和“解绑”，仅在异常时提供补充授权或重新连接入口。解绑会停止消息通道。

CLI 在保存用户身份后，即使部分权限未授予，也会输出 `authorization_complete` 并以 3 退出。连接器分别解析标准输出和错误输出，校验登录身份，单独展示缺失权限，不再笼统报告进程失败。固定版本 CLI 的 `--recommend` 会刻意排除 `im:message.send_as_user`，连接流程因此检查并在需要时继续请求发送消息授权。业务调用返回缺权限后停止继续调用，并允许对经过校验的权限发起补充授权；通过 `auth check` 验证后才清除缺失状态。创建应用和个人授权使用分阶段二维码提示；授权进度和凭据仍由 Host 管理。

飞书详情弹窗复用现有连接器的品牌连接区、主要连接按钮和四条示例卡片。授权二维码只在授权进行中展示。已连接用户可以试用示例或解绑；首次配置应用保留为连接按钮下方的次要入口。

点击连接后先探测 CLI 配置。返回 `not_configured` 时启动官方应用配置流程，配置成功后继续用户授权；已有配置直接进入用户登录。授权链接保留原始编码。进程失败时只展示经过校验的错误类别和子类型，不展示原始授权输出。

连接器页的钉钉表示个人 DWS 授权加上供桌面 Agent 使用的 `dws-cli` 技能（日历、AI 表格、文档、邮箱、待办等相关产品）。技能复制后，Host 会写入个人单聊说明：给某人发消息使用已保存登录上的 `dws chat +dm`；除非用户明确要求机器人或提供了 Webhook Token，否则不再次执行 `dws auth login`，也不走 `send-by-bot`。用户要求机器人往群里发通知时，先 `dws chat +bot-find`，再用 `dws chat +messages-send --as bot` 把消息直接发进该群，不把机器人加为群成员。`+bot-find` 没有任何可用机器人时这次发送停止，因为 `dws` 不能创建机器人。产品在桌面 runtime 随包 `dingtalk-workspace-cli`（`dws`）并落盘 `app/assets/dws-cli`。**连接**在 WebView 请求外启动不带可继承输出管道的 `dws auth login`（浏览器 OAuth / 扫码，通常回调本机 `127.0.0.1`）。无锁的 `dws auth status --readonly` 报告登录已保存时，或登录进程退出后普通状态检查确认授权时，Host 会从随包资源（或 `@dingtalk-real-ai/dsh-dingtalk`）安装技能；若授权已成功则只写技能、不再打开浏览器。**解绑**先删掉本机技能副本并立刻返回；钉钉的退出登录在后台继续。之后的**连接**也会在 DWS 启动前返回。单次本机请求被丢掉时只留在该连接器卡片上；连接器目录和专家库会重试本机服务，不会停在整页的服务不可用提示上。微信助理表示 iLink 扫码绑定（`loginStart` / `loginPoll`），凭据落在 `$DSH_HOME/wechat-assistant`，并由 Host `getupdates` 桥接：创建桌面 Session 执行后经 `sendmessage` 回传到微信。**去试试**会把示例提示写入主输入框，并在 `+` 旁蓝色的 `conversation.composer.tools` 芯片上选中对应连接器（点击可切换连接器或重新打开本页）；首次发送时自动准备工作区 Session，无需先手动选择工作空间。钉钉**解绑**清除 CLI 凭据与技能副本；微信**取消连接**清除 iLink 凭据并停止桥接。产品仅把 `@dingtalk-real-ai/dsh-dingtalk` 当作 `dws-cli` 资源来源；不挂载钉钉 Stream IM，也不收集机器人 Client ID / Secret。其余连接器条目仍为演示。

两种网络模式下打开页面都会通过部署配置刷新 RPC 检查配置的平台。请求失败显示断开插头占位；成功后显示本地演示目录。重新打开页面会再次检查。此检查只验证平台可达性，不代表第三方连接器健康或已授权。管理员入口显示开关仍有效。

停用本插件的配置项会移除其入口；不需要停用其他业务插件。共用鉴权、渲染和侧边栏服务仍由各提供方负责。

内网模式下，连接器入口要求启用直连检测且检测成功。关闭检测、使用离线资源或检测失败时，入口置灰且不可点击，悬停显示网络不可达提示。中转可用不算直连互联网。管理员隐藏的入口仍然隐藏；外网模式保留既有服务检查。

-----

飞书绑定会话会继续将桌面端新增的用户文字、模型正文、澄清问题及问答工具结果同步到原机器人私聊。插件上下文、思考内容和无关会话不会发送；飞书入站消息不重复回显，事件使用独立消息键去重。绑定关系重启后保留，随通道恢复，解绑后停止。普通澄清表单可从飞书回复选项编号、完整名称、逗号分隔的多选或自由文字，多题按顺序收集。桌面和飞书竞争同一个请求，先完成的一端生效并结束另一端表单。附件、权限审批和计划审阅确认仍需在桌面处理。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Client 拥有连接器列表、选择状态和弹窗。钉钉详情走 Host RPC `/wanwei-dingtalk`；微信助理走 `/wanwei-wechat`（`status`、`loginStart`、`loginPoll`、`disconnect`）。密钥留在各自 CLI 或 iLink 凭据库；Client 只收到非机密状态与二维码图片 data URL。状态探测在 Host 短缓存，Client 用最近一次状态立刻画出「已连接」/「去试试」，再后台刷新。

[Client 入口](src/client/index.ts)提供界面。[Host 入口](src/index.ts)注册连接器 RPC 和 `dingtalk_dws` 工具；该工具在 Host 进程中运行随包 `dws`，使桌面对话与连接器卡片看到同一份钉钉登录。会话里的 `pwsh`/`bash` 在文件沙箱下读不到 `~/.dws`。

钉钉连接后，桌面会话通过 skill-filesystem 发现 `dws-cli`。微信助理连接后，入站微信文本经 `sessionController` 创建普通桌面 Session，模型与 token 消耗跟随这些 Session。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [产品组合](../../bundle/wanwei-desktop/README.zh.md) — profile 归属。
- [鉴权与网络策略](../oneapi-auth/README.zh.md) — 共用服务。
- [独立页面决策](../../../.agents/notes/implemented/architecture/2026-10-10-independent-wanwei-pages.zh.md) — 生命周期和依赖依据。
- [桌面 DWS 技能](../../../.agents/notes/implemented/feature/2026-10-16-wanwei-dingtalk-desktop-dws-skills.zh.md) — 为何以个人 DWS 授权为钉钉连接器成功路径。
- [移除企业微信连接器](../../../.agents/notes/implemented/simplification/2026-10-23-remove-wanwei-wecom-connector.zh.md) — 为何删除企业微信随包路径。
- [微信助理 iLink 通道](../../../.agents/notes/implemented/feature/2026-10-19-wanwei-wechat-assistant-ilink.zh.md) — 个人微信入站远程通道。

-----

<a id="model-experience"></a>
## Model Experience

Host 注册 `dingtalk_dws`。刷新已复制的 `dws-cli` 技能时会要求模型用该工具执行每条 `dws` 命令，不要用 `pwsh` 或 `bash`：`authenticated` 已为 true 时用 `dws chat +dm` 给某人发消息；只有用户要求机器人或 Webhook 时才走机器人发送。机器人通知先 `+bot-find`，再用 `+messages-send --as bot` 直接发进群。用户这句发送要求就是确认，命令带 `--yes`，不再次登录、不再次询问。命令行不能创建机器人。

#### KV Cache effect

`dingtalk_dws` 是常驻 Host 工具。个人单聊与执行方式说明只在会话读取 `dws-cli` 技能时进入上下文。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 目录只包含飞书、钉钉和微信助理。飞书仅导出 Agent 可读的 Markdown，不包含上游机器资源和脚本。真实账号的飞书授权与业务执行仍需联调验证。
- 钉钉在桌面 `prepare:runtime` 闭包中随包 CLI（WorkBuddy 体验）；PATH / `npm -g` 仅作回退。
- 微信助理 v1 仅处理私聊文本（及语音转写）；媒体与群聊延后。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
