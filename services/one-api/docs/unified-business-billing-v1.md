# 统一积分 HTTP 接口

专家、技能、知识库共用以下接口。业务后端负责调用，平台负责查价、余额校验、扣费及流水。

基础地址：`http://ac.zjugis.com:3300`，通过服务端配置传入。POST、PUT、DELETE 使用 `Content-Type: application/json`。

## 1. 资源与授权

### 资源参数

| 场景 | kind（代码填写） | item_id（当前资源或固定配置） | charge_point_id |
|---|---|---|---|
| 专家某个功能 | `expert` | 后台专家 key，例如 `geology` | 该专家对应扣分点 ID |
| 技能调用 | `skill` | 技能标识，例如 `pvs-contract-template` | 平台自动查找默认扣分点 ID |
| 浏览、下载具体知识库 | `knowledge` | 当前知识库 ID 的字符串，例如 `20` | 该知识库对应扣分点 ID |
| 知识库服务统一问答等功能 | `knowledge_service` | 固定 `default` | 服务级扣分点 ID |

扣分点 ID 由管理接口生成。业务后端将 ID 配置到对应收费节点，价格不写在业务代码里。统一问答配置一次即可，不需要每个知识库重复配置。每个节点选用一个扣分点，平台不会自动叠加服务级和具体库的费用。

### 请求授权

| 请求 | 授权来源 |
|---|---|
| 专家查价、预留、查询任务 | `Authorization: Bearer <billing_context>`；取自现有 `POST /api/expert-web/redeem` 的返回值，保存在后端当前用户会话中 |
| 技能、知识库查价、预留、查询任务 | 当前用户请求中的有效 Authorization 或登录 Cookie，后端转发 |
| 提交结算结果 | `Authorization: Bearer <task_token>`；取自本次预留响应 |
| 管理扣分点 | 管理员现有登录授权，仅用于管理页面 |

用户身份由授权识别，不传付款用户 ID；消费请求不传金额。专家凭据不能跨专家，也不能用于知识库服务。知识库业务自行校验访问及订阅权益。

## 2. 业务调用

顺序：**查价 → 预留成功 → 执行业务 → 提交结果**。以下以统一问答为例；其他场景只替换上表中的资源参数和扣分点 ID。

### ① 查价

```http
GET /api/billing/v1/quote?kind=knowledge_service&item_id=default&charge_point_id=cp_xxx
```

响应（仅列接入所需字段）：

```json
{"success":true,"data":{"exempt":false,"unit_credits":3,"rule":{"id":"cp_xxx","version":2}}}
```

- `unit_credits`：接口返回的单价，单位为积分。
- `rule.version`：接口返回的价格版本，预留时原样传入，不写死。
- `exempt=true`：直接执行业务，跳过预留和结算。

技能查默认 ID 可用 `GET /api/billing/v1/quote?kind=skill&item_id=技能标识&default=true`，从 `data.rule.id` 取得。

### ② 预留

```http
POST /api/billing/v1/tasks
```

```json
{
  "mode":"configured",
  "kind":"knowledge_service",
  "item_id":"default",
  "charge_point_id":"cp_xxx",
  "request_id":"qa:业务记录001",
  "quantity":1,
  "version":2
}
```

| 参数 | 来源及要求 |
|---|---|
| `mode` | 固定 `configured` |
| `kind`、`item_id`、`charge_point_id` | 与查价一致 |
| `request_id` | 业务后端生成的唯一编号，1～128 字节；同次重试不变，不同操作不重复 |
| `quantity` | 业务确定的收费次数，整数 1～1000000；单次填 `1` |
| `version` | 查价返回的 `data.rule.version` |
| `session_id`、`turn_id`（可选） | 桌面上下文中的真实会话 ID、非负整数轮次；无真实值则不传，不能只传 turn_id |

```json
{"success":true,"data":{"id":"计费任务ID","state":"reserved"},"task_token":"本次任务凭据"}
```

先在后端保存业务编号、`data.id`、`task_token`，再执行业务。任务凭据仅首次创建返回。预留会占用积分，成功结算不会再扣一次。

若预留返回 `data.exempt=true`，正常执行业务，跳过结算。

