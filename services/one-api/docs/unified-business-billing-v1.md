# 统一积分计费接口 v1

专家、知识库、技能共用同一套积分账户和计费服务。

## 调用准备

基础地址：http://ac.zjugis.com:3300/api/billing/v1。

专家后端复用已有登录兑换接口 /api/expert-web/redeem，保存响应中的 billing_context。它已关联当前用户和专家，无需新增管理员密钥，不要放到浏览器或日志中。

业务代码自行定价时，只需调用下面两个接口。

## 1. 预留积分

**POST /tasks**

请求头：

    Content-Type: application/json
    Authorization: Bearer {billing_context}

请求示例：

    {
      "mode":"developer",
      "request_id":"qa-001",
      "action":"qa",
      "points":"3",
      "description":"专家问答"
    }

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| mode | string | 是 | 固定developer，表示费用由业务代码提供 |
| request_id | string | 是 | 本次业务唯一编号，最多128字节；重试保持不变 |
| action | string | 是 | 功能标识，例如qa；最多80字节 |
| points | string | 是 | 本次总积分，例如"3"；范围0～1000，小数须能精确换成内部额度 |
| description | string | 否 | 消费事项说明，最多160字符，不含隐私内容 |

返回示例（省略其他字段）：

    {
      "success":true,
      "data":{"id":"计费任务ID","state":"reserved"},
      "task_token":"本次任务凭据"
    }

保存data.id、task_token。**预留成功后才执行收费业务。**
用户和专家身份自动从billing_context识别，不传用户ID或专家ID。

## 2. 确认扣费或释放

**POST /tasks/{计费任务ID}/result**

请求头：

    Content-Type: application/json
    Authorization: Bearer {task_token}

请求示例：

    {"status":"succeeded"}

| 参数 | 类型 | 必填 | 含义 |
|---|---|---|---|
| 路径中的计费任务ID | string | 是 | 接口1返回的data.id |
| status | string | 是 | succeeded成功扣费；failed失败释放；cancelled取消释放 |

返回示例（省略其他字段）：

    {
      "success":true,
      "data":{"id":"计费任务ID","state":"succeeded"}
    }

检查success和data.state。state=expired表示超时释放，不是扣费成功。
同一结果重复提交不重复扣费。

## SDK调用（可选）

同目录business_billing.py已封装上述请求：

    from business_billing import Billing

    billing = Billing("http://ac.zjugis.com:3300", identity)
    task = billing.reserve(order_id, points="3", description="专家问答", action="qa")

    billing.confirm(task)  # 成功分支
    billing.fail(task)     # 失败分支
    billing.cancel(task)   # 取消分支

identity是当前用户的原登录兑换响应；示例已使用你们当前后台地址。
三个结果方法选一个调用，不是连续调用。每个用户会话单独创建billing对象，不能全局共用。

## 使用后台配置的单次积分

例如后台将该专家的“任务积分”设为5积分／次，调用下面的方法就按5积分预留，不用在代码里再写金额：

    task = billing.reserve_default(order_id)

不传points，由平台读取后台配置的价格。业务成功后确认扣费，失败或取消时释放，调用方式与上面相同。

直接HTTP调用：先GET /quote?action=default，使用billing_context认证；取data.rule.version，然后POST /tasks：

    {
      "mode":"configured",
      "action":"default",
      "quantity":1,
      "version":1,
      "request_id":"task-001"
    }

version取实际报价，不固定为示例1；quantity是次数。
以上身份来自专家上下文。平台用户令牌调用configured模式时，还需传kind和item_id。

## 知识库内部接入

当前知识库和平台后台同进程，使用同一计费服务的现有封装，不需要URL或令牌：

    billing := knowledgeBillingFor(c, base)
    task, taskToken, err := billing.ReservePoints("qa", requestID, "3", "知识库问答")
    // err为空，预留成功后执行业务

    result, err := billing.Finish(task.ID, taskToken, "succeeded")
    // 失败改为failed，取消改为cancelled

c、base使用现有已登录、已授权请求；其余参数与上文对应。
位置：services/one-api/controller/knowledge_billing.go。
知识库当前不自动收费，由业务同事接上述调用；不涉及RAGFlow模型账单。

## 必要约定

- 积分不足：返回INSUFFICIENT_CREDITS，停止收费业务。
- 报错或超时：不能认定未扣费，不换request_id重扣。
- 同一编号参数改变：返回REQUEST_CONFLICT。
- 查询：GET /tasks/{计费任务ID}，使用billing_context认证；读取data.state。
- task_token只在首次创建返回，须安全保存；当前不支持凭据恢复。
- 预留30分钟后超时释放；当前无续期。billing_context有效1小时，过期重新打开专家。
- 费用由受信后端计算，收费前向用户明确费用；不直接使用浏览器传入的金额。
- 接口代码需部署配套后台，各专家仍需接入。正常业务调用不需要管理员令牌。



## 技能调用费

模型每次调用 skill 工具且加载成功，按后台任务积分收一次。相同技能在同一轮成功调用两次，收两次；同一调用编号的重试不重复扣。斜杠直接注入不触发，安装、下载、查看介绍不触发。调用前预留，调用失败或取消释放，加载成功立即结算；后续任务失败不退调用费。价格0表示免费，模型Token费用另计。
