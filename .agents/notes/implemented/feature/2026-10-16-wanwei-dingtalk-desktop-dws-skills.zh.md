# Agent Note: 万维钉钉连接器以桌面 DWS 技能为准

Status: implemented

[English](2026-10-16-wanwei-dingtalk-desktop-dws-skills.md) | 中文

## 问题

把「钉钉已连接」做成机器人 Stream 注册（Client ID / Secret / 应用注册扫码），优化的是在钉钉 App 里私聊机器人。产品期望的是 WorkBuddy 闭环：点「连接」、授权一次，即可在桌面对话使用钉钉技能——不要求用户另行执行 `npm install -g dingtalk-workspace-cli`。

## 决策

连接器钉钉卡片的主「已连接」状态是 **个人 DWS 授权 + 安装到 `$DSH_HOME/skills` 的 `dws-cli` 技能**，由 skill-filesystem 供桌面会话发现。Host RPC `/wanwei-dingtalk` 提供 `status` / `login`（`dws auth login`）/ `installSkill` / `disconnect`（移除技能副本）。

桌面产品在 **`prepare:runtime` 中随包 `dingtalk-workspace-cli`**，并解压出原生 `vendor/dws[.exe]`（deploy 会禁用 npm lifecycle，故需显式解压）。Host 解析优先使用随包二进制（`DSH_DWS_CLI` / `DSH_NODE_BINARY` 旁 / 产品 `node_modules`），PATH 仅作回退。`products/wanwei-desktop` 保留 `@dingtalk-real-ai/dsh-dingtalk` npm 依赖**仅用于**随包 `dws-cli` 技能资源；产品 profile **不**挂载该包做 Stream IM，连接器也不跑应用注册扫码，不写入 `DINGTALK_CLIENT_ID` / `DINGTALK_CLIENT_SECRET`。

这与 [桌面企业微信 CLI 技能](2026-10-19-wanwei-wecom-desktop-cli-skills.zh.md) 的随包策略一致，并合并取代已移除的机器人扫码绑定连接器路径与原先的 profile Stream 通道挂载。

## 考虑过的替代方案

**要求运维 `npm install -g dingtalk-workspace-cli`：** 否决，因不符合产品 UX；WorkBuddy 式连接器不要求终端用户单独安装 CLI。

**以机器人应用注册扫码为连接路径（Client ID / Secret / Stream 私聊）：** 否决，因不符合桌面技能诉求；该流程创建的是在钉钉 App 里私聊机器人的凭据，不是个人 DWS 登录。产品代码、private-setup resume 脚本与为此挂载的 profile Stream 均已删除。

**用 `@michengai/dsh-im-connect` 作为产品 IM 层：** 否决，因其 peer 与本仓库 alpha 线不匹配。

**连接器用 DWS，同时仍在产品 profile 挂载 `@dingtalk-real-ai/dsh-dingtalk` 做 Stream：** 否决；双重「已连接」会误导运维，桌面成功标准仅为 DWS 技能。

## 后果

安装包 / `prepare:runtime` 构建必须包含 `dingtalk-workspace-cli`、解压当前平台的 `vendor/dws` 二进制，并把 `dws-cli` 技能资源落到 `app/assets/dws-cli`，以便打包后的 Host 通过 `DSH_DWS_SKILL_DIR` / `DSH_APP_ROOT` / `DSH_NODE_BINARY` 解析，而不依赖 `require.resolve`。使用当前安装包的终端用户只需点「连接」并完成授权。「连接」在 Host 进程内启动 `dws auth login` 后立即返回 `authorizing: true`；Client 轮询 `status` 直至 CLI 退出，再显示已连接或 Host 的 `authorizeError`。若把整段浏览器授权挂在同一次登录 RPC 上，桌面 WebView 在从系统浏览器回来后会报 `Failed to fetch`。**解绑**先删掉技能副本并立刻返回，`dws auth logout` 在后台继续；随后的**连接**排在这次退出之后，仍立即返回 `authorizing: true`。若授权已成功但技能尚未写入，「连接」会只安装技能、不再打开 OAuth 浏览器。在 `dws auth login` 成功且 `dws-cli` 写入产品 home 技能根之前，依赖钉钉 API 的桌面提示无法经该技能执行。Stream 机器人私聊不在本连接器卡片的产品范围内。

「去试试」会写入示例提示，并在常驻的 `conversation.composer.tools` 芯片上选中钉钉（session-maybe，紧挨 `+`），因为 `conversation.input.left` 是 session 作用域，在 `sessions.clear()` 后不会渲染。点击芯片可切换连接器或重新打开连接器面板。

状态探测最多 spawn 一次 `dws auth status`（随包或 PATH 上能找到即视为已安装，不再单独跑 `--version`），合并 Host 进行中的请求，并短 TTL 复用结果。Client 将最近一次状态写入内存/localStorage，列表徽章与详情页可立刻显示「已连接」/「去试试」，再在后台软刷新。

连接器目录仍为多列卡片网格。未连接卡片右上角为 `+`（打开连接页）；已连接钉钉显示绿色状态点与试用按钮，点击直接写入示例提示，无需先打开详情。
