package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

func ListSkillCategoryTypes(c *gin.Context) {
	includeDisabled := c.Query("includeDisabled") == "1"
	types, err := model.ListSkillCategoryTypes(includeDisabled)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": types})
}

func CreateSkillCategoryType(c *gin.Context) {
	var req model.SkillCategoryType
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request: " + err.Error()})
		return
	}
	if err := model.CreateSkillCategoryType(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": req})
}

func UpdateSkillCategoryType(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid id"})
		return
	}
	var req model.SkillCategoryType
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request: " + err.Error()})
		return
	}
	req.Id = id
	if err := model.UpdateSkillCategoryType(&req); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": req})
}

func ListSkillCategoriesAdmin(c *gin.Context) {
	typeCode := c.Query("type")
	includeDisabled := c.Query("includeDisabled") == "1"
	categories, err := model.ListSkillCategoriesByType(typeCode, includeDisabled)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": categories})
}

type skillCategoryRequest struct {
	TypeId      uint64  `json:"type_id"`
	ParentId    *uint64 `json:"parent_id"`
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Status      int     `json:"status"`
	SortOrder   int     `json:"sort_order"`
}

func skillCategoryFromRequest(req skillCategoryRequest) model.SkillCategory {
	return model.SkillCategory{
		TypeId:      req.TypeId,
		ParentId:    req.ParentId,
		Code:        req.Code,
		Name:        req.Name,
		Description: req.Description,
		Status:      req.Status,
		SortOrder:   req.SortOrder,
	}
}

func CreateSkillCategory(c *gin.Context) {
	var req skillCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request: " + err.Error()})
		return
	}
	category := skillCategoryFromRequest(req)
	if err := model.CreateSkillCategory(&category); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	_ = model.RefreshSkillCache()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": category})
}

func UpdateSkillCategory(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid id"})
		return
	}
	var req skillCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request: " + err.Error()})
		return
	}
	category := skillCategoryFromRequest(req)
	category.Id = id
	existing, err := model.GetSkillCategoryById(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": err.Error()})
		return
	}
	category.TypeId = existing.TypeId
	category.Code = existing.Code
	category.Status = existing.Status
	category.SortOrder = existing.SortOrder
	if err := model.UpdateSkillCategory(&category); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	_ = model.RefreshSkillCache()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": category})
}

func DeleteSkillCategory(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid id"})
		return
	}
	if err := model.DeleteSkillCategory(id); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	_ = model.RefreshSkillCache()
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func ListSkillCategorySkills(c *gin.Context) {
	categoryId, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid id"})
		return
	}
	skills, err := model.ListSkillsForCategory(categoryId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": skills})
}

func RemoveSkillFromCategory(c *gin.Context) {
	categoryId, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid category id"})
		return
	}
	skillId, err := strconv.Atoi(c.Param("skillId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid skill id"})
		return
	}
	if err := model.RemoveSkillFromCategory(categoryId, skillId); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	_ = model.RefreshSkillCache()
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func GetSkillCategories(c *gin.Context) {
	skillId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid id"})
		return
	}
	categories, err := model.ListSkillCategoriesForSkill(skillId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": categories})
}

func ReplaceSkillCategories(c *gin.Context) {
	skillId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid id"})
		return
	}
	var req struct {
		CategoryIds []uint64 `json:"category_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request: " + err.Error()})
		return
	}
	if err := model.ReplaceSkillCategories(skillId, req.CategoryIds); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	_ = model.RefreshSkillCache()
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func ReplaceSkillCategoriesByType(c *gin.Context) {
	skillId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid id"})
		return
	}
	var req struct {
		TypeCode    string   `json:"type_code"`
		CategoryIds []uint64 `json:"category_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request: " + err.Error()})
		return
	}
	if err := model.ReplaceSkillCategoriesByType(skillId, req.TypeCode, req.CategoryIds); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	_ = model.RefreshSkillCache()
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func BatchSkillCategories(c *gin.Context) {
	var req struct {
		SkillIds    []int    `json:"skill_ids"`
		Action      string   `json:"action"`
		CategoryIds []uint64 `json:"category_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid request: " + err.Error()})
		return
	}
	if len(req.SkillIds) == 0 || len(req.CategoryIds) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "skill_ids and category_ids are required"})
		return
	}
	var err error
	switch req.Action {
	case "append":
		err = model.AppendSkillCategories(req.SkillIds, req.CategoryIds)
	case "remove":
		err = model.RemoveSkillCategories(req.SkillIds, req.CategoryIds)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid action"})
		return
	}
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	_ = model.RefreshSkillCache()
	c.JSON(http.StatusOK, gin.H{"success": true})
}
