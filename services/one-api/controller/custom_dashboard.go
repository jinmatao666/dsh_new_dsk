package controller

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
)

func ListCustomDashboard(c *gin.Context) {
	userId := c.GetInt(ctxkey.Id)
	charts, err := model.ListCustomDashboardCharts(userId)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": charts})
}

func CreateCustomDashboard(c *gin.Context) {
	userId := c.GetInt(ctxkey.Id)
	var body struct {
		Title  string `json:"title"`
		Config string `json:"config"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid request: " + err.Error()})
		return
	}
	if body.Title == "" || body.Config == "" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "title 和 config 不能为空"})
		return
	}
	chart := &model.CustomDashboardChart{
		UserId: userId,
		Title:  body.Title,
		Config: body.Config,
	}
	if err := model.CreateCustomDashboardChart(chart); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": chart})
}

func UpdateCustomDashboard(c *gin.Context) {
	userId := c.GetInt(ctxkey.Id)
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid id"})
		return
	}
	var body struct {
		Title  string `json:"title"`
		Config string `json:"config"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid request: " + err.Error()})
		return
	}
	chart := &model.CustomDashboardChart{
		Id:     id,
		UserId: userId,
		Title:  body.Title,
		Config: body.Config,
	}
	if err := model.UpdateCustomDashboardChart(chart); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func DeleteCustomDashboard(c *gin.Context) {
	userId := c.GetInt(ctxkey.Id)
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "invalid id"})
		return
	}
	if err := model.DeleteCustomDashboardChart(userId, id); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
