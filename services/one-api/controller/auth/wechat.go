package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
)

var wechatStateStore sync.Map

// 同一 state 的 OAuth 回调可能被系统浏览器与桌面端各请求一次；微信 code 仅单次有效，需串行并幂等
var wechatAuthLocks sync.Map

func wechatAuthLock(state string) *sync.Mutex {
	v, _ := wechatAuthLocks.LoadOrStore(state, &sync.Mutex{})
	return v.(*sync.Mutex)
}

// 普通扫码会话：与前端二维码倒计时大致一致
const wechatStateTTL = 5 * time.Minute

// 未绑定微信：用户需切短信/密码登录后再 quick-bind，CreatedAt 在设为 unbound 时重置，TTL 单独放宽
const wechatUnboundStateTTL = 30 * time.Minute

type wechatQRResult struct {
	CreatedAt  time.Time
	Status     string // "pending" | "success" | "error" | "unbound"
	User       *model.User
	Message    string
	RetryCount int
	WeChatId   string // 保存未绑定的微信ID，用于后续快速绑定
}

func wechatStateEntryTTL(r *wechatQRResult) time.Duration {
	if r.Status == "unbound" {
		return wechatUnboundStateTTL
	}
	return wechatStateTTL
}

func StartWeChatStateCleanup(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			now := time.Now()
			wechatStateStore.Range(func(key, value interface{}) bool {
				result := value.(*wechatQRResult)
				if now.Sub(result.CreatedAt) > wechatStateEntryTTL(result) {
					wechatStateStore.Delete(key)
				}
				return true
			})
		}
	}
}

type wechatLoginResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    string `json:"data"`
}

func getWeChatOpenIDByCode(code string) (openid, unionid string, err error) {
	apiURL := fmt.Sprintf(
		"https://api.weixin.qq.com/sns/oauth2/access_token?appid=%s&secret=%s&code=%s&grant_type=authorization_code",
		config.WeChatAppID, config.WeChatAppSecret, code,
	)

	client := &http.Client{Timeout: 10 * time.Second}

	for i := 0; i < 2; i++ {
		resp, err := client.Get(apiURL)
		if err != nil {
			if i == 1 {
				return "", "", fmt.Errorf("网络请求失败: %w", err)
			}
			time.Sleep(time.Second)
			continue
		}
		defer resp.Body.Close()

		body, _ := io.ReadAll(resp.Body)
		var result struct {
			Openid  string `json:"openid"`
			Unionid string `json:"unionid"`
			Errcode int    `json:"errcode"`
			Errmsg  string `json:"errmsg"`
		}

		if err := json.Unmarshal(body, &result); err != nil {
			return "", "", fmt.Errorf("解析响应失败: %w", err)
		}

		if result.Errcode != 0 {
			return "", "", fmt.Errorf("微信API错误 %d: %s", result.Errcode, result.Errmsg)
		}

		return result.Openid, result.Unionid, nil
	}

	return "", "", fmt.Errorf("重试失败")
}

func WeChatQRGenerate(c *gin.Context) {
	if !config.WeChatAuthEnabled || config.WeChatAppID == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "管理员未开启微信扫码登录",
		})
		return
	}

	state := uuid.New().String()
	wechatStateStore.Store(state, &wechatQRResult{
		CreatedAt: time.Now(),
		Status:    "pending",
	})

	redirectURI := config.ServerAddress + "/api/oauth/wechat"
	qrconnectURL := fmt.Sprintf(
		"https://open.weixin.qq.com/connect/qrconnect?appid=%s&redirect_uri=%s&response_type=code&scope=snsapi_login&state=%s",
		config.WeChatAppID,
		url.QueryEscape(redirectURI),
		state,
	)
	qrURL := ""
	if parsed, err := fetchWeChatDirectQRCodeURL(qrconnectURL); err == nil {
		qrURL = parsed
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"state":         state,
			"appid":         config.WeChatAppID,
			"redirect_uri":  redirectURI,
			"poll_url":      config.ServerAddress + "/api/oauth/wechat/poll",
			"qr_url":        qrURL,
			"qrconnect_url": qrconnectURL,
		},
	})
}

