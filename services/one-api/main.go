package main

import (
	"context"
	"embed"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	_ "github.com/joho/godotenv/autoload"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/client"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/i18n"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/common/snowflake"
	"github.com/songquanpeng/one-api/controller"
	"github.com/songquanpeng/one-api/controller/auth"
	"github.com/songquanpeng/one-api/invoice"
	"github.com/songquanpeng/one-api/middleware"
	"github.com/songquanpeng/one-api/model"
	"github.com/songquanpeng/one-api/relay/adaptor/openai"
	"github.com/songquanpeng/one-api/router"
)

//go:embed web/build/*
var buildFS embed.FS

//go:embed web/build/org-admin/*
var orgBuildFS embed.FS

func main() {
	common.Init()
	logger.SetupLogger()
	logger.SysLogf("One API %s started", common.Version)
	if err := model.ValidateChannelKeyEncryptionConfig(); err != nil {
		logger.FatalLog("channel key encryption config error: " + err.Error())
	}

	// Load SMS configuration from environment
	config.LoadSMSConfigFromEnv()

	if os.Getenv("GIN_MODE") != gin.DebugMode {
		gin.SetMode(gin.ReleaseMode)
	}
	if config.DebugEnabled {
		logger.SysLog("running in debug mode")
	}

	// Initialize snowflake ID generator (用于账号中心等双库兼容的雪花主键)
	nodeID, _ := strconv.ParseInt(os.Getenv("NODE_ID"), 10, 64)
	if err := snowflake.Init(nodeID); err != nil {
		logger.FatalLog("snowflake 初始化失败: " + err.Error())
	}

	// Initialize SQL Database
	model.InitDB()
	if err := model.MigratePlaintextChannelKeys(); err != nil {
		logger.FatalLog("channel key migration failed: " + err.Error())
	}
	model.InitLogDB()
	model.InitAccountDB()

	// 历史用户迁移到账号中心（幂等，主节点执行；账号中心未启用时内部跳过）。
	// 依赖 DB 与 ACCOUNT_DB 均已就绪，故放在三个 Init 之后。
	// 失败不阻断启动：账号中心是副本，迁移失败下次启动 / 双写会兜底，不该卡住 one-api。
	if config.IsMasterNode {
		if err := model.MigrateAccountsV0(); err != nil {
			logger.SysError("迁移历史用户到账号中心失败（不阻断启动，下次会重试）: " + err.Error())
		}
	}

	// Initialize skill cache
	if err := model.InitSkillCache(); err != nil {
		logger.SysLog("failed to initialize skill cache: " + err.Error())
	}

	var err error
	err = model.CreateRootAccountIfNeed()
	if err != nil {
		logger.FatalLog("database init error: " + err.Error())
	}
	defer func() {
		err := model.CloseDB()
		if err != nil {
			logger.FatalLog("failed to close database: " + err.Error())
		}
	}()

	// Initialize Redis
	err = common.InitRedisClient()
	if err != nil {
		logger.FatalLog("failed to initialize Redis: " + err.Error())
	}

	// PR2 quota 拆分:迁移完成后清空 user_quota:* 缓存,避免老缓存值与新 (subscription_quota + timed_quota_total) 求和读取不一致.
	// 单次启动开销很小(SCAN 游标 + 批量 DEL),失败仅警告不阻断.
	if err := model.FlushUserQuotaCache(); err != nil {
		logger.SysError("flush user_quota cache failed: " + err.Error())
	}

	// Initialize options
	model.InitOptionMap()
	config.Theme = config.NormalizeTheme(config.Theme)
	logger.SysLog(fmt.Sprintf("using theme %s", config.Theme))
	if common.RedisEnabled {
		// for compatibility with old versions
		config.MemoryCacheEnabled = true
	}
	if config.MemoryCacheEnabled {
		logger.SysLog("memory cache enabled")
		logger.SysLog(fmt.Sprintf("sync frequency: %d seconds", config.SyncFrequency))
		model.InitChannelCache()
	}
	if config.MemoryCacheEnabled {
		go model.SyncOptions(config.SyncFrequency)
		go model.SyncChannelCache(config.SyncFrequency)
	}

	// 显式缓存模型集合：无条件初始化（热路径依赖，不受 MemoryCacheEnabled 开关影响）+ 定时刷新，
	// 使后台勾选/取消"显式缓存"后无需重启即可生效。
	model.InitExplicitCacheModelCache()
	go model.SyncExplicitCacheModelCache(config.SyncFrequency)

	// 初始化诺诺发票客户端
	invoice.InitNuonuoClient()

	// 启动微信状态清理任务
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go auth.StartWeChatStateCleanup(ctx)

	// 启动订单过期检查定时任务（每分钟检查一次）
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			controller.AutoExpireOrders()
		}
	}()
	// 发布记录探测（路线B）：每小时轮询 app/主站/后端线上版本，变化即记录。
	// 发布周期约一周一次，无需高频；启动后延迟建立基线，避开启动瞬间
	// nginx/路由未就绪导致 /api/status 返回 HTML 的竞态。
	if config.ReleaseDetectionEnabled() {
		go func() {
			time.Sleep(30 * time.Second)
			controller.DetectVersionReleases()
			ticker := time.NewTicker(1 * time.Hour)
			defer ticker.Stop()
			for range ticker.C {
				controller.DetectVersionReleases()
			}
		}()
	}
	// 启动每日 0 点定时任务:订阅续期 → 免费额度发放 → 清理过期定时积分 → 企业额度对账
	//   顺序很重要:
	//     1. 先 AutoProcessSubscriptions 让 VIP 到期的订阅置为 expired,
	//        AutoIssueMonthlyFreeQuotas 此时才能正确判断"无 active 订阅"并发放每月免费;
	//     2. AutoExpireTimedQuotas 把已过期的定时积分笔归零;
	//     3. AutoReconcileOrgQuota 排在过期清理之后,基于最新账本对账企业额度镜像列.
	go func() {
		for {
			now := time.Now()
			// 计算下一个本地 0 点
			next := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Add(24 * time.Hour)
			time.Sleep(time.Until(next))
			controller.AutoProcessSubscriptions()
			controller.AutoIssueMonthlyFreeQuotas()
			controller.AutoExpireTimedQuotas()
			// 过期清理后对账:企业额度镜像列以账本为真相自愈可用余额,成员用量不一致告警
			controller.AutoReconcileOrgQuota()
			controller.AutoVerifyAccountTypeInvariants()
			// 重置企业成员日用量;若醒来后已是每月 1 号,额外重置月用量
			controller.AutoResetOrgMemberLimits(time.Now().Day() == 1)
			// 刷新所有用户分群的缓存人数(规则动态匹配,此处只更新列表展示用的快照)
			controller.AutoRefreshCrowdCounts()
		}
	}()
	if os.Getenv("CHANNEL_TEST_FREQUENCY") != "" {
		frequency, err := strconv.Atoi(os.Getenv("CHANNEL_TEST_FREQUENCY"))
		if err != nil {
			logger.FatalLog("failed to parse CHANNEL_TEST_FREQUENCY: " + err.Error())
		}
		go controller.AutomaticallyTestChannels(frequency)
	}
	if os.Getenv("BATCH_UPDATE_ENABLED") == "true" {
		config.BatchUpdateEnabled = true
		logger.SysLog("batch update enabled with interval " + strconv.Itoa(config.BatchUpdateInterval) + "s")
		model.InitBatchUpdater()
	}
	if config.EnableMetric {
		logger.SysLog("metric enabled, will disable channel if too much request failed")
	}
	openai.InitTokenEncoders()
	client.Init()

	// Initialize i18n
	if err := i18n.Init(); err != nil {
		logger.FatalLog("failed to initialize i18n: " + err.Error())
	}

	// Initialize HTTP server
	server := gin.New()
	server.Use(gin.Recovery())
	// This will cause SSE not to work!!!
	//server.Use(gzip.Gzip(gzip.DefaultCompression))
	server.Use(middleware.RequestId())
	server.Use(middleware.Language())
	middleware.SetUpLogger(server)
	// Initialize session store
	store := cookie.NewStore([]byte(config.SessionSecret))
	server.Use(sessions.Sessions(config.SessionName, store))

	router.SetRouter(server, buildFS)
	var port = os.Getenv("PORT")
	if port == "" {
		port = strconv.Itoa(*common.Port)
	}

	// Start org-admin portal on separate port
	orgPort := os.Getenv("ORG_PORTAL_PORT")
	if orgPort == "" {
		orgPort = "3001"
	}
	go func() {
		orgServer := gin.New()
		orgServer.Use(gin.Recovery())
		orgServer.Use(middleware.RequestId())
		router.SetOrgRouter(orgServer, orgBuildFS)
		logger.SysLogf("org-admin portal started on http://localhost:%s", orgPort)
		logger.SysLogf("Click on http://localhost:8080/business/")

		// 前端以 homepage="/business" 构建，资源/接口路径均带 /business 前缀。
		// 生产环境由 ALB 剥掉该前缀后转发；本地直连 localhost:3001 不经过 ALB，
		// 这里在进入 Gin 路由匹配之前剥掉前缀，模拟 ALB，使两种情况下接口与静态资源都正常。
		stripBusiness := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if p := r.URL.Path; p == "/business" || strings.HasPrefix(p, "/business/") {
				trimmed := strings.TrimPrefix(p, "/business")
				if trimmed == "" {
					trimmed = "/"
				}
				r.URL.Path = trimmed
				r.RequestURI = trimmed
				if r.URL.RawPath != "" {
					r.URL.RawPath = ""
				}
			}
			orgServer.ServeHTTP(w, r)
		})
		if err := http.ListenAndServe(":"+orgPort, stripBusiness); err != nil {
			logger.SysError("failed to start org-admin portal: " + err.Error())
		}
	}()

	logger.SysLogf("server started on http://localhost:%s", port)
	logger.SysLogf("Click on http://localhost:8080/one-api/")
	err = server.Run(":" + port)
	if err != nil {
		logger.FatalLog("failed to start HTTP server: " + err.Error())
	}
}
