package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
)

// managementActorRole elevates ordinary users to RoleAdminUser for peer privilege
// checks in the workbench 用户权限 module so that surface matches administrators
// until a unified permission model lands. Root stays Root; admins are unchanged.
func managementActorRole(c *gin.Context) int {
	role := c.GetInt(ctxkey.Role)
	if role > 0 && role < model.RoleAdminUser {
		return model.RoleAdminUser
	}
	return role
}
