package controller

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/common/i18n"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/common/random"
	"github.com/songquanpeng/one-api/common/sms"
	"github.com/songquanpeng/one-api/model"
)

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func Login(c *gin.Context) {
	if !config.PasswordLoginEnabled {
		c.JSON(http.StatusOK, gin.H{
			"message": "管理员关闭了密码登录",
			"success": false,
		})
		return
	}
	var loginRequest LoginRequest
	err := json.NewDecoder(c.Request.Body).Decode(&loginRequest)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"message": i18n.Translate(c, "invalid_parameter"),
			"success": false,
		})
		return
	}
	username := loginRequest.Username
	password := loginRequest.Password
	if username == "" || password == "" {
		c.JSON(http.StatusOK, gin.H{
			"message": i18n.Translate(c, "invalid_parameter"),
			"success": false,
		})
		return
	}
	user := model.User{
		Username: username,
		Password: password,
	}
	err = user.ValidateAndFill()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"message": err.Error(),
			"success": false,
		})
		return
	}
	SetupLogin(&user, c)
}

// setup session & cookies and then return user info
func SetupLogin(user *model.User, c *gin.Context) {
	session := sessions.Default(c)
	session.Set("id", user.Id)
	session.Set("username", user.Username)
	session.Set("role", user.Role)
	session.Set("status", user.Status)
	err := session.Save()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"message": "无法保存会话信息，请重试",
			"success": false,
		})
		return
	}
	cleanUser := model.User{
		Id:               user.Id,
		Username:         user.Username,
		DisplayName:      model.ResolveUserDisplayName(user.AccountId, user.DisplayName),
		Role:             user.Role,
		Status:           user.Status,
		Quota:            user.Quota,
		UsedQuota:        user.UsedQuota,
		RequestCount:     user.RequestCount,
		AdminPermissions: user.AdminPermissions,
	}

	// ✨ 触发登录活动
	if err := model.TriggerActivities(c.Request.Context(), "login", user.Id); err != nil {
		logger.SysError(fmt.Sprintf("触发登录活动失败 user=%d: %v", user.Id, err))
		// 埋点上报
		// telemetry.track("登录活动异常", map[string]interface{}{"user_id": user.Id, "error": err.Error()})
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "",
		"success": true,
		"data":    cleanUser,
	})
}

func Logout(c *gin.Context) {
	session := sessions.Default(c)
	session.Clear()
	err := session.Save()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"message": err.Error(),
			"success": false,
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "",
		"success": true,
	})
}

func Register(c *gin.Context) {
	ctx := c.Request.Context()
	if !config.RegisterEnabled {
		c.JSON(http.StatusOK, gin.H{
			"message": "管理员关闭了新用户注册",
			"success": false,
		})
		return
	}
	if !config.PasswordRegisterEnabled {
		c.JSON(http.StatusOK, gin.H{
			"message": "管理员关闭了通过密码进行注册，请使用第三方账户验证的形式进行注册",
			"success": false,
		})
		return
	}
	var user model.User
	err := json.NewDecoder(c.Request.Body).Decode(&user)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}
	if err := common.Validate.Struct(&user); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_input"),
		})
		return
	}
	if config.EmailVerificationEnabled {
		if user.Email == "" || user.VerificationCode == "" {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "管理员开启了邮箱验证，请输入邮箱地址和验证码",
			})
			return
		}
		if !common.VerifyCodeWithKey(user.Email, user.VerificationCode, common.EmailVerificationPurpose) {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "验证码错误或已过期",
			})
			return
		}
	}
	affCode := user.AffCode // this code is the inviter's code, not the user's own code
	inviterId, _ := model.GetUserIdByAffCode(affCode)
	cleanUser := model.User{
		Username:    user.Username,
		Password:    user.Password,
		DisplayName: user.Username,
		InviterId:   inviterId,
	}
	if config.EmailVerificationEnabled {
		cleanUser.Email = user.Email
	}
	if err := cleanUser.Insert(ctx, inviterId); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	// 异步触发注册邀请活动
	if affCode != "" {
		go func() {
			if err := model.TriggerInviteActivities(ctx, "registration", cleanUser.Id, affCode, "", 0); err != nil {
				logger.SysError(fmt.Sprintf("触发注册邀请活动失败 user=%d: %v", cleanUser.Id, err))
			}
		}()
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func GetAllUsers(c *gin.Context) {
	p, _ := strconv.Atoi(c.Query("p"))
	if p < 0 {
		p = 0
	}
	size, _ := strconv.Atoi(c.Query("size"))
	if size <= 0 {
		size = config.ItemsPerPage
	}
	if size > 100 {
		size = 100
	}

	order := c.DefaultQuery("order", "")
	users, err := model.GetAllUsers(p*size, size, order)

	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "[GetAllUsers] " + err.Error(),
		})
		return
	}

	// 填充每个用户的运营标签用于后台列表展示;失败不阻断列表返回。
	if err := model.AttachTagsToUsers(users); err != nil {
		logger.SysError("填充用户标签失败: " + err.Error())
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    users,
	})
}

func SearchUsers(c *gin.Context) {
	keyword := c.Query("keyword")
	users, err := model.SearchUsers(keyword)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "[SearchUsers] " + err.Error(),
		})
		return
	}
	// 填充每个用户的运营标签用于后台列表展示;失败不阻断列表返回。
	if err := model.AttachTagsToUsers(users); err != nil {
		logger.SysError("填充用户标签失败: " + err.Error())
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    users,
	})
	return
}

func GetUser(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	user, err := model.GetUserById(id, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	myRole := c.GetInt(ctxkey.Role)
	if myRole <= user.Role && myRole != model.RoleRootUser {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无权获取同级或更高等级用户的信息",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    user,
	})
	return
}

