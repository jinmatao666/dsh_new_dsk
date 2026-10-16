package controller

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/invoice"
	"github.com/songquanpeng/one-api/model"
)

// ============== 请求结构 ==============

// InvoiceCreateRequest 创建发票申请请求
type InvoiceCreateRequest struct {
	OrderNo      string `json:"order_no" binding:"required"`
	InvoiceType  string `json:"invoice_type" binding:"required"` // company / personal
	InvoiceLine  string `json:"invoice_line"`                    // pc / bs
	BuyerName    string `json:"buyer_name" binding:"required"`
	BuyerTaxNum  string `json:"buyer_tax_num"`
	BuyerTel     string `json:"buyer_tel"`
	BuyerAddress string `json:"buyer_address"`
	BankName     string `json:"bank_name"`
	BankAccount  string `json:"bank_account"`
	BuyerPhone   string `json:"buyer_phone"`
	Email        string `json:"email" binding:"required"`
}

// ============== 输入验证 ==============

var (
	emailRegex  = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	phoneRegex  = regexp.MustCompile(`^1[3-9]\d{9}$`)
	taxNumRegex = regexp.MustCompile(`^[A-Za-z0-9]{15,20}$`)
)

func validateInvoiceRequest(req *InvoiceCreateRequest) (string, bool) {
	// 抬头类型校验
	if req.InvoiceType != "company" && req.InvoiceType != "personal" {
		return "抬头类型只能是 company 或 personal", false
	}

	// 开具方式默认值
	if req.InvoiceLine == "" {
		req.InvoiceLine = "pc"
	}
	if req.InvoiceLine != "pc" && req.InvoiceLine != "bs" {
		return "开具方式只能是 pc(电子普通发票) 或 bs(增值税专用发票)", false
	}

	// 企业必须填写税号
	if req.InvoiceType == "company" {
		if req.BuyerTaxNum == "" {
			return "企业开票必须填写纳税人识别号", false
		}
		if !taxNumRegex.MatchString(req.BuyerTaxNum) {
			return "纳税人识别号格式不正确（应为15-20位字母数字）", false
		}
	}

	// 增值税专用发票只能企业开具
	if req.InvoiceLine == "bs" && req.InvoiceType != "company" {
		return "增值税专用发票仅限企业开具", false
	}

	// 邮箱校验
	if !emailRegex.MatchString(req.Email) {
		return "邮箱格式不正确", false
	}

	// 手机号校验（如果填写了）
	if req.BuyerPhone != "" && !phoneRegex.MatchString(req.BuyerPhone) {
		return "手机号格式不正确", false
	}

	// 购方名称长度
	if len(req.BuyerName) > 128 {
		return "购方名称不能超过128个字符", false
	}

	return "", true
}

// ============== 创建发票 ==============

