# 土地市场桌面登录接口

独立于 `/api/expert-web`。桌面土地市场入口用一次性票据把已登录用户交给 ais-land，不把用户令牌传给网站。

## 管理

管理工作台「系统设置 → 功能设置 → 土地市场 → 地址配置」：

- 页面地址：写入 `SystemDeploymentSettings.featurePages.landMarket.url`，随 `/api/desktop-config` 下发
- 生成/重置凭据：`POST /api/portal/land-market/admin/credential`（`AdminAuth`），明文只返回一次；库内只存 SHA-256 摘要（Option `LandMarketProviderSecretHash`）
- 凭据状态：`GET /api/portal/land-market/admin/credential` → `{ configured: boolean }`，不回显明文

旧凭据在重置后立即失效。网站服务端须同步更换 `.env` / `provider-credential`。

## 打开与兑换

1. 桌面 Host 持有用户令牌，调用 `POST /api/portal/land-market/launch`（`UserAuth`）
2. 需已配置页面地址且已有提供方凭据；签发约 90 秒、一次性票据，返回 `{ url, ticket, expires_in }`
3. 桌面把 ticket 拼进打开地址（hash 路由用 `#/path?ticket=`，否则 `#ticket=`）
4. 网站后端：`POST /api/portal/land-market/redeem`，`Authorization: Bearer <provider_credential>`，体 `{ "ticket": "..." }`
5. 成功返回 `{ "user_id": "123" }`；重复、过期、错凭据均失败

票据与凭据均为 64 位小写十六进制。兑换不得跟随重定向。

## 资规讲坛

在「系统设置 → 功能设置 → 资规讲坛」设置当前部署环境的开关，并在「地址配置」中填写资规讲坛网址、生成服务端接入凭据。资规讲坛使用同样的登录流程，接口前缀为 `/api/portal/planning-lecture`。网站服务端用资规讲坛凭据调用 `POST /api/portal/planning-lecture/redeem`，请求格式和返回字段与上文相同。两项功能的凭据和票据只能在各自的兑换接口使用。
