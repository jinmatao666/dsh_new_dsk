# Parvis 预览运行时

[English](README.md) | 中文

Office、演示文稿、工作表、图片、选区及缩放实现来自 `Parvis-old/packages/app/src/components/session` 和 `utils/preview-edit.ts`，原始 MIT 许可保留在 [LICENSE](LICENSE)。文件图标来自 `packages/ui/src/assets/icons/file-types`，图表渲染来自 `components/writing-chart-renderer.ts`。

Buddy 在不透明来源的 iframe 中运行这些 Solid 组件，消息边界只传递文件内容、显示信息和文本选区，iframe 不获得原生桥或文件系统权限。`build.mjs` 将 Solid 与隔离的 Tailwind 样式编入产品客户端，内置 PDF worker、字体、字符映射及 WebAssembly 文件，并把 Parvis 专有导入替换为本地适配。不需要运行时访问 Parvis 仓库或在线文档预览服务。

HTML 使用净化后的 `srcdoc`，替代不透明来源环境无法执行的 `contentDocument.write`。Markdown 使用 Buddy 已有的 Marked 依赖配合 DOMPurify，保留原版选区和 CSS 层。图标按钮适配器提供本地 SVG 控件，产品颜色变量由本地提供。这些属于宿主适配，并非重新实现 Office 解析。

React 宿主负责工作区浏览、打开文件、独立草稿、原路径输入框引用、拖拽反馈、面板调宽和原始内容摘要校验后的原生保存。显式模型操作使用选中的 Buddy 会话，将提交请求与对应的已完成轮次关联，把编辑结果或图表写入可审阅草稿，按所选模型正常计量。旧格式 DOC、XLS、PPT 转换仍需要 LibreOffice 或 `SOFFICE_PATH`。

在仓库根目录运行 `node packages/wanwei/product-ui/tests/preview-runtime.browser.mjs`，可执行无头浏览器检查，覆盖 Word、合并单元格及多工作表 Excel、Markdown、净化 HTML、图片缩放、PPT 翻页和双页 PDF。模型响应关联及 Word 跨文本段编辑有定向 Vitest 测试，原生测试覆盖路径边界、外部修改拒绝、文件操作和可恢复删除。这些证据不能替代重建桌面应用后的真实模型验收。
