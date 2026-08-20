# @deepseek-ai/dsh-client-ui-oneapi-auth

桌面版专用的双端插件：在本地 Host 侧完成 OneAPI 登录，通过 DSH Credentials
保存生成的令牌，并把一个受管 `llm-pi-ai` Provider 合并进原生模型设置。浏览器
侧只显示 `shell.overlay` 登录层，永远不会收到生成的令牌。

## 模型体验

### 不改变模型可见提示词

#### 模型看到的内容

无。本插件不向模型请求添加系统文本、消息、工具或结果。

#### Token 影响

无；所选 Provider 会改变请求目标，但不增加提示词 Token。

#### KV Cache 影响

无。认证和 Provider 配置不会改变提示词。

## 已知限制与后续工作

- V1 仅支持用户名和密码。
- 退出会删除本地凭据与受管 Provider；服务端令牌由 OneAPI 管理员统一吊销。
- 服务器暂时不可达时保留有效本地凭据，并显示离线状态。
