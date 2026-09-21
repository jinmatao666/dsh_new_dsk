# 万维产品层解耦规范

本文是万维功能开发和上游 DSH 升级的架构约束。任何功能需求都必须先满足本文，再考虑实现速度、代码复用或页面一致性。当前实际保留的官方扩展点记录在 [万维上游兼容补丁清单](WANWEI_UPSTREAM_PATCHES.md) 中。

## 核心原则

官方 DSH 是可独立构建、可随时替换的底座；万维功能是独立安装和组装的产品层。官方缺少接入能力时，可以增加通用 Slot、Service、Controller、Remote、事件或扩展注册表，但不得在官方实现中加入万维业务、品牌、协议或桌面平台细节。

“放进独立目录”不等于解耦。依赖方向、运行时注册、数据协议、样式覆盖、测试和构建流程都必须遵守本规范。

## 目录所有权

万维私有实现只能位于以下区域：

```text
packages/wanwei/*
packages/bundle/wanwei-desktop
products/wanwei-desktop
```

各区域职责如下：

- `packages/wanwei/*`：可组合的万维业务插件、产品 UI、OneAPI 适配、桌面能力适配和私有 Presenter。
- `packages/bundle/wanwei-desktop`：唯一的万维插件组装入口，只声明和装配产品插件，不承载大段业务实现。
- `products/wanwei-desktop`：Tauri 壳、安装器、产品 profile、自包含运行时、原生命令和产品资源。

`apps/*`、除万维 Bundle 外的 `packages/bundle/*`，以及 `packages/wanwei/*` 之外的所有 `packages/*` 均视为官方 DSH 区域。

## 依赖方向

允许的依赖方向是：

```text
products/wanwei-desktop
  -> packages/bundle/wanwei-desktop
  -> packages/wanwei/*
  -> 官方 DSH 公共能力
```

禁止反向依赖：

- 官方 CLI、应用或包不得依赖万维 Bundle 或 `packages/wanwei/*`。
- 官方 Bundle 不得加载万维插件。
- 官方组件不得导入万维类型、资源、样式或实现。
- 万维插件不得通过深层相对路径访问官方包内部文件；应使用公开导出和已登记的扩展接口。
- 产品层不得通过复制官方组件形成长期分叉；确需改变官方组件时，应先设计最小通用扩展点。

## 官方源码允许的修改

官方源码修改必须同时满足以下条件：

1. 接口不包含万维名称、业务语义或产品默认值。
2. 没有产品插件时，官方行为、视觉和构建结果保持不变。
3. 接口可被其他产品合理复用，而不是为一个万维调用点伪装的通用名称。
4. 接口有独立测试，覆盖空实现和注册实现两种情况。
5. 修改登记到 [万维上游兼容补丁清单](WANWEI_UPSTREAM_PATCHES.md)，说明接口、默认行为和升级复核点。

可接受的扩展形式包括：

- Slot：增加可替换或可插入的 UI 区域。
- Service 或注册表：注入平台动作、Presenter、Detector 或策略。
- Controller/Remote：公开稳定的数据或命令边界。
- 通用事件：表达平台无关的状态变化，不携带私有协议名称。
- 稳定的 `class` 或 `data-*`：只为产品主题提供选择器，官方 CSS 中不写产品样式。

不得以“改动较小”为理由把条件分支、产品名称、Tauri 调用或私有协议放进官方组件。

## 私有能力归属

以下能力必须由万维层持有：

| 能力 | 所有者 | 官方层最多提供 |
| --- | --- | --- |
| OneAPI 登录、Token、用户、模型和权限映射 | `packages/wanwei/*` | 通用认证或模型接口 |
| Tauri 原生调用和平台事件 | `products/wanwei-desktop` 与万维桥 | `platformActions` 等平台无关 Service |
| 文件拖入、导入和本地目录打开 | 万维产品 UI/桌面桥 | 通用文件投递接口或 Action Slot |
| 成果协议、解析和成果卡片 | 万维 Deliverable 插件 | Detector/Presenter 注册表 |
| 会话日志保存和文件定位 | 万维桌面插件 | 生成导出内容和通用保存回调 |
| 技能市场、下载、安装和卸载 | `packages/wanwei/skill-marketplace` | 技能发现和运行能力 |
| 品牌、主题、产品文案和布局覆盖 | `packages/wanwei/product-ui` | 品牌 Slot、稳定选择器或主题变量 |
| 产品 profile 和运行时组装 | `products/wanwei-desktop` | 通用 profile 加载和包解析接口 |