func GetUserDashboard(c *gin.Context) {
	id := c.GetInt(ctxkey.Id)
	role := c.GetInt(ctxkey.Role)
	now := time.Now()

	var startTs, endTs int64
	if startStr := c.Query("start_timestamp"); startStr != "" {
		if v, e := strconv.ParseInt(startStr, 10, 64); e == nil {
			startTs = v
		}
	}
	if endStr := c.Query("end_timestamp"); endStr != "" {
		if v, e := strconv.ParseInt(endStr, 10, 64); e == nil {
			endTs = v
		}
	}
	if startTs == 0 || endTs == 0 {
		startTs = now.Truncate(24*time.Hour).AddDate(0, 0, -6).Unix()
		endTs = now.Truncate(24 * time.Hour).Add(24*time.Hour - time.Second).Unix()
	}

	var dashboards []*model.LogStatistic
	var err error
	useHour := c.Query("granularity") == "hour"
	if role >= model.RoleAdminUser {
		username := c.Query("username")
		if username != "" {
			if useHour {
				dashboards, err = model.SearchLogsByUsernameHourAndModel(username, int(startTs), int(endTs))
			} else {
				dashboards, err = model.SearchLogsByUsernameDayAndModel(username, int(startTs), int(endTs))
			}
		} else {
			if useHour {
				dashboards, err = model.SearchAllLogsByHourAndModel(int(startTs), int(endTs))
			} else {
				dashboards, err = model.SearchAllLogsByDayAndModel(int(startTs), int(endTs))
			}
		}
	} else {
		if useHour {
			dashboards, err = model.SearchLogsByHourAndModel(id, int(startTs), int(endTs))
		} else {
			dashboards, err = model.SearchLogsByDayAndModel(id, int(startTs), int(endTs))
		}
	}
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无法获取统计信息",
			"data":    nil,
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    dashboards,
	})
	return
}

// ChannelStatisticItem 在 ChannelStatistic 基础上补齐渠道名后返回前端。
type ChannelStatisticItem struct {
	Day              string `json:"Day"`
	ChannelId        int    `json:"ChannelId"`
	ChannelName      string `json:"ChannelName"`
	RequestCount     int    `json:"RequestCount"`
	Quota            int    `json:"Quota"`
	PromptTokens     int    `json:"PromptTokens"`
	CompletionTokens int    `json:"CompletionTokens"`
}

// GetUserChannelDashboard 返回按渠道维度聚合的用量统计。
// 管理员可看全部或指定用户；普通用户只看自身。渠道名在内存中由 id 映射补齐
// （logs 与 channels 可能不同库，无法 SQL JOIN）。
func GetUserChannelDashboard(c *gin.Context) {
	id := c.GetInt(ctxkey.Id)
	role := c.GetInt(ctxkey.Role)
	now := time.Now()

	var startTs, endTs int64
	if startStr := c.Query("start_timestamp"); startStr != "" {
		if v, e := strconv.ParseInt(startStr, 10, 64); e == nil {
			startTs = v
		}
	}
	if endStr := c.Query("end_timestamp"); endStr != "" {
		if v, e := strconv.ParseInt(endStr, 10, 64); e == nil {
			endTs = v
		}
	}
	if startTs == 0 || endTs == 0 {
		startTs = now.Truncate(24*time.Hour).AddDate(0, 0, -6).Unix()
		endTs = now.Truncate(24 * time.Hour).Add(24*time.Hour - time.Second).Unix()
	}

	var stats []*model.ChannelStatistic
	var err error
	useHour := c.Query("granularity") == "hour"
	if role >= model.RoleAdminUser {
		username := c.Query("username")
		if username != "" {
			if useHour {
				stats, err = model.SearchLogsByUsernameHourAndChannel(username, int(startTs), int(endTs))
			} else {
				stats, err = model.SearchLogsByUsernameDayAndChannel(username, int(startTs), int(endTs))
			}
		} else {
			if useHour {
				stats, err = model.SearchAllLogsByHourAndChannel(int(startTs), int(endTs))
			} else {
				stats, err = model.SearchAllLogsByDayAndChannel(int(startTs), int(endTs))
			}
		}
	} else {
		if useHour {
			stats, err = model.SearchLogsByUserHourAndChannel(id, int(startTs), int(endTs))
		} else {
			stats, err = model.SearchLogsByUserDayAndChannel(id, int(startTs), int(endTs))
		}
	}
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无法获取统计信息",
			"data":    nil,
		})
		return
	}

	nameMap, _ := model.GetChannelIdNameMap()
	items := make([]*ChannelStatisticItem, 0, len(stats))
	for _, s := range stats {
		name := nameMap[s.ChannelId]
		if name == "" {
			name = fmt.Sprintf("渠道#%d", s.ChannelId)
		}
		items = append(items, &ChannelStatisticItem{
			Day:              s.Day,
			ChannelId:        s.ChannelId,
			ChannelName:      name,
			RequestCount:     s.RequestCount,
			Quota:            s.Quota,
			PromptTokens:     s.PromptTokens,
			CompletionTokens: s.CompletionTokens,
		})
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    items,
	})
	return
}

func GenerateAccessToken(c *gin.Context) {
	id := c.GetInt(ctxkey.Id)
	user, err := model.GetUserById(id, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	user.AccessToken = random.GetUUID()

	if model.DB.Where("access_token = ?", user.AccessToken).First(user).RowsAffected != 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "请重试，系统生成的 UUID 竟然重复了！",
		})
		return
	}

	if err := user.Update(false); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    user.AccessToken,
	})
	return
}

func GetAffCode(c *gin.Context) {
	id := c.GetInt(ctxkey.Id)
	user, err := model.GetUserById(id, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	if user.AffCode == "" {
		user.AffCode = random.GetRandomString(4)
		if err := user.Update(false); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    user.AffCode,
	})
	return
}

