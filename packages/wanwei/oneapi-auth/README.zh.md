# 万维 OneAPI 认证

[English](README.md) | 中文

这个私有 Host 插件从上一版万维桌面端迁移已经验证的 OneAPI 登录、自动令牌保存、服务端模型发现、受管 pi-ai Provider 和默认模型选择。它面向现有 OneAPI 部署，不要求修改镜像或数据库。

浏览器登录界面保持独立。本包让密码和生成的令牌只停留在回环 Host，并且只向桌面界面传递认证状态和模型标识。

## 模型体验

认证后，插件仅使用当前 OneAPI 账户允许的模型替换万维受管 pi-ai Provider，并在服务端提供默认模型时优先选择它。桌面端的“模型”设置只展示服务端下发的目录，不提供 Provider 编辑入口。模型请求继续通过标准 DSH LLM Provider 调用 OneAPI 的 OpenAI 兼容端点。

## 限制

桌面端需要连接 OneAPI 服务才能发现可用模型。产品 Bundle 禁用官方可编辑的模型设置页和 DeepSeek 适配器；模型管理归服务端管理后台所有。
