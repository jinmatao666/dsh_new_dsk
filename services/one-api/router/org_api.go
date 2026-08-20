package router

import (
	"embed"
	"net/http"
	"strings"

	"github.com/gin-contrib/gzip"
	"github.com/gin-contrib/static"
	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/controller"
	"github.com/songquanpeng/one-api/middleware"
)

func SetOrgRouter(router *gin.Engine, buildFS embed.FS) {
	router.Use(middleware.CORS())

	orgApi := router.Group("/org-api")
	orgApi.Use(gzip.Gzip(gzip.DefaultCompression))
	{
		orgApi.POST("/login", controller.OrgLogin)

		authed := orgApi.Group("/")
		authed.Use(middleware.OrgTokenAuth())
		{
			authed.GET("/dashboard", controller.OrgDashboard)
			authed.GET("/dashboard/trend", controller.OrgDashboardTrend)
			authed.GET("/dashboard/health", controller.OrgServiceHealthStat)
			authed.GET("/quota/ledger", controller.OrgGetQuotaLedger)

			authed.GET("/members", controller.OrgGetMembers)
			authed.GET("/members/activity", controller.OrgGetMemberActivity)
			authed.POST("/members", controller.OrgAddMember)
			authed.POST("/members/batch", controller.OrgBatchAddMembers)
			authed.POST("/members/import", controller.OrgBatchImportMembers)
			authed.PUT("/members/:userId", controller.OrgUpdateMember)
			authed.DELETE("/members/:userId", controller.OrgRemoveMember)

			authed.GET("/logs", controller.OrgGetLogs)
			authed.GET("/logs/stat", controller.OrgGetLogsStat)
			authed.GET("/usage/members", controller.OrgGetUsageByMember)
			authed.GET("/usage/models", controller.OrgGetUsageByModel)
			authed.GET("/usage/series", controller.OrgGetUsageSeries)
			authed.GET("/recharge/packages", controller.OrgListRechargePackages)
			authed.GET("/recharge/records", controller.OrgListRechargeRecords)
			authed.POST("/recharge/order", controller.OrgCreateRechargeOrder)
			authed.GET("/recharge/order", controller.OrgQueryRechargeOrder)
			authed.POST("/invoice/create", controller.OrgCreateInvoice)

			authed.GET("/invitations", controller.OrgGetInvitations)
			authed.POST("/invitation", controller.OrgCreateInvitation)
			authed.DELETE("/invitation/:code", controller.OrgDeleteInvitation)

			authed.GET("/settings", controller.OrgGetSettings)
			authed.PUT("/settings", controller.OrgUpdateSettings)

			// 部门管理 / 成员限额 / 操作审计(企业自助)
			authed.GET("/departments", controller.OrgPortalGetDepartments)
			authed.POST("/departments", controller.OrgPortalCreateDepartment)
			authed.PUT("/departments/:deptId", controller.OrgPortalUpdateDepartment)
			authed.PUT("/departments/:deptId/default-limit", controller.OrgPortalSetDeptDefaultLimit)
			authed.DELETE("/departments/:deptId", controller.OrgPortalDeleteDepartment)
			authed.PUT("/members/:userId/dept", controller.OrgPortalSetMemberDept)
			authed.GET("/member-limits", controller.OrgPortalGetMemberLimits)
			authed.PUT("/member-limits/batch", controller.OrgPortalBatchSetMemberLimit)
			authed.PUT("/members/:userId/limit", controller.OrgPortalSetMemberLimit)
			authed.GET("/audit-logs", controller.OrgPortalGetAuditLogs)
		}
	}

	indexPageData, _ := buildFS.ReadFile("web/build/org-admin/index.html")
	router.Use(static.Serve("/", common.EmbedFolder(buildFS, "web/build/org-admin")))
	router.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.RequestURI, "/org-api") {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "接口不存在"})
			return
		}
		c.Header("Cache-Control", "no-cache")
		c.Data(http.StatusOK, "text/html; charset=utf-8", indexPageData)
	})
}