// CreateInvoice 创建发票申请
// POST /api/invoice/create
func CreateInvoice(c *gin.Context) {
	userID := c.GetInt(ctxkey.Id)

	// 检查诺诺客户端是否已配置
	if invoice.GlobalClient == nil || !invoice.GlobalClient.IsConfigured() {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "发票服务暂未开通"})
		return
	}

	var req InvoiceCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请求参数错误: " + err.Error()})
		return
	}

	// 输入验证
	if errMsg, ok := validateInvoiceRequest(&req); !ok {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": errMsg})
		return
	}

	// 1. 查询订单
	var order model.Order
	err := model.DB.Table("orders").Where("order_no = ?", req.OrderNo).First(&order).Error
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "订单不存在"})
		return
	}

	// 2. 校验订单归属
	if order.UserId != userID {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无权操作该订单"})
		return
	}

	// 3. 校验订单已支付
	if order.Status != "paid" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "当前订单状态不允许开票"})
		return
	}

	// 4. 校验是否已开过票（防重复）
	if order.InvoiceStatus != model.InvoiceStatusNone && order.InvoiceStatus != model.InvoiceStatusFailed {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "该订单已申请开票，请勿重复申请"})
		return
	}

	// 5. 构建开票参数
	// amount 是分，转为元
	amountYuan := float64(order.Amount) / 100.0
	goodsName := order.PackageName
	if goodsName == "" {
		goodsName = "信息技术服务费"
	}

	sdkParams := &invoice.InvoiceCreateParams{
		OrderNo:      req.OrderNo,
		InvoiceType:  req.InvoiceType,
		BuyerName:    req.BuyerName,
		InvoiceLine:  req.InvoiceLine,
		BuyerTaxNum:  req.BuyerTaxNum,
		BuyerTel:     req.BuyerTel,
		BuyerAddress: req.BuyerAddress,
		BankName:     req.BankName,
		BankAccount:  req.BankAccount,
		BuyerPhone:   req.BuyerPhone,
		Email:        req.Email,
	}
	orderInfo := &invoice.OrderInfo{
		OrderNo: order.OrderNo,
		Amount:  amountYuan,
	}

	invoiceParams := invoice.GlobalClient.BuildBillingNewParams(sdkParams, orderInfo, goodsName)
	contentBytes, _ := json.Marshal(invoiceParams)
	content := string(contentBytes)

	// 6. 调用诺诺开票
	billingResult := invoice.GlobalClient.RequestBillingNew(content)

	// 7. 创建发票记录
	now := time.Now()
	taxRate := 0.01
	taxAmountFen := int64(math.Round(float64(order.Amount) * taxRate / (taxRate + 1)))

	inv := model.Invoice{
		Id:            invoice.GenerateInvoiceID(),
		OrderId:       order.Id,
		OrderNo:       order.OrderNo,
		UserId:        userID,
		InvoiceType:   req.InvoiceType,
		InvoiceLine:   req.InvoiceLine,
		BuyerName:     req.BuyerName,
		BuyerTaxNum:   req.BuyerTaxNum,
		BuyerTel:      req.BuyerTel,
		BuyerAddress:  req.BuyerAddress,
		BankName:      req.BankName,
		BankAccount:   req.BankAccount,
		BuyerPhone:    req.BuyerPhone,
		Email:         req.Email,
		InvoiceAmount: int64(order.Amount),
		TaxRate:       taxRate,
		TaxAmount:     taxAmountFen,
		ApplyTime:     &now,
		Request:       content,
	}

	if !billingResult.Success {
		// 开票失败
		inv.InvoiceStatus = model.InvoiceStatusFailed
		remark := "开票失败：" + billingResult.ErrorMessage
		if billingResult.ErrorCode != "" {
			remark += "（错误代码：" + billingResult.ErrorCode + "）"
		}
		inv.Remark = remark

		model.CreateInvoice(&inv)
		model.UpdateOrderInvoiceStatus(order.OrderNo, model.InvoiceStatusFailed)

		log.Printf("[Invoice] 开票失败, orderNo=%s, error=%s", req.OrderNo, billingResult.ErrorMessage)
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "发票申请失败：" + billingResult.ErrorMessage})
		return
	}

	// 开票提交成功（审核模式下 SerialNum 可能为空）
	inv.InvoiceStatus = model.InvoiceStatusApplying
	inv.SerialNum = billingResult.InvoiceSerialNum
	if billingResult.InvoiceSerialNum != "" {
		inv.Remark = "发票序列号：" + billingResult.InvoiceSerialNum
	} else {
		inv.Remark = "开票申请已提交，等待审核"
	}

	if err := model.CreateInvoice(&inv); err != nil {
		log.Printf("[Invoice] 创建发票记录失败, orderNo=%s, error=%v", req.OrderNo, err)
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "创建发票记录失败"})
		return
	}

	model.UpdateOrderInvoiceStatus(order.OrderNo, model.InvoiceStatusApplying)

	log.Printf("[Invoice] 发票申请成功, orderNo=%s, serialNum=%s", req.OrderNo, billingResult.InvoiceSerialNum)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "发票申请已提交，请等待开票完成",
		"data": gin.H{
			"invoice_id": inv.Id,
			"serial_num": billingResult.InvoiceSerialNum,
			"status":     inv.InvoiceStatus,
		},
	})
}

