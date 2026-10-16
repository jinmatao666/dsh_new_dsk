package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
)

var timeFormat = "2006-01-02T15:04:05.000Z"

var inMemoryRateLimiter common.InMemoryRateLimiter

func redisRateLimiter(c *gin.Context, identifier string, maxRequestNum int, duration int64, mark string) {
	ctx := context.Background()
	rdb := common.RDB
	key := "rateLimit:" + mark + identifier
	listLength, err := rdb.LLen(ctx, key).Result()
	if err != nil {
		fmt.Println(err.Error())
		c.Status(http.StatusInternalServerError)
		c.Abort()
		return
	}
	if listLength < int64(maxRequestNum) {
		rdb.LPush(ctx, key, time.Now().Format(timeFormat))
		rdb.Expire(ctx, key, config.RateLimitKeyExpirationDuration)
	} else {
		oldTimeStr, _ := rdb.LIndex(ctx, key, -1).Result()
		oldTime, err := time.Parse(timeFormat, oldTimeStr)
		if err != nil {
			fmt.Println(err)
			c.Status(http.StatusInternalServerError)
			c.Abort()
			return
		}
		nowTimeStr := time.Now().Format(timeFormat)
		nowTime, err := time.Parse(timeFormat, nowTimeStr)
		if err != nil {
			fmt.Println(err)
			c.Status(http.StatusInternalServerError)
			c.Abort()
			return
		}
		// time.Since will return negative number!
		// See: https://stackoverflow.com/questions/50970900/why-is-time-since-returning-negative-durations-on-windows
		if int64(nowTime.Sub(oldTime).Seconds()) < duration {
			rdb.Expire(ctx, key, config.RateLimitKeyExpirationDuration)
			c.Status(http.StatusTooManyRequests)
			c.Abort()
			return
		} else {
			rdb.LPush(ctx, key, time.Now().Format(timeFormat))
			rdb.LTrim(ctx, key, 0, int64(maxRequestNum-1))
			rdb.Expire(ctx, key, config.RateLimitKeyExpirationDuration)
		}
	}
}

func memoryRateLimiter(c *gin.Context, identifier string, maxRequestNum int, duration int64, mark string) {
	key := mark + identifier
	if !inMemoryRateLimiter.Request(key, maxRequestNum, duration) {
		c.Status(http.StatusTooManyRequests)
		c.Abort()
		return
	}
}

// clientIPIdentifier 按客户端 IP 区分限流桶（原有默认行为）。
func clientIPIdentifier(c *gin.Context) string {
	return c.ClientIP()
}

// userIdentifier 优先按登录用户 id 区分限流桶（单账号限流），未取到用户时
// 回退到客户端 IP。须挂在写入 ctxkey.Id 的鉴权中间件（如 UserAuth）之后。
func userIdentifier(c *gin.Context) string {
	if id := c.GetInt(ctxkey.Id); id > 0 {
		return "uid:" + strconv.Itoa(id)
	}
	return c.ClientIP()
}

func rateLimitFactory(maxRequestNum int, duration int64, mark string) func(c *gin.Context) {
	return rateLimitFactoryWith(maxRequestNum, duration, mark, clientIPIdentifier)
}

// rateLimitFactoryWith 与 rateLimitFactory 一致，但允许自定义限流桶的区分标识
// （按 IP / 按用户等），复用同一套 redis/内存限流实现。
func rateLimitFactoryWith(maxRequestNum int, duration int64, mark string, identify func(*gin.Context) string) func(c *gin.Context) {
	if maxRequestNum == 0 || config.DebugEnabled {
		return func(c *gin.Context) {
			c.Next()
		}
	}
	if common.RedisEnabled {
		return func(c *gin.Context) {
			if isHealthCheck(c) {
				c.Next()
				return
			}
			redisRateLimiter(c, identify(c), maxRequestNum, duration, mark)
		}
	} else {
		// It's safe to call multi times.
		inMemoryRateLimiter.Init(config.RateLimitKeyExpirationDuration)
		return func(c *gin.Context) {
			if isHealthCheck(c) {
				c.Next()
				return
			}
			memoryRateLimiter(c, identify(c), maxRequestNum, duration, mark)
		}
	}
}

// isHealthCheck 判断请求是否来自负载均衡（如阿里云 SLB）的健康检查。
// 这类探活请求频率极高，不应计入限流，否则会刷爆 429 日志，
// 并在 SLB 做 SNAT 时与真实用户共享限流桶导致误伤。
func isHealthCheck(c *gin.Context) bool {
	return strings.Contains(c.Request.UserAgent(), "SLBHealthCheck")
}

func GlobalWebRateLimit() func(c *gin.Context) {
	return rateLimitFactory(config.GlobalWebRateLimitNum, config.GlobalWebRateLimitDuration, "GW")
}

func GlobalAPIRateLimit() func(c *gin.Context) {
	return rateLimitFactory(config.GlobalApiRateLimitNum, config.GlobalApiRateLimitDuration, "GA")
}

func CriticalRateLimit() func(c *gin.Context) {
	return rateLimitFactory(config.CriticalRateLimitNum, config.CriticalRateLimitDuration, "CT")
}

func DownloadRateLimit() func(c *gin.Context) {
	return rateLimitFactory(config.DownloadRateLimitNum, config.DownloadRateLimitDuration, "DW")
}

func UploadRateLimit() func(c *gin.Context) {
	return rateLimitFactory(config.UploadRateLimitNum, config.UploadRateLimitDuration, "UP")
}

// skillBundleRateLimitNum / skillBundleRateLimitDuration 控制单账号在
// 60s 窗口内可拉取 /api/skill/:id/bundle 的次数。
//
// 取 100 次/60s 的依据：一次正常首装会由客户端自动为全部通用公库 skill 逐个
// 拉取 assets bundle（当前公库约 48 个，见下载分析），故窗口必须容纳一次完整
// 首装的突发；而持续高频枚举 / 反复全量抓取会被拦下，提高批量脚本拉全库源码的
// 成本。阈值走常量而非 config，避免为单接口新增全局配置项；如需调整改这里即可。
const (
	skillBundleRateLimitNum      = 100
	skillBundleRateLimitDuration = 60 // 秒
)

// SkillBundleRateLimit 对 bundle 接口做单账号限流。必须挂在 UserAuth 之后，
// 这样 ctxkey.Id 已写入，可按用户而非 IP 区分（同一出口 IP 下的多用户不互相误伤，
// 同一用户换 IP 也无法绕过）。
func SkillBundleRateLimit() func(c *gin.Context) {
	return rateLimitFactoryWith(skillBundleRateLimitNum, skillBundleRateLimitDuration, "SB", userIdentifier)
}
