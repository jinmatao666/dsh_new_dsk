package middleware

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/model"
)

func OrgAdminAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		orgIdStr := c.Param("id")
		orgId, err := strconv.Atoi(orgIdStr)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无效的企业ID",
			})
			c.Abort()
			return
		}
		userId := c.GetInt("id")
		if !model.IsOrgAdmin(orgId, userId) {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无权进行此操作，需要企业管理员权限",
			})
			c.Abort()
			return
		}
		c.Set("org_id", orgId)
		c.Next()
	}
}

func OrgMemberAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		orgIdStr := c.Param("id")
		orgId, err := strconv.Atoi(orgIdStr)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无效的企业ID",
			})
			c.Abort()
			return
		}
		userId := c.GetInt("id")
		_, memberErr := model.GetOrgMember(orgId, userId)
		if memberErr != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "无权进行此操作，你不是该企业的成员",
			})
			c.Abort()
			return
		}
		c.Set("org_id", orgId)
		c.Next()
	}
}
