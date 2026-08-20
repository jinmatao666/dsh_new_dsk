package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

// AdminListRechargePackages 后台:列出全部套餐(含禁用).
// query: scope=personal|enterprise 时按 scope 过滤;不传 scope 时返回全部(兼容旧后台表格)
func AdminListRechargePackages(c *gin.Context) {
	scope := c.Query("scope")
	var packages []*model.RechargePackage
	var err error
	if scope == "" {
		packages, err = model.GetAllRechargePackagesForAdmin()
	} else {
		packages, err = model.ListRechargePackagesByScope(normalizeScope(scope))
	}
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": packages})
}

// normalizeScope 把任意输入收敛到 personal/enterprise.
func normalizeScope(s string) string {
	if s == model.RechargeScopeEnterprise {
		return model.RechargeScopeEnterprise
	}
	return model.RechargeScopePersonal
}

// AdminCreateRechargePackage 后台:新建套餐.
func AdminCreateRechargePackage(c *gin.Context) {
	var pkg model.RechargePackage
	if err := c.ShouldBindJSON(&pkg); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	pkg.Id = 0
	pkg.Enabled = false // 新建商品默认停用,需后台手动启用
	pkg.Scope = normalizeScope(pkg.Scope)
	if err := model.CreateRechargePackage(&pkg); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": pkg})
}

// AdminUpdateRechargePackage 后台:更新套餐.
func AdminUpdateRechargePackage(c *gin.Context) {
	var pkg model.RechargePackage
	if err := c.ShouldBindJSON(&pkg); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "参数错误"})
		return
	}
	if pkg.Id == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "套餐ID不能为空"})
		return
	}
	// ?status_only=true 时仅切换启用状态(兼容旧后台表格)
	if c.Query("status_only") != "" {
		if err := model.UpdateRechargePackageStatus(pkg.Id, pkg.Enabled); err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
		return
	}
	pkg.Scope = normalizeScope(pkg.Scope)
	if err := model.UpdateRechargePackage(&pkg); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

// AdminDeleteRechargePackage 后台:删除套餐.
func AdminDeleteRechargePackage(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "无效的套餐ID"})
		return
	}
	if err := model.DeleteRechargePackage(id); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}
