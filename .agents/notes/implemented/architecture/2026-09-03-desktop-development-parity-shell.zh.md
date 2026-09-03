# Agent Note: 桌面开发同源调试壳

Status: implemented

[English](2026-09-03-desktop-development-parity-shell.md) | 中文

## Problem

桌面工作区由回环 Node 进程提供的运行时客户端插件组装。仅用于后台管理的浏览器页面无法运行该组合，而独立前端服务器缺少注入的启动清单。UI 开发需要一个无需生成安装包、也不依赖区域登录服务的入口，同时必须呈现安装包中的插件树和原生交互。

认证快捷入口不能产生第二套工作区实现，也不能进入正式启动器。开发环境还需要隔离且持久的状态，避免技能安装和设置测试修改用户的正式数据。

## Decision

`pnpm --filter @deepseek-ai/dsh-desktop-app dev` 先构建当前检出内容，再通过 Tauri 的 `beforeDevCommand` 启动仓库客户端插件监视器，最后使用独立的 `com.wanwei.harness.development` 标识运行真实 Tauri debug 壳。它可以与已安装的正式版同时运行，不共享单实例锁或 WebView 配置。debug 壳启动与正式版相同的 `desktop` profile，并应用仅存在于源码中的 `apps/desktop/dev/cordis.patch.yml` 覆盖层。该覆盖层保留正式认证插件，只把 Host RPC 配置为返回本地开发身份。

只有 Rust debug 启动器提供 `DSH_DESKTOP_DEVELOPMENT=1` 时，认证插件才接受该配置。开发覆盖层不在 Tauri 资源清单中，release 构建既不选择它，也不设置该标记。旁路不会授予 OneAPI 令牌或受管模型，只允许打开本地工作区 UI，不产生服务端权限。

debug 启动器把 `DSH_HOME` 设置为 Tauri 应用数据目录下持久化的 `development/dsh-home`。debug 构建中的原生技能市场命令解析同一目录。release 构建继续使用用户正常的 `~/.dsh` 位置和现有的安装包 sidecar 路径。

客户端 UI 修改由 `pnpm run dev:web` 重新构建，并在现有 Tauri WebView 中刷新。文件操作、技能市场安装、Session 导出、托盘和窗口行为继续调用真实 Tauri 实现。Host 侧 TypeScript 修改需要重启开发命令，启动前构建会刷新这些产物。

所有桌面专用客户端插件都在 `tsconfig.base.json` 中具有源码映射。因此源码启动和静态检查会解析当前检出内容，不会静默回退到旧的 `lib` 构建产物。

## Verification

桌面组合测试比较正式环境和开发环境的条目标识，并要求认证之外的所有条目完全一致。认证测试验证缺少 debug 标记时拒绝旁路，并在标记存在时执行已挂载的 `/desktop-auth` RPC。Rust 测试独立覆盖原生技能市场文件系统操作，不依赖所选择的用户根目录。

## Alternatives considered

**维护单独的 Mock 桌面页面。** 这种方式渲染快，但会重复组件和交互状态，无法准确预测安装后的应用。

**在开发环境禁用认证插件。** 这可以打开工作区，但会移除该插件的客户端贡献，使插件树不同于已登录的正式会话。

**要求每次 UI 修改都运行本地 OneAPI。** 这可以验证登录和模型同步，但会让无关的布局开发依赖外部服务和凭据。

**使用正式版的 `~/.dsh` 目录。** 这能显示已有数据，但开发安装、设置和迁移测试可能改变已安装应用的状态。

## Consequences

- UI 布局和交互在真实桌面 WebView 中运行，使用正式客户端插件组合与原生命令。
- 开发启动会先执行一次仓库构建，随后持续更新客户端产物，无需构建安装包。
- 开发状态会跨 debug 启动保留，但与正式版的对话、设置和已安装技能隔离。
- 登录页面修改和真实 OneAPI 模型同步仍需使用正常认证路径；开发身份只验证登录后的桌面工作区。
- 安装包资源、签名、NSIS 生命周期和升级行为仍由安装包验证负责。
