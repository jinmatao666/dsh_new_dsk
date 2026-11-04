package controller

import "github.com/gin-gonic/gin"

// GetCheckinStatus retains the status handler name but uses the operational reward policy.
func GetCheckinStatus(c *gin.Context) { DesktopCheckin(c) }
