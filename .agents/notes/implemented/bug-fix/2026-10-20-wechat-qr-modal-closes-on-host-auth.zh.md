# Agent Note: 微信扫码弹窗在 Host 已授权时主动关闭

Status: implemented

[English](2026-10-20-wechat-qr-modal-closes-on-host-auth.md) | 中文

## Problem

打包桌面安装测试中，微信扫码并授权后，应用内二维码弹窗不关闭，也不提示「微信助理已连接」。「去试试」/「取消连接」往往要等到用户从手机发消息并再次打开连接器页才出现。此时 Host 已写入 iLink 凭据并启动 `getupdates`，远程通道可用，但 Client 仍卡在挂起或丢失的 `loginPoll` 一元 RPC 上。

## Decision

二维码绑定仍走 `/wanwei-wechat` 的 `loginStart` / `loginPoll`，但完成态不再依赖单次长轮询响应：

- 将 Host 侧每次 `get_qrcode_status` 长轮询上限设为 20s，避免一元 RPC 触达常见空闲超时；Client 本就会循环调用。
- 二维码弹窗打开期间每 1.5s 探测 `status()`；一旦 `authed`，即使 `loginPoll` 未返回 `confirmed`，也关闭弹窗并提示「微信助理已连接」。
- `loginPoll` 出错、超时或报告无进行中登录时，若 Host `status()` 已有凭据则按成功收尾。
- iLink 返回 `confirmed` 但缺少 `bot_token` / `ilink_bot_id` 时，对同一二维码最多再轮询三次再失败。
- 创建/刷新二维码时在 `local_token_list` 中带上已存 `bot_token`，以便 `binded_redirect` 成功。

## Alternatives considered

**把整段等待挪到 Host、用一次数分钟 RPC 完成：** 否决——桌面一元 RPC 与反向代理不适合长时间占用；短轮询加 `status()` 探测即可恢复“响应丢失”而不新增通道。

**只缩短长轮询：** 否决——能降低挂起概率，但无法在凭据已由先前、Client 未观察到的轮询落盘时关闭弹窗。

## Consequences

`WeChatPanel` 通过 `loginPoll` 的 `confirmed` 或成功的 `status()` 探测完成连接，并用一次性守卫避免重复 Toast。Host `pollWeChatLogin` 在 session key 已清除但磁盘上已有凭据时仍返回 `confirmed`。包测试覆盖凭据恢复、`confirmed` 缺 token 重轮询，以及 `loginPoll` 挂起时由 `status()` 关闭二维码。相关产品决策见[微信助理 iLink 通道](../feature/2026-10-19-wanwei-wechat-assistant-ilink.zh.md)。
