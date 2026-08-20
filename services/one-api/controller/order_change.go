package controller

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// OrderChangeResult 改单计算结果（preview 与 execute 共用）。
// 额度单位为 quota（内部积分额度），金额单位为分。
type OrderChangeResult struct {
	Used         int64 `json:"used"`          // 原订单已消费额度
	OldRemaining int64 `json:"old_remaining"` // 原订单当前账本剩余额度
	NewRemaining int64 `json:"new_remaining"` // 转换后剩余额度 = max(qNew - used, 0)
	DeltaQuota   int64 `json:"delta_quota"`   // 账本/余额增量 = newRemaining - oldRemaining
	RefundAmount int   `json:"refund_amount"` // 建议退款金额（分）= max(paidOld - priceNew, 0)
}

// computeOrderChange 纯函数：根据原/目标套餐及消费情况计算改单各项数值。
//
//	newRemaining = max(qNew - used, 0)        保留已用，按目标额度结算，不为负
//	delta        = newRemaining - oldRemaining 可正可负，落库时非负截断保证余额>=0
//	refund       = max(paidOld - priceNew, 0)  简单价差，仅展示不实退
//
// 参数：
//
//	qNew         目标套餐额度
//	used         原订单已消费额度（订单额度 - 账本剩余）
//	oldRemaining 原订单当前账本剩余
//	paidOld      原订单实付（orders.amount，分）
//	priceNew     目标套餐价（recharge_packages.price，分）
func computeOrderChange(qNew, used, oldRemaining int64, paidOld, priceNew int) OrderChangeResult {
	if used < 0 {
		used = 0
	}
	newRemaining := qNew - used
	if newRemaining < 0 {
		newRemaining = 0
	}
	refund := paidOld - priceNew
	if refund < 0 {
		refund = 0
	}
	return OrderChangeResult{
		Used:         used,
		OldRemaining: oldRemaining,
		NewRemaining: newRemaining,
		DeltaQuota:   newRemaining - oldRemaining,
		RefundAmount: refund,
	}
}

// ChangeOrderRequest 改单 / 预览请求体
type ChangeOrderRequest struct {
	OrderNo         string `json:"order_no"`
	TargetPackageID int    `json:"target_package_id"`
}

// orderChangeContext 预备数据：校验订单 + 目标套餐 + 原账本，返回计算所需上下文。
type orderChangeContext struct {
	order        Order
	targetPkg    model.RechargePackage
	qNew         int64      // 目标套餐额度（个人取单期额度 CalcQuota，企业同）
	targetPrice  int        // 目标套餐实际售价（分）
	used         int64      // 原订单已消费额度
	oldRemaining int64      // 原订单当前账本剩余
	expiresAt    *time.Time // 原账本到期时间（改单后沿用）
	isOrg        bool       // 企业订单
	orgId        int
	orgName      string
}

// loadOrderChangeContext 读取订单、目标套餐、原账本，并做改单合法性校验（仅读）。
func loadOrderChangeContext(orderNo string, targetPkgID int) (*orderChangeContext, error) {
	var order Order
	if err := model.DB.Table("orders").Where("order_no = ?", orderNo).First(&order).Error; err != nil {
		return nil, fmt.Errorf("订单不存在")
	}
	if order.Status != model.OrderStatusPaid {
		return nil, fmt.Errorf("只有已支付的订单才能改单")
	}
	if order.OrgId != nil && *order.OrgId > 0 {
		return nil, fmt.Errorf("企业订单不支持改单，请走人工处理")
	}

	// 原订单套餐：增值包(quota)订单不支持改单（一次性发放、无订阅语义，交人工）
	srcPkg, err := model.GetRechargePackageById(order.PackageID)
	if err != nil {
		return nil, fmt.Errorf("原套餐不存在，无法改单")
	}
	if srcPkg.PackageType == "quota" {
		return nil, fmt.Errorf("增值包订单不支持改单，请人工处理")
	}

	target, err := model.GetRechargePackageById(targetPkgID)
	if err != nil || !target.Enabled {
		return nil, fmt.Errorf("目标套餐不存在或已停用")
	}
	if target.Id == order.PackageID {
		return nil, fmt.Errorf("目标套餐与原套餐相同，无需改单")
	}
	if target.PackageType == "quota" {
		return nil, fmt.Errorf("不支持改为增值包套餐")
	}
	if !target.IsPersonalScope() {
		return nil, fmt.Errorf("个人订单只能改为个人套餐")
	}

	ctx := &orderChangeContext{
		order:       order,
		targetPkg:   *target,
		qNew:        target.CalcQuota(),
		targetPrice: target.EffectivePrice(),
	}

	// 个人订阅订单：从订阅积分账本读「本单剩余」
	remaining, err := model.GetOrderSubscriptionRemaining(order.UserID, orderNo)
	if err != nil {
		return nil, fmt.Errorf("读取用户账本失败: %w", err)
	}

	// 改单仅允许发生在第 1 期：updateSubscriptionForChange 会把 periods_used 重置为 1、
	// 按目标套餐重排周期结构，若订阅已续期到第 2 期及以后再改单会算错剩余期数。
	// 历史上靠"续期 drip 的 source_ref 被标成 renewal、本单查不到剩余"隐式拦住第 2 期改单；
	// T0-1 改为续期写真实 order_no 后该副作用消失，这里改为显式按 periods_used 拦截。
	var sub model.Subscription
	subErr := model.DB.Where("order_no = ? AND status = ?", orderNo, "active").First(&sub).Error
	if subErr != nil {
		if subErr == gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("该订单无活跃订阅，无法改单，请人工处理")
		}
		return nil, fmt.Errorf("查询订阅失败: %w", subErr)
	}
	if sub.PeriodsUsed > 1 {
		return nil, fmt.Errorf("该订阅已进入第 2 期及以后，不支持改单，请人工处理")
	}

	expiresAt, ok, err := model.GetOrderSubscriptionExpiry(order.UserID, orderNo)
	if err != nil {
		return nil, fmt.Errorf("读取用户账本失败: %w", err)
	}
	if !ok {
		return nil, fmt.Errorf("该订单无活跃积分（已用尽 / 已过期 / 为旧订单），无法改单，请人工处理")
	}
	ctx.oldRemaining = remaining
	ctx.expiresAt = expiresAt

	ctx.used = order.Quota - ctx.oldRemaining
	if ctx.used < 0 {
		ctx.used = 0
	}
	return ctx, nil
}