func GetSelf(c *gin.Context) {
	id := c.GetInt(ctxkey.Id)
	user, err := model.GetUserById(id, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	// 定时积分账本明细(未过期账本笔,按到期升序,永久排最后).
	// 失败仅警告不阻断 GetSelf,前端按空数组兜底展示.
	breakdown, breakdownErr := model.GetUserTimedQuotaBreakdown(id)
	if breakdownErr != nil {
		breakdown = nil
	}
	result := gin.H{
		"success":               true,
		"message":               "",
		"data":                  user,
		"quota_per_unit":        config.QuotaPerUnit,
		"timed_quota_breakdown": breakdown,
	}
	org, member, err := model.GetUserActiveOrg(id)
	if err == nil && org != nil && member != nil {
		result["org_info"] = gin.H{
			"org_name":       org.Name,
			"org_id":         org.Id,
			"org_quota":      org.Quota,
			"org_used_quota": org.UsedQuota,
			"quota_limit":    member.QuotaLimit,
			"used_quota":     member.UsedQuota,
			"role":           member.Role,
		}
	}
	c.JSON(http.StatusOK, result)
	return
}

func GetPhoneBindStatus(c *gin.Context) {
	id := c.GetInt(ctxkey.Id)
	user, err := model.GetUserById(id, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	// 纯展示读穿账号中心：手机号以账号中心为准，未启用/未迁移回退 users.Phone。
	phoneVal := model.ResolveUserIdentifierByLocalUser(user.Id, model.IdentifierTypePhone, user.Phone)
	hasPhone := phoneVal != ""
	maskedPhone := ""
	if hasPhone {
		phone := phoneVal
		if strings.HasPrefix(phone, "+86") && len(phone) == 14 {
			phone = phone[3:]
		} else if strings.HasPrefix(phone, "86") && len(phone) == 13 {
			phone = phone[2:]
		}
		if len(phone) > 7 {
			maskedPhone = phone[:3] + "****" + phone[len(phone)-4:]
		} else {
			maskedPhone = phone
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"has_phone":      hasPhone,
			"phone":          maskedPhone,
			"phone_verified": user.PhoneVerified,
		},
	})
}

func validateCurrentAdminPassword(c *gin.Context, password string) error {
	if password == "" {
		return fmt.Errorf("请输入管理员密码")
	}
	adminId := c.GetInt(ctxkey.Id)
	// 账号中心启用后 users.password 列已停写,直读 admin.Password 必然校验失败
	// (能登录是因为登录走账号中心 credential)。优先用账号中心校验,
	// 仅在未启用/未投影时回退老路读 users.password。
	if ok, err := model.ValidateAccountPasswordByLocalUserID(adminId, password); err == nil {
		if !ok {
			return fmt.Errorf("管理员密码错误")
		}
		return nil
	}
	admin, err := model.GetUserById(adminId, true)
	if err != nil {
		return fmt.Errorf("获取管理员信息失败")
	}
	if !common.ValidatePasswordAndHash(password, admin.Password) {
		return fmt.Errorf("管理员密码错误")
	}
	return nil
}

func UpdateUser(c *gin.Context) {
	ctx := c.Request.Context()
	var updatedUser model.User
	body, err := io.ReadAll(c.Request.Body)
	if err == nil {
		err = json.Unmarshal(body, &updatedUser)
	}
	if err != nil || updatedUser.Id == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}
	var rawPayload map[string]json.RawMessage
	_ = json.Unmarshal(body, &rawPayload)
	_, quotaProvided := rawPayload["quota"]
	_, phoneProvided := rawPayload["phone"]
	if updatedUser.Password == "" {
		updatedUser.Password = "$I_LOVE_U" // make Validator happy :)
	}
	if err := common.Validate.Struct(&updatedUser); err != nil {
		errMsg := i18n.Translate(c, "invalid_input")
		if validationErrors, ok := err.(validator.ValidationErrors); ok {
			var details []string
			for _, e := range validationErrors {
				details = append(details, fmt.Sprintf("字段 %s 验证失败: %s=%s, 实际值: %v", e.Field(), e.Tag(), e.Param(), e.Value()))
			}
			errMsg = fmt.Sprintf("%s: %s", errMsg, strings.Join(details, "; "))
		}
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": errMsg,
		})
		return
	}
	originUser, err := model.GetUserById(updatedUser.Id, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	myRole := c.GetInt(ctxkey.Role)
	if myRole <= originUser.Role && myRole != model.RoleRootUser {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无权更新同权限等级或更高权限等级的用户信息",
		})
		return
	}
	if myRole <= updatedUser.Role && myRole != model.RoleRootUser {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无权将其他用户权限等级提升到大于等于自己的权限等级",
		})
		return
	}
	if updatedUser.Password == "$I_LOVE_U" {
		updatedUser.Password = "" // rollback to what it should be
	}
	updatePassword := updatedUser.Password != ""
	// 手机号是受管标识,User.Update() 会 Omit,需单独走 UpdateUserPhone/ClearUserPhone。
	// 仅当请求体显式带 phone 字段时才处理,避免未传时被当成「清空」。
	var phoneChanged bool
	var newPhone string
	if phoneProvided {
		newPhone = strings.TrimSpace(updatedUser.Phone)
		if newPhone != "" {
			newPhone = normalizePhone(newPhone)
			if !validateE164Phone(newPhone) {
				c.JSON(http.StatusOK, gin.H{
					"success": false,
					"message": "手机号格式不正确",
				})
				return
			}
		}
		phoneChanged = newPhone != originUser.Phone
	}
	sensitiveChanged := originUser.Username != updatedUser.Username ||
		originUser.DisplayName != updatedUser.DisplayName ||
		updatePassword ||
		phoneChanged
	if sensitiveChanged {
		if err := validateCurrentAdminPassword(c, updatedUser.AdminPassword); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	}
	if err := updatedUser.Update(updatePassword); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	if phoneChanged {
		if newPhone == "" {
			if err := model.ClearUserPhone(originUser.Id); err != nil {
				c.JSON(http.StatusOK, gin.H{
					"success": false,
					"message": err.Error(),
				})
				return
			}
			model.RecordLog(ctx, originUser.Id, model.LogTypeManage, fmt.Sprintf("管理员解绑了用户 %s 的手机号", originUser.Username))
		} else {
			if model.IsPhoneTakenByOther(newPhone, originUser.Id) {
				c.JSON(http.StatusOK, gin.H{
					"success": false,
					"message": "该手机号已被其他账户绑定",
				})
				return
			}
			if err := model.UpdateUserPhone(originUser.Id, newPhone); err != nil {
				c.JSON(http.StatusOK, gin.H{
					"success": false,
					"message": err.Error(),
				})
				return
			}
			model.RecordLog(ctx, originUser.Id, model.LogTypeManage, fmt.Sprintf("管理员将用户 %s 的手机号更新为 %s", originUser.Username, newPhone))
		}
	}
	originQuota := originUser.SubscriptionQuota + originUser.TimedQuotaTotal
	if quotaProvided && originQuota != updatedUser.Quota {
		if err := model.SetUserTotalQuota(updatedUser.Id, updatedUser.Quota, "admin_edit"); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
		model.RecordLog(ctx, originUser.Id, model.LogTypeManage, fmt.Sprintf("管理员将用户额度从 %s修改为 %s", common.LogQuota(originQuota), common.LogQuota(updatedUser.Quota)))
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func UpdateSelf(c *gin.Context) {
	var user model.User
	err := json.NewDecoder(c.Request.Body).Decode(&user)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}
	if user.Password == "" {
		user.Password = "$I_LOVE_U" // make Validator happy :)
	}
	if err := common.Validate.Struct(&user); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "输入不合法 " + err.Error(),
		})
		return
	}

	cleanUser := model.User{
		Id:          c.GetInt(ctxkey.Id),
		Username:    user.Username,
		Password:    user.Password,
		DisplayName: user.DisplayName,
	}
	if user.Password == "$I_LOVE_U" {
		user.Password = "" // rollback to what it should be
		cleanUser.Password = ""
	}
	updatePassword := user.Password != ""
	if err := cleanUser.Update(updatePassword); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	// B 类档案写收口：账号中心是 display_name 唯一权威写入源（设计 §1.3）。
	// 用户改昵称时同步到 account_profiles，避免 users.display_name 与账号中心档案漂移。
	// 失败不阻断（副本错误不该卡住主流程）。avatar_url 暂未在此入口修改，传空表示不动。
	if cleanUser.DisplayName != "" {
		model.SyncAccountProfileByUserID(cleanUser.Id, cleanUser.DisplayName, "", "user_update_self")
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func DeleteUser(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	originUser, err := model.GetUserById(id, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	myRole := c.GetInt("role")
	if myRole <= originUser.Role {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无权删除同权限等级或更高权限等级的用户",
		})
		return
	}
	err = model.DeleteUserById(id)
	if err != nil {
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
}

func DeleteSelf(c *gin.Context) {
	id := c.GetInt("id")
	user, _ := model.GetUserById(id, false)

	if user.Role == model.RoleRootUser {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "不能删除超级管理员账户",
		})
		return
	}

	err := model.DeleteUserById(id)
	if err != nil {
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

func CreateUser(c *gin.Context) {
	ctx := c.Request.Context()
	var user model.User
	err := json.NewDecoder(c.Request.Body).Decode(&user)
	if err != nil || user.Username == "" || user.Password == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}
	if err := common.Validate.Struct(&user); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_input"),
		})
		return
	}
	if user.DisplayName == "" {
		user.DisplayName = user.Username
	}
	myRole := c.GetInt("role")
	if user.Role >= myRole {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无法创建权限大于等于自己的用户",
		})
		return
	}
	// Even for admin users, we cannot fully trust them!
	cleanUser := model.User{
		Username:    user.Username,
		Password:    user.Password,
		DisplayName: user.DisplayName,
	}
	if err := cleanUser.Insert(ctx, 0); err != nil {
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

type ManageRequest struct {
	Username      string `json:"username"`
	Action        string `json:"action"`
	AdminPassword string `json:"admin_password"`
}

// ManageUser Only admin user can do this
func ManageUser(c *gin.Context) {
	var req ManageRequest
	err := json.NewDecoder(c.Request.Body).Decode(&req)

	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}
	user := model.User{
		Username: req.Username,
	}
	// 阶段 6 单源化：users.username 启用账号中心时是 acc_<ts>_<rand> 占位,
	// 必须走 FillUserByUsername(优先查账号中心 account_identifiers)才能找到用户。
	if err := user.FillUserByUsername(); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "用户不存在",
		})
		return
	}
	if user.Id == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "用户不存在",
		})
		return
	}
	myRole := c.GetInt("role")
	if myRole <= user.Role && myRole != model.RoleRootUser {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "无权更新同权限等级或更高权限等级的用户信息",
		})
		return
	}
	if req.Action == "disable" || req.Action == "delete" || req.Action == "hard_delete" {
		if err := validateCurrentAdminPassword(c, req.AdminPassword); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	}
	switch req.Action {
	case "disable":
		user.Status = model.UserStatusDisabled
		if user.Role == model.RoleRootUser {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无法禁用超级管理员用户",
			})
			return
		}
	case "enable":
		user.Status = model.UserStatusEnabled
	case "delete":
		if user.Role == model.RoleRootUser {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无法删除超级管理员用户",
			})
			return
		}
		if err := user.Delete(); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
	case "hard_delete":
		if user.Role == model.RoleRootUser {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无法删除超级管理员用户",
			})
			return
		}
		// 删除前抓取用户快照——删完关联数据全清，审计记录是唯一可追溯依据。
		snapshot := fmt.Sprintf("彻底删除用户 id=%d username=%s phone=%s quota=%d",
			user.Id, user.Username, user.Phone, user.Quota)
		targetId := strconv.Itoa(user.Id)
		if err := user.HardDelete(); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
		// 写管理员操作审计（失败不阻断，仅记日志）。被删用户已不存在，
		// 故必须显式补这条记录：管理员谁、何时、删了哪个用户、用户快照、来源 IP。
		if logErr := model.CreateAdminOperationLog(&model.AdminOperationLog{
			AdminId:       c.GetInt(ctxkey.Id),
			AdminUsername: c.GetString(ctxkey.Username),
			AdminRole:     c.GetInt(ctxkey.Role),
			Action:        "彻底删除用户",
			Module:        "用户管理",
			Method:        c.Request.Method,
			Path:          c.Request.URL.Path,
			TargetId:      targetId,
			StatusCode:    http.StatusOK,
			Detail:        snapshot,
			Ip:            c.ClientIP(),
		}); logErr != nil {
			logger.SysErrorf("写彻底删除审计记录失败(target=%s): %v", targetId, logErr)
		}
		// 用户行已物理删除，无法走下方 user.Update，直接返回成功。
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "",
		})
		return
	case "promote":
		if myRole != model.RoleRootUser {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "普通管理员用户无法提升其他用户为管理员",
			})
			return
		}
		if user.Role >= model.RoleAdminUser {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "该用户已经是管理员",
			})
			return
		}
		user.Role = model.RoleAdminUser
	case "demote":
		if user.Role == model.RoleRootUser {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无法降级超级管理员用户",
			})
			return
		}
		if user.Role == model.RoleCommonUser {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "该用户已经是普通用户",
			})
			return
		}
		user.Role = model.RoleCommonUser
	}

	if err := user.Update(false); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	clearUser := model.User{
		Role:   user.Role,
		Status: user.Status,
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    clearUser,
	})
	return
}

