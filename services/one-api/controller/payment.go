package controller

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/smartwalle/alipay/v3"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/core/notify"
	"github.com/wechatpay-apiv3/wechatpay-go/core/option"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/native"
	"github.com/wechatpay-apiv3/wechatpay-go/utils"
	"gorm.io/gorm"
)

// 微信支付配置（从环境变量读取，支持 .env 文件注入）
var WxPayConfig = struct {
	AppID          string
	MchID          string
	APIv3Key       string
	SerialNo       string
	PrivateKeyPath string
	PubKeyID       string
	PubKeyPath     string
	NotifyURL      string
}{
	AppID:          getEnvOrDefault("WECHAT_APP_ID", "wx95020644e79ce840"),
	MchID:          getEnvOrDefault("WECHAT_MCH_ID", "1104973994"),
	APIv3Key:       getEnvOrDefault("WECHAT_APIV3_KEY", "F7Q8Xn2A6c4B5sJZ0YkD3V9HUmRPTELW"),
	SerialNo:       getEnvOrDefault("WECHAT_SERIAL_NO", "21BB79CE0C99B256CC72DE238C288CB881D26CAB"),
	PrivateKeyPath: getEnvOrDefault("WECHAT_PRIVATE_KEY_PATH", `/data/cret/apiclient_key.pem`),
	PubKeyID:       getEnvOrDefault("WECHAT_PUB_KEY_ID", "PUB_KEY_ID_0111049739942026010600212263003800"),
	PubKeyPath:     getEnvOrDefault("WECHAT_PUB_KEY_PATH", `/data/cret/pub_key.pem`),
	NotifyURL:      getEnvOrDefault("WECHAT_NOTIFY_URL", "https://let-cliff-assess-blogging.trycloudflare.com"),
}

// 支付宝（当面付预下单 / 订单码）
var AlipayConfig = struct {
	AppID          string
	PrivateKey     string
	PrivateKeyPath string
	PublicKey      string
	PublicKeyPath  string
	NotifyURL      string
	GatewayURL     string
	SellerID       string
}{
	AppID:          strings.TrimSpace(os.Getenv("ALIPAY_APP_ID")),
	PrivateKey:     os.Getenv("ALIPAY_PRIVATE_KEY"),
	PrivateKeyPath: strings.TrimSpace(os.Getenv("ALIPAY_PRIVATE_KEY_PATH")),
	PublicKey:      os.Getenv("ALIPAY_PUBLIC_KEY"),
	PublicKeyPath:  strings.TrimSpace(os.Getenv("ALIPAY_PUBLIC_KEY_PATH")),
	NotifyURL:      strings.TrimSpace(os.Getenv("ALIPAY_NOTIFY_URL")),
	GatewayURL:     strings.TrimSpace(os.Getenv("ALIPAY_GATEWAY_URL")),
	SellerID:       strings.TrimSpace(os.Getenv("ALIPAY_SELLER_ID")),
}

// getEnvOrDefault 从环境变量读取，未设置则返回默认值
func getEnvOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func normalizePayType(s string) string {
	p := strings.ToLower(strings.TrimSpace(s))
	if p == "" {
		return "wechat"
	}
	switch p {
	case "wechat", "wxpay", "wechatpay", "weixin":
		return "wechat"
	case "alipay", "ali_pay":
		return "alipay"
	}
	return ""
}

func loadKeyPEM(content, path string) (string, error) {
	if path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("读取密钥文件失败: %w", err)
		}
		return string(b), nil
	}
	if content == "" {
		return "", fmt.Errorf("密钥未配置")
	}
	return strings.ReplaceAll(content, "\\n", "\n"), nil
}

func newAlipayClient() (*alipay.Client, error) {
	priv, err := loadKeyPEM(AlipayConfig.PrivateKey, AlipayConfig.PrivateKeyPath)
	if err != nil {
		return nil, err
	}
	pub, err := loadKeyPEM(AlipayConfig.PublicKey, AlipayConfig.PublicKeyPath)
	if err != nil {
		return nil, err
	}
	if AlipayConfig.AppID == "" {
		return nil, fmt.Errorf("ALIPAY_APP_ID 未配置")
	}
	isProd := !strings.EqualFold(os.Getenv("ALIPAY_SANDBOX"), "true")
	var opts []alipay.OptionFunc
	if AlipayConfig.GatewayURL != "" {
		if isProd {
			opts = append(opts, alipay.WithProductionGateway(AlipayConfig.GatewayURL))
		} else {
			opts = append(opts, alipay.WithSandboxGateway(AlipayConfig.GatewayURL))
		}
	}
	client, err := alipay.New(AlipayConfig.AppID, priv, isProd, opts...)
	if err != nil {
		return nil, fmt.Errorf("初始化支付宝客户端失败: %w", err)
	}
	if err := client.LoadAliPayPublicKey(pub); err != nil {
		return nil, fmt.Errorf("加载支付宝公钥失败: %w", err)
	}
	return client, nil
}

func alipayYuanFromFen(fen int) string {
	return fmt.Sprintf("%.2f", float64(fen)/100)
}

func alipayAmountMatchesOrder(totalYuan string, amountFen int) bool {
	f, err := strconv.ParseFloat(totalYuan, 64)
	if err != nil {
		return false
	}
	want := float64(amountFen) / 100
	return math.Abs(f-want) < 0.005
}

func generateOrderNo(userID int) string {
	// 订单号格式：P + 毫秒时间戳 + 4位随机数 + 6位固定宽度用户ID
	// 示例：P17764101903161234001234
	tsPart := time.Now().UnixMilli()
	randomPart := make([]byte, 2) // 2字节用于生成 0000-9999
	if _, err := rand.Read(randomPart); err != nil {
		fallback := time.Now().UnixNano() % 10000
		return fmt.Sprintf("P%d%04d%06d", tsPart, fallback, userID)
	}
	randomNum := int(randomPart[0])<<8 | int(randomPart[1])
	return fmt.Sprintf("P%d%04d%06d", tsPart, randomNum%10000, userID)
}

// pubKeyVerifier 用微信支付公钥实现验证接口
type pubKeyVerifier struct {
	keyID  string
	pubKey *rsa.PublicKey
}

func (v *pubKeyVerifier) GetSerial(_ context.Context) (string, error) { return v.keyID, nil }

func (v *pubKeyVerifier) Verify(_ context.Context, serialNo, message, signature string) error {
	if serialNo != v.keyID {
		return fmt.Errorf("公钥ID不匹配: got %s, want %s", serialNo, v.keyID)
	}
	sig, err := base64.StdEncoding.DecodeString(signature)
	if err != nil {
		return fmt.Errorf("解码签名失败: %w", err)
	}
	h := sha256.Sum256([]byte(message))
	return rsa.VerifyPKCS1v15(v.pubKey, crypto.SHA256, h[:], sig)
}

// newWxPayClient 创建微信支付客户端
func newWxPayClient(ctx context.Context) (*core.Client, error) {
	privateKey, err := utils.LoadPrivateKeyWithPath(WxPayConfig.PrivateKeyPath)
	if err != nil {
		return nil, fmt.Errorf("加载私钥失败: %w", err)
	}
	publicKey, err := utils.LoadPublicKeyWithPath(WxPayConfig.PubKeyPath)
	if err != nil {
		return nil, fmt.Errorf("加载公钥失败: %w", err)
	}
	return core.NewClient(ctx,
		option.WithWechatPayPublicKeyAuthCipher(
			WxPayConfig.MchID,
			WxPayConfig.SerialNo,
			privateKey,
			WxPayConfig.PubKeyID,
			publicKey,
		),
	)
}

