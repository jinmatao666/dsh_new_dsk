# 统一积分 HTTP 接口

专家、技能、知识库使用同一套接口与积分账户。业务后端只传资源和扣分点 ID，不传收费金额或付款用户 ID。后台配置价格，平台验证登录身份、资源权限、余额并记录流水。

## 1. 接入准备

- 当前服务器：`http://ac.zjugis.com:3300`。下文路径已包含 `/api/billing/v1`，不要重复拼接。
- 专家后端：复用 `POST /api/expert-web/redeem` 返回的 `billing_context`，请求头为 `Authorization: Bearer <billing_context>`。凭据绑定当前用户和专家，不能跨用户或跨专家共用。
- 桌面技能：平台自动携带当前用户的登录凭据，不需要技能开发者逐个接入。
- 知识库：调用放在现有 Go 后台，转发当前请求的有效 Authorization 或登录 Cookie，不需要新增登录流程。现有接入位置是 `controller/knowledge_base.go` 的 `answerKnowledgeConversation()`；`controller/knowledge_billing.go` 只封装对下面 HTTP 的转发，不再直接扣分或接受金额，不会自动收费。
- 管理扣分点需要管理员身份；实际收费使用当前付款用户身份。用户身份从凭据识别，不允许随意传用户 ID 扣分。
- 接口代码入口：`router/api.go`、`controller/business_billing.go`；底层：`model/business_billing.go`。Python 和 Go 都按本文 HTTP 协议调用，不再提供 Python SDK。

## 2. 三类资源的统一字段

| 字段 | 类型 | 含义 |
|---|---|---|
| `kind` | string | `expert` 专家、`skill` 技能、`knowledge` 知识库 |
| `item_id` | string | 专家 key、技能英文标识、知识库数字 ID 的字符串 |
| `charge_point_id` | string | 后台生成的 `cp_...` 固定扣分点 ID，必须属于上述资源 |

例如：

```json
{"kind":"expert","item_id":"geology","charge_point_id":"cp_报告点ID"}
```

```json
{"kind":"skill","item_id":"pvs-contract-template","charge_point_id":"cp_技能点ID"}
```

```json
{"kind":"knowledge","item_id":"20","charge_point_id":"cp_问答点ID"}
```

以上 ID 是占位示例，必须替换为后台实际生成的值。专家代码在具体收费节点配置 ID；技能按当前技能自动查询默认 ID；知识库同事在具体收费节点配置 ID。

## 3. 查价

**GET `/api/billing/v1/quote?kind=expert&item_id=geology&charge_point_id=<实际ID>`**

携带当前用户授权。返回示例：

```json
{"success":true,"data":{"exempt":false,"unit_credits":3,"rule":{"id":"cp_实际ID","version":2,"enabled":true,"unit_quota":3000}}}
```

`unit_credits` 是每次的积分，供展示；`version` 用于下一步预留，不能写死。`unit_quota` 是内部额度，不是直接展示的积分。

若 `data.exempt=true`，表示本次免计费：直接执行业务，不创建计费任务，不提交结算。关闭平台积分总开关时，即使扣分点尚未配置，也不会因计费配置阻断业务。

技能平台入口可以用 `GET /api/billing/v1/quote?kind=skill&item_id=<技能标识>&default=true` 查询自动关联的默认扣分点，从 `data.rule.id` 取得 ID。仅本地存在、未纳入后台技能管理的技能沿用免费执行；平台管理技能按默认点计费。

## 4. 业务开始前预留

**POST `/api/billing/v1/tasks`**

请求头：`Content-Type: application/json`，以及当前用户授权。

```json
{
  "mode":"configured",
  "kind":"expert",
  "item_id":"geology",
  "charge_point_id":"cp_实际ID",
  "request_id":"geology:report:业务记录001",
  "quantity":1,
  "version":2
}
```

| 参数 | 必填 | 含义 |
|---|---|---|
| `mode` | 建议传 | 固定 `configured`；不再支持业务传金额的 `developer` 模式 |
| `kind` / `item_id` / `charge_point_id` | 是 | 上文资源和扣分点标识 |
| `request_id` | 是 | 本次业务唯一编号，1～128 字节；同次重试保持不变，不同操作使用不同编号 |
| `quantity` | 是 | 收费次数，整数 1～1000000；单次传 1 |
| `version` | 是 | 查价返回的 `data.rule.version` |
| `description` | 否 | 消费说明，最多 160 字符；不放问题、文档正文等隐私 |
| `session_id` / `turn_id` | 否 | 真实桌面会话 ID 与非负整数轮次，传入后可归入“本轮消耗”；只传 turn_id 不合法，不要自行编造 |

成功返回：

```json
{"success":true,"data":{"id":"计费任务ID","state":"reserved","quota":3000,"resource_name":"地质专家","point_name":"生成报告"},"task_token":"本次任务凭据"}
```

