# 资规讲坛积分

[English](forum-analysis.md)

「系统设置 → 功能设置 → 资规讲坛 → 地址配置」弹框内的「积分配置」分别设置弹框问答（`qa`）和生成报告（`report`）。默认各 1 积分，0 表示免费。「保存积分配置」立即生效并保留地址草稿；地址需点击「确定」后再「保存设置」。两个配置计费点归属 `planning_lecture/default`，使用专家共用的计费任务实现。名称固定，版本检查防止覆盖其他管理员的新配置。

已认证的桌面 Host 使用 `/api/portal/planning-lecture` 下的接口：

| 接口 | 用途 |
|---|---|
| `GET /admin/credits` | 管理员读取两项积分及版本。 |
| `PUT /admin/credits` | 管理员原子保存 `qa` 和 `report`，各包含十进制字符串 `credits` 与整数 `version`。 |
| `POST /analysis/quote` | 根据 `item.id`、`item.type`、`question` 报价，返回 `credits`、`version`、`cached`。 |
| `POST /analysis/begin` | 同一问题身份，加已确认的 `version`、新 `session_id` 和所选 `managed_model`，预扣配置价格或返回原答案。 |
| `POST /analysis/:id/result` | 本次执行的拥有者提交 `lease`、`status`，成功时同时提交 `text`、`provider`、`model`，在同一事务保存答案并结算。 |

接口从认证身份确定付款人。问题键区分来源类型、来源 ID 和操作类型，并归一化问题中的空白；数据库唯一约束包含账户归属。历史对话、模型和价格变更不使成功答案失效。活动任务返回 `ANALYSIS_PENDING`；失败或取消退款后可重试。遗留预扣通过现有统一计费工作线程在三十分钟后过期退款。

平台模型转发允许已认证账户、预扣会话和所选模型的一次纯文本模型请求。持久化原子认领防止另一 HTTP 请求复用免扣费资格；原请求内部的渠道重试复用认领。模型日志保留用量，附加积分为零，业务结算记录配置的积分。其他会话继续按正常模型价格收费。生成报告在讲坛抽屉中返回文本。

同步部署 OneAPI 后端、桌面门户及认证模块和 `ais-rpforum` 前端。后端启动迁移 `forum_analyses`，首次读取配置或使用分析时初始化两项默认规则。讲坛服务端无需新增模型 API Key 或扣费密钥，现有桌面身份兑换保持原样。

提交问题不需要确认积分。后端根据生成、撰写报告等措辞确定操作类型，不信任调用方指定的类型。`/api/desktop-forum/stream` 使用 NDJSON 实时返回模型文本，持久化及扣费确认后才返回最终成功结果。
