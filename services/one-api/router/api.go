package router

import (
	"github.com/songquanpeng/one-api/controller"
	"github.com/songquanpeng/one-api/controller/auth"
	"github.com/songquanpeng/one-api/middleware"

	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
)

func SetApiRouter(router *gin.Engine) {
	apiRouter := router.Group("/api")
	apiRouter.Use(middleware.CORS()) // 添加 CORS 支持
	apiRouter.Use(gzip.Gzip(gzip.DefaultCompression))
	apiRouter.Use(middleware.GlobalAPIRateLimit())
	apiRouter.Use(middleware.AdminOperationLog()) // 后台操作审计记录
	{
		apiRouter.GET("/status", controller.GetStatus)
		apiRouter.GET("/models", middleware.UserAuth(), controller.DashboardListModels)
		apiRouter.GET("/model_ratios", middleware.UserAuth(), controller.GetModelRatios)
		apiRouter.GET("/notice", controller.GetNotice)
		apiRouter.GET("/about", controller.GetAbout)
		apiRouter.GET("/captcha", middleware.GlobalAPIRateLimit(), controller.GetCaptcha)
		apiRouter.GET("/home_page_content", controller.GetHomePageContent)
		apiRouter.GET("/verification", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), controller.SendEmailVerification)
		apiRouter.GET("/reset_password", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), controller.SendPasswordResetEmail)
		apiRouter.POST("/user/reset", middleware.CriticalRateLimit(), controller.ResetPassword)
		apiRouter.GET("/oauth/github", middleware.CriticalRateLimit(), auth.GitHubOAuth)
		apiRouter.GET("/oauth/oidc", middleware.CriticalRateLimit(), auth.OidcAuth)
		apiRouter.GET("/oauth/lark", middleware.CriticalRateLimit(), auth.LarkOAuth)
		apiRouter.GET("/oauth/state", middleware.CriticalRateLimit(), auth.GenerateOAuthCode)
		apiRouter.GET("/oauth/wechat", middleware.CriticalRateLimit(), auth.WeChatAuth)
		apiRouter.GET("/oauth/wechat/qr", middleware.GlobalAPIRateLimit(), auth.WeChatQRGenerate)
		apiRouter.GET("/oauth/wechat/poll", middleware.GlobalAPIRateLimit(), auth.WeChatQRPoll)
		apiRouter.GET("/oauth/wechat/bind", middleware.CriticalRateLimit(), middleware.UserAuth(), auth.WeChatBind)
		apiRouter.GET("/oauth/wechat/quick-bind", middleware.CriticalRateLimit(), middleware.UserAuth(), auth.WeChatQuickBind)
		apiRouter.GET("/oauth/email/bind", middleware.CriticalRateLimit(), middleware.UserAuth(), controller.EmailBind)
		apiRouter.POST("/topup", middleware.AdminAuth(), controller.AdminTopUp)
		apiRouter.GET("/province-sso/launch", middleware.CriticalRateLimit(), controller.ProvinceSSOLaunch)
		// AI Search 的所有请求来自同一后端 IP，不能使用每 20 分钟仅 20 次的
		// CriticalRateLimit，否则多个正常用户会共用并快速耗尽限额。
		apiRouter.POST("/province-sso/internal/launch", middleware.GlobalAPIRateLimit(), controller.ProvinceSSOInternalLaunch)
		apiRouter.POST("/province-sso/exchange", middleware.CriticalRateLimit(), controller.ProvinceSSOExchange)
		apiRouter.POST("/province-sso/logout", middleware.TokenAuth(), controller.ProvinceSSOLogout)
		apiRouter.GET("/mcp/token/validate", middleware.MCPInternalAuth(), middleware.TokenAuth(), controller.ValidateMCPToken)

		userRoute := apiRouter.Group("/user")
		{
			userRoute.POST("/register", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), controller.Register)
			userRoute.POST("/login", middleware.CriticalRateLimit(), controller.Login)
			userRoute.GET("/logout", controller.Logout)

			// Phone authentication routes
			userRoute.POST("/phone/send-code", middleware.CriticalRateLimit(), controller.SendPhoneVerificationCode)
			userRoute.POST("/phone/login", middleware.CriticalRateLimit(), controller.PhoneLogin)
			userRoute.POST("/phone/register", middleware.CriticalRateLimit(), controller.PhoneRegister)
			userRoute.POST("/phone/reset-password", middleware.CriticalRateLimit(), controller.ResetPasswordByPhonePublic)

			selfRoute := userRoute.Group("/")
			selfRoute.Use(middleware.UserAuth())
			{
				selfRoute.GET("/dashboard", controller.GetUserDashboard)
				selfRoute.GET("/dashboard/channel", controller.GetUserChannelDashboard)
				selfRoute.GET("/self", controller.GetSelf)
				selfRoute.PUT("/self", controller.UpdateSelf)
				selfRoute.DELETE("/self", controller.DeleteSelf)
				selfRoute.GET("/token", controller.GenerateAccessToken)
				selfRoute.GET("/aff", controller.GetAffCode)
				selfRoute.GET("/self/quota-records", controller.GetSelfQuotaRecords)
				selfRoute.GET("/self/activity-logs", controller.GetSelfActivityLogs)
				selfRoute.POST("/topup", middleware.RequirePersonalAccount(), controller.TopUp)
				selfRoute.POST("/self/redeem-influencer-code", middleware.RequirePersonalAccount(), controller.RedeemInfluencerCode)
				selfRoute.GET("/self/redeem-influencer-code/status", controller.RedeemInfluencerCodeStatus)
				selfRoute.GET("/available_models", controller.GetUserAvailableModels)
				selfRoute.GET("/available_models/detail", controller.GetUserAvailableModelsDetail)
				// 每日签到状态（签到已改为使用后自动触发，无手动领取接口）
				selfRoute.GET("/checkin/status", controller.GetCheckinStatus)
				// Phone management routes
				selfRoute.POST("/self/phone/bind", controller.BindPhone)
				selfRoute.POST("/self/phone/quick-bind", controller.QuickBindPhone)
				selfRoute.POST("/self/phone/replace", controller.ReplacePhone)
				selfRoute.POST("/self/phone/unbind", controller.UnbindPhone)
				selfRoute.POST("/self/wechat/unbind", controller.UnbindWeChat)
				selfRoute.GET("/self/phone/status", controller.GetPhoneBindStatus)
				selfRoute.POST("/self/phone/send-change-code", middleware.CriticalRateLimit(), controller.SendPhoneChangeCode)
				selfRoute.POST("/self/phone/verify-change-code", controller.VerifyPhoneChangeCode)
				selfRoute.POST("/self/phone/send-reset-code", middleware.CriticalRateLimit(), controller.SendResetPasswordCode)
				selfRoute.POST("/self/phone/reset-password", controller.ResetPasswordByPhone)
			}

			adminRoute := userRoute.Group("/")
			adminRoute.Use(middleware.AdminAuth())
			{
				adminRoute.GET("/", controller.GetAllUsers)
				adminRoute.GET("/search", controller.SearchUsers)
				adminRoute.GET("/:id", controller.GetUser)
				adminRoute.GET("/:id/activity-logs", controller.GetUserActivityLogs)
				adminRoute.POST("/", controller.CreateUser)
				adminRoute.POST("/timed_quota/batch", controller.BatchAdminTimedQuota)
				adminRoute.POST("/manage", controller.ManageUser)
				adminRoute.POST("/batch_manage", controller.BatchManageUser)
				adminRoute.PUT("/", controller.UpdateUser)
				adminRoute.DELETE("/:id", controller.DeleteUser)
				// 账户类型迁移(企业 / 个体身份切换)
				adminRoute.GET("/:id/transfer-preview", controller.PreviewUserTransferToOrg)
				adminRoute.POST("/:id/transfer-to-org", controller.TransferUserToOrg)
				adminRoute.POST("/:id/transfer-to-personal", controller.TransferUserToPersonal)
			}
		}
		// 平台管理员杂项接口,独立分组避免与 /user/:id 通配冲突
		adminMiscRoute := apiRouter.Group("/admin")
		adminMiscRoute.Use(middleware.AdminAuth())
		{
			adminMiscRoute.GET("/account-type-changes", controller.ListAccountTypeChanges)
		}
		// 充值套餐管理(平台管理员)
		rechargePackageRoute := apiRouter.Group("/recharge-package")
		rechargePackageRoute.Use(middleware.AdminAuth())
		{
			rechargePackageRoute.GET("/", controller.AdminListRechargePackages)
			rechargePackageRoute.POST("/", controller.AdminCreateRechargePackage)
			rechargePackageRoute.PUT("/", controller.AdminUpdateRechargePackage)
			rechargePackageRoute.DELETE("/:id", controller.AdminDeleteRechargePackage)
		}
		// 版本更新说明管理(平台管理员)
		versionNoteRoute := apiRouter.Group("/version-note")
		versionNoteRoute.Use(middleware.AdminAuth())
		{
			versionNoteRoute.GET("/", controller.AdminListVersionNotes)
			versionNoteRoute.POST("/", controller.AdminCreateVersionNote)
			versionNoteRoute.PUT("/", controller.AdminUpdateVersionNote)
			versionNoteRoute.DELETE("/:id", controller.AdminDeleteVersionNote)
		}
		// 发布记录(平台管理员,路线B定时探测)
		versionReleaseRoute := apiRouter.Group("/version-release")
		versionReleaseRoute.Use(middleware.AdminAuth())
		{
			versionReleaseRoute.GET("/", controller.AdminListVersionReleases)
		}
		// 通知/公告/站内信管理(平台管理员)
		notificationRoute := apiRouter.Group("/notification")
		notificationRoute.Use(middleware.AdminAuth())
		{
			notificationRoute.GET("/", controller.AdminListNotifications)
			notificationRoute.POST("/", controller.AdminCreateNotification)
			notificationRoute.PUT("/", controller.AdminUpdateNotification)
			notificationRoute.DELETE("/:id", controller.AdminDeleteNotification)
			notificationRoute.POST("/:id/publish", controller.AdminPublishNotification)
		}
		// 活动管理(平台管理员)
		activityRoute := apiRouter.Group("/activity")
		activityRoute.Use(middleware.AdminAuth())
		{
			activityRoute.GET("/", controller.AdminListActivities)
			activityRoute.GET("/:id", controller.AdminGetActivity)
			activityRoute.POST("/", controller.AdminCreateActivity)
			activityRoute.PUT("/", controller.AdminUpdateActivity)
			activityRoute.DELETE("/:id", controller.AdminDeleteActivity)
		}
		// 达人兑换码管理 + 流量看板(平台管理员)
		influencerCodeRoute := apiRouter.Group("/influencer-code")
		influencerCodeRoute.Use(middleware.AdminAuth())
		{
			// 看板/明细：具体路径需在 /:id 之前注册，避免被 :id 捕获
			influencerCodeRoute.GET("/stats", controller.AdminInfluencerCodeStats)
			influencerCodeRoute.GET("/stats/trend", controller.AdminInfluencerCodeTrend)
			influencerCodeRoute.GET("/redemptions", controller.AdminInfluencerCodeRedemptions)
			influencerCodeRoute.GET("/with-reward", controller.AdminListInfluencerCodesWithReward)
			influencerCodeRoute.POST("/batch-import", controller.AdminBatchImportInfluencerCodes)
			influencerCodeRoute.POST("/batch-operate", controller.AdminBatchOperateInfluencerCodes)
			influencerCodeRoute.GET("/", controller.AdminListInfluencerCodes)
			influencerCodeRoute.GET("/:id", controller.AdminGetInfluencerCode)
			influencerCodeRoute.POST("/", controller.AdminCreateInfluencerCode)
			influencerCodeRoute.PUT("/:id", controller.AdminUpdateInfluencerCode)
			influencerCodeRoute.DELETE("/:id", controller.AdminDeleteInfluencerCode)
		}
		// 达人奖励规则(平台管理员) — AI 生成 + 设置读写(T6 在同组追加 GET/PUT /settings)
		rewardRuleRoute := apiRouter.Group("/reward-rule")
		rewardRuleRoute.Use(middleware.AdminAuth())
		{
			rewardRuleRoute.POST("/generate", controller.AdminGenerateRewardRule)
			rewardRuleRoute.GET("/settings", controller.AdminGetRewardSettings)
			rewardRuleRoute.PUT("/settings", controller.AdminUpdateRewardSettings)
		}
		// 达人奖励结算(平台管理员) — 结算 + 奖励记录 + 单码结算历史
		rewardSettlementRoute := apiRouter.Group("/reward-settlement")
		rewardSettlementRoute.Use(middleware.AdminAuth())
		{
			// 具体路径需在 /:id 之前注册，避免被 :id 捕获
			rewardSettlementRoute.POST("/settle", controller.AdminSettleReward)
			rewardSettlementRoute.GET("/by-code", controller.AdminGetSettlementHistoryByCode)
			rewardSettlementRoute.GET("/", controller.AdminListRewardSettlements)
			rewardSettlementRoute.GET("/:id/items", controller.AdminGetRewardSettlementItems)
		}
		// 会员身份管理(平台管理员)
		memberIdentityRoute := apiRouter.Group("/member-identity")
		memberIdentityRoute.Use(middleware.AdminAuth())
		{
			memberIdentityRoute.GET("/", controller.AdminListMemberIdentities)
			memberIdentityRoute.POST("/", controller.AdminCreateMemberIdentity)
			memberIdentityRoute.PUT("/", controller.AdminUpdateMemberIdentity)
			memberIdentityRoute.DELETE("/:id", controller.AdminDeleteMemberIdentity)
		}
		// 用户分群管理(平台管理员) - Phase 2 功能，暂时注释
		userCrowdRoute := apiRouter.Group("/user-crowd")
		userCrowdRoute.Use(middleware.AdminAuth())
		{
			userCrowdRoute.GET("/", controller.AdminGetUserCrowds)
			userCrowdRoute.GET("/:id", controller.AdminGetUserCrowd)
			userCrowdRoute.POST("/", controller.AdminCreateUserCrowd)
			userCrowdRoute.PUT("/", controller.AdminUpdateUserCrowd)
			userCrowdRoute.DELETE("/:id", controller.AdminDeleteUserCrowd)
			userCrowdRoute.GET("/:id/users", controller.AdminGetCrowdUsers)
			userCrowdRoute.POST("/:id/calculate", controller.AdminCalculateCrowdCount)
			userCrowdRoute.POST("/calculate-all", controller.AdminCalculateAllCrowdCounts)
			userCrowdRoute.POST("/preview", controller.AdminPreviewCrowd)
			userCrowdRoute.POST("/batch-grant", controller.AdminBatchGrant)
		}
		// 用户标签管理(平台管理员)
		userTagRoute := apiRouter.Group("/user-tag")
		userTagRoute.Use(middleware.AdminAuth())
		{
			userTagRoute.GET("/", controller.AdminGetUserTags)
			userTagRoute.POST("/", controller.AdminCreateUserTag)
			userTagRoute.PUT("/", controller.AdminUpdateUserTag)
			userTagRoute.DELETE("/:id", controller.AdminDeleteUserTag)
			userTagRoute.POST("/batch", controller.AdminBatchTagUsers)
			userTagRoute.POST("/batch-untag", controller.AdminBatchUntagUsers)
			userTagRoute.POST("/users", controller.AdminGetUsersTags)
		}
		// 运营看板（平台管理员）
		operationDashboardRoute := apiRouter.Group("/operation-dashboard")
		operationDashboardRoute.Use(middleware.AdminAuth())
		{
			operationDashboardRoute.GET("/stats", controller.GetOperationDashboardStats)
			operationDashboardRoute.GET("", controller.ListOperationDashboards)
			operationDashboardRoute.POST("", controller.CreateOperationDashboard)
			operationDashboardRoute.PUT("/:id", controller.UpdateOperationDashboard)
			operationDashboardRoute.DELETE("/:id", controller.DeleteOperationDashboard)
		}
		optionRoute := apiRouter.Group("/option")
		optionRoute.Use(middleware.RootAuth())
		{
			optionRoute.GET("/", controller.GetOptions)
			optionRoute.PUT("/", controller.UpdateOption)
		}
		// 线上数据同步工具(后台工具箱,高危操作全部走 RootAuth)
		syncRoute := apiRouter.Group("/sync")
		syncRoute.Use(middleware.RootAuth())
		{
			syncRoute.GET("/status", controller.GetSyncStatus)
			syncRoute.POST("/preview", controller.PreviewSync)
			syncRoute.POST("/execute", controller.ExecuteSync)
			syncRoute.GET("/task/:id", controller.GetSyncTask)
		}
		adminPermReadRoute := apiRouter.Group("/admin-permissions")
		adminPermReadRoute.Use(middleware.AdminAuth())
		{
			adminPermReadRoute.GET("/", controller.GetAdminPermissions)
			adminPermReadRoute.PUT("/:id", controller.UpdateAdminPermissions)
			adminPermReadRoute.PUT("/:id/role", controller.UpdateAdminRole)
		}
		channelRoute := apiRouter.Group("/channel")
		channelRoute.Use(middleware.AdminAuth())
		{
			channelRoute.GET("/", controller.GetAllChannels)
			channelRoute.GET("/search", controller.SearchChannels)
			channelRoute.GET("/models", controller.ListAllModels)
			channelRoute.GET("/:id", controller.GetChannel)
			channelRoute.GET("/test", controller.TestChannels)
			channelRoute.GET("/test/:id", controller.TestChannel)
			channelRoute.GET("/:id/fetch_models", controller.FetchChannelModels)
			channelRoute.POST("/fetch_models", controller.FetchChannelModelsByConfig)
			channelRoute.POST("/:id/probe_models", controller.ProbeChannelModels)
			channelRoute.GET("/update_balance", controller.UpdateAllChannelsBalance)
			channelRoute.GET("/update_balance/:id", controller.UpdateChannelBalance)
			channelRoute.POST("/", controller.AddChannel)
			channelRoute.POST("/copy/:id", controller.CopyChannel)
			channelRoute.PUT("/", controller.UpdateChannel)
			channelRoute.DELETE("/disabled", controller.DeleteDisabledChannel)
			channelRoute.DELETE("/:id", controller.DeleteChannel)
		}
		// 模型主表 CRUD(T1.2)+ 模型↔渠道关系(T1.3)
		modelDefRoute := apiRouter.Group("/model_definition")
		modelDefRoute.Use(middleware.AdminAuth())
		{
			modelDefRoute.GET("/", controller.GetAllModelDefinitions)
			modelDefRoute.GET("/aggregated", controller.ListAggregatedModels)
			modelDefRoute.GET("/candidate_channels", controller.GetCandidateChannels)
			modelDefRoute.GET("/channel_model_names", controller.GetChannelModelNames)
			modelDefRoute.GET("/test", controller.TestModelChannels)
			modelDefRoute.GET("/:id", controller.GetModelDefinition)
			modelDefRoute.POST("/", controller.AddModelDefinition)
			modelDefRoute.PUT("/", controller.UpdateModelDefinition)
			modelDefRoute.PUT("/reorder", controller.ReorderModelDefinitions)
			modelDefRoute.DELETE("/:id", controller.DeleteModelDefinition)
			// 模型↔渠道来源
			modelDefRoute.GET("/:id/sources", controller.GetModelChannelSources)
			modelDefRoute.GET("/:id/test", controller.TestModelChannels)
			modelDefRoute.POST("/source", controller.AddModelChannelSource)
			modelDefRoute.DELETE("/source", controller.DeleteModelChannelSource)
			modelDefRoute.PUT("/source/priority", controller.SetModelChannelSourcePriority)
		}
		tokenRoute := apiRouter.Group("/token")
		tokenRoute.Use(middleware.UserAuth())
		{
			tokenRoute.GET("/", controller.GetAllTokens)
			tokenRoute.GET("/search", controller.SearchTokens)
			tokenRoute.GET("/:id", controller.GetToken)
			tokenRoute.POST("/", controller.AddToken)
			tokenRoute.PUT("/", controller.UpdateToken)
			tokenRoute.DELETE("/:id", controller.DeleteToken)
		}
		adminTokenRoute := apiRouter.Group("/admin/token")
		adminTokenRoute.Use(middleware.AdminAuth())
		{
			adminTokenRoute.GET("/user/:user_id", controller.GetUserTokens)
			adminTokenRoute.POST("/user/:user_id", controller.AdminAddToken)
			adminTokenRoute.PUT("/user/:user_id", controller.AdminUpdateToken)
			adminTokenRoute.DELETE("/user/:user_id/:id", controller.AdminDeleteToken)
		}
		redemptionRoute := apiRouter.Group("/redemption")
		redemptionRoute.Use(middleware.AdminAuth())
		{
			redemptionRoute.GET("/", controller.GetAllRedemptions)
			redemptionRoute.GET("/search", controller.SearchRedemptions)
			redemptionRoute.GET("/:id", controller.GetRedemption)
			redemptionRoute.POST("/", controller.AddRedemption)
			redemptionRoute.PUT("/", controller.UpdateRedemption)
			redemptionRoute.DELETE("/:id", controller.DeleteRedemption)
		}
		logRoute := apiRouter.Group("/log")
		logRoute.GET("/", middleware.AdminAuth(), controller.GetAllLogs)
		logRoute.GET("/options", middleware.AdminAuth(), controller.GetLogFilterOptions)
		logRoute.DELETE("/", middleware.AdminAuth(), controller.DeleteHistoryLogs)
		logRoute.GET("/stat", middleware.AdminAuth(), controller.GetLogsStat)
		logRoute.GET("/cleanup/stat", middleware.AdminAuth(), controller.GetLogCleanupStat)
		logRoute.GET("/self/stat", middleware.UserAuth(), controller.GetLogsSelfStat)
		logRoute.GET("/self/trend", middleware.UserAuth(), controller.GetLogsSelfTrend)
		logRoute.GET("/search", middleware.AdminAuth(), controller.SearchAllLogs)
		logRoute.GET("/ranking", middleware.AdminAuth(), controller.GetUserUsageRanking)
		logRoute.GET("/self", middleware.UserAuth(), controller.GetUserLogs)
		logRoute.GET("/self/options", middleware.UserAuth(), controller.GetUserLogFilterOptions)
		logRoute.GET("/self/search", middleware.UserAuth(), controller.SearchUserLogs)
		customDashboardRoute := apiRouter.Group("/dashboard/custom")
		customDashboardRoute.Use(middleware.UserAuth())
		{
			customDashboardRoute.GET("", controller.ListCustomDashboard)
			customDashboardRoute.POST("", controller.CreateCustomDashboard)
			customDashboardRoute.PUT("/:id", controller.UpdateCustomDashboard)
			customDashboardRoute.DELETE("/:id", controller.DeleteCustomDashboard)
		}
		groupRoute := apiRouter.Group("/group")
		groupRoute.Use(middleware.AdminAuth())
		{
			groupRoute.GET("/", controller.GetGroups)
		}
		apiRouter.GET("/parvis-dashboard", middleware.AdminAuth(), controller.GetParvisDashboard)
		// 客户端行为事件
		clientEventRoute := apiRouter.Group("/client-event")
		{
			clientEventRoute.POST("", middleware.UserAuth(), controller.ReportClientEvents)
			clientEventRoute.POST("/anonymous", controller.ReportClientEventsAnonymous)
			clientEventRoute.GET("/stats", middleware.AdminAuth(), controller.GetClientEventStats)
			clientEventRoute.GET("/list", middleware.AdminAuth(), controller.GetClientEventList)
			clientEventRoute.GET("/event-names", middleware.AdminAuth(), controller.GetClientEventNames)
			clientEventRoute.GET("/data-keys", middleware.AdminAuth(), controller.GetClientEventDataKeys)
			clientEventRoute.GET("/funnel", middleware.AdminAuth(), controller.GetClientEventFunnel)
		}
		// 后台操作记录（审计）
		adminOpLogRoute := apiRouter.Group("/admin-operation-log")
		adminOpLogRoute.Use(middleware.AdminAuth())
		{
			adminOpLogRoute.GET("/stats", controller.GetAdminOperationLogStats)
			adminOpLogRoute.GET("/list", controller.GetAdminOperationLogList)
			adminOpLogRoute.GET("/actions", controller.GetAdminOperationLogActions)
		}
		paymentRoute := apiRouter.Group("/payment")
		{
			paymentRoute.GET("/packages", controller.GetRechargePackages)
			// 微信支付回调 - 添加日志中间件
			paymentRoute.POST("/notify", func(c *gin.Context) {
				println(">>> 路由层收到 /api/payment/notify 请求")
				controller.PaymentNotify(c)
			})
			paymentRoute.POST("/alipay/callback", controller.AlipayPaymentNotify)
			paymentRoute.GET("/admin/orders", middleware.AdminAuth(), controller.AdminListPaymentOrders)
			paymentRoute.POST("/admin/orders/refund", middleware.AdminAuth(), controller.AdminRefundOrder)
			paymentRoute.GET("/admin/orders/changeable-packages", middleware.AdminAuth(), controller.AdminListChangeablePackages)
			paymentRoute.POST("/admin/orders/change/preview", middleware.AdminAuth(), controller.AdminPreviewOrderChange)
			paymentRoute.POST("/admin/orders/change", middleware.AdminAuth(), controller.AdminChangeOrder)
			paymentRoute.GET("/admin/orders/change-logs", middleware.AdminAuth(), controller.AdminGetOrderChangeLogs)
			paymentRoute.GET("/admin/orders/change-logs/search", middleware.AdminAuth(), controller.AdminSearchOrderChangeLogs)

			userPaymentRoute := paymentRoute.Group("/")
			userPaymentRoute.Use(middleware.UserAuth())
			{
				userPaymentRoute.POST("/order", middleware.RequirePersonalAccount(), controller.CreatePaymentOrder)
				userPaymentRoute.GET("/order", controller.QueryPaymentOrder)
				userPaymentRoute.POST("/order/cancel", middleware.RequirePersonalAccount(), controller.CancelOrder)
				userPaymentRoute.GET("/orders", controller.GetUserOrders)
				userPaymentRoute.GET("/records", controller.GetUserRechargeRecords)
				userPaymentRoute.GET("/subscriptions", controller.GetUserSubscriptions)
				userPaymentRoute.GET("/subscriptions/queue", controller.GetUserSubscriptionQueue)
			}
		}
		// 发票路由组
		invoiceRoute := apiRouter.Group("/invoice")
		{
			// 诺诺回调接口（无需认证）
			invoiceRoute.POST("/callback", controller.InvoiceCallback)
			invoiceRoute.GET("/admin/list", middleware.AdminAuth(), controller.AdminListInvoices)

			// 需要认证的发票接口
			authInvoiceRoute := invoiceRoute.Group("/")
			authInvoiceRoute.Use(middleware.UserAuth())
			{
				authInvoiceRoute.POST("/create", middleware.CriticalRateLimit(), controller.CreateInvoice)
				authInvoiceRoute.GET("/query", controller.GetInvoiceByOrderNo)
				authInvoiceRoute.GET("/orders", controller.GetUserOrdersWithInvoice)
				authInvoiceRoute.GET("/list", controller.GetUserInvoiceList)
			}
		}
		// 企业管理路由组（仅平台管理员）
		orgRoute := apiRouter.Group("/organization")
		orgRoute.Use(middleware.AdminAuth())
		{
			orgRoute.GET("/", controller.GetAllOrganizations)
			orgRoute.GET("/search", controller.SearchOrganizations)
			orgRoute.POST("/create", controller.CreateOrganization)
			orgRoute.GET("/:id", controller.GetOrganization)
			orgRoute.PUT("/:id", controller.UpdateOrganization)
			orgRoute.POST("/:id/topup", controller.TopUpOrganization)
			orgRoute.GET("/:id/quota/breakdown", controller.GetOrganizationQuotaBreakdown)
			orgRoute.POST("/reconcile", controller.ReconcileOrganizationQuota)
			orgRoute.POST("/:id/delete", controller.DeleteOrganization)
			orgRoute.GET("/:id/members", controller.GetOrgMembers)
			orgRoute.POST("/:id/members", controller.AddOrgMember)
			orgRoute.POST("/:id/members/batch", controller.BatchAddOrgMembers)
			orgRoute.POST("/:id/members/generate", controller.BatchGenerateOrgMembers)
			orgRoute.POST("/:id/members/import", controller.BatchImportOrgMembers)
			orgRoute.PUT("/:id/members/:userId", controller.UpdateOrgMember)
			orgRoute.DELETE("/:id/members/:userId", controller.RemoveOrgMember)
			orgRoute.GET("/:id/invitations", controller.GetOrgInvitations)
			orgRoute.POST("/:id/invitation", controller.CreateOrgInvitation)
			orgRoute.DELETE("/:id/invitation/:code", controller.DeleteOrgInvitation)
			// 部门管理
			orgRoute.GET("/:id/departments", controller.GetOrgDepartments)
			orgRoute.POST("/:id/departments", controller.CreateOrgDepartment)
			orgRoute.PUT("/:id/departments/:deptId", controller.UpdateOrgDepartment)
			orgRoute.DELETE("/:id/departments/:deptId", controller.DeleteOrgDepartment)
			// 成员部门归属与日/月限额
			orgRoute.PUT("/:id/members/:userId/dept", controller.SetOrgMemberDept)
			orgRoute.GET("/:id/member-limits", controller.GetOrgMemberLimits)
			orgRoute.PUT("/:id/members/:userId/limit", controller.SetOrgMemberLimit)
			orgRoute.GET("/:id/audit-logs", controller.GetOrgAuditLogs)
		}
		// Skill routes
		skillRoute := apiRouter.Group("/skill")
		skillRoute.Use(middleware.RequireRemoteSkills())
		{
			skillRoute.GET("/", controller.ListSkills)
			skillRoute.GET("/meta", controller.GetSkillsMeta)
			skillRoute.GET("/display-names", controller.GetSkillDisplayNames)
			skillRoute.GET("/function-categories", controller.ListSkillFunctionCategories)
			skillRoute.GET("/:id", controller.GetSkill)
			skillRoute.GET("/:id/bundle", middleware.UserAuth(), middleware.SkillBundleRateLimit(), controller.GetSkillBundle)
			skillRoute.POST("/:id/download", controller.IncrementSkillDownloads)

			skillAdminRoute := skillRoute.Group("/admin")
			skillAdminRoute.Use(middleware.AdminAuth())
			{
				skillAdminRoute.GET("/list", controller.AdminListSkills)
				skillAdminRoute.GET("/categories", controller.ListSkillCategories)
				skillAdminRoute.POST("/batch", controller.BatchSkill)
				skillAdminRoute.POST("/batch-categories", controller.BatchSkillCategories)
				skillAdminRoute.GET("/:id", controller.AdminGetSkillFull)
			}

			skillWriteRoute := skillRoute.Group("/")
			skillWriteRoute.Use(middleware.AdminAuth())
			{
				skillWriteRoute.POST("/", controller.CreateSkill)
				skillWriteRoute.PUT("/:id", controller.UpdateSkill)
				skillWriteRoute.DELETE("/:id", controller.DeleteSkill)
				skillWriteRoute.POST("/:id/restore", controller.RestoreSkill)
				skillWriteRoute.GET("/:id/categories", controller.GetSkillCategories)
				skillWriteRoute.PUT("/:id/categories", controller.ReplaceSkillCategories)
				skillWriteRoute.PUT("/:id/categories/by-type", controller.ReplaceSkillCategoriesByType)
				skillWriteRoute.POST("/refresh-cache", controller.RefreshSkillCache)
			}
		}
		skillCategoryRoute := apiRouter.Group("/skill-category")
		skillCategoryRoute.Use(middleware.RequireRemoteSkills())
		skillCategoryRoute.Use(middleware.AdminAuth())
		{
			skillCategoryRoute.GET("/types", controller.ListSkillCategoryTypes)
			skillCategoryRoute.POST("/types", controller.CreateSkillCategoryType)
			skillCategoryRoute.PUT("/types/:id", controller.UpdateSkillCategoryType)
			skillCategoryRoute.GET("/", controller.ListSkillCategoriesAdmin)
			skillCategoryRoute.POST("/", controller.CreateSkillCategory)
			skillCategoryRoute.PUT("/:id", controller.UpdateSkillCategory)
			skillCategoryRoute.DELETE("/:id", controller.DeleteSkillCategory)
		}
		// Skill package routes (专业广场 — 按 category 分组)
		skillPackageRoute := apiRouter.Group("/skill-package")
		skillPackageRoute.Use(middleware.RequireRemoteSkills())
		{
			skillPackageRoute.GET("/", controller.ListSkillPackages)
			skillPackageRoute.GET("/detail", controller.GetSkillPackageDetail)
		}
		// Personal skill routes (user-scoped)
		personalSkillRoute := apiRouter.Group("/personal-skill")
		personalSkillRoute.Use(middleware.RequireRemoteSkills())
		personalSkillRoute.Use(middleware.UserAuth())
		{
			personalSkillRoute.GET("/", controller.ListPersonalSkills)
			personalSkillRoute.GET("/:id", controller.GetPersonalSkill)
			personalSkillRoute.GET("/:id/bundle", controller.GetPersonalSkillBundle)
			personalSkillRoute.POST("/", controller.CreatePersonalSkill)
			personalSkillRoute.PUT("/:id", controller.UpdatePersonalSkill)
			personalSkillRoute.DELETE("/:id", controller.DeletePersonalSkill)
		}
		// Admin-only personal skill routes (cross-owner)
		personalSkillAdminRoute := apiRouter.Group("/personal-skill/admin")
		personalSkillAdminRoute.Use(middleware.RequireRemoteSkills())
		personalSkillAdminRoute.Use(middleware.AdminAuth())
		{
			personalSkillAdminRoute.GET("/", controller.AdminListPersonalSkills)
			personalSkillAdminRoute.GET("/:id", controller.AdminGetPersonalSkill)
			personalSkillAdminRoute.PUT("/:id", controller.AdminUpdatePersonalSkill)
			personalSkillAdminRoute.DELETE("/:id", controller.AdminDeletePersonalSkill)
		}
		// 邀请码相关接口
		inviteRoute := apiRouter.Group("/invite")
		{
			inviteRoute.GET("/validate", controller.ValidateInviteCode)
			inviteRoute.GET("/activities", controller.GetInviteActivities)
		}
		inviteSelfRoute := apiRouter.Group("/user/invite")
		inviteSelfRoute.Use(middleware.UserAuth())
		{
			inviteSelfRoute.GET("", controller.GetMyInvite)
			inviteSelfRoute.GET("/list", controller.GetMyInviteList)
		}
		// Feedback route
		feedbackRoute := apiRouter.Group("/feedback")
		{
			feedbackRoute.POST("/", controller.CreateFeedback)
			feedbackRoute.GET("/list", middleware.AdminAuth(), controller.GetFeedbackList)
		}
		// 版本更新说明公开查询(供发布脚本按 platform+version 读取)
		versionNotePublicRoute := apiRouter.Group("/version-note")
		{
			versionNotePublicRoute.GET("/lookup", controller.GetVersionNote)
		}
		// 通知公开查询(登录前/官网):仅 audience=all 的公告/服务通知
		notificationPublicRoute := apiRouter.Group("/notifications")
		{
			notificationPublicRoute.GET("/public", controller.GetPublicNotifications)
		}
		// 通知(登录用户):按定向过滤 + 已读状态
		notificationUserRoute := apiRouter.Group("/notifications")
		notificationUserRoute.Use(middleware.UserAuth())
		{
			notificationUserRoute.GET("", controller.GetMyNotifications)
			notificationUserRoute.POST("/:id/read", controller.MarkMyNotificationRead)
		}
	}
}