// 订单结构
type Order struct {
	ID             int        `json:"id"`
	OrderNo        string     `json:"order_no"`
	UserID         int        `json:"user_id"`
	Username       string     `json:"username"`
	PackageID      int        `json:"package_id"`
	PackageName    string     `json:"package_name"`
	Amount         int        `json:"amount"`
	OriginalAmount int        `json:"original_amount" gorm:"column:original_amount"`
	DiscountAmount int        `json:"discount_amount" gorm:"column:discount_amount"`
	Quota          int64      `json:"quota"`
	BillingCycle   string     `json:"billing_cycle"`
	SubscriptionId int        `json:"subscription_id"`
	PayType        string     `json:"pay_type"`
	Status         string     `json:"status"`
	TransactionID  string     `json:"transaction_id"`
	CodeUrl        string     `json:"code_url"`
	PaidAt         *time.Time `json:"paid_at" gorm:"column:paid_at"`
	ExpiredAt      *time.Time `json:"expired_at" gorm:"column:expired_at"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	OrgId          *int       `json:"org_id" gorm:"column:org_id"`
	InviteCode     string     `json:"invite_code" gorm:"type:varchar(32)"`
	InviteDiscount int        `json:"invite_discount" gorm:"default:0"` // 抵扣金额（分）
}

// PLACEHOLDER_FOR_MORE_CODE

// 获取充值套餐列表
func GetRechargePackages(c *gin.Context) {
	packages, err := model.GetAllRechargePackages()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "获取套餐列表失败",
		})
		return
	}

	// 附加 effective_level：套餐真实生效等级取自关联会员身份的 package_level，
	// 与套餐表的 level 列可能不一致。前端升级/同级/降级判定必须用 effective_level，
	// 否则会用错位的 level 列误判（高等级买低等级仍打开支付弹窗）。
	type packageWithLevel struct {
		*model.RechargePackage
		EffectiveLevel int `json:"effective_level"`
	}
	resp := make([]packageWithLevel, 0, len(packages))
	for _, pkg := range packages {
		resp = append(resp, packageWithLevel{RechargePackage: pkg, EffectiveLevel: pkg.EffectiveLevel()})
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    resp,
	})
}

// 创建订单请求
type CreateOrderRequest struct {
	PackageID    int    `json:"package_id"`
	PayType      string `json:"pay_type"`      // wechat/alipay
	BillingCycle string `json:"billing_cycle"` // monthly/yearly
	InviteCode   string `json:"invite_code"`   // 邀请码（可选）
}

// PLACEHOLDER_FOR_CREATE_ORDER

// 创建订单
func CreatePaymentOrder(c *gin.Context) {
	userID := c.GetInt(ctxkey.Id)
	username := c.GetString(ctxkey.Username)

	var req CreateOrderRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "参数错误",
		})
		return
	}

	// 获取套餐信息
	pkg, err := model.GetRechargePackageById(req.PackageID)
	if err != nil || !pkg.Enabled || !pkg.IsPersonalScope() {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "个人订阅套餐不存在",
		})
		return
	}

	// 订阅时长由商品「时长」字段决定; billing_cycle 仅为兼容下游(年付校验/订阅记录)而派生:
	// 时长单位为 year 视为年付, 其余视为月付. 入参 billing_cycle 已忽略.
	billingCycle := "monthly"
	if pkg.DurationUnit == "year" {
		billingCycle = "yearly"
	}

	// 订阅金额按套餐周期取实际售价:月付/年付折扣价优先,回退原周期价,再回退 price.
	orderAmount := pkg.EffectivePrice()

	// 订阅升级校验（仅订阅类套餐；加油包/额度包只增加积分，不涉及会员等级，跳过）
	isSubscription := pkg.PackageType != "quota"
	activeSubs, _ := model.GetActiveSubscriptionsByUserId(userID)
	if isSubscription && len(activeSubs) > 0 {
		maxLevel := 0
		hasYearly := false
		for _, sub := range activeSubs {
			if sub.PackageLevel > maxLevel {
				maxLevel = sub.PackageLevel
			}
			if sub.BillingCycle == "yearly" {
				hasYearly = true
			}
		}
		if pkg.EffectiveLevel() < maxLevel {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "当前为更高等级会员，订阅到期后可更换购买。如需更多积分，可购买增值包。",
			})
			return
		}
		if hasYearly && billingCycle == "monthly" {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "年费会员只能购买年费套餐",
			})
			return
		}
	}

	// 队列模型(T1-4):升级不再折抵差价。历史付费不动——旧块原样排队/冻结,本单按目标套餐全价计费
	// (见规则文档诉求5「历史付费不动」、§7 市场对照)。originalAmount 等于实付,无升级折抵。
	originalAmount := orderAmount
	discountAmount := 0

	payType := normalizePayType(req.PayType)
	if payType == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "不支持的支付方式",
		})
		return
	}
	if payType == "alipay" {
		if AlipayConfig.NotifyURL == "" {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "支付宝支付未配置：请设置 ALIPAY_NOTIFY_URL",
			})
			return
		}
		if _, err := newAlipayClient(); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": fmt.Sprintf("支付宝未正确配置: %v", err),
			})
			return
		}
	}

	// 生成订单号（防止同一秒内重复点击导致冲突）
	orderNo := generateOrderNo(userID)

	// 设置过期时间（30分钟）- 使用本地时区
	loc, _ := time.LoadLocation("Asia/Shanghai")
	expiredAt := time.Now().In(loc).Add(30 * time.Minute)

	// 创建订单
	order := Order{
		OrderNo:        orderNo,
		UserID:         userID,
		Username:       username,
		PackageID:      req.PackageID,
		PackageName:    pkg.Name,
		Amount:         orderAmount,
		OriginalAmount: originalAmount,
		DiscountAmount: discountAmount,
		Quota:          pkg.CalcQuota(),
		BillingCycle:   billingCycle,
		PayType:        payType,
		Status:         "pending",
		PaidAt:         nil,        // 未支付时为 nil
		ExpiredAt:      &expiredAt, // 过期时间
	}

	// 处理邀请码抵扣
	if req.InviteCode != "" {
		deduction, err := model.GetInviteDeductionAmount(req.InviteCode)
		if err == nil && deduction > 0 {
			discount := int(deduction)
			if discount > orderAmount {
				discount = orderAmount
			}
			order.Amount = orderAmount - discount
			order.InviteDiscount = discount
			order.InviteCode = req.InviteCode
		}
	}

	err = model.DB.Table("orders").Create(&order).Error
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "创建订单失败",
		})
		return
	}

	ctx := c.Request.Context()
	var codeURL string

	switch payType {
	case "alipay":
		aliClient, err := newAlipayClient()
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": fmt.Sprintf("初始化支付宝客户端失败: %v", err),
			})
			return
		}
		var pre alipay.TradePreCreate
		pre.NotifyURL = AlipayConfig.NotifyURL
		pre.Subject = pkg.Name
		pre.OutTradeNo = orderNo
		pre.TotalAmount = alipayYuanFromFen(orderAmount)
		pre.ProductCode = "FACE_TO_FACE_PAYMENT"
		pre.TimeoutExpress = "15m"
		if AlipayConfig.SellerID != "" {
			pre.SellerId = AlipayConfig.SellerID
		}
		aliResp, err := aliClient.TradePreCreate(ctx, pre)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": fmt.Sprintf("创建支付宝订单失败: %v", err),
			})
			return
		}
		if aliResp == nil || !aliResp.IsSuccess() {
			msg := "支付宝预下单失败"
			if aliResp != nil && aliResp.SubMsg != "" {
				msg = fmt.Sprintf("%s: %s", msg, aliResp.SubMsg)
			}
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": msg,
			})
			return
		}
		if aliResp.QRCode == "" {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "支付宝未返回二维码数据",
			})
			return
		}
		codeURL = aliResp.QRCode

	default:
		client, err := newWxPayClient(ctx)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": fmt.Sprintf("初始化支付客户端失败: %v", err),
			})
			return
		}

		svc := native.NativeApiService{Client: client}
		resp, _, err := svc.Prepay(ctx, native.PrepayRequest{
			Appid:       core.String(WxPayConfig.AppID),
			Mchid:       core.String(WxPayConfig.MchID),
			Description: core.String(pkg.Name),
			OutTradeNo:  core.String(orderNo),
			TimeExpire:  core.Time(time.Now().Add(15 * time.Minute)),
			NotifyUrl:   core.String(WxPayConfig.NotifyURL),
			Amount: &native.Amount{
				Total:    core.Int64(int64(orderAmount)),
				Currency: core.String("CNY"),
			},
		})
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": fmt.Sprintf("创建支付订单失败: %v", err),
			})
			return
		}
		codeURL = *resp.CodeUrl
	}

	err = model.DB.Table("orders").
		Where("order_no = ?", orderNo).
		Update("code_url", codeURL).Error
	if err != nil {
		fmt.Printf("保存二维码链接失败: %v\n", err)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"order_no":        orderNo,
			"code_url":        codeURL,
			"amount":          orderAmount,
			"original_amount": originalAmount,
			"discount_amount": discountAmount,
			"status":          "pending",
			"pay_type":        payType,
			"billing_cycle":   billingCycle,
		},
	})
}

// PLACEHOLDER_FOR_GET_ORDER

// createPaymentQRCode 为已落库的订单生成支付二维码(微信/支付宝),返回二维码链接.
// 供个人下单与企业充值下单复用,只负责调第三方预下单,不写库.
func createPaymentQRCode(ctx context.Context, payType, orderNo, subject string, amountFen int) (string, error) {
	switch payType {
	case "alipay":
		if AlipayConfig.NotifyURL == "" {
			return "", fmt.Errorf("支付宝支付未配置：请设置 ALIPAY_NOTIFY_URL")
		}
		aliClient, err := newAlipayClient()
		if err != nil {
			return "", fmt.Errorf("初始化支付宝客户端失败: %v", err)
		}
		var pre alipay.TradePreCreate
		pre.NotifyURL = AlipayConfig.NotifyURL
		pre.Subject = subject
		pre.OutTradeNo = orderNo
		pre.TotalAmount = alipayYuanFromFen(amountFen)
		pre.ProductCode = "FACE_TO_FACE_PAYMENT"
		pre.TimeoutExpress = "15m"
		if AlipayConfig.SellerID != "" {
			pre.SellerId = AlipayConfig.SellerID
		}
		aliResp, err := aliClient.TradePreCreate(ctx, pre)
		if err != nil {
			return "", fmt.Errorf("创建支付宝订单失败: %v", err)
		}
		if aliResp == nil || !aliResp.IsSuccess() {
			msg := "支付宝预下单失败"
			if aliResp != nil && aliResp.SubMsg != "" {
				msg = fmt.Sprintf("%s: %s", msg, aliResp.SubMsg)
			}
			return "", fmt.Errorf("%s", msg)
		}
		if aliResp.QRCode == "" {
			return "", fmt.Errorf("支付宝未返回二维码数据")
		}
		return aliResp.QRCode, nil
	default:
		client, err := newWxPayClient(ctx)
		if err != nil {
			return "", fmt.Errorf("初始化支付客户端失败: %v", err)
		}
		svc := native.NativeApiService{Client: client}
		resp, _, err := svc.Prepay(ctx, native.PrepayRequest{
			Appid:       core.String(WxPayConfig.AppID),
			Mchid:       core.String(WxPayConfig.MchID),
			Description: core.String(subject),
			OutTradeNo:  core.String(orderNo),
			TimeExpire:  core.Time(time.Now().Add(15 * time.Minute)),
			NotifyUrl:   core.String(WxPayConfig.NotifyURL),
			Amount: &native.Amount{
				Total:    core.Int64(int64(amountFen)),
				Currency: core.String("CNY"),
			},
		})
		if err != nil {
			return "", fmt.Errorf("创建支付订单失败: %v", err)
		}
		if resp == nil || resp.CodeUrl == nil || *resp.CodeUrl == "" {
			return "", fmt.Errorf("微信支付未返回二维码数据")
		}
		return *resp.CodeUrl, nil
	}
}

// syncPaidOrderFromProvider 在异步回调缺失/延迟时主动向支付平台查单。
// 仅处理 pending 订单；确认支付成功后翻转本地订单状态并调用统一发放入口。
func syncPaidOrderFromProvider(ctx context.Context, order Order) (Order, error) {
	if order.Status != "pending" {
		return order, nil
	}

	orderNo := order.OrderNo
	switch strings.ToLower(strings.TrimSpace(order.PayType)) {
	case "alipay":
		fmt.Printf("订单 %s 状态为 pending，尝试主动查询支付宝订单状态\n", orderNo)
		aliClient, err := newAlipayClient()
		if err != nil {
			return order, err
		}
		qresp, err := aliClient.TradeQuery(ctx, alipay.TradeQuery{OutTradeNo: orderNo})
		if err != nil || qresp == nil || !qresp.IsSuccess() {
			return order, err
		}
		st := qresp.TradeStatus
		if st != alipay.TradeStatusSuccess && st != alipay.TradeStatusFinished {
			return order, nil
		}
		if !alipayAmountMatchesOrder(qresp.TotalAmount, order.Amount) {
			return order, fmt.Errorf("支付宝订单金额不匹配: 查询=%s 本地=%d 分", qresp.TotalAmount, order.Amount)
		}

		loc, _ := time.LoadLocation("Asia/Shanghai")
		now := time.Now().In(loc)
		tid := qresp.TradeNo
		result := model.DB.Table("orders").
			Where("order_no = ? AND status = ?", orderNo, "pending").
			Updates(map[string]interface{}{
				"status":         "paid",
				"transaction_id": tid,
				"paid_at":        now,
			})
		if result.Error != nil {
			return order, result.Error
		}
		if result.RowsAffected == 0 {
			order.Status = "paid"
			return order, nil
		}
		if err := fulfillOrder(order); err != nil {
			return order, err
		}
		order.Status = "paid"
		order.TransactionID = tid
		order.PaidAt = &now
		return order, nil

	default:
		fmt.Printf("订单 %s 状态为 pending，尝试主动查询微信支付状态\n", orderNo)
		client, err := newWxPayClient(ctx)
		if err != nil {
			return order, err
		}
		svc := native.NativeApiService{Client: client}
		result, _, err := svc.QueryOrderByOutTradeNo(ctx, native.QueryOrderByOutTradeNoRequest{
			Mchid:      core.String(WxPayConfig.MchID),
			OutTradeNo: core.String(orderNo),
		})
		if err != nil || result == nil || result.TradeState == nil || *result.TradeState != "SUCCESS" {
			return order, err
		}

		loc, _ := time.LoadLocation("Asia/Shanghai")
		now := time.Now().In(loc)
		transactionID := ""
		if result.TransactionId != nil {
			transactionID = *result.TransactionId
		}
		update := map[string]interface{}{
			"status":  "paid",
			"paid_at": now,
		}
		if transactionID != "" {
			update["transaction_id"] = transactionID
		}
		dbResult := model.DB.Table("orders").
			Where("order_no = ? AND status = ?", orderNo, "pending").
			Updates(update)
		if dbResult.Error != nil {
			return order, dbResult.Error
		}
		if dbResult.RowsAffected == 0 {
			order.Status = "paid"
			return order, nil
		}
		if err := fulfillOrder(order); err != nil {
			return order, err
		}
		order.Status = "paid"
		order.TransactionID = transactionID
		order.PaidAt = &now
		return order, nil
	}
}

// 查询订单状态
func QueryPaymentOrder(c *gin.Context) {
	userID := c.GetInt(ctxkey.Id)
	orderNo := c.Query("order_no")

	if orderNo == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "订单号不能为空",
		})
		return
	}

	var order Order
	err := model.DB.Table("orders").
		Where("order_no = ? AND user_id = ?", orderNo, userID).
		First(&order).Error

	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "订单不存在",
		})
		return
	}

	// 订单仍为 pending 时主动向第三方查单。syncPaidOrderFromProvider 内部已正确
	// 处理「UPDATE...AND status='pending'」的 RowsAffected 守卫,避免与回调并发时双发。
	if order.Status == "pending" {
		if synced, syncErr := syncPaidOrderFromProvider(c.Request.Context(), order); syncErr == nil {
			order = synced
		} else {
			fmt.Printf("主动查询订单 %s 失败: %v\n", orderNo, syncErr)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"order_no": order.OrderNo,
			"status":   order.Status,
			"amount":   order.Amount,
			"code_url": order.CodeUrl,
			"paid_at":  order.PaidAt,
			"pay_type": order.PayType,
		},
	})
}

// 获取用户订单列表
func GetUserOrders(c *gin.Context) {
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
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "统计订单总数失败",
		})
		return
	}

	var orders []Order
	query := model.DB.Table("orders").
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
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "获取订单列表失败",
		})
		return
	}

	c.Header("X-Total-Orders", fmt.Sprintf("%d", totalCount))
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    orders,
		"pagination": gin.H{
			"page":      page,
			"page_size": pageSize,
			"total":     totalCount,
		},
	})
}

// AdminListPaymentOrders 平台管理员订单总表,支持用户名与个人/企业订单筛选.
func AdminListPaymentOrders(c *gin.Context) {
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
	status := strings.ToLower(strings.TrimSpace(c.DefaultQuery("status", "paid")))

	base := model.DB.Table("orders AS o").
		Joins("LEFT JOIN organizations AS org ON org.id = o.org_id")
	if username != "" {
		like := "%" + username + "%"
		base = base.Where("o.username LIKE ? OR org.name LIKE ?", like, like)
	}
	switch enterprise {
	case "true", "1", "enterprise":
		base = base.Where("o.org_id IS NOT NULL AND o.org_id > 0")
	case "false", "0", "personal":
		base = base.Where("o.org_id IS NULL OR o.org_id = 0")
	}
	if status != "" && status != "all" {
		switch status {
		case "paid", "success":
			base = base.Where("LOWER(o.status) IN ?", []string{"paid", "success"})
		case "cancelled", "canceled", "cancel":
			base = base.Where("LOWER(o.status) IN ?", []string{"cancelled", "canceled", "cancel"})
		default:
			base = base.Where("LOWER(o.status) = ?", status)
		}
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "统计订单失败"})
		return
	}

	type adminOrder struct {
		ID            int        `json:"id"`
		OrderNo       string     `json:"order_no"`
		UserID        int        `json:"user_id"`
		Username      string     `json:"username"`
		OrgID         *int       `json:"org_id"`
		OrgName       string     `json:"org_name"`
		PackageName   string     `json:"package_name"`
		Amount        int        `json:"amount"`
		Quota         int64      `json:"quota"`
		PayType       string     `json:"pay_type"`
		Status        string     `json:"status"`
		InvoiceStatus string     `json:"invoice_status"`
		PaidAt        *time.Time `json:"paid_at"`
		CreatedAt     time.Time  `json:"created_at"`
	}
	var orders []adminOrder
	if err := base.
		Select("o.id, o.order_no, o.user_id, o.username, o.org_id, COALESCE(org.name, '') AS org_name, o.package_name, o.amount, o.quota, o.pay_type, o.status, o.invoice_status, o.paid_at, o.created_at").
		Order("o.created_at DESC").
		Limit(pageSize).
		Offset(offset).
		Find(&orders).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取订单列表失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    orders,
		"pagination": gin.H{
			"page":      page,
			"page_size": pageSize,
			"total":     total,
		},
	})
}

// 退积分请求
type RefundOrderRequest struct {
	OrderNo string `json:"order_no"`
}

// refundOrderCore 执行一笔已支付订单的退积分,返回实际扣回的积分数.
// 现金退款由财务线下处理,这里只回收积分,并保证扣减后用户/企业剩余积分 >= 0.
//
// 幂等:第一步带 status='paid' 守卫翻转订单状态,RowsAffected==0 即拒绝(已退过/状态不符).
// 扣减语义:
//   - 个人订单:若关联订阅仍 active,先撤销订阅并清零订阅积分账本(避免续期 cron 重发);
//     再对差额走 DecreaseUserQuota 补扣(内部按到期顺序扣,扣到账本耗尽即止,不会扣成负数).
//   - 企业订单:对 min(订单积分, 当前可用) 走 DecreaseOrgQuotaByLedger(先 clamp,避免余额不足报错).
//
// 设计取舍:沿用 fulfillOrder 风格,不包外层大事务——各扣减函数自带事务且 clamp 安全,
// 状态守卫作为幂等第一道防线;扣减若失败写 SysError 告警,不回滚已翻转的状态.
func refundOrderCore(order Order, adminId int, adminName string) (int64, error) {
	if order.Status != "paid" {
		return 0, fmt.Errorf("仅已支付订单可退款")
	}

	// 幂等守卫:只有把 paid 成功翻成 refunded 的那一次调用才继续执行扣减
	affected, err := model.MarkOrderRefunded(order.OrderNo)
	if err != nil {
		return 0, fmt.Errorf("更新订单状态失败: %w", err)
	}
	if affected == 0 {
		return 0, fmt.Errorf("订单不可退款（可能已退积分或状态不符）")
	}

	var actualRefund int64
	var beforeQuota int64

	if order.OrgId != nil && *order.OrgId > 0 {
		// 企业订单:从企业积分账本扣回
		orgId := *order.OrgId
		avail, err := model.GetOrgAvailableQuota(orgId)
		if err != nil {
			logger.SysError(fmt.Sprintf("退积分读取企业余额失败 order=%s org=%d: %v", order.OrderNo, orgId, err))
			return 0, fmt.Errorf("读取企业余额失败: %w", err)
		}
		beforeQuota = avail
		actualRefund = order.Quota
		if actualRefund > avail {
			actualRefund = avail
		}
		if actualRefund > 0 {
			if _, err := model.DecreaseOrgQuotaByLedger(orgId, actualRefund); err != nil {
				logger.SysError(fmt.Sprintf("退积分扣减企业额度失败 order=%s org=%d refund=%d: %v", order.OrderNo, orgId, actualRefund, err))
				return 0, fmt.Errorf("扣减企业积分失败: %w", err)
			}
		}
	} else {
		// 个人订单:按订单回收(T2,见规则文档 §6)。只清本单订阅积分余量(已花不倒扣、不碰其它订单),
		// 移除本单身份块、未生效块前移,被退块是当前身份则恢复队首 frozen 块。
		availBefore, err := model.GetUserQuota(order.UserID)
		if err != nil {
			logger.SysError(fmt.Sprintf("退积分读取用户余额失败 order=%s user=%d: %v", order.OrderNo, order.UserID, err))
			return 0, fmt.Errorf("读取用户余额失败: %w", err)
		}
		beforeQuota = availBefore

		now := time.Now()
		if err := model.DB.Transaction(func(tx *gorm.DB) error {
			refunded, err := model.RefundOrderSubscriptionTx(tx, order.UserID, order.OrderNo, now)
			if err != nil {
				return err
			}
			actualRefund = refunded
			return nil
		}); err != nil {
			logger.SysError(fmt.Sprintf("退积分按订单回收失败 order=%s user=%d: %v", order.OrderNo, order.UserID, err))
			return 0, fmt.Errorf("回收订阅权益失败: %w", err)
		}
	}

	// 写一条负向充值记录,便于对账与审计
	record := RechargeRecord{
		UserID:      order.UserID,
		Username:    order.Username,
		OrderNo:     order.OrderNo,
		Quota:       -actualRefund,
		BeforeQuota: beforeQuota,
		AfterQuota:  beforeQuota - actualRefund,
		Remark:      fmt.Sprintf("订单退积分(管理员 %s,退回 %d 积分)", adminName, actualRefund),
	}
	if order.OrgId != nil && *order.OrgId > 0 {
		record.OrgID = *order.OrgId
	}
	if err := model.DB.Table("recharge_records").Create(&record).Error; err != nil {
		logger.SysError(fmt.Sprintf("退积分写充值记录失败 order=%s: %v", order.OrderNo, err))
	}

	return actualRefund, nil
}

// AdminRefundOrder 平台管理员对已支付订单退积分(现金退款由财务线下处理).
func AdminRefundOrder(c *gin.Context) {
	var req RefundOrderRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	req.OrderNo = strings.TrimSpace(req.OrderNo)
	if req.OrderNo == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "订单号不能为空"})
		return
	}

	var order Order
	if err := model.DB.Table("orders").Where("order_no = ?", req.OrderNo).First(&order).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "订单不存在"})
		return
	}
	if order.Status != "paid" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "仅已支付订单可退款"})
		return
	}

	adminId := c.GetInt(ctxkey.Id)
	adminName := c.GetString(ctxkey.Username)
	refunded, err := refundOrderCore(order, adminId, adminName)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "退积分成功",
		"data":    gin.H{"refunded_quota": refunded},
	})
}

// 充值记录结构
type RechargeRecord struct {
	ID          int       `json:"id"`
	UserID      int       `json:"user_id"`
	OrgID       int       `json:"org_id"`
	Username    string    `json:"username"`
	OrderNo     string    `json:"order_no"`
	Quota       int64     `json:"quota"`
	BeforeQuota int64     `json:"before_quota"`
	AfterQuota  int64     `json:"after_quota"`
	Remark      string    `json:"remark"`
	CreatedAt   time.Time `json:"created_at"`
}

// 获取用户充值记录
func GetUserRechargeRecords(c *gin.Context) {
	userID := c.GetInt(ctxkey.Id)

	var records []RechargeRecord
	err := model.DB.Table("recharge_records").
		Where("user_id = ?", userID).
		Where("org_id = 0 OR org_id IS NULL").
		Order("created_at DESC").
		Limit(50).
		Find(&records).Error

	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "获取充值记录失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    records,
	})
}

// 取消订单请求
type CancelOrderRequest struct {
	OrderNo string `json:"order_no"`
}

// 取消订单
func CancelOrder(c *gin.Context) {
	userID := c.GetInt(ctxkey.Id)

	var req CancelOrderRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "参数错误",
		})
		return
	}

	if req.OrderNo == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "订单号不能为空",
		})
		return
	}

	// 查询订单
	var order Order
	err := model.DB.Table("orders").
		Where("order_no = ? AND user_id = ?", req.OrderNo, userID).
		First(&order).Error

	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "订单不存在",
		})
		return
	}

	// 只能取消待支付的订单
	if order.Status != "pending" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "订单状态不允许取消",
		})
		return
	}

	ctx := c.Request.Context()
	switch strings.ToLower(strings.TrimSpace(order.PayType)) {
	case "alipay":
		if aliClient, err := newAlipayClient(); err == nil {
			_, err := aliClient.TradeClose(ctx, alipay.TradeClose{OutTradeNo: req.OrderNo})
			if err != nil {
				fmt.Printf("调用支付宝关单接口失败: %v\n", err)
			} else {
				fmt.Printf("成功关闭支付宝订单: %s\n", req.OrderNo)
			}
		} else {
			fmt.Printf("初始化支付宝客户端失败: %v\n", err)
		}
	default:
		client, err := newWxPayClient(ctx)
		if err == nil {
			svc := native.NativeApiService{Client: client}
			_, err := svc.CloseOrder(ctx, native.CloseOrderRequest{
				Mchid:      core.String(WxPayConfig.MchID),
				OutTradeNo: core.String(req.OrderNo),
			})
			if err != nil {
				fmt.Printf("调用微信关闭订单接口失败: %v\n", err)
			} else {
				fmt.Printf("成功关闭微信订单: %s\n", req.OrderNo)
			}
		} else {
			fmt.Printf("初始化微信支付客户端失败: %v\n", err)
		}
	}

	// 更新订单状态为已取消
	err = model.DB.Table("orders").
		Where("order_no = ?", req.OrderNo).
		Update("status", "cancelled").Error

	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "取消订单失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "订单已取消",
	})
}

// 自动处理过期订单（定时任务）
func AutoExpireOrders() {
	// 查询所有待支付且已过期的订单
	var orders []Order
	now := time.Now()

	err := model.DB.Table("orders").
		Where("status = ? AND expired_at < ?", "pending", now).
		Find(&orders).Error

	if err != nil {
		fmt.Printf("查询过期订单失败: %v\n", err)
		return
	}

	if len(orders) == 0 {
		return
	}

	fmt.Printf("发现 %d 个过期订单，开始处理...\n", len(orders))

	ctx := context.Background()
	wxClient, wxErr := newWxPayClient(ctx)
	if wxErr != nil {
		fmt.Printf("初始化微信支付客户端失败: %v\n", wxErr)
	}
	aliClient, aliErr := newAlipayClient()
	if aliErr != nil {
		fmt.Printf("初始化支付宝客户端失败: %v\n", aliErr)
	}

	// 批量更新订单状态为已过期
	for _, order := range orders {
		switch strings.ToLower(strings.TrimSpace(order.PayType)) {
		case "alipay":
			if aliClient != nil {
				_, err := aliClient.TradeClose(ctx, alipay.TradeClose{OutTradeNo: order.OrderNo})
				if err != nil {
					fmt.Printf("关闭支付宝订单 %s 失败: %v\n", order.OrderNo, err)
				} else {
					fmt.Printf("成功关闭支付宝订单: %s\n", order.OrderNo)
				}
			}
		default:
			if wxClient != nil {
				svc := native.NativeApiService{Client: wxClient}
				_, err := svc.CloseOrder(ctx, native.CloseOrderRequest{
					Mchid:      core.String(WxPayConfig.MchID),
					OutTradeNo: core.String(order.OrderNo),
				})
				if err != nil {
					fmt.Printf("关闭微信订单 %s 失败: %v\n", order.OrderNo, err)
				} else {
					fmt.Printf("成功关闭微信订单: %s\n", order.OrderNo)
				}
			}
		}

		// 更新本地订单状态(只翻 pending,避免与回调并发时把已 paid 订单覆盖成 expired)
		err := model.DB.Table("orders").
			Where("order_no = ? AND status = ?", order.OrderNo, "pending").
			Update("status", "expired").Error

		if err != nil {
			fmt.Printf("更新订单 %s 状态失败: %v\n", order.OrderNo, err)
		} else {
			fmt.Printf("订单 %s 已自动过期\n", order.OrderNo)
		}
	}
}

// 支付回调通知
func PaymentNotify(c *gin.Context) {
	ctx := c.Request.Context()

	fmt.Println("=== 收到微信支付回调 ===")
	fmt.Printf("请求头: Wechatpay-Serial=%s, Wechatpay-Timestamp=%s\n",
		c.GetHeader("Wechatpay-Serial"),
		c.GetHeader("Wechatpay-Timestamp"))

	// 1. 验证时间戳，防止重放攻击（5分钟内有效）
	timestamp := c.GetHeader("Wechatpay-Timestamp")
	if timestamp != "" {
		ts, err := time.Parse("2006-01-02 15:04:05", timestamp)
		if err == nil {
			if time.Since(ts) > 5*time.Minute {
				fmt.Printf("回调时间戳过期: %s\n", timestamp)
				c.JSON(http.StatusBadRequest, gin.H{
					"code":    "FAIL",
					"message": "回调时间戳过期",
				})
				return
			}
		}
	}

	// 2. 加载微信支付公钥，用于回调验签
	publicKey, err := utils.LoadPublicKeyWithPath(WxPayConfig.PubKeyPath)
	if err != nil {
		fmt.Printf("加载公钥失败: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "FAIL",
			"message": "加载公钥失败",
		})
		return
	}

	// 3. 验签
	verifier := &pubKeyVerifier{keyID: WxPayConfig.PubKeyID, pubKey: publicKey}
	handler, err := notify.NewRSANotifyHandler(WxPayConfig.APIv3Key, verifier)
	if err != nil {
		fmt.Printf("初始化回调处理器失败: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    "FAIL",
			"message": "初始化回调处理器失败",
		})
		return
	}

	transaction := new(payments.Transaction)
	notifyReq, err := handler.ParseNotifyRequest(ctx, c.Request, transaction)
	if err != nil {
		fmt.Printf("解析回调失败（验签失败）: %v\n", err)
		// 验签失败返回 400
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "FAIL",
			"message": "验签失败",
		})
		return
	}

	fmt.Printf("回调ID: %s, 事件类型: %s\n", notifyReq.ID, notifyReq.EventType)
	fmt.Printf("交易状态: %s, 订单号: %s\n", *transaction.TradeState, *transaction.OutTradeNo)

	// 4. 检查交易状态
	if *transaction.TradeState != "SUCCESS" {
		fmt.Printf("交易状态非成功: %s\n", *transaction.TradeState)
		// 非成功状态也返回成功，避免微信重复回调
		c.JSON(http.StatusOK, gin.H{
			"code":    "SUCCESS",
			"message": "成功",
		})
		return
	}

	// 5. 获取订单信息
	orderNo := *transaction.OutTradeNo
	var order Order
	err = model.DB.Table("orders").Where("order_no = ?", orderNo).First(&order).Error
	if err != nil {
		fmt.Printf("订单不存在: %s\n", orderNo)
		// 订单不存在也返回成功，避免微信重复回调
		c.JSON(http.StatusOK, gin.H{
			"code":    "SUCCESS",
			"message": "成功",
		})
		return
	}

	// 6. 检查订单是否已处理（重入保护）
	if order.Status == "paid" {
		fmt.Printf("订单已处理（重复回调）: %s\n", orderNo)
		c.JSON(http.StatusOK, gin.H{
			"code":    "SUCCESS",
			"message": "成功",
		})
		return
	}

	// 7. 验证订单金额是否匹配
	if transaction.Amount != nil && transaction.Amount.Total != nil {
		if int(*transaction.Amount.Total) != order.Amount {
			fmt.Printf("订单金额不匹配: 微信=%d, 本地=%d\n", *transaction.Amount.Total, order.Amount)
			c.JSON(http.StatusOK, gin.H{
				"code":    "SUCCESS",
				"message": "成功",
			})
			return
		}
	}

	// 8. 先应答成功（符合微信官方建议：先应答，再处理业务）
	c.JSON(http.StatusOK, gin.H{
		"code":    "SUCCESS",
		"message": "成功",
	})

	// 9. 异步处理业务逻辑（更新订单、充值额度）
	go func() {
		fmt.Printf("开始处理订单业务逻辑: %s\n", orderNo)

		// 更新订单状态（使用乐观锁，防止并发问题）
		loc, _ := time.LoadLocation("Asia/Shanghai")
		now := time.Now().In(loc)
		result := model.DB.Table("orders").
			Where("order_no = ? AND status = ?", orderNo, "pending").
			Updates(map[string]interface{}{
				"status":         "paid",
				"transaction_id": *transaction.TransactionId,
				"paid_at":        now,
			})

		if result.Error != nil {
			fmt.Printf("更新订单失败: %v\n", result.Error)
			return
		}

		if result.RowsAffected == 0 {
			fmt.Printf("订单已被处理（并发保护）: %s\n", orderNo)
			return
		}

		fmt.Printf("订单更新成功，开始创建订阅: 用户ID=%d, 额度=%d\n", order.UserID, order.Quota)

		// 创建订阅并充值
		err := fulfillOrder(order)
		if err != nil {
			fmt.Printf("创建订阅失败: %v\n", err)
		} else {
			fmt.Printf("充值成功: 订单号=%s\n", orderNo)
		}
	}()
}

// AlipayPaymentNotify 支付宝异步通知（application/x-www-form-urlencoded）
func AlipayPaymentNotify(c *gin.Context) {
	if err := c.Request.ParseForm(); err != nil {
		fmt.Printf("支付宝回调解析表单失败: %v\n", err)
		c.String(http.StatusOK, "fail")
		return
	}

	client, err := newAlipayClient()
	if err != nil {
		fmt.Printf("支付宝回调初始化客户端失败: %v\n", err)
		c.String(http.StatusOK, "fail")
		return
	}

	notification, err := client.DecodeNotification(context.Background(), c.Request.PostForm)
	if err != nil {
		fmt.Printf("支付宝回调验签失败: %v\n", err)
		c.String(http.StatusOK, "fail")
		return
	}

	if notification.AppId != "" && notification.AppId != AlipayConfig.AppID {
		fmt.Printf("支付宝回调 app_id 不匹配: %s\n", notification.AppId)
		c.String(http.StatusOK, "fail")
		return
	}

	st := notification.TradeStatus
	if st != alipay.TradeStatusSuccess && st != alipay.TradeStatusFinished {
		alipay.ACKNotification(c.Writer)
		return
	}

	orderNo := notification.OutTradeNo
	var order Order
	err = model.DB.Table("orders").Where("order_no = ?", orderNo).First(&order).Error
	if err != nil {
		alipay.ACKNotification(c.Writer)
		return
	}

	if order.Status == "paid" {
		alipay.ACKNotification(c.Writer)
		return
	}

	if strings.ToLower(strings.TrimSpace(order.PayType)) != "alipay" {
		fmt.Printf("支付宝回调订单支付方式非 alipay: %s\n", order.PayType)
		alipay.ACKNotification(c.Writer)
		return
	}

	if !alipayAmountMatchesOrder(notification.TotalAmount, order.Amount) {
		fmt.Printf("支付宝回调金额不匹配: 通知=%s 本地=%d 分\n", notification.TotalAmount, order.Amount)
		alipay.ACKNotification(c.Writer)
		return
	}

	loc, _ := time.LoadLocation("Asia/Shanghai")
	now := time.Now().In(loc)
	result := model.DB.Table("orders").
		Where("order_no = ? AND status = ?", orderNo, "pending").
		Updates(map[string]interface{}{
			"status":         "paid",
			"transaction_id": notification.TradeNo,
			"paid_at":        now,
		})

	if result.Error != nil {
		fmt.Printf("支付宝回调更新订单失败: %v\n", result.Error)
		c.String(http.StatusOK, "fail")
		return
	}

	if result.RowsAffected == 0 {
		alipay.ACKNotification(c.Writer)
		return
	}

	if err := fulfillOrder(order); err != nil {
		fmt.Printf("支付宝回调创建订阅失败: %v\n", err)
	}

	alipay.ACKNotification(c.Writer)
}

// fulfillOrder 订单转 paid 后的统一发放入口:企业充值走企业账本一次性到账,
// 个人订单走原有订阅发放逻辑。调用前必须已确保订单状态从 pending 翻转成功(幂等由状态守卫保证)。
func fulfillOrder(order Order) error {
	var fulfillErr error
	if order.OrgId != nil && *order.OrgId > 0 {
		fulfillErr = creditOrgRecharge(order)
	} else {
		fulfillErr = createSubscriptionAfterPayment(order)
	}

	// 触发邀请付费活动（异步，不阻塞主流程）
	if order.InviteCode != "" {
		go func() {
			ctx := context.Background()
			if err := model.TriggerInviteActivities(ctx, "payment", order.UserID, order.InviteCode, order.OrderNo, int64(order.Amount)); err != nil {
				logger.SysError(fmt.Sprintf("触发付费邀请活动失败 order=%s: %v", order.OrderNo, err))
			}
		}()
	}

	return fulfillErr
}

// creditOrgRecharge 企业充值到账:把订单积分一次性加进企业定时积分账本(无到期).
func creditOrgRecharge(order Order) error {
	if order.OrgId == nil || *order.OrgId <= 0 {
		return fmt.Errorf("订单缺少 org_id")
	}
	if order.Quota <= 0 {
		return fmt.Errorf("订单积分为 0,跳过发放")
	}
	// 应用层幂等:同一笔订单已写过 recharge_records 即视为已发放,直接返回成功.
	// 状态守卫(RowsAffected)是第一道防线,这里是不依赖调用方守卫的兜底.
	var existed int64
	if err := model.DB.Table("recharge_records").
		Where("order_no = ?", order.OrderNo).
		Count(&existed).Error; err != nil {
		return fmt.Errorf("查询充值记录失败: %w", err)
	}
	if existed > 0 {
		fmt.Printf("订单 %s 已发放过(recharge_records 命中),跳过\n", order.OrderNo)
		return nil
	}
	org, err := model.GetOrgById(*order.OrgId)
	if err != nil {
		return fmt.Errorf("企业不存在: %w", err)
	}
	beforeQuota := org.Quota
	if err := model.AddOrgTimedQuota(*order.OrgId, order.Quota, model.OrgTimedQuotaSourceTopup, order.OrderNo, nil); err != nil {
		return err
	}
	// 写一条带 org_id 的充值日志,使企业维度充值流水在 logs 表可查(与个人充值对齐).
	// user_id 记付款用户(order.UserID).
	model.RecordOrgTopupLog(context.Background(), *order.OrgId, order.UserID,
		fmt.Sprintf("企业充值 - 订单号: %s", order.OrderNo), int(order.Quota))

	record := model.RechargeRecord{
		UserId:      order.UserID,
		OrgId:       *order.OrgId,
		Username:    order.Username,
		OrderNo:     order.OrderNo,
		Quota:       order.Quota,
		BeforeQuota: beforeQuota,
		AfterQuota:  beforeQuota + order.Quota,
		Remark:      "企业充值",
	}
	if err := model.CreateRechargeRecord(&record); err != nil {
		logger.SysError(fmt.Sprintf("创建企业充值记录失败 order=%s: %v", order.OrderNo, err))
	}
	return nil
}

// createSubscriptionAfterPayment creates a subscription record after successful payment
func createSubscriptionAfterPayment(order Order) error {
	// 应用层幂等:同一笔订单已写过 recharge_records 即视为已发放,直接返回成功.
	// 与 RowsAffected 守卫互为冗余,确保即使上层守卫被绕过也不会双发.
	var existed int64
	if err := model.DB.Table("recharge_records").
		Where("order_no = ?", order.OrderNo).
		Count(&existed).Error; err != nil {
		return fmt.Errorf("查询充值记录失败: %w", err)
	}
	if existed > 0 {
		fmt.Printf("订单 %s 已发放过(recharge_records 命中),跳过\n", order.OrderNo)
		return nil
	}

	pkg, err := model.GetRechargePackageById(order.PackageID)
	if err != nil {
		return fmt.Errorf("获取套餐信息失败: %w", err)
	}

	// quota 类型：直接发放定时积分，不创建订阅
	if pkg.PackageType == "quota" {
		quota := pkg.CalcQuota()
		source := fmt.Sprintf("增值包 - 订单号: %s", order.OrderNo)
		// quota_days>0 时积分按天限时, 到期自动回收; =0 表示不限时(永久)
		var ttl *time.Duration
		if pkg.QuotaDays > 0 {
			d := time.Duration(pkg.QuotaDays) * 24 * time.Hour
			ttl = &d
		}
		var beforeQuota int64
		if u, qErr := model.GetUserById(order.UserID, false); qErr == nil {
			beforeQuota = u.Quota
		}
		err = model.DB.Transaction(func(tx *gorm.DB) error {
			if err := model.AddUserTimedQuotaTx(tx, order.UserID, quota, model.TimedQuotaSourcePurchase, source, ttl); err != nil {
				return fmt.Errorf("发放增值包积分失败: %w", err)
			}
			record := RechargeRecord{
				UserID:      order.UserID,
				Username:    order.Username,
				OrderNo:     order.OrderNo,
				Quota:       quota,
				BeforeQuota: beforeQuota,
				AfterQuota:  beforeQuota + quota,
				Remark:      "增值包",
			}
			if err := tx.Table("recharge_records").Create(&record).Error; err != nil {
				return fmt.Errorf("创建充值记录失败: %w", err)
			}
			return nil
		})
		if err != nil {
			return err
		}
		model.RecordTopupLog(context.Background(), order.UserID, source, int(quota))
		return nil
	}

	// subscription 类型（默认）：创建订阅
	billingCycle := order.BillingCycle
	if billingCycle == "" {
		billingCycle = "monthly"
	}

	now := time.Now()
	// 时长(总天数)与发放周期(每期天数)共同决定期数:
	//   - 一次性发放(point_cycle=once 或周期天数<=0): 整个时长为 1 期,首期即发全部积分
	//   - 周期性发放: periodsTotal = 时长天数 / 周期天数(至少 1 期)
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

	// 队列模型分支判定(T1-4,见规则文档行为 1/2/5):
	//   - 首购 / 升级(目标等级 > 当前最高 active)：新块插队首、立即生效、首期积分立即 drip;
	//     升级时把被压住的低等级 active 块冻结(时钟暂停,见 T1-2)。
	//   - 同级 / (防御性)更低：新块排队尾、置 frozen、本期积分不立即发(轮到时由续期/恢复 drip)。
	//     降级在下单时已拦截,此处的"更低"仅为支付回调期间身份变化的兜底,统一按排队冻结处理。
	highestActive, _ := model.GetHighestActiveSubscription(order.UserID)
	newLevel := pkg.EffectiveLevel()
	isUpgrade := highestActive == nil || newLevel > highestActive.PackageLevel

	// 队列模型下各块各自记时,新块首期到期日按自身发放周期推算,不再对齐旧订阅(历史付费不动)。
	periodEnd := model.SubscriptionPeriodEndDays(now, periodDays)
	subscriptionEnd := periodEnd.Add(time.Duration(periodsTotal-1) * time.Duration(periodDays) * 24 * time.Hour)

	quotaPerPeriod := pkg.CalcQuota()

	subStatus := model.SubscriptionStatusActive
	periodsUsed := 1               // 立即生效块本期即发,已发期数=1
	grantedNow := quotaPerPeriod   // 立即 drip 的积分额
	var frozenAt *time.Time
	if !isUpgrade {
		subStatus = model.SubscriptionStatusFrozen
		periodsUsed = 0 // 排队块尚未 drip 任何一期,恢复时从 0→1 起发
		grantedNow = 0
		frozenAt = &now
	}
	totalRecharge := grantedNow

	remark := "VIP 订阅"
	if !isUpgrade {
		remark = "VIP 订阅(同级排队,积分按周期发放)"
	}

	sub := &model.Subscription{
		UserId:             order.UserID,
		PackageId:          order.PackageID,
		PackageLevel:       newLevel,
		BillingCycle:       billingCycle,
		Status:             subStatus,
		QuotaPerPeriod:     quotaPerPeriod,
		PeriodDays:         periodDays,
		PeriodsTotal:       periodsTotal,
		PeriodsUsed:        periodsUsed,
		CurrentPeriodStart: now,
		CurrentPeriodEnd:   periodEnd,
		SubscriptionEnd:    subscriptionEnd,
		OrderNo:            order.OrderNo,
		FrozenAt:           frozenAt,
	}

	// 事务内串行落库,队列模型语义(T1-3/T1-4):
	//   1. 升级:冻结被压住的低等级 active 块(不再 expire+清零旧积分,历史付费保留各自到期)
	//   2. 新建本次订阅块(升级=active 插队首;同级=frozen 排队尾)
	//   3. 分配队列序 + 回填订单 subscription_id
	//   4. 仅"立即生效"块发放首期积分(同级排队块本期不发,轮到时由续期/恢复 drip)
	//   5. 写充值记录
	// 任一步失败整体回滚,避免孤儿状态.
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		if isUpgrade {
			if err := model.FreezeActiveSubscriptionsBelowTx(tx, order.UserID, newLevel, now); err != nil {
				return fmt.Errorf("冻结低等级订阅失败: %w", err)
			}
		}
		var beforeQuota int64
		if err := tx.Model(&model.User{}).Select("quota").
			Where("id = ?", order.UserID).Scan(&beforeQuota).Error; err != nil {
			return fmt.Errorf("读取用户额度失败: %w", err)
		}
		if err := model.CreateSubscriptionTx(tx, sub); err != nil {
			return fmt.Errorf("创建订阅失败: %w", err)
		}
		// 分配队列序(同用户内当前最大 +1)。
		seq, err := model.NextSubscriptionQueueSeqTx(tx, order.UserID)
		if err != nil {
			return fmt.Errorf("计算订阅队列序失败: %w", err)
		}
		if err := tx.Model(&model.Subscription{}).Where("id = ?", sub.Id).
			Update("queue_seq", seq).Error; err != nil {
			return fmt.Errorf("回填订阅队列序失败: %w", err)
		}
		sub.QueueSeq = seq
		if err := tx.Table("orders").Where("order_no = ?", order.OrderNo).
			Update("subscription_id", sub.Id).Error; err != nil {
			return fmt.Errorf("回填订单 subscription_id 失败: %w", err)
		}
		if totalRecharge > 0 {
			if err := model.IncreaseUserSubscriptionQuotaTx(tx, order.UserID, totalRecharge, order.OrderNo, &periodEnd); err != nil {
				return fmt.Errorf("发放订阅积分失败: %w", err)
			}
		}
		record := RechargeRecord{
			UserID:      order.UserID,
			Username:    order.Username,
			OrderNo:     order.OrderNo,
			Quota:       totalRecharge,
			BeforeQuota: beforeQuota,
			AfterQuota:  beforeQuota + totalRecharge,
			Remark:      remark,
		}
		if err := tx.Table("recharge_records").Create(&record).Error; err != nil {
			return fmt.Errorf("创建充值记录失败: %w", err)
		}
		return nil
	})
	if err != nil {
		return err
	}

	model.RecordTopupLog(context.Background(), order.UserID, fmt.Sprintf("VIP 订阅 - 订单号: %s", order.OrderNo), int(totalRecharge))
	return nil
}

// GetUserSubscriptions returns all active subscriptions for the current user
func GetUserSubscriptions(c *gin.Context) {
	userID := c.GetInt(ctxkey.Id)

	subs, err := model.GetActiveSubscriptionsByUserId(userID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "获取订阅信息失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    subs,
	})
}

// subscriptionBlockView 订阅块的前端展示视图:在 Subscription 基础上补套餐名,供"当前生效+下一个块"展示(T3-3)。
type subscriptionBlockView struct {
	*model.Subscription
	PackageName string `json:"package_name"`
}

func toSubscriptionBlockView(sub *model.Subscription) *subscriptionBlockView {
	if sub == nil {
		return nil
	}
	name := ""
	if pkg, err := model.GetRechargePackageById(sub.PackageId); err == nil && pkg != nil {
		name = pkg.Name
	}
	return &subscriptionBlockView{Subscription: sub, PackageName: name}
}

// GetUserSubscriptionQueue 返回当前用户的订阅队列视图(T3-3):当前生效身份 + 下一个自动生效块 + 完整队列。
// 复用 model.ResolveActiveSubscription(队列模型核心),并为每个块补套餐名供前端展示。
func GetUserSubscriptionQueue(c *gin.Context) {
	userID := c.GetInt(ctxkey.Id)

	view, err := model.ResolveActiveSubscription(userID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "获取订阅信息失败",
		})
		return
	}

	queue := make([]*subscriptionBlockView, 0, len(view.Queue))
	for _, s := range view.Queue {
		queue = append(queue, toSubscriptionBlockView(s))
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"current": toSubscriptionBlockView(view.Current),
			"next":    toSubscriptionBlockView(view.Next),
			"queue":   queue,
		},
	})
}

// AutoProcessSubscriptions handles subscription period renewal and expiration
func AutoProcessSubscriptions() {
	userIds, err := model.GetUsersWithExpiredHighestPeriod()
	if err != nil {
		fmt.Printf("查询到期订阅用户失败: %v\n", err)
		return
	}

	if len(userIds) == 0 {
		return
	}

	fmt.Printf("发现 %d 个用户订阅到期，开始处理...\n", len(userIds))

	for _, uid := range userIds {
		if err := model.ProcessUserSubscriptionRenewal(uid); err != nil {
			fmt.Printf("处理用户 %d 订阅续期失败: %v\n", uid, err)
		} else {
			fmt.Printf("用户 %d 订阅续期处理完成\n", uid)
		}
	}
}

// AutoIssueMonthlyFreeQuotas 定时扫描发放每月免费额度(仅给无 active 订阅的用户)
//
//	函数本身已对发放间隔做幂等控制,可安全地周期性调用
func AutoIssueMonthlyFreeQuotas() {
	if err := model.IssueMonthlyFreeQuotas(); err != nil {
		fmt.Printf("发放每月免费额度失败: %v\n", err)
	}
}

// AutoExpireTimedQuotas 定时清理过期定时积分,把过期账本笔的 remaining 置 0
//
//	并同步 users.timed_quota_total.放在 0 点 cron 链最后一步.
func AutoExpireTimedQuotas() {
	if err := model.ExpireTimedQuotas(); err != nil {
		fmt.Printf("清理过期定时积分失败: %v\n", err)
	}
	if err := model.ExpireOrgTimedQuotas(); err != nil {
		fmt.Printf("清理过期企业定时积分失败: %v\n", err)
	}
}

// AutoResetOrgMemberLimits 重置企业成员的日/月用量计数.
//
//	每天 0 点 daily 重置;月初(由调用方判断)额外触发 monthly 重置.
//	内部按 reset_at <= now 过滤,幂等;偶发漏跑下次仍补上.
func AutoResetOrgMemberLimits(resetMonthly bool) {
	if err := model.ResetOrgMemberDailyUsed(); err != nil {
		logger.SysError(fmt.Sprintf("[org_member_limit] 日用量重置失败: %v", err))
	}
	if resetMonthly {
		if err := model.ResetOrgMemberMonthlyUsed(); err != nil {
			logger.SysError(fmt.Sprintf("[org_member_limit] 月用量重置失败: %v", err))
		}
	}
}

// AutoVerifyAccountTypeInvariants 巡检账户隔离不变量,发现违例写 SysError 告警.
//
//	这是 enterprise/personal 隔离的兜底保护:扫描 users 表四类违例
//	(企业账户却没有 org_id / 持有个人额度 / 关联活账本笔 / 个体账户却有 org_id),
//	定时输出审计信号,但不自动修复 — 任何违例都需要人工介入排查.
func AutoVerifyAccountTypeInvariants() {
	hits, err := model.VerifyAccountTypeInvariants(200)
	if err != nil {
		logger.SysError(fmt.Sprintf("[account_type] 巡检失败: %v", err))
		return
	}
	if len(hits) == 0 {
		logger.SysLog("[account_type] 巡检通过,未发现违例")
		return
	}
	for _, h := range hits {
		logger.SysError(fmt.Sprintf("[account_type] 违例 user_id=%d %s", h.UserId, h.Description))
	}
	logger.SysError(fmt.Sprintf("[account_type] 巡检发现 %d 条违例,请人工核查", len(hits)))
}

// AutoReconcileOrgQuota 对账企业额度镜像列(以 org_timed_quotas 账本为真相),
// 可用余额漂移自动以账本修正,成员用量之和不一致仅告警.放在 0 点 cron 链、过期清理之后运行.
func AutoReconcileOrgQuota() {
	drifts, err := model.ReconcileOrgQuotaMirrors()
	if err != nil {
		logger.SysError(fmt.Sprintf("[org_quota] 对账失败: %v", err))
		return
	}
	if len(drifts) == 0 {
		logger.SysLog("[org_quota] 对账通过,镜像列与账本一致")
		return
	}
	for _, d := range drifts {
		if d.AvailFixed {
			logger.SysError(fmt.Sprintf("[org_quota] org_id=%d(%s) 镜像列漂移已修正:quota %d→%d, used_quota %d→%d(按账本 valid_total=%d/used=%d 重算)",
				d.OrgId, d.OrgName, d.MirrorQuota, d.LedgerValidTotal, d.MirrorUsed, d.LedgerUsed, d.LedgerValidTotal, d.LedgerUsed))
		}
		if d.MemberMismatch {
			logger.SysError(fmt.Sprintf("[org_quota] org_id=%d(%s) 成员用量之和=%d != 账本口径已用=%d,消费链路可能落库失败,请人工核查",
				d.OrgId, d.OrgName, d.MemberUsedSum, d.LedgerUsed))
		}
	}
	logger.SysError(fmt.Sprintf("[org_quota] 对账发现 %d 个企业存在漂移", len(drifts)))
}
