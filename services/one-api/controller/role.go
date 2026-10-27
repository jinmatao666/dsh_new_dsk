package controller

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
)

type roleRequest struct {
	Name        string                `json:"name"`
	Description string                `json:"description"`
	Permissions model.RolePermissions `json:"permissions"`
	Status      int                   `json:"status"`
}

func roleFromRequest(role int, req roleRequest) (model.Role, error) {
	if err := model.ValidateGovernmentOrganizationNodes(req.Permissions.OrganizationNodeIDs); err != nil {
		return model.Role{}, err
	}
	permissions, err := json.Marshal(req.Permissions)
	if err != nil {
		return model.Role{}, err
	}
	if req.Status == 0 {
		req.Status = 1
	}
	return model.Role{Role: role, Name: req.Name, Description: req.Description, Permissions: permissions, Status: req.Status}, nil
}

func ListRoles(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	roles, err := model.ListRoles()
	if err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": roles})
}

func CreateRole(c *gin.Context) {
	var req struct {
		RoleType string `json:"role_type"`
		roleRequest
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, err.Error())
		return
	}
	if req.RoleType == "admin" && c.GetInt(ctxkey.Role) != model.RoleRootUser {
		respondError(c, "仅超级管理员可以创建管理员角色")
		return
	}
	role, err := roleFromRequest(0, req.roleRequest)
	if err != nil {
		respondError(c, err.Error())
		return
	}
	if err := model.CreateRole(&role, req.RoleType); err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": role})
}

func DeleteRole(c *gin.Context) {
	code, err := strconv.Atoi(c.Param("role"))
	if err != nil {
		respondError(c, "角色编号不合法")
		return
	}
	// 普通管理员不能通过删除同级或更高权限角色影响管理账号。
	if c.GetInt(ctxkey.Role) != model.RoleRootUser && code >= model.RoleAdminUser {
		respondError(c, "仅超级管理员可以删除管理员角色")
		return
	}
	if err := model.DeleteRole(code); err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func UpdateRole(c *gin.Context) {
	roleCode, err := strconv.Atoi(c.Param("role"))
	if err != nil {
		respondError(c, "角色编号不合法")
		return
	}
	existing, err := model.GetRole(roleCode)
	if err != nil {
		respondError(c, "角色不存在")
		return
	}
	var req roleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, err.Error())
		return
	}
	role, err := roleFromRequest(roleCode, req)
	if err != nil {
		respondError(c, err.Error())
		return
	}
	role.IsBuiltin = existing.IsBuiltin
	if err := model.UpdateRole(&role); err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": role})
}