// OrgCreateInvoice 企业门户订单开票申请.
// POST /org-api/invoice/create
func OrgCreateInvoice(c *gin.Context) {
	orgId := c.GetInt("org_id")

	if invoice.GlobalClient == nil || !invoice.GlobalClient.IsConfigured() {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "发票服务暂未开通"})
		return
	}

	var req InvoiceCreateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "请求参数错误: " + err.Error()})
		return
	}

	if errMsg, ok := validateInvoiceRequest(&req); !ok {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": errMsg})
		return
	}

	var order model.Order
	err := model.DB.Table("orders").Where("order_no = ? AND org_id = ?", req.OrderNo, orgId).First(&order).Error
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "订单不存在"})
		return
	}
	if order.Status != "paid" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "当前订单状态不允许开票"})
		return
	}
	if order.InvoiceStatus != model.InvoiceStatusNone && order.InvoiceStatus != model.InvoiceStatusFailed {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "该订单已申请开票，请勿重复申请"})
		return
	}

	amountYuan := float64(order.Amount) / 100.0
	goodsName := order.PackageName
	if goodsName == "" {
		goodsName = "信息技术服务费"
	}

	sdkParams := &invoice.InvoiceCreateParams{
		OrderNo:      req.OrderNo,
		InvoiceType:  req.InvoiceType,
		BuyerName:    req.BuyerName,
		InvoiceLine:  req.InvoiceLine,
		BuyerTaxNum:  req.BuyerTaxNum,
		BuyerTel:     req.BuyerTel,
		BuyerAddress: req.BuyerAddress,
		BankName:     req.BankName,
		BankAccount:  req.BankAccount,
		BuyerPhone:   req.BuyerPhone,
		Email:        req.Email,
	}
	orderInfo := &invoice.OrderInfo{
		OrderNo: order.OrderNo,
		Amount:  amountYuan,
	}

	invoiceParams := invoice.GlobalClient.BuildBillingNewParams(sdkParams, orderInfo, goodsName)
	contentBytes, _ := json.Marshal(invoiceParams)
	content := string(contentBytes)
	billingResult := invoice.GlobalClient.RequestBillingNew(content)

	now := time.Now()
	taxRate := 0.01
	taxAmountFen := int64(math.Round(float64(order.Amount) * taxRate / (taxRate + 1)))
	inv := model.Invoice{
		Id:            invoice.GenerateInvoiceID(),
		OrderId:       order.Id,
		OrderNo:       order.OrderNo,
		UserId:        order.UserId,
		InvoiceType:   req.InvoiceType,
		InvoiceLine:   req.InvoiceLine,
		BuyerName:     req.BuyerName,
		BuyerTaxNum:   req.BuyerTaxNum,
		BuyerTel:      req.BuyerTel,
		BuyerAddress:  req.BuyerAddress,
		BankName:      req.BankName,
		BankAccount:   req.BankAccount,
		BuyerPhone:    req.BuyerPhone,
		Email:         req.Email,
		InvoiceAmount: int64(order.Amount),
		TaxRate:       taxRate,
		TaxAmount:     taxAmountFen,
		ApplyTime:     &now,
		Request:       content,
	}

	if !billingResult.Success {
		inv.InvoiceStatus = model.InvoiceStatusFailed
		remark := "开票失败：" + billingResult.ErrorMessage
		if billingResult.ErrorCode != "" {
			remark += "（错误代码：" + billingResult.ErrorCode + "）"
		}
		inv.Remark = remark
		model.CreateInvoice(&inv)
		model.UpdateOrderInvoiceStatus(order.OrderNo, model.InvoiceStatusFailed)
		log.Printf("[Invoice] 企业开票失败, orgId=%d, orderNo=%s, error=%s", orgId, req.OrderNo, billingResult.ErrorMessage)
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "发票申请失败：" + billingResult.ErrorMessage})
		return
	}

	inv.InvoiceStatus = model.InvoiceStatusApplying
	inv.SerialNum = billingResult.InvoiceSerialNum
	if billingResult.InvoiceSerialNum != "" {
		inv.Remark = "发票序列号：" + billingResult.InvoiceSerialNum
	} else {
		inv.Remark = "开票申请已提交，等待审核"
	}
	if err := model.CreateInvoice(&inv); err != nil {
		log.Printf("[Invoice] 创建企业发票记录失败, orgId=%d, orderNo=%s, error=%v", orgId, req.OrderNo, err)
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "创建发票记录失败"})
		return
	}

	model.UpdateOrderInvoiceStatus(order.OrderNo, model.InvoiceStatusApplying)
	log.Printf("[Invoice] 企业发票申请成功, orgId=%d, orderNo=%s, serialNum=%s", orgId, req.OrderNo, billingResult.InvoiceSerialNum)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "发票申请已提交，请等待开票完成",
		"data": gin.H{
			"invoice_id": inv.Id,
			"serial_num": billingResult.InvoiceSerialNum,
			"status":     inv.InvoiceStatus,
		},
	})
}

