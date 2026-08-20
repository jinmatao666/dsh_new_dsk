package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/model"
)

// AdminGetUserTags 获取用户标签列表
func AdminGetUserTags(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	tags, total, err := model.GetAllUserTags((page-1)*pageSize, pageSize)
	if err != nil {
		logger.SysError("获取用户标签列表失败: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "获取标签列表失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    tags,
		"total":   total,
	})
}

// AdminCreateUserTag 创建用户标签
func AdminCreateUserTag(c *gin.Context) {
	var tag model.UserTag
	if err := c.ShouldBindJSON(&tag); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	if err := model.CreateUserTag(&tag); err != nil {
		logger.SysError("创建用户标签失败: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "创建成功",
		"data":    tag,
	})
}

// AdminUpdateUserTag 更新用户标签
func AdminUpdateUserTag(c *gin.Context) {
	var tag model.UserTag
	if err := c.ShouldBindJSON(&tag); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	if tag.Id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "缺少标签ID",
		})
		return
	}

	if err := model.UpdateUserTag(&tag); err != nil {
		logger.SysError("更新用户标签失败: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "更新成功",
		"data":    tag,
	})
}

// AdminBatchTagUsers 批量给用户打标（追加语义）。
//
// 请求体二选一确定作用对象：
//   - user_ids: []int —— 明确的用户 id 列表（前端勾选场景）
//   - rules: string   —— 分群规则 JSON，服务端解析出全部命中用户（"全部命中"场景，避免前端分页只拿到首页）
//
// tag_ids 必填。返回新增的关联条数。
func AdminBatchTagUsers(c *gin.Context) {
	var req struct {
		UserIds []int  `json:"user_ids"`
		Rules   string `json:"rules"`
		TagIds  []int  `json:"tag_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	if len(req.TagIds) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请至少选择一个标签",
		})
		return
	}

	userIds, errMsg, code := resolveBatchTagUserIds(req.UserIds, req.Rules)
	if errMsg != "" {
		c.JSON(code, gin.H{"success": false, "message": errMsg})
		return
	}

	added, err := model.BatchAttachTagsToUsers(userIds, req.TagIds)
	if err != nil {
		logger.SysError("批量打标失败: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "打标成功",
		"data":    gin.H{"added": added, "user_count": len(userIds)},
	})
}

// resolveBatchTagUserIds 解析批量打标/取消打标的作用用户列表。
//
// userIds 非空时直接采用；否则用 rules 解析全部命中用户。返回 (用户列表, 错误消息, HTTP状态码)，
// 错误消息为空表示成功。
func resolveBatchTagUserIds(userIds []int, rules string) ([]int, string, int) {
	if len(userIds) == 0 && rules != "" {
		crowd := &model.UserCrowd{Rules: rules}
		if _, err := crowd.ParseRules(); err != nil {
			return nil, "分群规则格式错误: " + err.Error(), http.StatusBadRequest
		}
		matched, err := crowd.GetMatchedUsersWithPagination(0, 0)
		if err != nil {
			logger.SysError("解析命中用户失败: " + err.Error())
			return nil, "解析命中用户失败", http.StatusInternalServerError
		}
		userIds = matched
	}
	if len(userIds) == 0 {
		return nil, "没有可操作的用户", http.StatusBadRequest
	}
	return userIds, "", http.StatusOK
}

// AdminBatchUntagUsers 批量从用户身上移除标签。
//
// 作用对象解析逻辑与 AdminBatchTagUsers 相同（user_ids 优先，否则用 rules 全部命中）。
// tag_ids 必填。返回删除的关联条数。
func AdminBatchUntagUsers(c *gin.Context) {
	var req struct {
		UserIds []int  `json:"user_ids"`
		Rules   string `json:"rules"`
		TagIds  []int  `json:"tag_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	if len(req.TagIds) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请至少选择一个标签",
		})
		return
	}

	userIds, errMsg, code := resolveBatchTagUserIds(req.UserIds, req.Rules)
	if errMsg != "" {
		c.JSON(code, gin.H{"success": false, "message": errMsg})
		return
	}

	removed, err := model.BatchDetachTagsFromUsers(userIds, req.TagIds)
	if err != nil {
		logger.SysError("批量取消打标失败: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "取消打标成功",
		"data":    gin.H{"removed": removed, "user_count": len(userIds)},
	})
}

// AdminGetUsersTags 批量查询用户标签。
//
// 请求体：{ user_ids: []int }。返回 user_id -> 标签列表 的映射。
func AdminGetUsersTags(c *gin.Context) {
	var req struct {
		UserIds []int `json:"user_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "请求参数错误: " + err.Error(),
		})
		return
	}

	tagsMap, err := model.GetTagsForUsers(req.UserIds)
	if err != nil {
		logger.SysError("查询用户标签失败: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "查询用户标签失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    tagsMap,
	})
}

// AdminDeleteUserTag 删除用户标签
func AdminDeleteUserTag(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "无效的标签ID",
		})
		return
	}

	if err := model.DeleteUserTag(id); err != nil {
		logger.SysError("删除用户标签失败: " + err.Error())
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
