package controller

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

func GetParvisDashboard(c *gin.Context) {
	period := c.DefaultQuery("period", "7d")
	now := time.Now()
	var startTime, endTime time.Time

	switch period {
	case "today":
		startTime = now.Truncate(24 * time.Hour)
		endTime = now
	case "7d":
		startTime = now.AddDate(0, 0, -7)
		endTime = now
	case "30d":
		startTime = now.AddDate(0, 0, -30)
		endTime = now
	case "custom":
		startStr := c.Query("start")
		endStr := c.Query("end")
		var err error
		startTime, err = time.Parse("2006-01-02", startStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid start date"})
			return
		}
		endTime, err = time.Parse("2006-01-02", endStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid end date"})
			return
		}
		endTime = endTime.Add(24*time.Hour - time.Second)
	default:
		startTime = now.AddDate(0, 0, -7)
		endTime = now
	}

	kpi, _ := model.GetParvisUserKPI(startTime, endTime)
	userTrend, _ := model.GetUserGrowthTrend(startTime, endTime)
	revenueTrend, _ := model.GetRevenueTrend(startTime, endTime)
	userComp, _ := model.GetUserComposition()
	packageDist, _ := model.GetPackageDistribution(startTime, endTime)
	funnel, _ := model.GetConversionFunnel(startTime, endTime)
	payTypeDist, _ := model.GetPayTypeDistribution(startTime, endTime)
	orderStatusDist, _ := model.GetOrderStatusDistribution(startTime, endTime)
	recentOrders, _ := model.GetRecentOrders(10)
	topSpenders, _ := model.GetTopSpenders(startTime, endTime, 10)
	homepageStats, _ := model.GetHomepageStats(startTime, endTime)
	deviceStats, _ := model.GetDeviceStats(startTime, endTime)
	versionDist, _ := model.GetActiveUserVersionDist(startTime, endTime)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"kpi":                       kpi,
			"user_trend":                userTrend,
			"revenue_trend":             revenueTrend,
			"user_composition":          userComp,
			"package_distribution":      packageDist,
			"conversion_funnel":         funnel,
			"pay_type_distribution":     payTypeDist,
			"order_status_distribution": orderStatusDist,
			"recent_orders":             recentOrders,
			"top_spenders":              topSpenders,
			"homepage_stats":            homepageStats,
			"device_stats":              deviceStats,
			"version_dist":              versionDist,
		},
	})
}