先保存业务编号、`data.id` 和 `task_token`，再执行业务。`request_id` 由业务生成；计费任务 ID 由平台生成，二者不是同一个编号。首次预留会减少可用余额；成功确认不重复扣第二次。

如果预留期间平台关闭积分，返回 `success=true,data.exempt=true,state=exempt`，不包含计费任务凭据。应正常执行业务，跳过结算。不是错误。

价格为零或扣分点停用时，查价可直接跳过计费；若仍提交了预留，可返回额度为 0 的 reserved 任务，按正常流程结束，不产生积分支出。

## 5. 业务结束后确认或释放

**POST `/api/billing/v1/tasks/{task_id}/result`**

`task_id` 替换为预留返回的 `data.id`；请求头为 `Authorization: Bearer <task_token>`。

```json
{"status":"succeeded"}
```

| status | 作用 |
|---|---|
| `succeeded` | 业务成功，确认扣费 |
| `failed` | 业务失败，释放预留 |
| `cancelled` | 用户取消，释放预留 |

返回 `success=true` 后仍要检查 `data.state`。只有 `succeeded` 表示确认扣费成功；`expired` 表示已过期释放。流式问答须按实际完成状态提交，不能把 HTTP 200 或第一个分片当作业务完成。

## 6. 查询、重试和异常

**GET `/api/billing/v1/tasks/{task_id}`**，携带当前用户授权。返回 `data.state`：`reserved`、`succeeded`、`failed`、`cancelled`、`expired`。

| 情况 | 处理 |
|---|---|
| `INSUFFICIENT_CREDITS` | 不执行业务，提示积分不足 |
| `PRICE_CHANGED` | 重新查价并向用户确认，不按旧报价执行 |
| `REQUEST_CONFLICT` | 同一业务编号参数不同，核对原记录，不自动换编号重扣 |
| `TERMINAL_CONFLICT` | 已结束任务不能改成另一结果，查询原状态 |
| `NOT_FOUND` / `TASK_NOT_FOUND` | 核对扣分点或任务 ID，不能默认为免费；本地技能的缺失判定由平台内部处理 |
| `BILLING_SCOPE_MISMATCH` | 凭据、资源或扣分点归属不匹配 |
| 业务成功但确认超时 | 保存业务结果，查询任务；仍 reserved 则用原任务和凭据重试确认，不释放、不重新执行业务 |
| 预留超时且未拿到 ID 或凭据 | 不执行业务、不换编号再次收费，保留业务编号排查；当前没有按 request_id 找回凭据的接口 |

相同参数重复预留不会重复扣分，但任务凭据只在首次创建返回。业务侧须安全保存它；重复预留不能用来恢复凭据。重复提交同一结算结果不重复扣分。

预留有效期 30 分钟，当前无续期。到期由平台清理任务释放，或提交结果时判定过期。专家 billing_context 有效期 1 小时，过期重新通过现有登录流程兑换。任务凭据仅保存在后端，禁止暴露到浏览器和普通日志。

## 7. 后台配置接口（三类相同）

使用管理员现有登录授权。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/billing/v1/resources/{kind}/{item_id}/charge-points` | 查询资源扣分点，包括停用点 |
| POST | 同上 | 新增扣分点，自动生成固定 ID |
| PUT | `/api/billing/v1/resources/{kind}/{item_id}/charge-points/{point_id}` | 修改名称、说明、价格及启停 |

新增请求：

```json
{"name":"生成报告","description":"用户确认后生成报告","credits":"3","enabled":true}
```

更新时增加查询返回的 `version`，防止覆盖他人修改。`credits` 为十进制字符串，0～1000000，精度须可换成整数内部额度；名称 1～100 字符，说明最多 500 字符。返回 `data.id`、`data.version`、`data.credits`、`data.enabled` 等字段。ID 与所属资源不可修改，不提供删除，只停用。

- 启用且正价格：按后台金额计费。
- 启用且零价格：免费执行业务。
- 停用：停止扣分，业务正常执行。
- 平台积分总开关关闭：业务正常执行，不预留、不扣分。
- 已预留任务：后续停用或调价不影响原交易结算。

专家保留扣分点管理页面。技能列表“积分”按钮打开同样的配置弹窗，原编辑表单不再配置任务积分；新技能自动建立默认“技能调用”点，已有价格迁入，修改价格不改 ID。添加额外技能扣分点不会自动触发，需接到新业务节点。知识库仅提供接口和现有 Go 请求中的接入位置，管理页面及具体收费规则由知识库同事完成。

## 8. 流水与验收

正金额成功扣费进入“积分与用量”。预留时保存资源名称、扣分点名称及金额快照，后台改名或调价不改历史展示。会话与轮次真实关联时，计入对应“本轮消耗”。

接入必须测试：正常成功只扣一次、余额不足不执行业务、失败取消释放、停用免费、零分免费、总开关关闭正常执行、重复请求不重复扣分、跨资源点不可使用、调价后旧任务按原价结算、确认超时仅补偿结算、流水名称和金额正确。
