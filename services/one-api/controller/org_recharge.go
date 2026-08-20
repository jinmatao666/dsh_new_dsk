package controller

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/model"
)

// orgDiscountedPrice 按企业折扣率算实付价(分),折扣率越界回落原价.
func orgDiscountedPrice(price, discount int) int {
	if discount < 1 || discount > 100 {
		discount = 100
	}
	v := price * discount / 100
	if v < 0 {
		v = 0
	}
	return v
}

// OrgListRechargePackages 企业门户:列出启用的企业充值套餐,附本企业折扣价.
func OrgListRechargePackages(c *gin.Context) {
	orgId := c.GetInt("org_id")
	org, err := model.GetOrgById(orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "企业不存在"})
		return
	}
	packages, err := model.GetEnterpriseRechargePackages()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	type pkgView struct {
		*model.RechargePackage
		DiscountedPrice int `json:"discounted_price"`
	}
	views := make([]pkgView, 0, len(packages))
	for _, p := range packages {
		views = append(views, pkgView{
			RechargePackage: p,
			DiscountedPrice: orgDiscountedPrice(p.Price, org.Discount),
		})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{
		"packages": views,
		"discount": org.Discount,
	}})
}

// OrgCreateRechargeOrder 企业门户:为企业充值套餐下单,返回支付二维码.
func OrgCreateRechargeOrder(c *gin.Context) {
	orgId := c.GetInt("org_id")
	var req struct {
		PackageId int    `json:"package_id"`
		PayType   string `json:"pay_type"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	org, err := model.GetOrgById(orgId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "企业不存在"})
		return
	}
	pkg, err := model.GetRechargePackageById(req.PackageId)
	if err != nil || !pkg.Enabled || !pkg.IsEnterpriseScope() {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "套餐不存在"})
		return
	}
	payType := normalizePayType(req.PayType)
	if payType == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "不支持的支付方式"})
		return
	}
	// 实付价 = 原价 × 企业折扣;后端重算,不信任前端金额
	amount := orgDiscountedPrice(pkg.Price, org.Discount)
	if amount <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "套餐价格异常"})
		return
	}

	orderNo := generateOrderNo(orgId)
	loc, _ := time.LoadLocation("Asia/Shanghai")
	expiredAt := time.Now().In(loc).Add(30 * time.Minute)
	orgIdCopy := orgId
	order := Order{
		OrderNo:      orderNo,
		UserID:       org.OwnerId, // 满足 user_id 非空;归属由 OrgId 决定
		Username:     org.Name,
		PackageID:    pkg.Id,
		PackageName:  pkg.Name,
		Amount:       amount,
		Quota:        pkg.CalcQuota(),
		BillingCycle: "once",
		PayType:      payType,
		Status:       "pending",
		ExpiredAt:    &expiredAt,
		OrgId:        &orgIdCopy,
	}
	if err := model.DB.Table("orders").Create(&order).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "创建订单失败"})
		return
	}

	codeURL, err := createPaymentQRCode(c.Request.Context(), payType, orderNo, "企业充值-"+pkg.Name, amount)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err := model.DB.Table("orders").Where("order_no = ?", orderNo).
		Update("code_url", codeURL).Error; err != nil {
		// 二维码已生成,落库失败不阻断下单
		_ = err
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{
		"order_no": orderNo,
		"code_url": codeURL,
		"amount":   amount,
		"status":   "pending",
		"pay_type": payType,
	}})
}

// OrgQueryRechargeOrder 企业门户:查询本企业某订单状态(按 order_no + org_id 校验归属).
func OrgQueryRechargeOrder(c *gin.Context) {
	orgId := c.GetInt("org_id")
	orderNo := c.Query("order_no")
	if orderNo == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "订单号不能为空"})
		return
	}
	var order Order
	err := model.DB.Table("orders").
		Where("order_no = ? AND org_id = ?", orderNo, orgId).
		First(&order).Error
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "订单不存在"})
		return
	}
	if order.Status == "pending" {
		if synced, err := syncPaidOrderFromProvider(c.Request.Context(), order); err == nil {
			order = synced
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{
		"order_no": order.OrderNo,
		"status":   order.Status,
		"amount":   order.Amount,
		"quota":    order.Quota,
		"paid_at":  order.PaidAt,
		"pay_type": order.PayType,
	}})
}

// OrgListRechargeRecords 企业门户:列出当前企业的充值到账记录.
func OrgListRechargeRecords(c *gin.Context) {
	orgId := c.GetInt("org_id")
	type orgRechargeRecord struct {
		ID            int       `json:"id"`
		UserID        int       `json:"user_id"`
		OrgID         int       `json:"org_id"`
		Username      string    `json:"username"`
		OrderNo       string    `json:"order_no"`
		PackageName   string    `json:"package_name"`
		Amount        int       `json:"amount"`
		Quota         int64     `json:"quota"`
		BeforeQuota   int64     `json:"before_quota"`
		AfterQuota    int64     `json:"after_quota"`
		PayType       string    `json:"pay_type"`
		InvoiceStatus string    `json:"invoice_status"`
		InvoiceURL    string    `json:"invoice_url"`
		Remark        string    `json:"remark"`
		CreatedAt     time.Time `json:"created_at"`
	}
	var records []orgRechargeRecord
	err := model.DB.Table("recharge_records AS r").
		Select(`r.id, r.user_id, r.org_id, r.username, r.order_no, r.quota, r.before_quota, r.after_quota, r.remark, r.created_at, o.package_name, o.amount, o.pay_type, o.invoice_status,
			COALESCE((SELECT inv.invoice_url FROM invoices AS inv WHERE inv.order_no = r.order_no ORDER BY inv.apply_time DESC LIMIT 1), '') AS invoice_url`).
		Joins("JOIN orders AS o ON o.order_no = r.order_no").
		Where("r.org_id = ? AND o.org_id = ?", orgId, orgId).
		Order("r.created_at DESC").
		Limit(50).
		Find(&records).Error
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取充值记录失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": records})
}
