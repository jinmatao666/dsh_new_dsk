package controller

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

type roleRequest struct {
	Name        string                `json:"name"`
	Description string                `json:"description"`
	Permissions model.RolePermissions `json:"permissions"`
	Status      int                   `json:"status"`
}

func roleFromRequest(role int, req roleRequest) (model.Role, error) {
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
	roles, err := model.ListRoles()
	if err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": roles})
}

func CreateRole(c *gin.Context) {
	var req struct {
		Role int `json:"role"`
		roleRequest
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, err.Error())
		return
	}
	role, err := roleFromRequest(req.Role, req.roleRequest)
	if err != nil {
		respondError(c, err.Error())
		return
	}
	if err := model.CreateRole(&role); err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": role})
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
