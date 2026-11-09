# Agent Note: 土地市场独立桌面登录票据

Status: implemented

[English](2026-11-09-portal-land-market-desktop-login.md) | 中文

## 问题

土地市场桌面入口原先只 iframe 打开管理员配置地址，ais-land 拿不到桌面已登录用户。专家库票据登记面不适合这个门户入口。

## 决策

新增 OneAPI `/api/portal/land-market/{launch,redeem}` 与管理员凭据重置/状态接口。提供方凭据摘要存 Option `LandMarketProviderSecretHash`（不进入公开 `desktop-config`）。管理工作台功能设置 → 土地市场地址配置增加生成/重置凭据。桌面 portals 打开前经 Host `land-market-launch` 取票并拼进 iframe；ais-land 经 ais-manager-server 兑换。

## 考虑过的替代方案

**复用 expert-web 资料：** 拒绝，土地市场应留在功能设置，不进专家目录。

**把凭据摘要写入 `featurePages` JSON：** 拒绝，该对象会经 `/api/desktop-config` 在登录前下发客户端。

## 后果

OneAPI 需新表/选项与管理 UI。桌面 portals 依赖 `connection` 做 launch RPC。部署须把 ais-manager 的 `desktop.land-market.redeem-url` 配成 `…/api/portal/land-market/redeem`，并写入重置后的凭据。