// BatchManageRequest 批量删除/彻底删除请求。Ids 为账号中心 account_id 或本地 user id,
// 与前端列表 rowKey 保持一致;此处按本地 user id 处理(前端传 record.id)。
type BatchManageRequest struct {
	Ids           []int  `json:"ids"`
	Action        string `json:"action"` // delete | hard_delete
	AdminPassword string `json:"admin_password"`
}

// BatchManageUser 批量删除 / 彻底删除用户。逐个处理,单个失败不阻断其余,
// 汇总成功数与失败明细返回。仅管理员可用,且需校验管理员密码。
func BatchManageUser(c *gin.Context) {
	var req BatchManageRequest
	if err := json.NewDecoder(c.Request.Body).Decode(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}
	if req.Action != "delete" && req.Action != "hard_delete" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "不支持的操作类型",
		})
		return
	}
	if len(req.Ids) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "未选择任何用户",
		})
		return
	}
	if err := validateCurrentAdminPassword(c, req.AdminPassword); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	myRole := c.GetInt("role")
	var successIds []int
	type failItem struct {
		Id      int    `json:"id"`
		Message string `json:"message"`
	}
	var failures []failItem

	for _, id := range req.Ids {
		if id == 0 {
			failures = append(failures, failItem{Id: id, Message: "用户 ID 为空"})
			continue
		}
		user := model.User{Id: id}
		if err := user.FillUserById(); err != nil || user.Id == 0 {
			failures = append(failures, failItem{Id: id, Message: "用户不存在"})
			continue
		}
		if user.Role == model.RoleRootUser {
			failures = append(failures, failItem{Id: id, Message: "无法删除超级管理员用户"})
			continue
		}
		if myRole <= user.Role && myRole != model.RoleRootUser {
			failures = append(failures, failItem{Id: id, Message: "无权删除同权限或更高权限用户"})
			continue
		}

		if req.Action == "hard_delete" {
			snapshot := fmt.Sprintf("彻底删除用户 id=%d username=%s phone=%s quota=%d",
				user.Id, user.Username, user.Phone, user.Quota)
			targetId := strconv.Itoa(user.Id)
			if err := user.HardDelete(); err != nil {
				failures = append(failures, failItem{Id: id, Message: err.Error()})
				continue
			}
			if logErr := model.CreateAdminOperationLog(&model.AdminOperationLog{
				AdminId:       c.GetInt(ctxkey.Id),
				AdminUsername: c.GetString(ctxkey.Username),
				AdminRole:     c.GetInt(ctxkey.Role),
				Action:        "批量彻底删除用户",
				Module:        "用户管理",
				Method:        c.Request.Method,
				Path:          c.Request.URL.Path,
				TargetId:      targetId,
				StatusCode:    http.StatusOK,
				Detail:        snapshot,
				Ip:            c.ClientIP(),
			}); logErr != nil {
				logger.SysErrorf("写批量彻底删除审计记录失败(target=%s): %v", targetId, logErr)
			}
		} else {
			if err := user.Delete(); err != nil {
				failures = append(failures, failItem{Id: id, Message: err.Error()})
				continue
			}
		}
		successIds = append(successIds, id)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"success_ids":   successIds,
			"success_count": len(successIds),
			"fail_count":    len(failures),
			"failures":      failures,
		},
	})
}

