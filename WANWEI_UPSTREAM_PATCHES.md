# 万维上游兼容补丁清单

这份清单只记录为了装配产品而保留在官方 DSH 区域的通用扩展点。长期边界、依赖方向和功能接入规则以 [万维产品层解耦规范](WANWEI_DECOUPLING_RULES.md) 为准。

| 官方区域 | 通用扩展点 | 无产品实现时的行为 |
| --- | --- | --- |
| `packages/boot/app-boot` | 通过 `DSH_BUNDLE_ANCHORS` 接受产品持有的额外包解析锚点 | 未设置时仍只从 DSH 安装目录和用户 profile 解析 |
| `packages/client/platform-actions` | 注册可选的目录打开和原生文件保存动作 | 能力不可用；官方浏览器继续使用原有行为 |
| `packages/client/ui-workspace` | Workspace 菜单按能力显示通用“打开目录”动作 | 不显示该动作 |
| `packages/session-query/session-log-export` | 可注入通用文件保存函数 | 使用浏览器下载 |
| `packages/client/ui-deliverables` | 注册额外成果 Detector 和 Presenter | 只识别并展示官方通用成果 |
| `packages/client/ui-conversation` | Hero 品牌 Slot；无会话可编辑草稿与通用草稿前缀 Slot | 使用官方图标和标题；未选工作区的草稿在选择后进入会话，前缀 Slot 为空 |
| `packages/bundle/web-app` | 装载通用客户端平台动作注册表 | 注册表为空，不改变官方页面 |
| `scripts/check-workspace-constraints.ts`、`scripts/release/families.ts` | 通用 `dsh.release: false` 标记：产品包必须私有且不参与官方 npm 发布；官方包不得反向依赖这些包 | 未标记的官方包继续遵守原发布规则 |

类型目录所需的显式类型注解和跨包类型导入位于 `ui-approval`、`ui-chat`；只影响静态契约，不改变会话渲染。Windows 检查脚本使用目录 junction，ACP 测试直接引用规范快照配置，不依赖检出时能否创建符号链接。

## 已从官方区域移出的实现

- 产品 profile 的创建和升级保护由 `products/wanwei-desktop` 负责。
- CLI 不再依赖产品 Bundle。
- 文档解析工具迁入 `packages/wanwei/document-local`。
- 桌面桥、文件拖入、成果协议、品牌和主题均由万维插件注册。
- 官方测试不再包含私有协议名或产品 profile。

## 升级复核

升级官方 DSH 时逐项确认：通用扩展点仍可编译；空实现仍保持官方行为；产品 Bundle 能注册实现；相关测试仍通过。不得把 OneAPI 协议、Tauri 命令、万维文案、品牌资源或业务 Presenter 加回官方文件。

边界检查由 `products/wanwei-desktop/scripts/verify-boundaries.mjs` 扫描完整 `packages` 和 `apps`，只放行万维包与产品 Bundle。