### ③ 提交结果

```http
POST /api/billing/v1/tasks/{task_id}/result
Authorization: Bearer <task_token>
```

```json
{"status":"succeeded"}
```

`task_id`、`task_token` 都取自预留响应；status 由业务结果决定：

| status | 作用 |
|---|---|
| `succeeded` | 业务成功，确认消费 |
| `failed` | 业务失败，释放预留 |
| `cancelled` | 用户取消，释放预留 |

响应需同时满足 `success=true`、`data.state=succeeded` 才表示确认消费成功。流式问答在回答实际完成后确认。浏览、下载在业务约定的成功节点确认，不能仅因进入函数就确认。

### ④ 查询与重试

`GET /api/billing/v1/tasks/{task_id}`，使用当前用户授权。返回 `data.state`：`reserved`、`succeeded`、`failed`、`cancelled`、`expired`。

| 情况 | 处理 |
|---|---|
| `INSUFFICIENT_CREDITS` | 不执行业务，返回积分不足 |
| `PRICE_CHANGED` | 重新查价并确认费用后预留 |
| `REQUEST_CONFLICT` | 核对原业务编号和参数，不换编号重扣 |
| `TERMINAL_CONFLICT` | 查询原任务，不能更改已结束结果 |
| ID 不存在、归属不符、授权或网络错误 | 返回错误，不能视为免费 |
| 业务成功、结算超时 | 查询原任务；仍 reserved 则重试原结算，不重做业务或创建新收费任务 |
| 预留超时、未取得任务凭据 | 暂停业务，保留原业务编号排查；没有按 request_id 找回凭据的接口 |

预留有效期 30 分钟，无续期。相同参数重复预留不重复扣费；相同结果重复结算不重复扣费。

## 3. 管理页面对接

专家现有页面及同事编写的知识库页面使用同一套管理接口。kind、item_id 按第 1 节选择，使用管理员授权。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/billing/v1/resources/{kind}/{item_id}/charge-points` | 获取扣分点列表 |
| POST | 同上 | 新增扣分点 |
| PUT | `/api/billing/v1/resources/{kind}/{item_id}/charge-points/{point_id}` | 修改价格、名称、说明、启停 |
| DELETE | 与 PUT 相同 | 删除扣分点 |

例如为统一问答建点：

```http
POST /api/billing/v1/resources/knowledge_service/default/charge-points
```

```json
{"name":"统一问答","description":"回答完成后收费","credits":"3","enabled":true}
```

返回示例：

```json
{"success":true,"data":{"id":"cp_xxx","name":"统一问答","credits":3,"enabled":true,"version":1}}
```

- `name`：1～100 字符；`description`：最多 500 字符。
- `credits`：积分十进制字符串，0～1000000；精度须符合平台积分单位。
- 修改：发送以上配置字段，并增加列表返回的 `version`。
- 删除：请求体 `{"version":当前版本}`，成功返回 `{"success":true}`。
- 修改或删除冲突返回 409，重新读取配置后处理。
- ID 与所属资源不能修改。改价格后业务代码仍使用原 ID，下次查价采用新价格。

## 4. 执行规则与接入位置

- 平台关闭积分、扣分点停用或价格为 0：业务正常执行，按免计费响应跳过计费。
- 删除：管理列表隐藏，原 ID 后续调用免费；未知或跨资源 ID 仍报错。
- 已预留任务：按预留时价格结算，不受后续调价、停用或删除影响。
- 成功消费自动写入“积分与用量”；传真实会话和轮次后可归入“本轮消耗”。
- Go 知识库已有 HTTP 封装：`controller/knowledge_billing.go`。具体库用 `knowledgeBillingFor(c, base)`；整体服务用 `knowledgeServiceBillingFor(c)`；二者均调用本协议的 Quote、Reserve、Finish、Get。
- 收费触发由业务接入，不因配置了扣分点就自动收费；已有收费节点不要同时重复调用两套扣费逻辑。
- 本协议为积分消费接口。订阅赠送沿用平台现有积分发放体系，不通过负数消费实现；订阅有效期和权益由知识库业务维护。
