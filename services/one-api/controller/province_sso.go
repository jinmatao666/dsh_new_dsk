package controller

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
)

const defaultProvinceTicketValidateURL = "https://kjzl.zrzyt.zj.gov.cn/bev2/api/Ticket/ValidateTicket"
const defaultProvinceTicketUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"

var provinceHTTPClient = &http.Client{Timeout: 8 * time.Second}

var errProvinceAccountDisabled = errors.New("当前省域平台账号已停用")

type provinceTicketEnvelope struct {
	Result  json.RawMessage `json:"result"`
	Message string          `json:"message"`
}

type provinceTicketUser struct {
	OrganizationName         string          `json:"OrganizationName"`
	Account                  string          `json:"Account"`
	UserName                 string          `json:"UserName"`
	EmployeeCode             string          `json:"EmployeeCode"`
	IsActive                 json.RawMessage `json:"IsActive"`
	Name                     string          `json:"Name"`
	Xzqh                     string          `json:"Xzqh"`
	XzqhCode                 string          `json:"XzqhCode"`
	DivisionCode             string          `json:"DivisionCode"`
	Role                     json.RawMessage `json:"Role"`
	UnitName                 string          `json:"UnitName"`
	UnitCode                 string          `json:"UnitCode"`
	OrganizationCode         string          `json:"OrganizationCode"`
	OrganizationLine         string          `json:"OrganizationLine"`
	ResourceOrganizationLine string          `json:"ResourceOrganizationLine"`
	Id                       string          `json:"Id"`
}

func provinceSSOEnabled() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("PARVIS_PROVINCE_SSO_ENABLED")))
	return value == "1" || value == "true" || value == "yes"
}

func provinceTicketValidateURL() string {
	if value := strings.TrimSpace(os.Getenv("PARVIS_PROVINCE_TICKET_VALIDATE_URL")); value != "" {
		return value
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("PARVIS_DEPLOYMENT_MODE")), "private") {
		return ""
	}
	return defaultProvinceTicketValidateURL
}

func provinceTicketUserAgent() string {
	if value := strings.TrimSpace(os.Getenv("PARVIS_PROVINCE_TICKET_USER_AGENT")); value != "" {
		return value
	}
	return defaultProvinceTicketUserAgent
}

func provinceZeroIsActive() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("PARVIS_PROVINCE_ZERO_IS_ACTIVE")))
	return value == "1" || value == "true" || value == "yes"
}

func provinceInternalKey() string {
	value := strings.TrimSpace(os.Getenv("PARVIS_PROVINCE_SSO_INTERNAL_KEY"))
	if len(value) < 32 {
		return ""
	}
	return value
}

func provinceInternalKeyAuthorized(provided string) bool {
	expected := provinceInternalKey()
	provided = strings.TrimSpace(provided)
	if expected == "" || provided == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(provided)) == 1
}

func provinceRawString(value json.RawMessage) string {
	if len(value) == 0 || bytes.Equal(value, []byte("null")) {
		return ""
	}
	var text string
	if json.Unmarshal(value, &text) == nil {
		return text
	}
	var number json.Number
	if json.Unmarshal(value, &number) == nil {
		return number.String()
	}
	return strings.TrimSpace(string(value))
}

func provinceActive(value json.RawMessage) bool {
	raw := strings.ToLower(strings.TrimSpace(provinceRawString(value)))
	switch raw {
	case "0":
		return provinceZeroIsActive()
	case "1":
		return !provinceZeroIsActive()
	case "true", "enabled", "active", "yes":
		return true
	default:
		return false
	}
}

func decodeProvinceTicketUser(raw json.RawMessage) (*provinceTicketUser, error) {
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return nil, errors.New("省域平台未返回用户信息")
	}
	var payload []byte
	var encoded string
	if json.Unmarshal(raw, &encoded) == nil {
		payload = []byte(encoded)
	} else {
		payload = raw
	}
	var user provinceTicketUser
	if err := json.Unmarshal(payload, &user); err != nil {
		return nil, errors.New("省域平台用户信息格式错误")
	}
	if strings.TrimSpace(user.Account) == "" {
		return nil, errors.New("省域平台未返回 Account")
	}
	return &user, nil
}

func validateProvinceTicket(ticket string) (*provinceTicketUser, error) {
	configuredEndpoint := provinceTicketValidateURL()
	if configuredEndpoint == "" {
		return nil, errors.New("省域平台验证地址尚未配置")
	}
	endpoint, err := url.Parse(configuredEndpoint)
	if err != nil {
		return nil, errors.New("省域平台验证地址配置错误")
	}
	query := endpoint.Query()
	query.Set("ticket", ticket)
	endpoint.RawQuery = query.Encode()

	request, err := http.NewRequest(http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	// 省域平台防火墙会拦截 Go 默认的 Go-http-client 请求头并返回 HTTP 405。
	// 使用现有省域应用一致的浏览器请求头，同时保留环境变量覆盖能力。
	request.Header.Set("Accept", "application/json, text/plain, */*")
	request.Header.Set("User-Agent", provinceTicketUserAgent())
	response, err := provinceHTTPClient.Do(request)
	if err != nil {
		return nil, errors.New("暂时无法验证省域平台身份")
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return nil, errors.New("读取省域平台响应失败")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("省域平台身份验证失败（HTTP %d）", response.StatusCode)
	}
	var envelope provinceTicketEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, errors.New("省域平台响应格式错误")
	}
	user, err := decodeProvinceTicketUser(envelope.Result)
	if err != nil {
		if strings.TrimSpace(envelope.Message) != "" {
			return nil, errors.New(envelope.Message)
		}
		return nil, err
	}
	return user, nil
}