func EmailBind(c *gin.Context) {
	email := c.Query("email")
	code := c.Query("code")
	if !common.VerifyCodeWithKey(email, code, common.EmailVerificationPurpose) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "验证码错误或已过期",
		})
		return
	}
	id := c.GetInt("id")
	user := model.User{
		Id: id,
	}
	err := user.FillUserById()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	user.Email = email
	// 阶段 3 单源化：email 由账号中心持有,User.Update 已 Omit("email")。
	// 改为直接写账号中心受管标识(先删后建保证 1 行/账号),不再走 user.Update。
	if err := model.WriteAccountIdentifierByLocalUser(user.Id, model.IdentifierTypeEmail,
		email, true, "bind_email"); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	if user.Role == model.RoleRootUser {
		config.RootUserEmail = email
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

type topUpRequest struct {
	Key string `json:"key"`
}

func TopUp(c *gin.Context) {
	ctx := c.Request.Context()
	req := topUpRequest{}
	err := c.ShouldBindJSON(&req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	id := c.GetInt("id")
	quota, err := model.Redeem(ctx, req.Key, id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    quota,
	})
	return
}

type adminTopUpRequest struct {
	UserId        int    `json:"user_id"`
	Quota         int    `json:"quota"`
	Remark        string `json:"remark"`
	ExpiresInDays int    `json:"expires_in_days"`
	AdminPassword string `json:"admin_password"`
}

type batchAdminTimedQuotaRequest struct {
	Quota         int      `json:"quota"`
	ExpiresInDays int      `json:"expires_in_days"`
	Tag           string   `json:"tag"`
	Remark        string   `json:"remark"`
	Keyword       string   `json:"keyword"`
	Groups        []string `json:"groups"`
	Status        int      `json:"status"`
	Role          int      `json:"role"`
	DryRun        bool     `json:"dry_run"`
	PreviewLimit  int      `json:"preview_limit"`
	AdminPassword string   `json:"admin_password"`
}

func AdminTopUp(c *gin.Context) {
	ctx := c.Request.Context()
	req := adminTopUpRequest{}
	err := c.ShouldBindJSON(&req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	if req.Quota <= 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "额度必须大于 0",
		})
		return
	}
	if req.ExpiresInDays < 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "有效期天数不能为负数",
		})
		return
	}
	if err := validateCurrentAdminPassword(c, req.AdminPassword); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	// 企业账户不持有个人积分,后台充值入口同样拒绝
	if target, gErr := model.GetUserById(req.UserId, false); gErr == nil && target.AccountType == model.AccountTypeEnterprise {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "目标用户为企业账户,请通过企业额度入口充值",
		})
		return
	}
	remark := req.Remark
	if remark == "" {
		remark = fmt.Sprintf("通过 API 充值 %s", common.LogQuota(int64(req.Quota)))
	}
	var ttl *time.Duration
	if req.ExpiresInDays > 0 {
		d := time.Duration(req.ExpiresInDays) * 24 * time.Hour
		ttl = &d
	}
	// 管理员充值落到永久定时积分账本(source=admin),备注作为 source_ref
	err = model.AddUserTimedQuota(req.UserId, int64(req.Quota), model.TimedQuotaSourceAdmin, remark, ttl)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	model.RecordTopupLog(ctx, req.UserId, remark, req.Quota)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func BatchAdminTimedQuota(c *gin.Context) {
	ctx := c.Request.Context()
	req := batchAdminTimedQuotaRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	if req.Quota <= 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "额度必须大于 0",
		})
		return
	}
	if req.ExpiresInDays < 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "有效期天数不能为负数",
		})
		return
	}
	if req.Status != 0 && req.Status != model.UserStatusEnabled && req.Status != model.UserStatusDisabled {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "用户状态筛选不合法",
		})
		return
	}
	if req.Role != 0 && req.Role != model.RoleCommonUser && req.Role != model.RoleAdminUser && req.Role != model.RoleRootUser {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "用户角色筛选不合法",
		})
		return
	}

	filter := model.UserTimedQuotaBatchFilter{
		Keyword: strings.TrimSpace(req.Keyword),
		Groups:  cleanStringList(req.Groups),
		Status:  req.Status,
		Role:    req.Role,
	}
	if req.DryRun {
		preview, err := model.PreviewUsersForTimedQuotaBatch(filter, req.PreviewLimit)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": err.Error(),
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "",
			"data": gin.H{
				"matched": preview.Matched,
				"users":   preview.Users,
			},
		})
		return
	}

	if err := validateCurrentAdminPassword(c, req.AdminPassword); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	tag := strings.TrimSpace(req.Tag)
	remark := strings.TrimSpace(req.Remark)
	if tag == "" {
		tag = "运营批量发放"
	}
	sourceRef := tag
	if remark != "" {
		sourceRef = tag + ":" + remark
	}
	var ttl *time.Duration
	if req.ExpiresInDays > 0 {
		d := time.Duration(req.ExpiresInDays) * 24 * time.Hour
		ttl = &d
	}
	result, err := model.BatchAddUserTimedQuota(filter, int64(req.Quota), sourceRef, ttl)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	logContent := fmt.Sprintf("%s，批量发放 %s", tag, common.LogQuota(int64(req.Quota)))
	if req.ExpiresInDays > 0 {
		logContent += fmt.Sprintf("，有效期 %d 天", req.ExpiresInDays)
	}
	if remark != "" {
		logContent += "，备注：" + remark
	}
	for _, userId := range result.UserIds {
		model.RecordTopupLog(ctx, userId, logContent, req.Quota)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"matched": result.Matched,
		},
	})
	return
}