// billingCycleOf 按套餐时长单位派生订阅周期标识（与下单路径一致：year=>yearly，否则 monthly）。
func billingCycleOf(pkg *model.RechargePackage) string {
	if pkg.DurationUnit == "year" {
		return "yearly"
	}
	return "monthly"
}

// updateSubscriptionForChange 改单时按目标套餐重算关联订阅的周期结构并落库。
//
// 周期换算与下单路径(createSubscriptionAfterPayment)一致：
//   - totalDays = 套餐时长天数；cycleDays = 积分发放周期天数
//   - 一次性发放(cycleDays<=0)：periodsTotal=1，periodDays=totalDays
//   - 周期性发放：periodsTotal = totalDays/cycleDays(>=1)，periodDays=cycleDays
//
// 改单只发生在第 1 期(periods_used=1，由 loadOrderChangeContext 显式按 periods_used 拦截第 2 期及以后)，
// 故保留 current_period_start/end（当前期已付费），按新结构重置 periods_used=1、
// subscription_end = current_period_end + (periodsTotal-1)*periodDays。
func updateSubscriptionForChange(tx *gorm.DB, orderNo string, pkg *model.RechargePackage, quotaPerPeriod int64) error {
	var sub model.Subscription
	if err := tx.Where("order_no = ? AND status = ?", orderNo, "active").First(&sub).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return fmt.Errorf("该订单无活跃订阅，无法改单，请人工处理")
		}
		return fmt.Errorf("查询订阅失败: %w", err)
	}

	totalDays := pkg.DurationDays()
	cycleDays := pkg.PointCycleDays()
	periodsTotal := 1
	periodDays := totalDays
	if cycleDays > 0 {
		periodsTotal = totalDays / cycleDays
		if periodsTotal < 1 {
			periodsTotal = 1
		}
		periodDays = cycleDays
	}
	subscriptionEnd := sub.CurrentPeriodEnd.Add(
		time.Duration(periodsTotal-1) * time.Duration(periodDays) * 24 * time.Hour)

	updates := map[string]interface{}{
		"package_id":       pkg.Id,
		"package_level":    pkg.EffectiveLevel(),
		"quota_per_period": quotaPerPeriod,
		"billing_cycle":    billingCycleOf(pkg),
		"period_days":      periodDays,
		"periods_total":    periodsTotal,
		"periods_used":     1,
		"subscription_end": subscriptionEnd,
	}
	if err := tx.Model(&model.Subscription{}).
		Where("id = ?", sub.Id).Updates(updates).Error; err != nil {
		return fmt.Errorf("更新订阅失败: %w", err)
	}
	return nil
}

