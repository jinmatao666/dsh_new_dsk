# 万维上游兼容补丁清单

这份清单只记录为了装配万维产品而保留在官方 DSH 区域的通用扩展点。清单之外的万维业务实现应位于 `packages/wanwei`、`packages/bundle/wanwei-desktop` 或 `products/wanwei-desktop`。

| 官方区域 | 通用扩展 | 无万维实现时的行为 |
| --- | --- | --- |
| `packages/client/platform-actions` | 注册可选的目录打开和原生文件保存动作 | 能力不可用；官方浏览器继续使用原有行为 |
| `packages/client/ui-workspace` | Workspace 菜单按能力显示通用“打开目录”动作 | 不显示该动作 |
| `packages/session-query/session-log-export` | 可注入原生文件保存函数 | 使用浏览器下载 |
| `packages/client/ui-deliverables` | 注册额外成果 Detector 和 Presenter | 只识别并展示官方通用成果 |
| `packages/client/ui-conversation` | 完整 Hero 品牌 Slot | 使用官方图标、标题和预览标识 |
| `packages/bundle/web-app` | 装载通用客户端平台动作注册表 | 注册表为空，不改变官方页面 |

## 升级复核

升级官方 DSH 时只需要逐项确认：扩展点仍能编译、空实现仍保持官方行为、万维 Bundle 能注册实现、相关测试仍通过。任何 OneAPI 协议、Tauri 命令、万维文案、品牌资源或业务 Presenter 都不得加入本清单中的官方文件。