func cleanStringList(values []string) []string {
	seen := make(map[string]bool)
	cleaned := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		cleaned = append(cleaned, value)
	}
	return cleaned
}

// SendResetPasswordCode sends SMS code to user's bound phone for password reset
func SendResetPasswordCode(c *gin.Context) {
	if !config.SMSEnabled {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "短信服务未启用",
		})
		return
	}

	// Optional captcha body（图形验证码，CaptchaEnabled 开启时必填）
	var capReq struct {
		CaptchaId   string `json:"captcha_id"`
		CaptchaCode string `json:"captcha_code"`
	}
	_ = c.ShouldBindJSON(&capReq)
	if ok, msg := verifyCaptcha(capReq.CaptchaId, capReq.CaptchaCode); !ok {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": msg,
		})
		return
	}

	userId := c.GetInt(ctxkey.Id)
	user, err := model.GetUserById(userId, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "获取用户信息失败",
		})
		return
	}

	if user.Phone == "" || !user.PhoneVerified {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "请先绑定手机号",
		})
		return
	}

	// Generate verification code
	code := common.GeneratePhoneVerificationCode(config.PhoneVerificationCodeLength)

	// Send SMS
	provider, smsErr := sms.GetProvider()
	if smsErr != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "短信服务暂时不可用",
		})
		return
	}

	smsErr = provider.SendVerificationCode(user.Phone, code)
	if smsErr != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "短信发送失败，请稍后重试",
		})
		return
	}

	common.RegisterPhoneVerificationCode(user.Phone, common.PhoneResetPasswordPurpose, code)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "验证码已发送",
	})
}

