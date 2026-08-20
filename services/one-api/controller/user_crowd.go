package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
)

// AdminGetUserCrowds 获取用户分群列表
func AdminGetUserCrowds(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	crowds, total, err := model.GetAllUserCrowds((page-1)*pageSize, pageSize)
	if err != nil {
		logger.SysError("获取用户分群列表失败: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "获取分群列表失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    crowds,
		"total":   total,
	})
}

// AdminGetUserCrowd 获取单个用户分群
func AdminGetUserCrowd(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "无效的分群ID",
		})
		return
	}

	crowd, err := model.GetUserCrowdById(id)
	if err != nil {
		logger.SysError("获取用户分群失败: " + err.Error())
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "分群不存在",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    crowd,
	})
}

// AdminCreateUserCrowd 创建用户分群
func AdminCreateUserCrowd(c *gin.Context) {
	var crowd model.UserCrowd
	if err := c.ShouldBindJSON(&crowd); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	// 验证规则格式
	_, err := crowd.ParseRules()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "分群规则格式错误: " + err.Error(),
		})
		return
	}

	// 创建分群
	if err := model.CreateUserCrowd(&crowd); err != nil {
		logger.SysError("创建用户分群失败: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "创建分群失败",
		})
		return
	}

	// 计算初始人数
	if err := crowd.CalculateUserCount(); err != nil {
		logger.SysError("计算分群人数失败: " + err.Error())
		// 不阻塞创建流程
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "创建成功",
		"data":    crowd,
	})
}

// AdminUpdateUserCrowd 更新用户分群
func AdminUpdateUserCrowd(c *gin.Context) {
	var crowd model.UserCrowd
	if err := c.ShouldBindJSON(&crowd); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	if crowd.Id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "缺少分群ID",
		})
		return
	}

	// 验证规则格式
	_, err := crowd.ParseRules()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "分群规则格式错误: " + err.Error(),
		})
		return
	}

	// 更新分群
	if err := model.UpdateUserCrowd(&crowd); err != nil {
		logger.SysError("更新用户分群失败: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "更新分群失败",
		})
		return
	}

	// 重新计算人数
	if err := crowd.CalculateUserCount(); err != nil {
		logger.SysError("计算分群人数失败: " + err.Error())
		// 不阻塞更新流程
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "更新成功",
		"data":    crowd,
	})
}

// AdminDeleteUserCrowd 删除用户分群
func AdminDeleteUserCrowd(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "无效的分群ID",
		})
		return
	}

	// 删除分群（内部会检查关联活动）
	if err := model.DeleteUserCrowd(id); err != nil {
		logger.SysError("删除用户分群失败: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "删除成功",
	})
}

// AdminGetCrowdUsers 获取分群用户列表（预览）
func AdminGetCrowdUsers(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "无效的分群ID",
		})
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	crowd, err := model.GetUserCrowdById(id)
	if err != nil {
		logger.SysError("获取用户分群失败: " + err.Error())
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "分群不存在",
		})
		return
	}

	userIds, err := crowd.GetMatchedUsersWithPagination((page-1)*pageSize, pageSize)
	if err != nil {
		logger.SysError("获取分群用户列表失败: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "获取用户列表失败",
		})
		return
	}

	users, err := model.GetCrowdUserDetails(userIds)
	if err != nil {
		logger.SysError("获取分群用户详情失败: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "获取用户列表失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    users,
		"total":   len(users),
	})
}

// AdminCalculateCrowdCount 刷新分群人数
func AdminCalculateCrowdCount(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "无效的分群ID",
		})
		return
	}

	crowd, err := model.GetUserCrowdById(id)
	if err != nil {
		logger.SysError("获取用户分群失败: " + err.Error())
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "分群不存在",
		})
		return
	}

	if err := crowd.CalculateUserCount(); err != nil {
		logger.SysError("计算分群人数失败: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "计算人数失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "刷新成功",
		"data": gin.H{
			"user_count": crowd.UserCount,
		},
	})
}

