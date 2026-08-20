package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

func AdminListMemberIdentities(c *gin.Context) {
	list, err := model.GetAllMemberIdentities(false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	bound, err := model.GetIdentityBoundPackages()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	// 附带「已绑定商品」名称列表, 供前端展示与删除按钮禁用判断
	data := make([]gin.H, 0, len(list))
	for _, m := range list {
		names := bound[m.Id]
		if names == nil {
			names = []string{}
		}
		data = append(data, gin.H{
			"id":             m.Id,
			"name":           m.Name,
			"description":    m.Description,
			"package_level":  m.PackageLevel,
			"enabled":        m.Enabled,
			"created_at":     m.CreatedAt,
			"updated_at":     m.UpdatedAt,
			"bound_packages": names,
		})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data})
}

func AdminCreateMemberIdentity(c *gin.Context) {
	var m model.MemberIdentity
	if err := c.ShouldBindJSON(&m); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err := model.CreateMemberIdentity(&m); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": m})
}

func AdminUpdateMemberIdentity(c *gin.Context) {
	var m model.MemberIdentity
	if err := c.ShouldBindJSON(&m); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err := model.UpdateMemberIdentity(&m); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func AdminDeleteMemberIdentity(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "id 无效"})
		return
	}
	if err := model.DeleteMemberIdentity(id); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