type ResetPasswordByPhoneRequest struct {
	Code        string `json:"code" binding:"required"`
	NewPassword string `json:"new_password" binding:"required"`
}

type VerifyBoundPhoneRequest struct {
	Code string `json:"code" binding:"required"`
}

// VerifyPhoneChangeCode 校验当前绑定手机号验证码（用于换绑流程的第一步）
func VerifyPhoneChangeCode(c *gin.Context) {
	var req VerifyBoundPhoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}

	userId := c.GetInt(ctxkey.Id)
	user, err := model.GetUserById(userId, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "获取用户信息失败",
		})
		return
	}
	if user.Phone == "" || !user.PhoneVerified {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "请先绑定手机号",
		})
		return
	}

	if !common.VerifyPhoneCode(user.Phone, req.Code, common.PhoneChangePurpose) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "当前手机号验证码错误或已过期",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "验证通过",
	})
}

// ResetPasswordByPhone resets password using SMS verification code
// Phone number is read from user's profile, not from request
func ResetPasswordByPhone(c *gin.Context) {
	userId := c.GetInt(ctxkey.Id)
	user, err := model.GetUserById(userId, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "获取用户信息失败",
		})
		return
	}

	// Check if user has bound phone
	if user.Phone == "" || !user.PhoneVerified {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "请先绑定手机号",
		})
		return
	}

	var req ResetPasswordByPhoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}

	// Validate new password
	if len(req.NewPassword) < 8 || len(req.NewPassword) > 20 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "密码长度应在 8-20 位之间",
		})
		return
	}

	// Verify SMS code using user's phone
	if !common.VerifyPhoneCode(user.Phone, req.Code, common.PhoneResetPasswordPurpose) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "验证码错误或已过期",
		})
		return
	}

	// Update password
	updateUser := model.User{
		Id:       userId,
		Password: req.NewPassword,
	}
	if err := updateUser.Update(true); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "密码重置失败：" + err.Error(),
		})
		return
	}

	// Delete verification code
	common.DeletePhoneVerificationCode(user.Phone, common.PhoneResetPasswordPurpose)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "密码重置成功",
	})
}

type BindPhoneRequest struct {
	Phone string `json:"phone" binding:"required"`
	Code  string `json:"code" binding:"required"`
}

type QuickBindPhoneRequest struct {
	Phone string `json:"phone" binding:"required"`
	Code  string `json:"code" binding:"required"`
}

// BindPhone binds a phone number to user account
func BindPhone(c *gin.Context) {
	var req BindPhoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}

	// Normalize phone number
	req.Phone = normalizePhone(req.Phone)

	// Verify code
	if !common.VerifyPhoneCode(req.Phone, req.Code, common.PhoneBindPurpose) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "验证码错误或已过期",
		})
		return
	}

	userId := c.GetInt(ctxkey.Id)

	// 查重排除自己:号码已属当前用户(account_products 映射的真实账号)则视为幂等,
	// 直接当作绑定成功返回,不报「已被其他账户绑定」(否则重复绑同号会陷入死循环)。
	if model.IsPhoneTakenByOther(req.Phone, userId) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "该手机号已被其他账户绑定",
		})
		return
	}

	err := model.UpdateUserPhone(userId, req.Phone)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	// Delete verification code
	common.DeletePhoneVerificationCode(req.Phone, common.PhoneBindPurpose)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "手机号绑定成功",
	})
}

// QuickBindPhone binds phone by reusing phone_login verification code.
// Used by "phone unbound -> password login/register -> auto bind" flow.
func QuickBindPhone(c *gin.Context) {
	var req QuickBindPhoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}

	req.Phone = normalizePhone(req.Phone)
	if !validateE164Phone(req.Phone) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "手机号格式不正确",
		})
		return
	}

	if !common.VerifyPhoneCode(req.Phone, req.Code, common.PhoneLoginPurpose) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "手机号快速绑定已失效，请重新手机号登录",
		})
		return
	}

	userId := c.GetInt(ctxkey.Id)

	// 查重排除自己:号码已属当前用户则幂等放行(见 BindPhone 同处说明)。
	if model.IsPhoneTakenByOther(req.Phone, userId) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "该手机号已被其他账户绑定",
		})
		return
	}

	if err := model.UpdateUserPhone(userId, req.Phone); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	common.DeletePhoneVerificationCode(req.Phone, common.PhoneLoginPurpose)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "手机号绑定成功",
	})
}

// ReplacePhoneRequest 更换已绑定手机号：验证旧号短信 + 新号绑定短信
type ReplacePhoneRequest struct {
	OldCode  string `json:"old_code" binding:"required"`
	NewPhone string `json:"new_phone" binding:"required"`
	NewCode  string `json:"new_code" binding:"required"`
}