// buildChangePreview 组装 preview 返回数据。
func buildChangePreview(ctx *orderChangeContext) gin.H {
	r := computeOrderChange(ctx.qNew, ctx.used, ctx.oldRemaining, ctx.order.Amount, ctx.targetPrice)
	return gin.H{
		"order_no":      ctx.order.OrderNo,
		"username":      ctx.order.Username,
		"org_name":      ctx.orgName,
		"is_org":        ctx.isOrg,
		"from_package":  ctx.order.PackageName,
		"to_package":    ctx.targetPkg.Name,
		"old_quota":     ctx.order.Quota,
		"new_quota":     ctx.qNew,
		"used":          r.Used,
		"old_remaining": r.OldRemaining,
		"new_remaining": r.NewRemaining,
		"delta_quota":   r.DeltaQuota,
		"old_amount":    ctx.order.Amount,
		"new_amount":    ctx.targetPrice,
		"refund_amount": r.RefundAmount,
		"from_cycle":    ctx.order.BillingCycle,
		"to_cycle":      billingCycleOf(&ctx.targetPkg),
	}
}

// AdminPreviewOrderChange POST /api/payment/admin/orders/change/preview
// 改单前预览：展示积分如何转换、需退多少现金。纯计算，不写库。
func AdminPreviewOrderChange(c *gin.Context) {
	var req ChangeOrderRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	req.OrderNo = strings.TrimSpace(req.OrderNo)
	if req.OrderNo == "" || req.TargetPackageID == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "订单号和目标套餐不能为空"})
		return
	}

	ctx, err := loadOrderChangeContext(req.OrderNo, req.TargetPackageID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": buildChangePreview(ctx)})
}

// AdminChangeOrder POST /api/payment/admin/orders/change
// 执行改单：转换套餐 + 调整积分（保留已用，余额=目标额度-已用，>=0）+ 提示退款金额。
//
// 单事务串行落库：
//   - 行锁 + 乐观锁复核订单仍 paid 且仍指向原套餐（防并发双改）
//   - 个人：改写订阅账本 + 更新关联 Subscription；企业：改写企业账本
//   - 改写 orders 行（package/quota/amount）
//   - 写 recharge_records 审计（quota=delta）+ order_change_logs 流水
func AdminChangeOrder(c *gin.Context) {
	var req ChangeOrderRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	req.OrderNo = strings.TrimSpace(req.OrderNo)
	if req.OrderNo == "" || req.TargetPackageID == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "订单号和目标套餐不能为空"})
		return
	}

	ctx, err := loadOrderChangeContext(req.OrderNo, req.TargetPackageID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	operatorId := c.GetInt(ctxkey.Id)
	operatorName := c.GetString(ctxkey.Username)
	result := computeOrderChange(ctx.qNew, ctx.used, ctx.oldRemaining, ctx.order.Amount, ctx.targetPrice)

	// 改单前余额快照（审计用，事务外读取一次）
	var beforeQuota int64
	if ctx.isOrg {
		beforeQuota, _ = model.GetOrgAvailableQuota(ctx.orgId)
	} else {
		beforeQuota, _ = model.GetUserQuota(ctx.order.UserID)
	}

	txErr := model.DB.Transaction(func(tx *gorm.DB) error {
		// 1. 乐观锁：确认订单仍 paid 且仍指向原套餐
		var fresh model.Order
		q := tx.Table("orders").Where("order_no = ?", req.OrderNo)
		if !common.UsingSQLite {
			q = q.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := q.First(&fresh).Error; err != nil {
			return fmt.Errorf("订单不存在")
		}
		if fresh.Status != model.OrderStatusPaid || fresh.PackageId != ctx.order.PackageID {
			return fmt.Errorf("订单已被处理")
		}

		// 2. 改写账本
		if ctx.isOrg {
			if err := model.RewriteOrderOrgQuotaTx(tx, ctx.orgId, req.OrderNo, result.NewRemaining, ctx.expiresAt); err != nil {
				return fmt.Errorf("改写企业积分失败: %w", err)
			}
		} else {
			if err := model.RewriteOrderSubscriptionQuotaTx(tx, ctx.order.UserID, req.OrderNo, result.NewRemaining, ctx.expiresAt); err != nil {
				return fmt.Errorf("改写用户积分失败: %w", err)
			}
			// 更新关联订阅：套餐/等级/每期额度，并按目标套餐重算发放周期结构。
			//
			// 关键点（年付↔月付）：年付订阅在创建时只发首期(1个月)积分，period_total=12、
			// period_days=30，由 ProcessUserSubscriptionRenewal 每月续期发放；月付 period_total=1。
			// 改单仅可能发生在第 1 期（periods_used=1，loadOrderChangeContext 已显式拦截第 2 期及以后），
			// 故 current_period_start/end 保留（用户已为当前期付费），仅重算剩余期数与订阅结束日。
			if err := updateSubscriptionForChange(tx, req.OrderNo, &ctx.targetPkg, ctx.qNew); err != nil {
				return err
			}
		}

		// 3. 改写订单
		if err := tx.Table("orders").Where("order_no = ?", req.OrderNo).
			Updates(map[string]interface{}{
				"package_id":      ctx.targetPkg.Id,
				"package_name":    ctx.targetPkg.Name,
				"quota":           ctx.qNew,
				"amount":          ctx.targetPrice,
				"original_amount": 0,
				"billing_cycle":   billingCycleOf(&ctx.targetPkg),
			}).Error; err != nil {
			return fmt.Errorf("更新订单失败: %w", err)
		}

		// 4. 审计记录（quota=delta）
		record := RechargeRecord{
			UserID:      ctx.order.UserID,
			Username:    ctx.order.Username,
			OrderNo:     ctx.order.OrderNo,
			Quota:       result.DeltaQuota,
			BeforeQuota: beforeQuota,
			AfterQuota:  beforeQuota + result.DeltaQuota,
			Remark: fmt.Sprintf("管理员改单 %s→%s，建议退款¥%.2f",
				ctx.order.PackageName, ctx.targetPkg.Name, float64(result.RefundAmount)/100),
		}
		if ctx.isOrg {
			record.OrgID = ctx.orgId
		}
		if err := tx.Table("recharge_records").Create(&record).Error; err != nil {
			return fmt.Errorf("创建改单记录失败: %w", err)
		}

		// 5. 改单流水
		changeLog := model.OrderChangeLog{
			OrderNo:      ctx.order.OrderNo,
			UserId:       ctx.order.UserID,
			Username:     ctx.order.Username,
			OrgName:      ctx.orgName,
			FromPackage:  ctx.order.PackageName,
			ToPackage:    ctx.targetPkg.Name,
			FromQuota:    ctx.order.Quota,
			ToQuota:      ctx.qNew,
			FromAmount:   ctx.order.Amount,
			ToAmount:     ctx.targetPrice,
			UsedQuota:    result.Used,
			NewRemaining: result.NewRemaining,
			DeltaQuota:   result.DeltaQuota,
			RefundAmount: result.RefundAmount,
			OperatorId:   operatorId,
			OperatorName: operatorName,
		}
		if ctx.isOrg {
			changeLog.OrgId = &ctx.orgId
		}
		if err := tx.Create(&changeLog).Error; err != nil {
			return fmt.Errorf("创建改单流水失败: %w", err)
		}
		return nil
	})

	if txErr != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": txErr.Error()})
		return
	}

	if !ctx.isOrg {
		model.InvalidateUserAccountCache(ctx.order.UserID)
	}
	logger.SysLog(fmt.Sprintf("管理员改单 - 订单号: %s, %s→%s, 额度变动: %d, 建议退款: ¥%.2f",
		ctx.order.OrderNo, ctx.order.PackageName, ctx.targetPkg.Name,
		result.DeltaQuota, float64(result.RefundAmount)/100))

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "改单成功",
		"data": gin.H{
			"order_no":      ctx.order.OrderNo,
			"to_package":    ctx.targetPkg.Name,
			"new_remaining": result.NewRemaining,
			"delta_quota":   result.DeltaQuota,
			"refund_amount": result.RefundAmount,
		},
	})
}