// ============== 查询发票 ==============

// GetInvoiceByOrderNo 根据订单号查询发票信息
// GET /api/invoice/query?order_no=xxx
func GetInvoiceByOrderNo(c *gin.Context) {
	userID := c.GetInt(ctxkey.Id)
	orderNo := c.Query("order_no")

	if orderNo == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "订单号不能为空"})
		return
	}

	// 1. 验证订单归属
	var order model.Order
	err := model.DB.Table("orders").Where("order_no = ?", orderNo).First(&order).Error
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "订单不存在"})
		return
	}
	if order.UserId != userID {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无权查看该订单的发票信息"})
		return
	}

	// 2. 查询发票
	inv, err := model.GetInvoiceByOrderNo(orderNo, userID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data": gin.H{
				"order_no":       orderNo,
				"invoice_status": model.InvoiceStatusNone,
				"message":        "该订单尚未申请发票",
			},
		})
		return
	}

	// 3. 如果申请中，主动查询最新状态
	if inv.InvoiceStatus == model.InvoiceStatusApplying && inv.SerialNum != "" {
		tryUpdateInvoiceStatus(inv, orderNo)
		// 重新查询
		inv, _ = model.GetInvoiceByOrderNo(orderNo, userID)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"invoice_id":     inv.Id,
			"order_no":       inv.OrderNo,
			"invoice_type":   inv.InvoiceType,
			"invoice_line":   inv.InvoiceLine,
			"buyer_name":     inv.BuyerName,
			"buyer_tax_num":  inv.BuyerTaxNum,
			"buyer_phone":    inv.BuyerPhone,
			"email":          inv.Email,
			"invoice_amount": inv.InvoiceAmount,
			"invoice_status": inv.InvoiceStatus,
			"invoice_url":    inv.InvoiceUrl,
			"remark":         inv.Remark,
			"apply_time":     inv.ApplyTime,
			"issue_time":     inv.IssueTime,
		},
	})
}

// tryUpdateInvoiceStatus 主动查询诺诺发票最新状态
func tryUpdateInvoiceStatus(inv *model.Invoice, orderNo string) {
	if invoice.GlobalClient == nil || !invoice.GlobalClient.IsConfigured() {
		return
	}

	queryResult := invoice.GlobalClient.QueryInvoiceResultAPI(inv.SerialNum, orderNo)

	if queryResult.Success && queryResult.InvoiceData != nil {
		invoiceURL := getStringFromMap(queryResult.InvoiceData, "c_jpg_url")
		if invoiceURL == "" {
			invoiceURL = getStringFromMap(queryResult.InvoiceData, "c_url")
		}

		if invoiceURL != "" {
			now := time.Now()
			detailJSON, _ := json.Marshal(queryResult.InvoiceData)

			model.UpdateInvoiceStatus(inv.Id, map[string]interface{}{
				"invoice_status": model.InvoiceStatusIssued,
				"invoice_url":    invoiceURL,
				"issue_time":     now,
				"detail":         string(detailJSON),
			})
			model.UpdateOrderInvoiceStatus(orderNo, model.InvoiceStatusIssued)

			log.Printf("[Invoice] 查询到发票已开具, orderNo=%s, url=%s", orderNo, invoiceURL)
		}
	}
}

// ============== 回调接口 ==============

// InvoiceCallback 发票回调接口（无需认证）
// POST /api/invoice/callback
func InvoiceCallback(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		log.Printf("[发票回调] 读取body失败: %v", err)
		c.JSON(http.StatusOK, gin.H{"status": "0001", "message": "处理失败"})
		return
	}

	bodyStr := string(body)
	log.Printf("[发票回调] 收到回调通知, body长度: %d", len(bodyStr))

	// 异步处理回调
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[发票回调] panic: %v", r)
			}
		}()
		handleInvoiceCallback(bodyStr)
	}()

	// 立即返回成功
	c.JSON(http.StatusOK, gin.H{"status": "0000", "message": "订单接收成功", "data": ""})
}