// ReplacePhone 将当前账号手机号换为新号码（主流应用「换绑」流程）
func ReplacePhone(c *gin.Context) {
	var req ReplacePhoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}

	req.NewPhone = normalizePhone(req.NewPhone)
	if !validateE164Phone(req.NewPhone) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "新手机号格式不正确",
		})
		return
	}

	userId := c.GetInt(ctxkey.Id)
	user, err := model.GetUserById(userId, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "获取用户信息失败",
		})
		return
	}
	if user.Phone == "" || !user.PhoneVerified {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "请先绑定手机号",
		})
		return
	}
	if !common.VerifyPhoneCode(user.Phone, req.OldCode, common.PhoneChangePurpose) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "当前手机号验证码错误或已过期",
		})
		return
	}
	if !common.VerifyPhoneCode(req.NewPhone, req.NewCode, common.PhoneBindPurpose) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "新手机号验证码错误或已过期",
		})
		return
	}
	if req.NewPhone == user.Phone {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "新手机号不能与当前号码相同",
		})
		return
	}
	if model.IsPhoneTakenByOther(req.NewPhone, userId) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "该手机号已被其他账户绑定",
		})
		return
	}
	if err := model.UpdateUserPhone(userId, req.NewPhone); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	common.DeletePhoneVerificationCode(user.Phone, common.PhoneChangePurpose)
	common.DeletePhoneVerificationCode(req.NewPhone, common.PhoneBindPurpose)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "手机号已更换",
	})
}

func UnbindPhone(c *gin.Context) {
	var req VerifyBoundPhoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}

	userId := c.GetInt(ctxkey.Id)
	user, err := model.GetUserById(userId, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "获取用户信息失败",
		})
		return
	}
	if user.Phone == "" || !user.PhoneVerified {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "请先绑定手机号",
		})
		return
	}
	if !common.VerifyPhoneCode(user.Phone, req.Code, common.PhoneChangePurpose) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "验证码错误或已过期",
		})
		return
	}

	if err := model.ClearUserPhone(userId); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	common.DeletePhoneVerificationCode(user.Phone, common.PhoneChangePurpose)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "手机号已解绑",
	})
}

func UnbindWeChat(c *gin.Context) {
	var req VerifyBoundPhoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": i18n.Translate(c, "invalid_parameter"),
		})
		return
	}

	userId := c.GetInt(ctxkey.Id)
	user, err := model.GetUserById(userId, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "获取用户信息失败",
		})
		return
	}
	if user.Phone == "" || !user.PhoneVerified {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "请先绑定手机号",
		})
		return
	}
	if !common.VerifyPhoneCode(user.Phone, req.Code, common.PhoneChangePurpose) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "验证码错误或已过期",
		})
		return
	}

	if err := model.ClearUserWeChat(userId); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	common.DeletePhoneVerificationCode(user.Phone, common.PhoneChangePurpose)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "微信已解绑",
	})
}

func SendPhoneChangeCode(c *gin.Context) {
	if !config.SMSEnabled {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "短信服务未启用",
		})
		return
	}

	// Optional captcha body（图形验证码，CaptchaEnabled 开启时必填）
	var capReq struct {
		CaptchaId   string `json:"captcha_id"`
		CaptchaCode string `json:"captcha_code"`
	}
	_ = c.ShouldBindJSON(&capReq)
	if ok, msg := verifyCaptcha(capReq.CaptchaId, capReq.CaptchaCode); !ok {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": msg,
		})
		return
	}

	userId := c.GetInt(ctxkey.Id)
	user, err := model.GetUserById(userId, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "获取用户信息失败",
		})
		return
	}

	if user.Phone == "" || !user.PhoneVerified {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "请先绑定手机号",
		})
		return
	}

	if !checkPhoneRateLimit(user.Phone) {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": fmt.Sprintf("发送过于频繁，每小时最多发送 %d 次", config.PhoneMaxSendPerHour),
		})
		return
	}

	code := common.GeneratePhoneVerificationCode(config.PhoneVerificationCodeLength)
	provider, smsErr := sms.GetProvider()
	if smsErr != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "短信服务暂时不可用",
		})
		return
	}
	smsErr = provider.SendVerificationCode(user.Phone, code)
	if smsErr != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "短信发送失败，请稍后重试",
		})
		return
	}

	common.RegisterPhoneVerificationCode(user.Phone, common.PhoneChangePurpose, code)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "验证码已发送",
	})
}

func GetAdminPermissions(c *gin.Context) {
	users, err := model.GetAdminUsers()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": users})
}

func callerHasAdminPermissionsAccess(c *gin.Context) bool {
	role := c.GetInt(ctxkey.Role)
	if role >= model.RoleRootUser {
		return true
	}
	id := c.GetInt(ctxkey.Id)
	user, err := model.GetUserById(id, false)
	if err != nil {
		return false
	}
	var perms []string
	if err := json.Unmarshal([]byte(user.AdminPermissions), &perms); err != nil {
		return false
	}
	for _, p := range perms {
		if p == "admin_permissions" {
			return true
		}
	}
	return false
}

func UpdateAdminPermissions(c *gin.Context) {
	if !callerHasAdminPermissionsAccess(c) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权限"})
		return
	}
	idStr := c.Param("id")
	userId, err := strconv.Atoi(idStr)
	if err != nil || userId <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的用户ID"})
		return
	}
	var req struct {
		AdminPermissions string `json:"admin_permissions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if err := model.UpdateAdminPermissions(userId, req.AdminPermissions); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func UpdateAdminRole(c *gin.Context) {
	if !callerHasAdminPermissionsAccess(c) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权限"})
		return
	}
	idStr := c.Param("id")
	userId, err := strconv.Atoi(idStr)
	if err != nil || userId <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的用户ID"})
		return
	}
	var req struct {
		Role int `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if req.Role != model.RoleCommonUser && req.Role != model.RoleAdminUser && req.Role != model.RoleRootUser {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的角色值"})
		return
	}
	// 不允许修改自己的角色
	myId := c.GetInt(ctxkey.Id)
	if myId == userId {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "不能修改自己的角色"})
		return
	}
	if err := model.DB.Model(&model.User{}).Where("id = ?", userId).Update("role", req.Role).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