// AdminGetOrderChangeLogs GET /api/payment/admin/orders/change-logs
func AdminGetOrderChangeLogs(c *gin.Context) {
	p, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if p < 1 {
		p = 1
	}
	logs, err := model.GetOrderChangeLogs((p-1)*config.ItemsPerPage, config.ItemsPerPage)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": logs})
}

// AdminSearchOrderChangeLogs GET /api/payment/admin/orders/change-logs/search
func AdminSearchOrderChangeLogs(c *gin.Context) {
	keyword := strings.TrimSpace(c.Query("keyword"))
	logs, err := model.SearchOrderChangeLogs(keyword, config.ItemsPerPage)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": logs})
}

// AdminListChangeablePackages GET /api/payment/admin/orders/changeable-packages?order_no=xxx
// 仅个人订单可改单，返回启用的个人订阅套餐，供改单下拉选择。
func AdminListChangeablePackages(c *gin.Context) {
	orderNo := strings.TrimSpace(c.Query("order_no"))
	if orderNo == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "订单号不能为空"})
		return
	}
	var order Order
	if err := model.DB.Table("orders").Where("order_no = ?", orderNo).First(&order).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "订单不存在"})
		return
	}
	if order.OrgId != nil && *order.OrgId > 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "企业订单不支持改单，请走人工处理"})
		return
	}

	pkgs, err := model.GetAllRechargePackages()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取套餐失败"})
		return
	}

	type pkgOption struct {
		Id    int    `json:"id"`
		Name  string `json:"name"`
		Price int    `json:"price"`
		Quota int64  `json:"quota"`
	}
	options := make([]pkgOption, 0, len(pkgs))
	for _, p := range pkgs {
		if p.PackageType == "quota" || p.Id == order.PackageID {
			continue
		}
		options = append(options, pkgOption{Id: p.Id, Name: p.Name, Price: p.EffectivePrice(), Quota: p.CalcQuota()})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": options})
}
