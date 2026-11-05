# Agent Note: 知识库首页设计稿视觉素材

Status: implemented

[English](2026-11-04-knowledge-homepage-design-art.md) | 中文

## Problem

桌面端知识库首页的 FeaturePanel 顶栏只有 WANWEI Buddy 角标、标题与副标题，缺少设计稿右侧毛玻璃风格插画。侧栏「知识库广场」入口使用通用 SVG 房屋图标与扁平蓝卡，选中库标题区也使用内联 SVG 文件夹，而非产品已暂存的文件夹标记图。

## Decision

`FeaturePanel` 增加可选 `headerArt`（绝对 URL）。知识库注册 `/knowledge-covers/hero-banner.png`，顶栏按设计固定 **185px** 高、右对齐，`object-fit: contain`。落盘 PNG 为设计高度图 `plaza-bg-top.png`（1640×185）的 2×（3280×370）；勿用聊天压缩后的 1024×115 预览替换。产品资源位于 `products/wanwei-desktop/assets/web/knowledge-covers/`。广场入口以 js.design 底板 `plaza-entry.png` 铺满，文案叠在图上（标题 `#222`、副标题 `#177cee`），圆形箭头使用设计稿切图 `icon-plaza-launch-arrow.png`，不再用内联 SVG。广场列表与详情使用不透明浅色底板 `#f5f8fc` 与柔光 `plaza-page-bg.png`，卡片为实心白底，避免下层知识库壳透出。侧栏分组计数为居中的 `#237df5` 数字叠在浅蓝圆底 `icon-group-count-bg.png` 上（深浅对齐内容区计数胶囊）。侧栏分组、问答开关、库头图块、PDF 与时钟等小图标使用 js.design PNG 切图（按 2–3× 暂存到 `knowledge-covers/`），以保留设计稿原色；空描述不渲染。侧栏知识库卡片对齐 js.design 知识库画板：白底、`border-radius: 10px`、默认描边 `#dbe4f0`、选中描边 `#2294ff`、标题行（可选一行描述）、右上角 12px 问答开关，以及无分割线、无封面头像的 2×2 元信息，每格「标签 值」同一行（`维护者 值 | 更新时间 值` / `文件数量 值 | 文件大小 值`）；不足 1MB 的文件大小用 KB。侧栏搜索为扁平 36×10px 输入框（描边 `#dbe4f0`、占位符 `#999`）。内容区与广场分页条按设计稿：总数中数字为蓝色、`第 x 页 / y`、`上一页`、页码（当前页白底 `#237df5` 描边与字色）、`下一页`、`跳至 [输入框] 页`（回车跳转，无「跳转」按钮）。内容白卡描边 `#e8edf5`、阴影 `0 3px 4px`。文件夹分区保持透明包裹，使文件马赛克贴近设计网格。问答态保留三栏壳、单列文件列表并隐藏文件分页。

## Alternatives considered

**只把头图画在 KnowledgePage 内。** 否决：设计稿把插画放在已承载 WANWEI Buddy / 标题 / 副标题的共享 FeaturePanel 顶栏，且其他功能页也可复用 `headerArt`。

**把广场书本 PNG 整张做成含中文文案的可点击图。** 否决：文案须走 `productText` 的 locale 归属，入口必须是带可访问名称与副标题的真实按钮。

**用内联 SVG 重绘头图与书本。** 否决：设计导出图才是 100% 还原的视觉真源。

## Consequences

本地 source 启动需把新封面暂存到所服务的 `apps/web/dist/knowledge-covers/`（或重建产品 Web 资源），否则图片 404，但布局仍可用。未传 `headerArt` 的面板行为不变。