## 新功能接入流程

每个小功能在编码前按顺序判断：

1. 判断它是官方通用能力还是万维产品能力。只服务万维部署、品牌、OneAPI 或桌面端的功能默认为万维能力。
2. 在三个万维区域中选择所有者，避免先改官方组件再做迁移。
3. 检查官方是否已有公开 Service、Controller、Remote、Slot 或扩展注册表。
4. 已有扩展点时，万维插件只能通过该扩展点注册实现。
5. 缺少扩展点时，在官方层增加最小通用接口，并验证没有注册者时行为不变。
6. 为产品实现、通用扩展点和边界规则补充测试。
7. 若修改官方文件，立即更新补丁清单，不把登记工作留到发布前。

评审时至少回答三个问题：删除万维目录后官方能否工作；下次替换官方组件时万维业务是否需要复制；这项官方改动对非万维产品是否仍然成立。任一答案不满足即视为未解耦。

## 禁止事项

官方 DSH 区域不得出现或实现：

```text
Wanwei / wanwei
ZJUGIS / zjugis
OneAPI / oneapi
WANWEI_RESULT
DSH_ANALYSIS_VIEW
__ZJUGIS_NATIVE_INVOKE__
万维品牌资源、业务文案、产品 CSS 和 Tauri 命令
```

此外禁止：

- 为绕过边界检查而拆分字符串、改用模糊别名或运行时拼接私有标识。
- 在官方测试中写入私有协议或产品 profile；产品行为应在万维测试中验证。
- 将生成文件、临时 staged 资源或安装包产物提交到官方源码目录。
- 通过修改官方默认值让万维产品“自动生效”。产品启用必须来自万维 Bundle 或产品启动配置。
- 为追求官方文件零修改而复制大段官方实现。缺少能力时应增加小而稳定的通用接口。

## 验证要求

日常功能改动至少执行：

```powershell
pnpm --dir products/wanwei-desktop run check:boundaries
pnpm --dir products/wanwei-desktop run check:sidecar
pnpm --dir products/wanwei-desktop run check:rust
```

修改官方扩展点、依赖、Bundle、profile 或构建流程时还必须执行：

```powershell
pnpm run build:official
```

`check:boundaries` 是强制约束而不是提示。新增私有标识、产品资源或新的允许目录时，不得直接扩大排除范围；必须先说明所有权，并更新本文和补丁清单。自动检查无法识别所有语义耦合，代码评审仍须检查依赖方向、默认行为和扩展点是否真正通用。

## 上游升级流程

1. 获取并保留官方新版本的原始代码。
2. 对照补丁清单逐项恢复或调整通用扩展点。
3. 保持 `packages/wanwei/*` 和产品目录原样，优先只修改适配层和 Bundle 组装。
4. 运行边界检查，确认官方区域没有私有实现回流。
5. 独立构建官方 DSH，证明底座不依赖万维层。
6. 验证产品 Sidecar、登录、问答、文件、成果、技能和桌面能力。
7. 由 GitHub Runner 构建各平台安装包；升级 DSH 不触发 OneAPI 镜像或数据库重建。

## 完成标准

- 删除三个万维区域后，官方 DSH 可以独立安装依赖、构建和运行。
- 万维功能只通过公开扩展接口接入，官方层只有少量通用补丁。
- 官方源代码、测试和清单中不存在未登记的私有实现。
- OneAPI 服务、数据库、业务数据和部署镜像不依赖 DSH 源码版本。
- 上游升级主要工作是复核通用扩展点和适配层，而不是重新复制页面或迁移业务。
