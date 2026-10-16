package handler

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/core/notify"
	"github.com/wechatpay-apiv3/wechatpay-go/core/option"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/native"
	"github.com/wechatpay-apiv3/wechatpay-go/utils"

	"wechat-pay/config"
)

// pubKeyVerifier 用微信支付公钥实现 auth.Verifier 接口
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

// newClient 创建微信支付客户端（公钥模式）
func newClient(ctx context.Context) (*core.Client, error) {
	cfg := config.Cfg
	privateKey, err := utils.LoadPrivateKeyWithPath(cfg.PrivateKeyPath)
	if err != nil {
		return nil, fmt.Errorf("加载私钥失败: %w", err)
	}
	publicKey, err := utils.LoadPublicKeyWithPath(cfg.PubKeyPath)
	if err != nil {
		return nil, fmt.Errorf("加载公钥失败: %w", err)
	}
	return core.NewClient(ctx,
		option.WithWechatPayPublicKeyAuthCipher(cfg.MchID, cfg.SerialNo, privateKey, cfg.PubKeyID, publicKey),
	)
}

// CreateOrderRequest 创建订单请求参数
type CreateOrderRequest struct {
	OutTradeNo  string `json:"out_trade_no"` // 商户订单号
	Description string `json:"description"`  // 商品描述
	Amount      int64  `json:"amount"`       // 金额（分）
}

// CreateOrderResponse 创建订单响应
type CreateOrderResponse struct {
	CodeURL string `json:"code_url"` // 二维码链接
}

// CreateNativeOrder 创建 Native 支付订单，返回二维码 URL
func CreateNativeOrder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CreateOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.OutTradeNo == "" || req.Description == "" || req.Amount <= 0 {
		http.Error(w, "out_trade_no, description, amount are required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	client, err := newClient(ctx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	cfg := config.Cfg
	svc := native.NativeApiService{Client: client}
	resp, _, err := svc.Prepay(ctx, native.PrepayRequest{
		Appid:       core.String(cfg.AppID),
		Mchid:       core.String(cfg.MchID),
		Description: core.String(req.Description),
		OutTradeNo:  core.String(req.OutTradeNo),
		TimeExpire:  core.Time(time.Now().Add(30 * time.Minute)),
		NotifyUrl:   core.String(cfg.NotifyURL),
		Amount: &native.Amount{
			Total:    core.Int64(req.Amount),
			Currency: core.String("CNY"),
		},
	})
	if err != nil {
		http.Error(w, fmt.Sprintf("创建订单失败: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(CreateOrderResponse{CodeURL: *resp.CodeUrl})
}

// PayNotify 处理微信支付回调通知
func PayNotify(w http.ResponseWriter, r *http.Request) {
	cfg := config.Cfg
	ctx := r.Context()

	// 加载微信支付公钥，用于回调验签
	publicKey, err := utils.LoadPublicKeyWithPath(cfg.PubKeyPath)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	verifier := &pubKeyVerifier{keyID: cfg.PubKeyID, pubKey: publicKey}
	handler, err := notify.NewRSANotifyHandler(cfg.APIv3Key, verifier)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	transaction := new(payments.Transaction)
	notifyReq, err := handler.ParseNotifyRequest(ctx, r, transaction)
	if err != nil {
		fmt.Printf("解析回调失败: %v\n", err)
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	// 打印完整回调信息
	fmt.Println("========== 收到微信支付回调 ==========")
	fmt.Printf("事件类型:     %s\n", notifyReq.EventType)
	fmt.Printf("商户订单号:   %s\n", strVal(transaction.OutTradeNo))
	fmt.Printf("微信交易号:   %s\n", strVal(transaction.TransactionId))
	fmt.Printf("交易状态:     %s\n", strVal(transaction.TradeState))
	fmt.Printf("交易状态描述: %s\n", strVal(transaction.TradeStateDesc))
	fmt.Printf("AppID:        %s\n", strVal(transaction.Appid))
	fmt.Printf("商户号:       %s\n", strVal(transaction.Mchid))
	if transaction.Amount != nil {
		fmt.Printf("订单金额:     %d 分\n", *transaction.Amount.Total)
		fmt.Printf("实付金额:     %d 分\n", *transaction.Amount.PayerTotal)
	}
	if transaction.Payer != nil {
		fmt.Printf("付款方OpenID: %s\n", strVal(transaction.Payer.Openid))
	}
	if transaction.SuccessTime != nil {
		fmt.Printf("支付完成时间: %s\n", *transaction.SuccessTime)
	}
	fmt.Println("======================================")

	if *transaction.TradeState == "SUCCESS" {
		// TODO: 更新数据库订单状态
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"code": "SUCCESS", "message": "成功"})
}
// QueryOrder 查询订单状态
func QueryOrder(w http.ResponseWriter, r *http.Request) {
	outTradeNo := r.URL.Query().Get("out_trade_no")
	if outTradeNo == "" {
		http.Error(w, "out_trade_no is required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	client, err := newClient(ctx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	cfg := config.Cfg
	svc := native.NativeApiService{Client: client}
	resp, _, err := svc.QueryOrderByOutTradeNo(ctx, native.QueryOrderByOutTradeNoRequest{
		OutTradeNo: core.String(outTradeNo),
		Mchid:      core.String(cfg.MchID),
	})
	if err != nil {
		http.Error(w, fmt.Sprintf("查询订单失败: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func strVal(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