func handleInvoiceCallback(body string) {
	if body == "" {
		return
	}

	// 解析回调参数: operater=callback&content={URL编码JSON}&orderno=ORD...
	var orderNo, contentJSON string
	params := strings.Split(body, "&")
	for _, param := range params {
		if strings.HasPrefix(param, "orderno=") {
			orderNo = strings.TrimPrefix(param, "orderno=")
		} else if strings.HasPrefix(param, "content=") {
			contentJSON = strings.TrimPrefix(param, "content=")
		}
	}

	if orderNo == "" || contentJSON == "" {
		log.Printf("[发票回调] 参数不完整, body: %s", body)
		return
	}

	decodedContent, err := url.QueryUnescape(contentJSON)
	if err != nil {
		log.Printf("[发票回调] URL解码失败, orderNo=%s, error=%v", orderNo, err)
		return
	}

	var contentObj map[string]interface{}
	if err := json.Unmarshal([]byte(decodedContent), &contentObj); err != nil {
		log.Printf("[发票回调] JSON解析失败, orderNo=%s, error=%v", orderNo, err)
		return
	}

	// 查询发票记录
	inv, err := model.GetInvoiceByOrderNoOnly(orderNo)
	if err != nil {
		log.Printf("[发票回调] 未找到发票记录, orderNo=%s", orderNo)
		return
	}

	// 避免重复处理
	if inv.InvoiceStatus == model.InvoiceStatusIssued {
		log.Printf("[发票回调] 发票已处理, orderNo=%s", orderNo)
		return
	}

	// 提取发票URL
	invoiceURL := getStringFromMap(contentObj, "c_jpg_url")
	if invoiceURL == "" {
		invoiceURL = getStringFromMap(contentObj, "c_url")
	}

	now := time.Now()
	model.UpdateInvoiceStatus(inv.Id, map[string]interface{}{
		"invoice_status": model.InvoiceStatusIssued,
		"invoice_url":    invoiceURL,
		"detail":         body,
		"issue_time":     now,
	})

	model.UpdateOrderInvoiceStatus(orderNo, model.InvoiceStatusIssued)

	log.Printf("[发票回调] 处理完成, orderNo=%s, invoiceUrl=%s", orderNo, invoiceURL)
}

// ============== 辅助方法 ==============