func fetchWeChatDirectQRCodeURL(qrconnectURL string) (string, error) {
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Get(qrconnectURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	re := regexp.MustCompile(`connect/qrcode/([a-zA-Z0-9_-]+)`)
	m := re.FindSubmatch(body)
	if len(m) < 2 {
		return "", errors.New("failed to parse wechat qrcode uuid")
	}
	uuid := string(m[1])
	return "https://open.weixin.qq.com/connect/qrcode/" + uuid, nil
}

func getWeChatIdByCode(code string) (string, error) {
	if code == "" {
		return "", errors.New("无效的参数")
	}
	req, err := http.NewRequest("GET", fmt.Sprintf("%s/api/wechat/user?code=%s", config.WeChatServerAddress, code), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", config.WeChatServerToken)
	client := http.Client{
		Timeout: 5 * time.Second,
	}
	httpResponse, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer httpResponse.Body.Close()
	var res wechatLoginResponse
	err = json.NewDecoder(httpResponse.Body).Decode(&res)
	if err != nil {
		return "", err
	}
	if !res.Success {
		return "", errors.New(res.Message)
	}
	if res.Data == "" {
		return "", errors.New("验证码错误或已过期")
	}
	return res.Data, nil
}

func WeChatAuth(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")

	if code == "" || state == "" {
		renderInlineHTML(c, http.StatusBadRequest, "参数缺失", false)
		return
	}

	mu := wechatAuthLock(state)
	mu.Lock()
	defer mu.Unlock()

	val, ok := wechatStateStore.Load(state)
	if !ok {
		renderInlineHTML(c, http.StatusBadRequest, "二维码已过期或无效", false)
		return
	}

	result := val.(*wechatQRResult)

	// 幂等：首次请求已用 code 换 openid 并写入状态后，重复请求（常见为浏览器 + 客户端各一次）不再调微信接口
	if result.Status == "success" {
		if result.User != nil {
			renderInlineHTML(c, http.StatusOK, "扫码成功，请返回应用", true)
		} else {
			renderInlineHTML(c, http.StatusOK, "已完成登录，请返回应用", true)
		}
		return
	}
	if result.Status == "unbound" && result.WeChatId != "" {
		renderInlineHTML(c, http.StatusOK, "该微信未绑定账号，请先注册或登录后绑定", false)
		return
	}

	if result.RetryCount >= 3 {
		result.Status = "error"
		result.Message = "回调处理失败次数过多"
		wechatStateStore.Store(state, result)
		renderInlineHTML(c, http.StatusInternalServerError, result.Message, false)
		return
	}
	result.RetryCount++

	openid, unionid, err := getWeChatOpenIDByCode(code)
	if err != nil {
		errStr := err.Error()
		// 40163: code been used — 另一路请求已消费同一 code，若本 state 已成功落库则按成功页返回
		if strings.Contains(errStr, "40163") || strings.Contains(strings.ToLower(errStr), "been used") {
			if val2, ok2 := wechatStateStore.Load(state); ok2 {
				r2 := val2.(*wechatQRResult)
				if r2.Status == "unbound" && r2.WeChatId != "" {
					// 另一路已用掉 code 并成功落库；撤销本次预加的失败重试计数
					if result.RetryCount > 0 {
						result.RetryCount--
					}
					renderInlineHTML(c, http.StatusOK, "该微信未绑定账号，请先注册或登录后绑定", false)
					return
				}
				if r2.Status == "success" {
					if result.RetryCount > 0 {
						result.RetryCount--
					}
					if r2.User != nil {
						renderInlineHTML(c, http.StatusOK, "扫码成功，请返回应用", true)
					} else {
						renderInlineHTML(c, http.StatusOK, "已完成登录，请返回应用", true)
					}
					return
				}
			}
		}
		result.Status = "error"
		result.Message = fmt.Sprintf("获取微信信息失败: %v", err)
		wechatStateStore.Store(state, result)
		renderInlineHTML(c, http.StatusInternalServerError, "微信授权失败，请重试", false)
		return
	}

	wechatId := unionid
	if wechatId == "" {
		wechatId = openid
	}

	user := model.User{WeChatId: wechatId}
	if model.IsWeChatIdAlreadyTaken(wechatId) {
		err := user.FillUserByWeChatId()
		if err != nil {
			result.Status = "error"
			result.Message = fmt.Sprintf("用户查询失败: %v", err)
			wechatStateStore.Store(state, result)
			renderInlineHTML(c, http.StatusInternalServerError, "登录失败，请联系管理员", false)
			return
		}
	} else {
		// 微信未绑定任何账号，保存微信ID并返回 unbound 状态
		result.Status = "unbound"
		result.Message = "该微信未绑定账号"
		result.WeChatId = wechatId
		// 从「未绑定」起单独计时，避免用户短信登录耗时导致整段 state 被 5 分钟清理误删
		result.CreatedAt = time.Now()
		wechatStateStore.Store(state, result)
		renderInlineHTML(c, http.StatusOK, "该微信未绑定账号，请先注册或登录后绑定", false)
		return
	}

	if user.Status != model.UserStatusEnabled {
		result.Status = "error"
		result.Message = "用户已被封禁"
		wechatStateStore.Store(state, result)
		renderInlineHTML(c, http.StatusForbidden, result.Message, false)
		return
	}

	result.Status = "success"
	result.User = &user
	wechatStateStore.Store(state, result)

	renderInlineHTML(c, http.StatusOK, "扫码成功，请返回应用", true)
}

func WeChatQRPoll(c *gin.Context) {
	state := c.Query("state")
	if state == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "缺少 state 参数"})
		return
	}

	val, ok := wechatStateStore.Load(state)
	if !ok {
		c.JSON(http.StatusOK, gin.H{"status": "expired", "message": "二维码已过期"})
		return
	}

	result := val.(*wechatQRResult)

	switch result.Status {
	case "pending":
		c.JSON(http.StatusOK, gin.H{"status": "pending"})

	case "success":
		wechatStateStore.Delete(state)
		needBindPhone := strings.TrimSpace(result.User.Phone) == "" || !result.User.PhoneVerified
		// 只设置 session，不调用 SetupLogin（它会写自己的 JSON 响应）
		session := sessions.Default(c)
		session.Set("id", result.User.Id)
		session.Set("username", result.User.Username)
		session.Set("role", result.User.Role)
		session.Set("status", result.User.Status)
		session.Set("need_bind_phone", needBindPhone)
		if err := session.Save(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "message": "会话保存失败"})
			return
		}
		if needBindPhone {
			c.JSON(http.StatusOK, gin.H{
				"status":  "need_bind_phone",
				"message": "请先绑定手机号后继续",
				"data": gin.H{
					"username": result.User.Username,
					"id":       result.User.Id,
				},
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"status": "success",
			"data": gin.H{
				"username": result.User.Username,
				"id":       result.User.Id,
			},
		})

	case "unbound":
		// 不删除 state，保留用于后续快速绑定；滑动续期，防止用户长时间停留在绑定引导页
		result.CreatedAt = time.Now()
		wechatStateStore.Store(state, result)
		c.JSON(http.StatusOK, gin.H{
			"status":  "unbound",
			"message": result.Message,
			"state":   state, // 返回 state 供前端保存
		})

	case "error":
		wechatStateStore.Delete(state)
		c.JSON(http.StatusOK, gin.H{"status": "error", "message": result.Message})

	default:
		c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "message": "未知状态"})
	}
}

