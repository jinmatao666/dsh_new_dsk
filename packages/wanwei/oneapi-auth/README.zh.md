# 万维 OneAPI 认证

[English](README.md) | 中文

这个私有 Host 插件从上一版万维桌面端迁移已经验证的 OneAPI 登录、自动令牌保存、服务端模型发现、受管 pi-ai Provider 和默认模型选择。它面向现有 OneAPI 部署，不要求修改镜像或数据库。

浏览器登录界面保持独立。本包让密码和生成的令牌只停留在回环 Host，并且只向桌面界面传递认证状态和模型标识。

## 模型体验

认证后，插件使用当前 OneAPI 账户允许的模型替换万维受管 pi-ai Provider，并在服务端提供默认模型时优先选择它。模型请求继续通过标准 DSH LLM Provider 调用 OneAPI 的 OpenAI 兼容端点。

## 限制

第一段迁移只验证现有 Host 协议和服务集成。这个插件接入正式的 `wanwei-desktop` bundle 之前，还需要适配新版 DSH Remote API 和本地化登录界面。
