# 桌面端构建品牌配置

[English](README.md) | 中文

## 构建

复制 [example.json](example.json)，修改名称和图片，再通过 `DSH_BRAND_CONFIG` 指定配置文件相对仓库根目录的路径。GitHub 桌面端和麒麟构建工作流使用同名用途的 `brand_config` 输入框。留空使用 [default.json](default.json)。

```powershell
$env:DSH_BRAND_CONFIG = 'products/wanwei-desktop/branding/example.json'
pnpm --dir products/wanwei-desktop run build:runner
```

正式打包仍需现有 GitHub Runner、签名及版本配置。本地 `dev`、`build:local` 使用同一配置。同一工作副本每次只能执行一个完整产品构建，编译输出会共享；不要复用其他品牌的暂存运行时。前端构建即使失败也会恢复生成的源码模板，清理暂存公共资源，选定品牌的编译产物留给运行时打包。取消环境变量后重新构建，编译产物才恢复为万维版本。

## 配置字段

自定义品牌必须明确填写示例中的全部名称、版权文字和会话日志文件名前缀。`text` 将产品自有原句映射到替换文字，支持协议、支持信息、加载和错误文案；不改写用户消息、第三方作者或后台下发内容。中英文版权独立配置。协议字段名、应用标识、用户数据目录、程序文件名及更新产品与签名身份保持稳定；本功能用于现有应用换品牌，不用于创建可并行安装的新应用。

图片路径相对配置文件。`assets.mark`、`assets.wordmark` 分别提供默认图标和可选的完整 Logo。省略完整 Logo 时，构建会用图标和 `logoText` 自动组合。未填 `logoText` 时使用产品名称。`sidebar`、`home`、`login`、`loading`、`avatar`、`credits`、`version`、`update`、`knowledge`、`favicon` 分别覆盖侧栏、首页、登录、加载、头像、积分水印、版本、更新、知识库和网站图标。网页图片支持 SVG、PNG、WebP；建议裁掉留白并使用透明背景，完整 Logo 使用横向排版。`native.icon` 使用正方形 PNG，自动生成安装包需要的 ICO、ICNS、PNG；`native.windowIcon`、`native.trayIcon` 可分别提供窗口和托盘 PNG。自定义品牌必须提供默认图标。正方形 PNG 可同时用作网页和原生图标，其他格式需另配原生 PNG；文件缺失或字段拼写错误会中止构建。

生成的 `.brand-build/receipt.json` 记录图片哈希。打包前会核对编译后的品牌快照及暂存图片是否匹配当前配置。测试命令为 `pnpm --dir products/wanwei-desktop run check:branding`。Windows、Mac、麒麟仍需真实安装验收。证书发布者名称需要对应证书；独立专家网站和后台管理的内容不属于桌面品牌配置。CI 构建产物标签和 GitHub Release 元数据沿用现有流水线命名。

使用 `logoTextColor` 设置组合 Logo 的文字颜色，例如 `"#146B63"`。默认使用万维蓝 `"#0865F2"`。图标颜色由提供的图片决定。

用 logoTextImage 提供仅含文字的 SVG、PNG 或 WebP，构建会将它与 ssets.mark 横向拼接并保留图片比例和颜色。建议使用透明背景并裁掉留白。若配置了完整的 ssets.wordmark，则直接使用整图。优先级为完整 Logo、文字图片、自动排版。