func getStringFromMap(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// ============== 获取订单列表（含发票状态） ==============

// GetUserOrdersWithInvoice 获取用户订单列表（含发票状态）
// GET /api/invoice/orders
func GetUserOrdersWithInvoice(c *gin.Context) {
	userID := c.GetInt(ctxkey.Id)
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize
	statusFilter := strings.ToLower(strings.TrimSpace(c.Query("status")))

	var totalCount int64
	countQuery := model.DB.Table("orders").Where("user_id = ?", userID)
	if statusFilter != "" && statusFilter != "all" {
		if statusFilter == "paid" || statusFilter == "success" {
			countQuery = countQuery.Where("LOWER(status) IN ?", []string{"paid", "success"})
		} else if statusFilter == "settled" {
			countQuery = countQuery.Where("LOWER(status) IN ?", []string{"paid", "success", "refunded"})
		} else if statusFilter == "cancelled" || statusFilter == "canceled" || statusFilter == "cancel" {
			countQuery = countQuery.Where("LOWER(status) IN ?", []string{"cancelled", "canceled", "cancel"})
		} else {
			countQuery = countQuery.Where("LOWER(status) = ?", statusFilter)
		}
	}
	if err := countQuery.Count(&totalCount).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "统计订单总数失败"})
		return
	}

	var pendingInvoiceCount int64
	if err := model.DB.Table("orders").
		Where("user_id = ?", userID).
		Where("LOWER(status) IN ?", []string{"paid", "success"}).
		Where("(invoice_status = '' OR invoice_status IS NULL OR UPPER(invoice_status) IN ?)", []string{"NONE", "FAILED", "NOT_APPLIED"}).
		Count(&pendingInvoiceCount).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "统计待开票订单失败"})
		return
	}

	type OrderWithInvoice struct {
		Id            int        `json:"id"`
		OrderNo       string     `json:"order_no"`
		PackageName   string     `json:"package_name"`
		Amount        int        `json:"amount"`
		Quota         int64      `json:"quota"`
		Status        string     `json:"status"`
		InvoiceStatus string     `json:"invoice_status"`
		ExpiredAt     *time.Time `json:"expired_at"`
		PaidAt        *time.Time `json:"paid_at"`
		CreatedAt     time.Time  `json:"created_at"`
	}

	var orders []OrderWithInvoice
	query := model.DB.Table("orders").
		Select("id, order_no, package_name, amount, quota, status, invoice_status, expired_at, paid_at, created_at").
		Where("user_id = ?", userID)
	if statusFilter != "" && statusFilter != "all" {
		if statusFilter == "paid" || statusFilter == "success" {
			query = query.Where("LOWER(status) IN ?", []string{"paid", "success"})
		} else if statusFilter == "settled" {
			query = query.Where("LOWER(status) IN ?", []string{"paid", "success", "refunded"})
		} else if statusFilter == "cancelled" || statusFilter == "canceled" || statusFilter == "cancel" {
			query = query.Where("LOWER(status) IN ?", []string{"cancelled", "canceled", "cancel"})
		} else {
			query = query.Where("LOWER(status) = ?", statusFilter)
		}
	}
	err := query.
		Order("created_at DESC").
		Limit(pageSize).
		Offset(offset).
		Find(&orders).Error

	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取订单列表失败"})
		return
	}

	// 对金额做格式化输出
	type OrderResponse struct {
		Id            int        `json:"id"`
		OrderNo       string     `json:"order_no"`
		PackageName   string     `json:"package_name"`
		Amount        int        `json:"amount"`
		AmountYuan    string     `json:"amount_yuan"`
		Quota         int64      `json:"quota"`
		Status        string     `json:"status"`
		InvoiceStatus string     `json:"invoice_status"`
		ExpiredAt     *time.Time `json:"expired_at"`
		PaidAt        *time.Time `json:"paid_at"`
		CreatedAt     time.Time  `json:"created_at"`
	}

	var result []OrderResponse
	for _, o := range orders {
		result = append(result, OrderResponse{
			Id:            o.Id,
			OrderNo:       o.OrderNo,
			PackageName:   o.PackageName,
			Amount:        o.Amount,
			AmountYuan:    fmt.Sprintf("%.2f", float64(o.Amount)/100.0),
			Quota:         o.Quota,
			Status:        o.Status,
			InvoiceStatus: o.InvoiceStatus,
			ExpiredAt:     o.ExpiredAt,
			PaidAt:        o.PaidAt,
			CreatedAt:     o.CreatedAt,
		})
	}

	c.Header("X-Total-Orders", fmt.Sprintf("%d", totalCount))
	c.Header("X-Pending-Invoice-Orders", fmt.Sprintf("%d", pendingInvoiceCount))
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
		"pagination": gin.H{
			"page":                  page,
			"page_size":             pageSize,
			"total":                 totalCount,
			"pending_invoice_total": pendingInvoiceCount,
		},
	})
}

// GetUserInvoiceList 获取用户发票管理列表（专用接口）
// GET /api/invoice/list?page=1&page_size=20
func GetUserInvoiceList(c *gin.Context) {
	userID := c.GetInt(ctxkey.Id)
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize

	type InvoiceManageItem struct {
		OrderNo       string     `json:"order_no"`
		PackageName   string     `json:"package_name"`
		Amount        int        `json:"amount"`
		OrderStatus   string     `json:"order_status"`
		InvoiceStatus string     `json:"invoice_status"`
		InvoiceURL    string     `json:"invoice_url"`
		BuyerName     string     `json:"buyer_name"`
		ApplyTime     *time.Time `json:"apply_time"`
		IssueTime     *time.Time `json:"issue_time"`
		CreatedAt     time.Time  `json:"created_at"`
	}

	type orderRow struct {
		OrderNo       string    `json:"order_no"`
		PackageName   string    `json:"package_name"`
		Amount        int       `json:"amount"`
		OrderStatus   string    `json:"order_status"`
		InvoiceStatus string    `json:"invoice_status"`
		CreatedAt     time.Time `json:"created_at"`
	}

	var total int64
	if err := model.DB.Table("orders").
		Where("user_id = ?", userID).
		Where("LOWER(status) IN ?", []string{"paid", "success"}).
		Count(&total).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "统计发票列表失败"})
		return
	}

	var rows []orderRow
	if err := model.DB.Table("orders").
		Select("order_no, package_name, amount, status as order_status, invoice_status, created_at").
		Where("user_id = ?", userID).
		Where("LOWER(status) IN ?", []string{"paid", "success"}).
		Order("created_at DESC").
		Limit(pageSize).
		Offset(offset).
		Find(&rows).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取发票列表失败"})
		return
	}

	result := make([]InvoiceManageItem, 0, len(rows))
	for _, row := range rows {
		item := InvoiceManageItem{
			OrderNo:       row.OrderNo,
			PackageName:   row.PackageName,
			Amount:        row.Amount,
			OrderStatus:   row.OrderStatus,
			InvoiceStatus: row.InvoiceStatus,
			CreatedAt:     row.CreatedAt,
		}

		if inv, err := model.GetInvoiceByOrderNo(row.OrderNo, userID); err == nil && inv != nil {
			item.InvoiceURL = inv.InvoiceUrl
			item.BuyerName = inv.BuyerName
			item.ApplyTime = inv.ApplyTime
			item.IssueTime = inv.IssueTime
			// 发票表状态更可靠，优先返回发票表状态
			if inv.InvoiceStatus != "" {
				item.InvoiceStatus = inv.InvoiceStatus
			}
		}
		result = append(result, item)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
		"pagination": gin.H{
			"page":      page,
			"page_size": pageSize,
			"total":     total,
		},
	})
}