// AdminPreviewCrowd 按规则预览分群（保存前预览，不入库）
func AdminPreviewCrowd(c *gin.Context) {
	var req struct {
		Rules    string `json:"rules"`
		Page     int    `json:"page"`
		PageSize int    `json:"page_size"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	page := req.Page
	pageSize := req.PageSize
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	// 内存构造分群实例（不入库），复用规则查询逻辑
	crowd := &model.UserCrowd{Rules: req.Rules}

	// 验证规则格式
	if _, err := crowd.ParseRules(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "分群规则格式错误: " + err.Error(),
		})
		return
	}

	// 命中总数（limit=0 表示不分页，取全部）
	allIds, err := crowd.GetMatchedUsersWithPagination(0, 0)
	if err != nil {
		logger.SysError("预览分群人数失败: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "预览失败",
		})
		return
	}

	// 当前页用户详情
	pageIds, err := crowd.GetMatchedUsersWithPagination((page-1)*pageSize, pageSize)
	if err != nil {
		logger.SysError("预览分群用户失败: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "预览失败",
		})
		return
	}

	users, err := model.GetCrowdUserDetails(pageIds)
	if err != nil {
		logger.SysError("预览分群用户详情失败: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "预览失败",
		})
		return
	}

	// 填充每个用户的运营标签用于筛选结果展示;失败不阻断返回。
	if err := model.AttachTagsToUsers(users); err != nil {
		logger.SysError("填充用户标签失败: " + err.Error())
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    users,
		"total":   len(allIds),
	})
}

// AdminBatchGrant 基于分群规则批量发放权益（积分/会员时长/优惠券）
// POST /api/user-crowd/batch-grant
func AdminBatchGrant(c *gin.Context) {
	ctx := c.Request.Context()
	var req struct {
		Rules          string  `json:"rules"`
		GrantType      string  `json:"grant_type"`
		QuotaAmount    int64   `json:"quota_amount"`
		ExpiresInDays  int     `json:"expires_in_days"`
		MembershipDays int     `json:"membership_days"`
		IdentityId     int     `json:"identity_id"`
		CouponSubtype  string  `json:"coupon_subtype"`
		CouponValue    float64 `json:"coupon_value"`
		Remark         string  `json:"remark"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}

	req.GrantType = strings.TrimSpace(req.GrantType)
	if req.GrantType == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "grant_type 不能为空"})
		return
	}

	crowd := &model.UserCrowd{Rules: req.Rules}
	if _, err := crowd.ParseRules(); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "分群规则格式错误: " + err.Error()})
		return
	}
	userIds, err := crowd.GetMatchedUsersWithPagination(0, 0)
	if err != nil {
		logger.SysError("批量发放获取用户失败: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取命中用户失败"})
		return
	}
	if len(userIds) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "没有命中用户"})
		return
	}

	source := "运营批量发放"
	if remark := strings.TrimSpace(req.Remark); remark != "" {
		source = source + ":" + remark
	}
	if len([]rune(source)) > 64 {
		source = string([]rune(source)[:64])
	}

	switch req.GrantType {
	case "quota":
		if req.QuotaAmount <= 0 {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "积分数必须大于 0"})
			return
		}
		var ttl *time.Duration
		if req.ExpiresInDays > 0 {
			d := time.Duration(req.ExpiresInDays) * 24 * time.Hour
			ttl = &d
		}
		var failed []string
		for _, uid := range userIds {
			if e := model.AddUserTimedQuota(uid, req.QuotaAmount, model.TimedQuotaSourceAdmin, source, ttl); e != nil {
				logger.SysError("批量发放积分失败 uid=" + strconv.Itoa(uid) + ": " + e.Error())
				failed = append(failed, strconv.Itoa(uid))
			} else {
				model.RecordTopupLog(ctx, uid, source, int(req.QuotaAmount))
			}
		}
		if len(failed) > 0 {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": fmt.Sprintf("发放积分失败 %d/%d 个用户（uid: %s）", len(failed), len(userIds), strings.Join(failed, ",")),
			})
			return
		}

	case "membership":
		if req.IdentityId <= 0 {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "请选择会员身份"})
			return
		}
		if req.MembershipDays <= 0 {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "会员时长天数必须大于 0"})
			return
		}
		var failed []string
		for _, uid := range userIds {
			if e := model.GrantMemberIdentityToUser(uid, req.IdentityId, req.MembershipDays, source); e != nil {
				logger.SysError("批量发放会员失败 uid=" + strconv.Itoa(uid) + ": " + e.Error())
				failed = append(failed, strconv.Itoa(uid))
			}
		}
		if len(failed) > 0 {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": fmt.Sprintf("发放会员失败 %d/%d 个用户（uid: %s）", len(failed), len(userIds), strings.Join(failed, ",")),
			})
			return
		}

	case "coupon":
		if req.CouponSubtype != model.CouponTypeDiscount && req.CouponSubtype != model.CouponTypeDeduction {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "coupon_subtype 必须为 discount 或 deduction"})
			return
		}
		if req.CouponSubtype == model.CouponTypeDiscount && (req.CouponValue <= 0 || req.CouponValue > 1) {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "折扣系数必须在 0-1 之间"})
			return
		}
		if req.CouponSubtype == model.CouponTypeDeduction && req.CouponValue <= 0 {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "抵扣金额必须大于 0"})
			return
		}
		var expiresAt *time.Time
		if req.ExpiresInDays > 0 {
			t := time.Now().Add(time.Duration(req.ExpiresInDays) * 24 * time.Hour)
			expiresAt = &t
		}
		if e := model.BatchAddUserCoupons(userIds, req.CouponSubtype, req.CouponValue, source, expiresAt); e != nil {
			logger.SysError("批量发放优惠券失败: " + e.Error())
			c.JSON(http.StatusOK, gin.H{"success": false, "message": "批量发放优惠券失败: " + e.Error()})
			return
		}

	default:
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "不支持的发放类型: " + req.GrantType})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"matched": len(userIds)},
	})
}

