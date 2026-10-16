package invoice

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"strings"
	"time"
)

const (
	SuccessCode = "E0000"

	MethodRequestBillingNew  = "nuonuo.OpeMplatform.requestBillingNew"
	MethodQueryInvoiceResult = "nuonuo.OpeMplatform.queryInvoiceResult"
)

// NuonuoConfig 诺诺发票配置（从环境变量读取）
type NuonuoConfig struct {
	Clerk       string
	Taxnum      string
	AppKey      string
	AppSecret   string
	Token       string
	URL         string
	CallbackURL string
}

// LoadNuonuoConfig 从环境变量加载诺诺配置
func LoadNuonuoConfig() *NuonuoConfig {
	return &NuonuoConfig{
		Clerk:       getEnv("NUONUO_CLERK", ""),
		Taxnum:      getEnv("NUONUO_TAXNUM", ""),
		AppKey:      getEnv("NUONUO_APP_KEY", ""),
		AppSecret:   getEnv("NUONUO_APP_SECRET", ""),
		Token:       getEnv("NUONUO_TOKEN", ""),
		URL:         getEnv("NUONUO_URL", "https://sdk.nuonuo.com/open/v1/services"),
		CallbackURL: getEnv("NUONUO_CALLBACK_URL", ""),
	}
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

// NuonuoClient 诺诺开票客户端
type NuonuoClient struct {
	cfg *NuonuoConfig
}

// GlobalClient 全局客户端单例
var GlobalClient *NuonuoClient

// InitNuonuoClient 初始化全局诺诺客户端
func InitNuonuoClient() {
	cfg := LoadNuonuoConfig()
	GlobalClient = &NuonuoClient{cfg: cfg}
	if cfg.AppKey != "" {
		log.Printf("[NuonuoInvoice] 初始化成功, URL=%s, TaxNum=%s", cfg.URL, cfg.Taxnum)
	} else {
		log.Println("[NuonuoInvoice] 未配置诺诺发票参数，发票功能不可用")
	}
}

// IsConfigured 检查是否已配置
func (c *NuonuoClient) IsConfigured() bool {
	return c != nil && c.cfg != nil && c.cfg.AppKey != "" && c.cfg.AppSecret != "" && c.cfg.Token != ""
}

// ============== 开票结果 ==============

type BillingResult struct {
	Success          bool   `json:"success"`
	InvoiceSerialNum string `json:"invoiceSerialNum"`
	ErrorCode        string `json:"errorCode"`
	ErrorMessage     string `json:"errorMessage"`
}

// ============== 查询发票结果 ==============

type QueryInvoiceResult struct {
	Success      bool                   `json:"success"`
	InvoiceData  map[string]interface{} `json:"invoiceData"`
	ErrorCode    string                 `json:"errorCode"`
	ErrorMessage string                 `json:"errorMessage"`
}

// ============== 开票请求参数 ==============

type InvoiceCreateParams struct {
	OrderNo      string
	InvoiceType  string
	BuyerName    string
	InvoiceLine  string
	BuyerTaxNum  string
	BuyerTel     string
	BuyerAddress string
	BankName     string
	BankAccount  string
	BuyerPhone   string
	Email        string
}

type OrderInfo struct {
	OrderNo string
	Amount  float64 // 元（从数据库分转换后传入）
}

// ============== 开票 ==============

// RequestBillingNew 请求开票
func (c *NuonuoClient) RequestBillingNew(content string) *BillingResult {
	senid := generateSenid()

	sdk := GetSDKInstance()
	resp, err := sdk.SendPostSyncRequest(
		c.cfg.URL, senid, c.cfg.AppKey, c.cfg.AppSecret,
		c.cfg.Token, c.cfg.Taxnum,
		MethodRequestBillingNew, content, 0,
	)
	if err != nil {
		log.Printf("[NuonuoClient] 调用开票接口异常, senid: %s, error: %v", senid, err)
		return &BillingResult{Success: false, ErrorCode: "SYSTEM_ERROR", ErrorMessage: "调用开票接口异常: " + err.Error()}
	}

	var apiResp APIResponse
	if err := json.Unmarshal([]byte(resp), &apiResp); err != nil {
		log.Printf("[NuonuoClient] 解析开票响应失败, resp: %s, error: %v", resp, err)
		return &BillingResult{Success: false, ErrorCode: "PARSE_ERROR", ErrorMessage: "解析开票响应失败"}
	}

	if apiResp.Code == SuccessCode {
		var result map[string]interface{}
		serialNum := ""
		if err := json.Unmarshal(apiResp.Result, &result); err == nil {
			if sn, ok := result["invoiceSerialNum"].(string); ok && sn != "" {
				serialNum = sn
			}
		}
		// code=E0000 即为提交成功（审核模式下 invoiceSerialNum 可能为 null）
		log.Printf("[NuonuoClient] 开票提交成功, senid: %s, invoiceSerialNum: %s", senid, serialNum)
		return &BillingResult{Success: true, InvoiceSerialNum: serialNum}
	}

	errorMsg := apiResp.Describe
	if errorMsg == "" {
		errorMsg = "开票失败，错误代码：" + apiResp.Code
	}
	log.Printf("[NuonuoClient] 开票失败, code: %s, describe: %s", apiResp.Code, apiResp.Describe)
	return &BillingResult{Success: false, ErrorCode: apiResp.Code, ErrorMessage: errorMsg}
}

// ============== 查询发票 ==============

// QueryInvoiceResultAPI 查询发票详情
func (c *NuonuoClient) QueryInvoiceResultAPI(invoiceSerialNum, orderNo string) *QueryInvoiceResult {
	senid := generateSenid()

	params := map[string]interface{}{
		"serialNos":              []string{invoiceSerialNum},
		"orderNos":               []string{orderNo},
		"isOfferInvoiceDetail":   "0",
		"isOfferBlueDetailIndex": "0",
	}
	contentBytes, _ := json.Marshal(params)

	sdk := GetSDKInstance()
	resp, err := sdk.SendPostSyncRequest(
		c.cfg.URL, senid, c.cfg.AppKey, c.cfg.AppSecret,
		c.cfg.Token, c.cfg.Taxnum,
		MethodQueryInvoiceResult, string(contentBytes), 0,
	)
	if err != nil {
		log.Printf("[NuonuoClient] 查询发票异常, serialNum: %s, error: %v", invoiceSerialNum, err)
		return &QueryInvoiceResult{Success: false, ErrorCode: "SYSTEM_ERROR", ErrorMessage: "查询发票异常: " + err.Error()}
	}

	var apiResp APIResponse
	if err := json.Unmarshal([]byte(resp), &apiResp); err != nil {
		return &QueryInvoiceResult{Success: false, ErrorCode: "PARSE_ERROR", ErrorMessage: "解析响应失败"}
	}

	if apiResp.Code == SuccessCode {
		var resultObj map[string]interface{}
		if err := json.Unmarshal(apiResp.Result, &resultObj); err == nil {
			return &QueryInvoiceResult{Success: true, InvoiceData: resultObj}
		}
	}

	errorMsg := apiResp.Describe
	if errorMsg == "" {
		errorMsg = "查询发票失败，错误代码：" + apiResp.Code
	}
	return &QueryInvoiceResult{Success: false, ErrorCode: apiResp.Code, ErrorMessage: errorMsg}
}

// ============== 构建开票参数 ==============

// BuildBillingNewParams 构建开票请求参数
func (c *NuonuoClient) BuildBillingNewParams(req *InvoiceCreateParams, order *OrderInfo, goodsName string) map[string]interface{} {
	taxRate := 0.01
	taxIncludedAmount := order.Amount

	// 不含税金额 = 含税金额 / (1 + 税率)
	preTaxAmount := roundTo(taxIncludedAmount/(1+taxRate), 6)
	// 税额 = 含税金额 - 不含税金额
	taxAmount := roundTo(taxIncludedAmount-preTaxAmount, 6)

	invoiceDetail := map[string]interface{}{
		"goodsName":         goodsName,
	    "goodsCode":         "304020199", // 其他软件服务
		"withTaxFlag":       1,
		"taxIncludedAmount": taxIncludedAmount,
		"taxExcludedAmount": preTaxAmount,
		"tax":               taxAmount,
		"taxRate":           taxRate,
	}

	buyerAccount := getBuyerAccount(req.BankName, req.BankAccount)

	orderParams := map[string]interface{}{
		"invoiceDetail": []map[string]interface{}{invoiceDetail},
		"buyerName":     req.BuyerName,
		"buyerTaxNum":   req.BuyerTaxNum,
		"buyerTel":      req.BuyerTel,
		"buyerAddress":  req.BuyerAddress,
		"buyerAccount":  buyerAccount,
		"salerTaxNum":   c.cfg.Taxnum,
		"orderNo":       req.OrderNo,
		"invoiceDate":   time.Now().Format("2006-01-02 15:04:05"),
		"pushMode":      "-1",
		"buyerPhone":    req.BuyerPhone,
		"email":         req.Email,
		"invoiceType":   "1", // 蓝票
		"invoiceLine":   req.InvoiceLine,
		"callBackUrl":   c.cfg.CallbackURL,
		"clerk":         c.cfg.Clerk,
		"remark":        fmt.Sprintf("订单编号%s", order.OrderNo),
	}

	return map[string]interface{}{
		"order": orderParams,
	}
}

// ============== 辅助方法 ==============

func getBuyerAccount(bankName, bankAccount string) string {
	var builder strings.Builder
	if bankName != "" {
		builder.WriteString(bankName)
	}
	if bankAccount != "" {
		builder.WriteString(bankAccount)
	}
	return builder.String()
}

func generateSenid() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%x%x", time.Now().UnixNano(), time.Now().UnixMicro()%100000)
	}
	return hex.EncodeToString(b)
}

func roundTo(val float64, places int) float64 {
	p := math.Pow(10, float64(places))
	return math.Round(val*p) / p
}

// GenerateInvoiceID 生成发票记录ID（32位hex）
func GenerateInvoiceID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%x%x", time.Now().UnixNano(), time.Now().UnixMicro()%1000000)
	}
	return hex.EncodeToString(b)
}