// AdminListInvoices 平台管理员发票管理列表.
// GET /api/invoice/admin/list?page=1&page_size=20&username=&enterprise=all&invoice_status=all
func AdminListInvoices(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize
	username := strings.TrimSpace(c.Query("username"))
	enterprise := strings.ToLower(strings.TrimSpace(c.Query("enterprise")))
	status := strings.ToUpper(strings.TrimSpace(c.Query("invoice_status")))

	base := model.DB.Table("invoices AS i").
		Joins("JOIN orders AS o ON o.order_no = i.order_no").
		Joins("LEFT JOIN organizations AS org ON org.id = o.org_id")
	if username != "" {
		like := "%" + username + "%"
		base = base.Where("o.username LIKE ? OR org.name LIKE ? OR i.buyer_name LIKE ?", like, like, like)
	}
	switch enterprise {
	case "true", "1", "enterprise":
		base = base.Where("o.org_id IS NOT NULL AND o.org_id > 0")
	case "false", "0", "personal":
		base = base.Where("o.org_id IS NULL OR o.org_id = 0")
	}
	if status != "" && status != "ALL" {
		base = base.Where("UPPER(i.invoice_status) = ?", status)
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "统计发票失败"})
		return
	}

	type adminInvoiceItem struct {
		InvoiceID     string     `json:"invoice_id"`
		OrderNo       string     `json:"order_no"`
		UserID        int        `json:"user_id"`
		Username      string     `json:"username"`
		OrgID         *int       `json:"org_id"`
		OrgName       string     `json:"org_name"`
		PackageName   string     `json:"package_name"`
		OrderAmount   int        `json:"order_amount"`
		InvoiceAmount int64      `json:"invoice_amount"`
		InvoiceType   string     `json:"invoice_type"`
		InvoiceLine   string     `json:"invoice_line"`
		InvoiceStatus string     `json:"invoice_status"`
		InvoiceURL    string     `json:"invoice_url"`
		BuyerName     string     `json:"buyer_name"`
		BuyerTaxNum   string     `json:"buyer_tax_num"`
		Email         string     `json:"email"`
		ApplyTime     *time.Time `json:"apply_time"`
		IssueTime     *time.Time `json:"issue_time"`
		CreatedAt     time.Time  `json:"created_at"`
	}
	var rows []adminInvoiceItem
	if err := base.
		Select(`i.id AS invoice_id, i.order_no, i.user_id, o.username, o.org_id, COALESCE(org.name, '') AS org_name,
			o.package_name, o.amount AS order_amount, i.invoice_amount, i.invoice_type, i.invoice_line,
			i.invoice_status, i.invoice_url, i.buyer_name, i.buyer_tax_num, i.email, i.apply_time,
			i.issue_time, i.created_at`).
		Order("i.created_at DESC").
		Limit(pageSize).
		Offset(offset).
		Find(&rows).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取发票列表失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    rows,
		"pagination": gin.H{
			"page":      page,
			"page_size": pageSize,
			"total":     total,
		},
	})
}
