package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
)

type governmentOrganizationRequest struct {
	ParentID  uint   `json:"parent_id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	SortOrder int    `json:"sort_order"`
}

func requireGovernmentOrganizationEditor(c *gin.Context) bool {
	if c.GetInt(ctxkey.Role) == model.RoleRootUser {
		return true
	}
	respondError(c, "仅超级管理员可以修改组织架构")
	return false
}

// ListGovernmentOrganizationNodes 返回管理端可编辑的政务组织节点。
func ListGovernmentOrganizationNodes(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	nodes, err := model.ListGovernmentOrganizationNodes()
	if err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": nodes})
}

// CreateGovernmentOrganizationNode 在任意已有节点下新增一级。
func CreateGovernmentOrganizationNode(c *gin.Context) {
	if !requireGovernmentOrganizationEditor(c) {
		return
	}
	var request governmentOrganizationRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		respondError(c, "组织节点内容无效")
		return
	}
	node := model.GovernmentOrganizationNode{ParentID: request.ParentID, Name: request.Name, Kind: request.Kind, SortOrder: request.SortOrder}
	if err := model.SaveGovernmentOrganizationNode(&node); err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": node})
}

// UpdateGovernmentOrganizationNode 修改名称、类型、排序或上级节点。
func UpdateGovernmentOrganizationNode(c *gin.Context) {
	if !requireGovernmentOrganizationEditor(c) {
		return
	}
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil || id == 0 {
		respondError(c, "组织节点编号无效")
		return
	}
	var request governmentOrganizationRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		respondError(c, "组织节点内容无效")
		return
	}
	node := model.GovernmentOrganizationNode{ID: uint(id), ParentID: request.ParentID, Name: request.Name, Kind: request.Kind, SortOrder: request.SortOrder}
	if err := model.SaveGovernmentOrganizationNode(&node); err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": node})
}

// DeleteGovernmentOrganizationNode 删除无下级、无角色引用的节点。
func DeleteGovernmentOrganizationNode(c *gin.Context) {
	if !requireGovernmentOrganizationEditor(c) {
		return
	}
	id, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil || id == 0 {
		respondError(c, "组织节点编号无效")
		return
	}
	if err := model.DeleteGovernmentOrganizationNode(uint(id)); err != nil {
		respondError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