func WeChatBind(c *gin.Context) {
	if !config.WeChatAuthEnabled {
		c.JSON(http.StatusOK, gin.H{
			"message": "管理员未开启通过微信登录以及注册",
			"success": false,
		})
		return
	}
	code := c.Query("code")
	wechatId, err := getWeChatIdByCode(code)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"message": err.Error(),
			"success": false,
		})
		return
	}
	id := c.GetInt(ctxkey.Id)
	user := model.User{
		Id: id,
	}
	// 查重排除自己:已绑到自己账号则幂等放行(见 model.IsIdentifierTakenByOther)。
	if model.IsWeChatIdTakenByOther(wechatId, id) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "该微信账号已被绑定",
		})
		return
	}
	err = user.FillUserById()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	user.WeChatId = wechatId
	err = user.Update(false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	// 阶段 5 单源化：wechat_id 由账号中心持有,User.Update 已 Omit。补一次显式写入。
	if err := model.WriteAccountIdentifierByLocalUser(user.Id, model.IdentifierTypeWeChat,
		wechatId, true, "wechat_bind"); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

// WeChatQuickBind 快速绑定微信（登录/注册后使用保存的 state 绑定）
func WeChatQuickBind(c *gin.Context) {
	if !config.WeChatAuthEnabled {
		c.JSON(http.StatusOK, gin.H{
			"message": "管理员未开启通过微信登录以及注册",
			"success": false,
		})
		return
	}

	state := c.Query("state")
	phoneCode := c.Query("phone_code")
	if state == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "缺少 state 参数",
		})
		return
	}

	// 从 store 中获取保存的微信ID
	val, ok := wechatStateStore.Load(state)
	if !ok {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "绑定信息已过期，请重新扫码",
		})
		return
	}

	result := val.(*wechatQRResult)
	if result.Status != "unbound" || result.WeChatId == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无效的绑定请求",
		})
		return
	}

	wechatId := result.WeChatId

	// 获取当前登录用户
	id := c.GetInt(ctxkey.Id)
	// 查重排除自己:已绑到自己账号则幂等放行(见 model.IsIdentifierTakenByOther)。
	if model.IsWeChatIdTakenByOther(wechatId, id) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "该微信账号已被其他账号绑定",
		})
		return
	}

	user := model.User{Id: id}
	err := user.FillUserById()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	// 若传入 phone_code：须已绑定且已验证手机号，并按敏感操作校验短信。
	// 若未传：视为用户刚通过当前会话完成登录（如「扫码未绑定 → 密码/手机验证码登录」），
	// 信任 session 完成绑定（含仅有用户名、尚未绑手机的历史账号）。
	if phoneCode != "" {
		if user.Phone == "" || !user.PhoneVerified {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "请先绑定手机号后再绑定微信",
			})
			return
		}
		if !common.VerifyPhoneCode(user.Phone, phoneCode, common.PhoneChangePurpose) {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "验证码无效或已过期",
			})
			return
		}
	}

	// 绑定微信
	user.WeChatId = wechatId
	err = user.Update(false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	// 阶段 5 单源化：wechat_id 由账号中心持有,User.Update 已 Omit。
	if err := model.WriteAccountIdentifierByLocalUser(user.Id, model.IdentifierTypeWeChat,
		wechatId, true, "wechat_quick_bind"); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	// 删除临时状态
	wechatStateStore.Delete(state)
	if phoneCode != "" {
		common.DeletePhoneVerificationCode(user.Phone, common.PhoneChangePurpose)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "微信绑定成功",
	})
}

func renderInlineHTML(c *gin.Context, status int, message string, success bool) {
	color := "#e53e3e"
	title := "出错了"
	if success {
		color = "#38a169"
		title = "成功"
	}
	html := fmt.Sprintf(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>%s</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f7fafc}
.card{text-align:center;padding:40px;border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.08);max-width:400px}
.msg{color:%s;font-size:18px;font-weight:600}</style></head>
<body><div class="card"><p class="msg">%s</p></div></body></html>`, title, color, message)
	c.Data(status, "text/html; charset=utf-8", []byte(html))
}
