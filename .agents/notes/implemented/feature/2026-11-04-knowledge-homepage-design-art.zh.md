# Agent Note: 知识库首页设计稿视觉素材

Status: implemented

[English](2026-11-04-knowledge-homepage-design-art.md) | 中文

## Problem

桌面端知识库首页的 FeaturePanel 顶栏只有 WANWEI Buddy 角标、标题与副标题，缺少设计稿右侧毛玻璃风格插画。侧栏「知识库广场」入口使用通用 SVG 房屋图标与扁平蓝卡，选中库标题区也使用内联 SVG 文件夹，而非产品已暂存的文件夹标记图。

## Decision

`FeaturePanel` 接受可选 `headerArt`（绝对 URL）。知识库注册 `/knowledge-covers/hero-banner.png`，顶栏按设计固定 **185px** 高、右对齐，`object-fit: contain`。落盘 PNG 为设计高度图 `plaza-bg-top.png`（1640×185）的 2×（3280×370）；勿用聊天压缩后的 1024×115 预览替换。产品资源位于 `products/wanwei-desktop/assets/web/knowledge-covers/`。广场入口以 js.design 底板 `plaza-entry.png` 铺满，并叠加 locale 归属文案与 `icon-plaza-launch-arrow.png`。知识库图标优先使用已保存的封面；无封面时，个人库使用个人知识库 PNG，其他库使用带地球或书签标识的立体书册 SVG。PDF 与时钟图标保留暂存的设计切图；空描述不渲染。

侧栏分组使用靛蓝、青绿和紫罗兰色的 32px 柔角梯形标签，收起时保留连续底边。文件面板使用对应的低标签，并与侧栏问答图标沿用所属分组配色。侧栏每张卡片保留封面、标题、可展开详情、问答按钮及四项知识库信息。文件内容使用自适应多列卡片与小缩略图，并保留已有元信息和操作；问答态将文件和文件夹切换为单列。选中知识库信息条保持紧凑。广场卡片尺寸一致，封面照片不加滤镜，并保留清晰的状态标识与独立的红色点赞按钮。搜索、排序、文件夹导航、上传、订阅及分页沿用已有事件处理。问答保留既有渲染与行为，包括问答态隐藏文件分页。

基础 `.dsh-knowledge-file-icon` 对 PDF/Word 图片做 30×30 定宽高、`object-fit: contain` 与 `overflow: hidden`，避免预览「问问万维」附件条按原生 2–3× 像素绘制。缩略图文件行使用独立的小文件标识。内容区与广场分页保留页数、数字页码、上一页/下一页按钮与回车提交的页码输入框。

## Alternatives considered

**只把头图画在 KnowledgePage 内。** 否决：设计稿把插画放在已承载 WANWEI Buddy / 标题 / 副标题的共享 FeaturePanel 顶栏，且其他功能页也可复用 `headerArt`。

**把广场书本 PNG 整张做成含中文文案的可点击图。** 否决：文案须走 `productText` 的 locale 归属，入口必须是带可访问名称与副标题的真实按钮。

**用内联 SVG 重绘头图与书本。** 否决：设计导出图才是 100% 还原的视觉真源。

## Consequences

本地 `scripts/start-wanwei.ps1` 会在检查或启动服务前，将产品 Web 图片同步到所服务的 `apps/web/dist/`，包括复用运行中的桌面服务时。`stage-web-assets.mjs` 恢复缺失资源并替换旧图片，同时保留已编译的前端文件。其他源码启动方式须同步产品资源或使用产品 Web 构建；单独的官方 Web 构建不包含私有图片。未传 `headerArt` 的面板行为不变。