func provinceLaunchHTML(deepLink string, message string) string {
	if deepLink == "" {
		return fmt.Sprintf(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Parvis 登录失败</title></head><body><h2>无法打开 Parvis</h2><p>%s</p></body></html>`, html.EscapeString(message))
	}
	scriptURL, _ := json.Marshal(deepLink)
	return fmt.Sprintf(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>正在打开 Parvis</title></head><body><h2>正在打开 Parvis…</h2><p>若客户端没有自动启动，请确认 Parvis 已安装。</p><script>window.location.replace(%s)</script></body></html>`, scriptURL)
}

func provinceProfileFromUser(provinceUser *provinceTicketUser) model.ProvinceProfile {
	return model.ProvinceProfile{
		Account:                  provinceUser.Account,
		Name:                     provinceUser.Name,
		UserName:                 provinceUser.UserName,
		UnitName:                 provinceUser.UnitName,
		UnitCode:                 provinceUser.UnitCode,
		OrganizationName:         provinceUser.OrganizationName,
		OrganizationCode:         provinceUser.OrganizationCode,
		OrganizationLine:         provinceUser.OrganizationLine,
		ResourceOrganizationLine: provinceUser.ResourceOrganizationLine,
		RegionName:               provinceUser.Xzqh,
		RegionCode:               provinceFirstNonEmpty(provinceUser.XzqhCode, provinceUser.DivisionCode),
		ExternalRole:             provinceRawString(provinceUser.Role),
		EmployeeCode:             provinceUser.EmployeeCode,
		ExternalId:               provinceUser.Id,
		IsActive:                 provinceActive(provinceUser.IsActive),
	}
}

func createProvinceDeepLink(ctx context.Context, provinceUser *provinceTicketUser) (string, error) {
	profile := provinceProfileFromUser(provinceUser)
	user, err := model.UpsertProvinceUser(ctx, profile)
	if err != nil {
		return "", err
	}
	if !profile.IsActive || user.Status != model.UserStatusEnabled {
		return "", errProvinceAccountDisabled
	}
	code, err := model.CreateProvinceLaunchCode(user.Id)
	if err != nil {
		return "", err
	}
	return "parvis://sso/province?code=" + url.QueryEscape(code), nil
}

func ProvinceSSOLaunch(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'")
	if !provinceSSOEnabled() {
		c.Data(http.StatusNotFound, "text/html; charset=utf-8", []byte(provinceLaunchHTML("", "省域平台登录未启用")))
		return
	}
	ticket := strings.TrimSpace(c.Query("ticket"))
	if ticket == "" || len(ticket) > 4096 {
		c.Data(http.StatusBadRequest, "text/html; charset=utf-8", []byte(provinceLaunchHTML("", "ticket 不能为空")))
		return
	}
	provinceUser, err := validateProvinceTicket(ticket)
	if err != nil {
		c.Data(http.StatusUnauthorized, "text/html; charset=utf-8", []byte(provinceLaunchHTML("", err.Error())))
		return
	}
	deepLink, err := createProvinceDeepLink(c.Request.Context(), provinceUser)
	if errors.Is(err, errProvinceAccountDisabled) {
		c.Data(http.StatusForbidden, "text/html; charset=utf-8", []byte(provinceLaunchHTML("", "当前省域平台账号已停用")))
		return
	}
	if err != nil {
		c.Data(http.StatusInternalServerError, "text/html; charset=utf-8", []byte(provinceLaunchHTML("", "创建 Parvis 登录凭证失败")))
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(provinceLaunchHTML(deepLink, "")))
}

// ProvinceSSOInternalLaunch accepts an already validated province user from the
// trusted AI Search backend. The shared key authenticates the calling service;
// it is never sent to the browser.
func ProvinceSSOInternalLaunch(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if !provinceSSOEnabled() {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "省域平台登录未启用"})
		return
	}
	if provinceInternalKey() == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "省域内部登录未配置"})
		return
	}
	if !provinceInternalKeyAuthorized(c.GetHeader("X-Parvis-Internal-Key")) {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "unauthorized"})
		return
	}

	var provinceUser provinceTicketUser
	if err := c.ShouldBindJSON(&provinceUser); err != nil || strings.TrimSpace(provinceUser.Account) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无效省域用户信息"})
		return
	}

	deepLink, err := createProvinceDeepLink(c.Request.Context(), &provinceUser)
	if errors.Is(err, errProvinceAccountDisabled) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": errProvinceAccountDisabled.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "创建 Parvis 登录凭证失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"deep_link": deepLink},
	})
}

func provinceFirstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

type provinceExchangeRequest struct {
	Code     string `json:"code"`
	DeviceId string `json:"device_id"`
}

func ProvinceSSOExchange(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if !provinceSSOEnabled() {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "省域平台登录未启用"})
		return
	}
	var request provinceExchangeRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无效请求"})
		return
	}
	result, err := model.ConsumeProvinceLaunchCode(request.Code, request.DeviceId)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"token": result.Token.Key,
			"user": gin.H{
				"id":            result.User.Id,
				"username":      result.User.Username,
				"display_name":  result.User.DisplayName,
				"role":          result.User.Role,
				"quota":         result.User.Quota,
				"used_quota":    result.User.UsedQuota,
				"request_count": result.User.RequestCount,
			},
		},
	})
}

type provinceLogoutRequest struct {
	DeviceId string `json:"device_id"`
}

func ProvinceSSOLogout(c *gin.Context) {
	var request provinceLogoutRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无效请求"})
		return
	}
	userId := c.GetInt(ctxkey.Id)
	tokenId := c.GetInt(ctxkey.TokenId)
	if err := model.RevokeProvinceDeviceToken(userId, tokenId, request.DeviceId); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}
