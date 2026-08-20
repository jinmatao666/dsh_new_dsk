package config

import (
	"github.com/google/uuid"
	"github.com/songquanpeng/one-api/common/env"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

var SystemName = "One API"
var ServerAddress = env.String("SERVER_ADDRESS", "http://localhost:3000")
var Footer = ""
var Logo = ""
var TopUpLink = os.Getenv("TOP_UP_LINK")
var ChatLink = ""

// 线上数据同步工具配置（后台工具箱 → 线上数据同步）
// SyncSourceDSN: 线上源库连接（建议只读账号）。未配置时同步功能整体置灰。
// SyncProdDBNames: 库名守护清单（逗号分隔）。当前服务连接的目标库命中清单时禁用同步，防止反向污染线上库。
var SyncSourceDSN = os.Getenv("SYNC_SOURCE_SQL_DSN")
var SyncProdDBNames = env.String("SYNC_PROD_DB_NAMES", "oneapi")
var QuotaPerUnit = 1000.0
var DisplayInCurrencyEnabled = true
var DisplayTokenStatEnabled = true

// Any options with "Secret", "Token" in its key won't be return by GetOptions

var SessionSecret = uuid.New().String()

// SessionName 是会话 cookie 的名称。多项目共用 localhost 开发时，
// 浏览器 cookie 按 host（而非端口）隔离，同名 cookie 会互相覆盖导致登录态被挤掉。
// 通过 SESSION_NAME 环境变量为每个项目设置不同的值即可并行保持登录。
var SessionName = "session"

var OptionMap map[string]string
var OptionMapRWMutex sync.RWMutex

var ItemsPerPage = 10
var MaxRecentItems = 100

var PasswordLoginEnabled = true
var PasswordRegisterEnabled = false // 关闭密码注册，防止薅羊毛
var EmailVerificationEnabled = false
var GitHubOAuthEnabled = false
var OidcEnabled = false
var WeChatAuthEnabled = env.Bool("WECHAT_AUTH_ENABLED", false)
var TurnstileCheckEnabled = false
var RegisterEnabled = true

// SMS Configuration
var SMSEnabled = false
var SMSProvider = "aliyun" // aliyun, twilio
var SMSAccessKeyId = ""
var SMSAccessKeySecret = ""
var SMSSignName = ""
var SMSTemplateCode = ""
var SMSRegion = "cn-hangzhou"

// Phone Login Configuration
var PhoneLoginEnabled = true    // 默认开启手机号登录
var PhoneRegisterEnabled = true // 默认开启手机号注册
var PhoneVerificationCodeLength = 6
var PhoneVerificationValidMinutes = 10
var PhoneMaxSendPerHour = 5

// Captcha Configuration（图形验证码：发送短信验证码前的人机验证）
// 默认关闭，开启后所有发送手机验证码的接口都会先校验图形验证码
var CaptchaEnabled = false

var EmailDomainRestrictionEnabled = false
var EmailDomainWhitelist = []string{
	"gmail.com",
	"163.com",
	"126.com",
	"qq.com",
	"outlook.com",
	"hotmail.com",
	"icloud.com",
	"yahoo.com",
	"foxmail.com",
}

var DebugEnabled = strings.ToLower(os.Getenv("DEBUG")) == "true"
var DebugSQLEnabled = strings.ToLower(os.Getenv("DEBUG_SQL")) == "true"
var MemoryCacheEnabled = strings.ToLower(os.Getenv("MEMORY_CACHE_ENABLED")) == "true"

var LogConsumeEnabled = true

var SMTPServer = ""
var SMTPPort = 587
var SMTPAccount = ""
var SMTPFrom = ""
var SMTPToken = ""

var GitHubClientId = ""
var GitHubClientSecret = ""

var LarkClientId = ""
var LarkClientSecret = ""

var OidcClientId = ""
var OidcClientSecret = ""
var OidcWellKnown = ""
var OidcAuthorizationEndpoint = ""
var OidcTokenEndpoint = ""
var OidcUserinfoEndpoint = ""

var WeChatServerAddress = ""
var WeChatServerToken = ""
var WeChatAccountQRCodeImageURL = ""
var WeChatAppID = os.Getenv("WECHAT_OAUTH_APP_ID")
var WeChatAppSecret = os.Getenv("WECHAT_OAUTH_APP_SECRET")

var MessagePusherAddress = ""
var MessagePusherToken = ""

var TurnstileSiteKey = ""
var TurnstileSecretKey = ""

var QuotaForInviter int64 = 0
var QuotaForInvitee int64 = 0

var ChannelDisableThreshold = 5.0
var AutomaticDisableChannelEnabled = false
var AutomaticEnableChannelEnabled = false
var QuotaRemindThreshold int64 = 1000
var PreConsumedQuota int64 = 1000
var PreConsumedMaxTokensCap = int64(env.Int("PRE_CONSUMED_MAX_TOKENS_CAP", 10000))
var ApproximateTokenEnabled = false
var RetryTimes = 0

var RootUserEmail = ""

var IsMasterNode = os.Getenv("NODE_TYPE") != "slave"

var requestInterval, _ = strconv.Atoi(os.Getenv("POLLING_INTERVAL"))
var RequestInterval = time.Duration(requestInterval) * time.Second

var SyncFrequency = env.Int("SYNC_FREQUENCY", 10*60) // unit is second

var BatchUpdateEnabled = false
var BatchUpdateInterval = env.Int("BATCH_UPDATE_INTERVAL", 5)

var RelayTimeout = env.Int("RELAY_TIMEOUT", 0) // unit is second

var GeminiSafetySetting = env.String("GEMINI_SAFETY_SETTING", "BLOCK_NONE")

var Theme = env.String("THEME", "air")
var ValidThemes = map[string]bool{
	"berry": true,
	"air":   true,
}

func NormalizeTheme(theme string) string {
	switch theme {
	case "", "default":
		return "air"
	default:
		return theme
	}
}

// All duration's unit is seconds
// Shouldn't larger then RateLimitKeyExpirationDuration
var (
	GlobalApiRateLimitNum            = env.Int("GLOBAL_API_RATE_LIMIT", 480)
	GlobalApiRateLimitDuration int64 = 3 * 60

	GlobalWebRateLimitNum            = env.Int("GLOBAL_WEB_RATE_LIMIT", 240)
	GlobalWebRateLimitDuration int64 = 3 * 60

	UploadRateLimitNum            = 10
	UploadRateLimitDuration int64 = 60

	DownloadRateLimitNum            = 10
	DownloadRateLimitDuration int64 = 60

	CriticalRateLimitNum            = 20
	CriticalRateLimitDuration int64 = 20 * 60
)

var RateLimitKeyExpirationDuration = 20 * time.Minute

var EnableMetric = env.Bool("ENABLE_METRIC", false)
var MetricQueueSize = env.Int("METRIC_QUEUE_SIZE", 10)
var MetricSuccessRateThreshold = env.Float64("METRIC_SUCCESS_RATE_THRESHOLD", 0.8)
var MetricSuccessChanSize = env.Int("METRIC_SUCCESS_CHAN_SIZE", 1024)
var MetricFailChanSize = env.Int("METRIC_FAIL_CHAN_SIZE", 128)

var InitialRootToken = os.Getenv("INITIAL_ROOT_TOKEN")

var InitialRootAccessToken = os.Getenv("INITIAL_ROOT_ACCESS_TOKEN")

var GeminiVersion = env.String("GEMINI_VERSION", "v1")

var OnlyOneLogFile = env.Bool("ONLY_ONE_LOG_FILE", false)

var RelayProxy = env.String("RELAY_PROXY", "")
var UserContentRequestProxy = env.String("USER_CONTENT_REQUEST_PROXY", "")
var UserContentRequestTimeout = env.Int("USER_CONTENT_REQUEST_TIMEOUT", 30)

var EnforceIncludeUsage = env.Bool("ENFORCE_INCLUDE_USAGE", false)
var TestPrompt = env.String("TEST_PROMPT", "Output only your specific model name with no additional text.")

// Relay Timing 观测配置
//   - RelayTimingEnabled / SlowFirstChunkMs / SlowTotalMs：启动时从环境变量读取（重启生效）
//   - RelayTimingDetailEnabled / RelayTimingSampleRate：通过 option 表热更新，运行时由 admin UI 控制
//     也支持启动时通过环境变量给出初始值，方便本地 / 排障一键开启
var RelayTimingEnabled = env.Bool("RELAY_TIMING_ENABLED", true)
var RelayTimingSlowFirstChunkMs = env.Int("RELAY_TIMING_SLOW_FIRST_CHUNK_MS", 3000)
var RelayTimingSlowTotalMs = env.Int("RELAY_TIMING_SLOW_TOTAL_MS", 30000)
var RelayTimingDetailEnabled = env.Bool("RELAY_TIMING_DETAIL_ENABLED", false)
var RelayTimingSampleRate = env.Int("RELAY_TIMING_SAMPLE_RATE", 0)

// Context Length Protection
var DefaultContextLimit = env.Int("DEFAULT_CONTEXT_LIMIT", 198000)
var ModelContextLimits = map[string]int{}
var ModelContextLimitsRWMutex sync.RWMutex