// AutoRefreshCrowdCounts 每日定时批量刷新所有分群的缓存人数。
// 分群规则是动态的(查成员时实时按规则匹配 users 表),但列表展示的 user_count
// 是快照,只在创建/编辑/手动刷新时重算。此任务由每日 0 点 cron 调用,
// 让后台看到的人数自动跟上用户属性变化,无需人工逐个点刷新。
func AutoRefreshCrowdCounts() {
	ok, fail := refreshAllCrowdCounts()
	logger.SysLog(fmt.Sprintf("定时刷新分群人数完成: 成功 %d 个, 失败 %d 个", ok, fail))
}

// refreshAllCrowdCounts 重算所有分群的缓存人数,返回成功/失败计数。
func refreshAllCrowdCounts() (ok, fail int) {
	crowds, _, err := model.GetAllUserCrowds(0, 0)
	if err != nil {
		logger.SysError("批量刷新分群人数失败,无法获取分群列表: " + err.Error())
		return 0, 0
	}
	for _, crowd := range crowds {
		if err := crowd.CalculateUserCount(); err != nil {
			fail++
			logger.SysError(fmt.Sprintf("批量刷新分群人数失败 (id=%d, name=%s): %v", crowd.Id, crowd.Name, err))
			continue
		}
		ok++
	}
	return ok, fail
}

// AdminCalculateAllCrowdCounts 后台手动批量刷新所有分群人数。
func AdminCalculateAllCrowdCounts(c *gin.Context) {
	ok, fail := refreshAllCrowdCounts()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "刷新完成",
		"data":    gin.H{"ok": ok, "fail": fail},
	})
}
