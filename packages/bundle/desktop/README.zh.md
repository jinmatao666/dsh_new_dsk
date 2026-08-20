# @deepseek-ai/dsh-desktop

在 `dsh-base` 与 `dsh-web-app` 之后加载的桌面版补丁层。它保留完整原生插件清单，
只增加 OneAPI 登录门禁。

## 模型体验

### 不改变模型可见提示词

#### 模型看到的内容

无。本装配层不向模型请求添加系统文本、消息、工具或结果。

#### Token 影响

无，本 Bundle 不贡献提示词内容。

#### KV Cache 影响

无，本 Bundle 只改变装配。

## 已知限制与后续工作

- 桌面启动器从安装包内的 `server.json` 设置 `DSH_ONEAPI_URL`。
- V1 不装配 MCP 服务。
