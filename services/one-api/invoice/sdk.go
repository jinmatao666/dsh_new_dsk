package invoice

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// NNOpenSDK 诺诺开放平台SDK Go实现
// 基于 Java open-sdk-1.0.5.2 反编译还原
type NNOpenSDK struct{}

var sdkInstance = &NNOpenSDK{}

// GetSDKInstance 获取SDK单例
func GetSDKInstance() *NNOpenSDK {
	return sdkInstance
}

// SendPostSyncRequest 发送同步POST请求到诺诺开放平台
//
// 参数:
//   - apiURL:    请求地址, 如 https://sdk.nuonuo.com/open/v1/services
//   - senid:     唯一标识, 32位随机码
//   - appKey:    应用的appKey
//   - appSecret: 应用的appSecret
//   - token:     访问令牌(accessToken)
//   - taxnum:    授权企业税号
//   - method:    API方法名, 如 nuonuo.OpeMplatform.requestBillingNew
//   - content:   API私有请求参数, 标准JSON格式
//   - timeout:   超时时间(秒), 0表示使用默认值(30秒)
func (sdk *NNOpenSDK) SendPostSyncRequest(
	apiURL, senid, appKey, appSecret, token, taxnum, method, content string,
	timeout int,
) (string, error) {
	// 关键：timestamp 必须是秒级（Java SDK 用 System.currentTimeMillis()/1000）
	timestamp := time.Now().Unix()
	// nonce 范围：10000 ~ 999999999（Java SDK 用 ThreadLocalRandom.nextInt(10000, 1000000000)）
	nonce := rand.Intn(999990000) + 10000
	timestampStr := fmt.Sprintf("%d", timestamp)
	nonceStr := fmt.Sprintf("%d", nonce)

	fullURL := fmt.Sprintf("%s?senid=%s&nonce=%s&timestamp=%s&appkey=%s",
		apiURL, senid, nonceStr, timestampStr, appKey)

	parsedURL, err := url.Parse(fullURL)
	if err != nil {
		return "", fmt.Errorf("解析URL失败: %w", err)
	}
	path := parsedURL.Path

	sign := getSign(path, appSecret, appKey, senid, nonceStr, content, timestampStr)
	headers := buildHeaders(appKey, appSecret, token, taxnum, method, sign)

	if timeout <= 0 {
		timeout = 30
	}
	resp, err := sendHTTPPost(fullURL, headers, content, time.Duration(timeout)*time.Second)
	if err != nil {
		return "", fmt.Errorf("HTTP请求失败: %w", err)
	}

	return resp, nil
}

// getSign 计算API签名
func getSign(path, appSecret, appKey, senid, nonce, body, timestamp string) string {
	parts := strings.Split(path, "/")

	var signStr strings.Builder
	signStr.WriteString("a=")
	if len(parts) > 3 {
		signStr.WriteString(parts[3])
	}
	signStr.WriteString("&l=")
	if len(parts) > 2 {
		signStr.WriteString(parts[2])
	}
	signStr.WriteString("&p=")
	if len(parts) > 1 {
		signStr.WriteString(parts[1])
	}
	signStr.WriteString("&k=")
	signStr.WriteString(appKey)
	signStr.WriteString("&i=")
	signStr.WriteString(senid)
	signStr.WriteString("&n=")
	signStr.WriteString(nonce)
	signStr.WriteString("&t=")
	signStr.WriteString(timestamp)
	signStr.WriteString("&f=")
	signStr.WriteString(body)

	return hmacSHA1WithBase64(signStr.String(), appSecret)
}

// hmacSHA1WithBase64 HMAC-SHA1签名并Base64编码
func hmacSHA1WithBase64(value, secret string) string {
	mac := hmac.New(sha1.New, []byte(secret))
	mac.Write([]byte(value))
	rawHmac := mac.Sum(nil)
	return base64.StdEncoding.EncodeToString(rawHmac)
}

// buildHeaders 构建HTTP请求头
func buildHeaders(appKey, appSecret, token, taxnum, method, sign string) map[string]string {
	return map[string]string{
		"Content-Type":  "application/json",
		"X-Nuonuo-Sign": sign,
		"accessToken":   token,
		"userTax":       taxnum,
		"method":        method,
		"sdkVer":        "1.0.5.2",
	}
}

// sendHTTPPost 发送HTTP POST请求
func sendHTTPPost(reqURL string, headers map[string]string, body string, timeout time.Duration) (string, error) {
	client := &http.Client{Timeout: timeout}

	req, err := http.NewRequest("POST", reqURL, strings.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("创建请求失败: %w", err)
	}

	// 使用直接赋值保留原始 header key 大小写
	// Go 的 req.Header.Set() 会自动将 key 转为首字母大写（如 accessToken → Accesstoken）
	// 诺诺服务端需要原始大小写的 header key
	for k, v := range headers {
		req.Header[k] = []string{v}
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("发送请求失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取响应失败: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d code=%d result=%s", resp.StatusCode, resp.StatusCode, string(respBody))
	}

	return string(respBody), nil
}

// APIResponse 诺诺平台API统一响应结构
type APIResponse struct {
	Code     string          `json:"code"`
	Describe string          `json:"describe"`
	Result   json.RawMessage `json:"result"`
}
