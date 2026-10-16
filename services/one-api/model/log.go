package model

import (
	"context"
	"fmt"
	"strings"

	"gorm.io/gorm"

	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/common/logger"
)

type Log struct {
	Id                int    `json:"id"`
	UserId            int    `json:"user_id" gorm:"index"`
	CreatedAt         int64  `json:"created_at" gorm:"bigint;index:idx_created_at_type"`
	Type              int    `json:"type" gorm:"index:idx_created_at_type"`
	Content           string `json:"content"`
	Username          string `json:"username" gorm:"index:index_username_model_name,priority:2;default:''"`
	TokenName         string `json:"token_name" gorm:"index;default:''"`
	ModelName         string `json:"model_name" gorm:"index;index:index_username_model_name,priority:1;default:''"`
	Quota             int    `json:"quota" gorm:"default:0"`
	PromptTokens      int    `json:"prompt_tokens" gorm:"default:0"`
	CompletionTokens  int    `json:"completion_tokens" gorm:"default:0"`
	// 缓存 token（prompt cache）：CacheReadTokens=命中读取，CacheWriteTokens=写入缓存。
	// 仅用于后台观测缓存命中率，不参与计费。
	CacheReadTokens   int    `json:"cache_read_tokens" gorm:"default:0"`
	CacheWriteTokens  int    `json:"cache_write_tokens" gorm:"default:0"`
	ChannelId         int    `json:"channel" gorm:"index"`
	RequestId         string `json:"request_id" gorm:"default:'';index:idx_request_id"`
	ElapsedTime       int64  `json:"elapsed_time" gorm:"default:0"` // unit is ms
	IsStream          bool   `json:"is_stream" gorm:"default:false"`
	SystemPromptReset bool   `json:"system_prompt_reset" gorm:"default:false"`
	OrgId             int    `json:"org_id" gorm:"index;default:0;comment:企业ID 0表示个人使用"`

	// timing 阶段耗时（单位：毫秒，0 表示该阶段未发生）
	SelectMs               int `json:"select_ms" gorm:"default:0"`
	UpstreamRequestStartMs int `json:"upstream_request_start_ms" gorm:"default:0"`
	UpstreamHeaderMs       int `json:"upstream_header_ms" gorm:"default:0"`
	FirstChunkMs           int `json:"first_chunk_ms" gorm:"default:0"`
	FirstWriteMs           int `json:"first_write_ms" gorm:"default:0"`
	UpstreamWaitMs         int `json:"upstream_wait_ms" gorm:"default:0"`
	WriteGapMs             int `json:"write_gap_ms" gorm:"default:0"`

	// timing 状态/错误
	TimingStatus     string `json:"timing_status" gorm:"default:'';index:idx_timing_status"`
	TimingStatusCode int    `json:"timing_status_code" gorm:"default:0"`
	TimingError      string `json:"timing_error" gorm:"default:''"`
	SlowReason       string `json:"slow_reason" gorm:"default:'';index:idx_slow_reason"`

	// retry 元信息
	RetryCount      int `json:"retry_count" gorm:"default:0"`
	LastRetryStatus int `json:"last_retry_status" gorm:"default:0"`

	// 上游 request_id（部分 provider 会返回）
	UpstreamRequestId string `json:"upstream_request_id" gorm:"default:''"`
}

const (
	LogTypeUnknown = iota
	LogTypeTopup
	LogTypeConsume
	LogTypeManage
	LogTypeSystem
	LogTypeTest
	LogTypeError    // 错误请求日志（不计费）
	LogTypeBehavior // 用户行为日志（登录/注册等非权益变更），不在「账户动态/权益变更记录」中展示
)

func recordLogHelper(ctx context.Context, log *Log) {
	requestId := helper.GetRequestID(ctx)
	log.RequestId = requestId
	err := LOG_DB.Create(log).Error
	if err != nil {
		logger.Error(ctx, "failed to record log: "+err.Error())
		return
	}
	logger.Infof(ctx, "record log: %+v", log)
}

func RecordLog(ctx context.Context, userId int, logType int, content string) {
	if logType == LogTypeConsume && !config.LogConsumeEnabled {
		return
	}
	log := &Log{
		UserId:    userId,
		Username:  GetUsernameById(userId),
		CreatedAt: helper.GetTimestamp(),
		Type:      logType,
		Content:   content,
	}
	recordLogHelper(ctx, log)
}

func RecordTopupLog(ctx context.Context, userId int, content string, quota int) {
	log := &Log{
		UserId:    userId,
		Username:  GetUsernameById(userId),
		CreatedAt: helper.GetTimestamp(),
		Type:      LogTypeTopup,
		Content:   content,
		Quota:     quota,
	}
	recordLogHelper(ctx, log)
}

// RecordOrgTopupLog 写入一条企业充值日志(带 org_id),与个人充值 RecordTopupLog 对齐,
// 使企业维度的充值流水在 logs 表中可查(此前企业充值只写账本/审计,logs 表无痕迹)。
//   - orgId:企业ID(必填,用于按企业维度检索充值)
//   - userId:触发充值的用户(支付回调=付款用户;后台管理员充值可传 0)
//   - quota:本次充值额度
func RecordOrgTopupLog(ctx context.Context, orgId, userId int, content string, quota int) {
	log := &Log{
		UserId:    userId,
		Username:  GetUsernameById(userId),
		CreatedAt: helper.GetTimestamp(),
		Type:      LogTypeTopup,
		Content:   content,
		Quota:     quota,
		OrgId:     orgId,
	}
	recordLogHelper(ctx, log)
}

func RecordConsumeLog(ctx context.Context, log *Log) {
	if !config.LogConsumeEnabled {
		return
	}
	log.Username = GetUsernameById(log.UserId)
	log.CreatedAt = helper.GetTimestamp()
	log.Type = LogTypeConsume
	recordLogHelper(ctx, log)
}

func RecordTestLog(ctx context.Context, log *Log) {
	log.CreatedAt = helper.GetTimestamp()
	log.Type = LogTypeTest
	recordLogHelper(ctx, log)
}

// RecordErrorLog 写入一条错误请求日志（不计费、不更新用户/渠道额度统计）。
// 调用方应保证 log.Quota = 0，timing 字段已通过 billing.FillLogTiming* 填好。
// 与 RecordConsumeLog 不同：
//   - 不读取 LogConsumeEnabled 开关（错误日志总是记录，便于排障）
//   - 强制 Type = LogTypeError，避免调用方误填
func RecordErrorLog(ctx context.Context, log *Log) {
	log.Username = GetUsernameById(log.UserId)
	log.CreatedAt = helper.GetTimestamp()
	log.Type = LogTypeError
	log.Quota = 0
	recordLogHelper(ctx, log)
}

// resolveUsernamesByLocalUsers 按本地 user_id 批量读穿账号中心真实 username,
// 返回 local_user_id -> 真实 username(仅含账号中心有非空值的用户)。
// 账号中心未启用/未投影/查询失败时返回空 map,调用方据此保留落库原值。
func resolveUsernamesByLocalUsers(userIDs []int) map[int]string {
	out := make(map[int]string)
	if ACCOUNT_DB == nil || len(userIDs) == 0 {
		return out
	}
	accIDByLocal := ResolveAccountIDsByLocalUsers(userIDs)
	if len(accIDByLocal) == 0 {
		return out
	}
	accIDs := make([]int64, 0, len(accIDByLocal))
	for _, accID := range accIDByLocal {
		accIDs = append(accIDs, accID)
	}
	idMap, err := GetAccountIdentifiersFull(accIDs, []string{IdentifierTypeUsername})
	if err != nil {
		logger.SysErrorf("账号中心批量读穿 username 失败,列表回退落库原值: %v", err)
		return out
	}
	nameByAcc := make(map[int64]string, len(accIDs))
	for accID, idents := range idMap {
		if row, ok := idents[IdentifierTypeUsername]; ok && row.Identifier != "" {
			nameByAcc[accID] = row.Identifier
		}
	}
	for localID, accID := range accIDByLocal {
		if accID == 0 {
			continue
		}
		if name, ok := nameByAcc[accID]; ok {
			out[localID] = name
		}
	}
	return out
}

// overlayLogsUsername 读取时把日志里落库的 username 覆盖为账号中心权威值。
// 日志的 username 是写入时 denormalize 的快照(见 RecordLog 等),JIT 注册用户落的是
// jit_<snowflake> 占位符,历史数据同样是占位。统一在读取返回前按 user_id 批量读穿账号中心,
// 既修正新数据也修正历史,且不改动写入路径。账号中心未启用/未投影/查询失败时保留原值。
func overlayLogsUsername(logs []*Log) {
	if len(logs) == 0 {
		return
	}
	userIDs := make([]int, 0, len(logs))
	seen := make(map[int]struct{}, len(logs))
	for _, l := range logs {
		if l == nil || l.UserId == 0 {
			continue
		}
		if _, ok := seen[l.UserId]; ok {
			continue
		}
		seen[l.UserId] = struct{}{}
		userIDs = append(userIDs, l.UserId)
	}
	nameByUser := resolveUsernamesByLocalUsers(userIDs)
	if len(nameByUser) == 0 {
		return
	}
	for _, l := range logs {
		if l == nil || l.UserId == 0 {
			continue
		}
		if name, ok := nameByUser[l.UserId]; ok {
			l.Username = name
		}
	}
}

func GetAllLogs(logTypes []int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string, startIdx int, num int, channel int, requestId string, slowOnly bool, timingStatus string, slowReason string, minFirstChunkMs int, sortField string, sortOrder string) (logs []*Log, err error) {
	var tx *gorm.DB
	if len(logTypes) == 0 {
		tx = LOG_DB
	} else {
		tx = LOG_DB.Where("type IN ?", logTypes)
	}
	if modelName != "" {
		tx = tx.Where("model_name = ?", modelName)
	}
	if username != "" {
		tx = tx.Where("username LIKE ?", "%"+username+"%")
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if channel != 0 {
		tx = tx.Where("channel_id = ?", channel)
	}
	if requestId != "" {
		tx = tx.Where("request_id = ?", requestId)
	}
	if slowOnly {
		tx = tx.Where("slow_reason <> ''")
	}
	if timingStatus != "" {
		tx = tx.Where("timing_status = ?", timingStatus)
	}
	if slowReason != "" {
		tx = tx.Where("slow_reason = ?", slowReason)
	}
	if minFirstChunkMs > 0 {
		tx = tx.Where("first_chunk_ms >= ?", minFirstChunkMs)
	}
	err = tx.Order(buildLogOrder(sortField, sortOrder)).Limit(num).Offset(startIdx).Find(&logs).Error
	overlayLogsUsername(logs)
	return logs, err
}

func GetUserLogs(userId int, logTypes []int, startTimestamp int64, endTimestamp int64, modelName string, tokenName string, startIdx int, num int, requestId string, slowOnly bool, timingStatus string, slowReason string, minFirstChunkMs int, sortField string, sortOrder string) (logs []*Log, err error) {
	var tx *gorm.DB
	if len(logTypes) == 0 {
		tx = LOG_DB.Where("user_id = ?", userId)
	} else {
		tx = LOG_DB.Where("user_id = ? and type IN ?", userId, logTypes)
	}
	if modelName != "" {
		tx = tx.Where("model_name = ?", modelName)
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if requestId != "" {
		tx = tx.Where("request_id = ?", requestId)
	}
	if slowOnly {
		tx = tx.Where("slow_reason <> ''")
	}
	if timingStatus != "" {
		tx = tx.Where("timing_status = ?", timingStatus)
	}
	if slowReason != "" {
		tx = tx.Where("slow_reason = ?", slowReason)
	}
	if minFirstChunkMs > 0 {
		tx = tx.Where("first_chunk_ms >= ?", minFirstChunkMs)
	}
	err = tx.Order(buildLogOrder(sortField, sortOrder)).Limit(num).Offset(startIdx).Omit("id").Find(&logs).Error
	overlayLogsUsername(logs)
	return logs, err
}

// LogFilterOptions 表头筛选下拉的全量可选项（按时间区间聚合，而非仅当前页）。
type LogFilterOptions struct {
	Models   []string `json:"models"`
	Channels []int    `json:"channels"`
}

// applyLogOptionScope 为筛选项查询施加与列表一致的时间区间与用户范围。
func applyLogOptionScope(tx *gorm.DB, userId int, startTimestamp int64, endTimestamp int64) *gorm.DB {
	if userId > 0 {
		tx = tx.Where("user_id = ?", userId)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	return tx
}

// GetLogFilterOptions 返回指定范围内日志的去重模型名与渠道 id，用于表头筛选下拉。
// userId > 0 时仅统计该用户（普通用户视角），userId <= 0 为管理员全量视角。
func GetLogFilterOptions(userId int, startTimestamp int64, endTimestamp int64) (*LogFilterOptions, error) {
	opts := &LogFilterOptions{Models: []string{}, Channels: []int{}}

	modelTx := applyLogOptionScope(LOG_DB.Model(&Log{}), userId, startTimestamp, endTimestamp)
	if err := modelTx.Where("model_name <> ''").Distinct().Order("model_name asc").Pluck("model_name", &opts.Models).Error; err != nil {
		return nil, err
	}

	// 渠道仅管理员视角有意义（普通用户列表不展示渠道列）。
	if userId <= 0 {
		channelTx := applyLogOptionScope(LOG_DB.Model(&Log{}), userId, startTimestamp, endTimestamp)
		if err := channelTx.Where("channel_id <> 0").Distinct().Order("channel_id asc").Pluck("channel_id", &opts.Channels).Error; err != nil {
			return nil, err
		}
	}
	return opts, nil
}

// buildLogOrder maps a frontend sort field/order to a safe SQL ORDER BY clause.
// 仅允许白名单字段，避免 SQL 注入。
func buildLogOrder(field string, order string) string {
	allowed := map[string]string{
		"created_at":        "created_at",
		"prompt_tokens":     "prompt_tokens",
		"completion_tokens": "completion_tokens",
		"quota":             "quota",
		"first_chunk_ms":    "first_chunk_ms",
		"elapsed_time":      "elapsed_time",
		"username":          "username",
		"token_name":        "token_name",
	}
	col, ok := allowed[field]
	if !ok {
		return "id desc"
	}
	dir := "desc"
	if order == "ascend" || order == "asc" {
		dir = "asc"
	}
	return col + " " + dir + ", id desc"
}

func SearchAllLogs(keyword string) (logs []*Log, err error) {
	err = LOG_DB.Where("type = ? or content LIKE ?", keyword, keyword+"%").Order("id desc").Limit(config.MaxRecentItems).Find(&logs).Error
	overlayLogsUsername(logs)
	return logs, err
}

func SearchUserLogs(userId int, keyword string) (logs []*Log, err error) {
	err = LOG_DB.Where("user_id = ? and type = ?", userId, keyword).Order("id desc").Limit(config.MaxRecentItems).Omit("id").Find(&logs).Error
	overlayLogsUsername(logs)
	return logs, err
}

func SumUsedQuota(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string, channel int) (quota int64) {
	ifnull := "ifnull"
	if common.UsingPostgreSQL {
		ifnull = "COALESCE"
	}
	tx := LOG_DB.Table("logs").Select(fmt.Sprintf("%s(sum(quota),0)", ifnull))
	if username != "" {
		tx = tx.Where("username = ?", username)
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if modelName != "" {
		tx = tx.Where("model_name = ?", modelName)
	}
	if channel != 0 {
		tx = tx.Where("channel_id = ?", channel)
	}
	tx.Where("type = ?", LogTypeConsume).Scan(&quota)
	return quota
}

func SumUsedToken(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string) (token int) {
	ifnull := "ifnull"
	if common.UsingPostgreSQL {
		ifnull = "COALESCE"
	}
	tx := LOG_DB.Table("logs").Select(fmt.Sprintf("%s(sum(prompt_tokens),0) + %s(sum(completion_tokens),0)", ifnull, ifnull))
	if username != "" {
		tx = tx.Where("username = ?", username)
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if modelName != "" {
		tx = tx.Where("model_name = ?", modelName)
	}
	tx.Where("type = ?", LogTypeConsume).Scan(&token)
	return token
}

func DeleteOldLog(targetTimestamp int64, logTypes []int) (int64, error) {
	tx := LOG_DB.Where("created_at < ?", targetTimestamp)
	if len(logTypes) > 0 {
		tx = tx.Where("type IN ?", logTypes)
	}
	result := tx.Delete(&Log{})
	return result.RowsAffected, result.Error
}

// CountOldLog 统计早于 targetTimestamp 且匹配 logTypes 的日志条数及其估算字节大小。
// logTypes 为空表示全部类型。estimatedBytes 为近似值：条数 × 单行平均字节数。
// MySQL 通过 information_schema 读取 logs 表的 avg_row_length，其它数据库退化为经验值。
func CountOldLog(targetTimestamp int64, logTypes []int) (count int64, estimatedBytes int64, err error) {
	tx := LOG_DB.Model(&Log{}).Where("created_at < ?", targetTimestamp)
	if len(logTypes) > 0 {
		tx = tx.Where("type IN ?", logTypes)
	}
	if err = tx.Count(&count).Error; err != nil {
		return 0, 0, err
	}

	var avgRowLength int64 = 512 // 非 MySQL 的经验估值
	if common.UsingMySQL {
		var v int64
		// avg_row_length 由 MySQL 基于整表统计给出，作为单行平均字节估算
		if e := LOG_DB.Raw("SELECT AVG_ROW_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'logs'").Scan(&v).Error; e == nil && v > 0 {
			avgRowLength = v
		}
	}
	estimatedBytes = count * avgRowLength
	return count, estimatedBytes, nil
}

type LogStatistic struct {
	Day              string `gorm:"column:day"`
	ModelName        string `gorm:"column:model_name"`
	RequestCount     int    `gorm:"column:request_count"`
	Quota            int    `gorm:"column:quota"`
	PromptTokens     int    `gorm:"column:prompt_tokens"`
	CompletionTokens int    `gorm:"column:completion_tokens"`
	// 缓存 token 聚合（用于后台观测缓存命中率 = cache_read / prompt_tokens）
	CacheReadTokens  int `gorm:"column:cache_read_tokens"`
	CacheWriteTokens int `gorm:"column:cache_write_tokens"`
}

func SearchLogsByDayAndModel(userId, start, end int) (LogStatistics []*LogStatistic, err error) {
	groupSelect := "DATE_FORMAT(FROM_UNIXTIME(created_at), '%Y-%m-%d') as day"

	if common.UsingPostgreSQL {
		groupSelect = "TO_CHAR(date_trunc('day', to_timestamp(created_at)), 'YYYY-MM-DD') as day"
	}

	if common.UsingSQLite {
		groupSelect = "strftime('%Y-%m-%d', datetime(created_at, 'unixepoch')) as day"
	}

	err = LOG_DB.Raw(`
		SELECT `+groupSelect+`,
		model_name, count(1) as request_count,
		sum(quota) as quota,
		sum(prompt_tokens) as prompt_tokens,
		sum(completion_tokens) as completion_tokens,
		sum(cache_read_tokens) as cache_read_tokens,
		sum(cache_write_tokens) as cache_write_tokens
		FROM logs
		WHERE type=2
		AND user_id= ?
		AND created_at BETWEEN ? AND ?
		GROUP BY day, model_name
		ORDER BY day, model_name
	`, userId, start, end).Scan(&LogStatistics).Error

	return LogStatistics, err
}

func SearchAllLogsByDayAndModel(start, end int) (LogStatistics []*LogStatistic, err error) {
	groupSelect := "DATE_FORMAT(FROM_UNIXTIME(created_at), '%Y-%m-%d') as day"
	if common.UsingPostgreSQL {
		groupSelect = "TO_CHAR(date_trunc('day', to_timestamp(created_at)), 'YYYY-MM-DD') as day"
	}
	if common.UsingSQLite {
		groupSelect = "strftime('%Y-%m-%d', datetime(created_at, 'unixepoch')) as day"
	}
	err = LOG_DB.Raw(`
		SELECT `+groupSelect+`,
		model_name, count(1) as request_count,
		sum(quota) as quota,
		sum(prompt_tokens) as prompt_tokens,
		sum(completion_tokens) as completion_tokens,
		sum(cache_read_tokens) as cache_read_tokens,
		sum(cache_write_tokens) as cache_write_tokens
		FROM logs
		WHERE type=2
		AND created_at BETWEEN ? AND ?
		GROUP BY day, model_name
		ORDER BY day, model_name
	`, start, end).Scan(&LogStatistics).Error
	return LogStatistics, err
}

func SearchLogsByUsernameDayAndModel(username string, start, end int) (LogStatistics []*LogStatistic, err error) {
	groupSelect := "DATE_FORMAT(FROM_UNIXTIME(created_at), '%Y-%m-%d') as day"
	if common.UsingPostgreSQL {
		groupSelect = "TO_CHAR(date_trunc('day', to_timestamp(created_at)), 'YYYY-MM-DD') as day"
	}
	if common.UsingSQLite {
		groupSelect = "strftime('%Y-%m-%d', datetime(created_at, 'unixepoch')) as day"
	}
	err = LOG_DB.Raw(`
		SELECT `+groupSelect+`,
		model_name, count(1) as request_count,
		sum(quota) as quota,
		sum(prompt_tokens) as prompt_tokens,
		sum(completion_tokens) as completion_tokens,
		sum(cache_read_tokens) as cache_read_tokens,
		sum(cache_write_tokens) as cache_write_tokens
		FROM logs
		WHERE type=2
		AND username = ?
		AND created_at BETWEEN ? AND ?
		GROUP BY day, model_name
		ORDER BY day, model_name
	`, username, start, end).Scan(&LogStatistics).Error
	return LogStatistics, err
}

func hourGroupSelect() string {
	if common.UsingPostgreSQL {
		return "TO_CHAR(date_trunc('hour', to_timestamp(created_at)), 'YYYY-MM-DD HH24:00') as day"
	}
	if common.UsingSQLite {
		return "strftime('%Y-%m-%d %H:00', datetime(created_at, 'unixepoch')) as day"
	}
	return "DATE_FORMAT(FROM_UNIXTIME(created_at), '%Y-%m-%d %H:00') as day"
}

func SearchLogsByHourAndModel(userId, start, end int) (LogStatistics []*LogStatistic, err error) {
	err = LOG_DB.Raw(`
		SELECT `+hourGroupSelect()+`,
		model_name, count(1) as request_count,
		sum(quota) as quota,
		sum(prompt_tokens) as prompt_tokens,
		sum(completion_tokens) as completion_tokens,
		sum(cache_read_tokens) as cache_read_tokens,
		sum(cache_write_tokens) as cache_write_tokens
		FROM logs
		WHERE type=2
		AND user_id= ?
		AND created_at BETWEEN ? AND ?
		GROUP BY day, model_name
		ORDER BY day, model_name
	`, userId, start, end).Scan(&LogStatistics).Error
	return LogStatistics, err
}

func SearchAllLogsByHourAndModel(start, end int) (LogStatistics []*LogStatistic, err error) {
	err = LOG_DB.Raw(`
		SELECT `+hourGroupSelect()+`,
		model_name, count(1) as request_count,
		sum(quota) as quota,
		sum(prompt_tokens) as prompt_tokens,
		sum(completion_tokens) as completion_tokens,
		sum(cache_read_tokens) as cache_read_tokens,
		sum(cache_write_tokens) as cache_write_tokens
		FROM logs
		WHERE type=2
		AND created_at BETWEEN ? AND ?
		GROUP BY day, model_name
		ORDER BY day, model_name
	`, start, end).Scan(&LogStatistics).Error
	return LogStatistics, err
}

func SearchLogsByUsernameHourAndModel(username string, start, end int) (LogStatistics []*LogStatistic, err error) {
	err = LOG_DB.Raw(`
		SELECT `+hourGroupSelect()+`,
		model_name, count(1) as request_count,
		sum(quota) as quota,
		sum(prompt_tokens) as prompt_tokens,
		sum(completion_tokens) as completion_tokens,
		sum(cache_read_tokens) as cache_read_tokens,
		sum(cache_write_tokens) as cache_write_tokens
		FROM logs
		WHERE type=2
		AND username = ?
		AND created_at BETWEEN ? AND ?
		GROUP BY day, model_name
		ORDER BY day, model_name
	`, username, start, end).Scan(&LogStatistics).Error
	return LogStatistics, err
}

// ChannelStatistic 按渠道聚合的用量统计。
// 注意：logs 表位于 LOG_DB，channels 表位于 DB，二者可能是不同数据库，
// 因此无法直接 SQL JOIN，渠道名需在 controller 层用 channel_id → name 映射补齐。
type ChannelStatistic struct {
	Day              string `gorm:"column:day"`
	ChannelId        int    `gorm:"column:channel_id"`
	RequestCount     int    `gorm:"column:request_count"`
	Quota            int    `gorm:"column:quota"`
	PromptTokens     int    `gorm:"column:prompt_tokens"`
	CompletionTokens int    `gorm:"column:completion_tokens"`
	// 缓存 token 聚合（同 LogStatistic，用于渠道维度观测缓存命中率）
	CacheReadTokens  int `gorm:"column:cache_read_tokens"`
	CacheWriteTokens int `gorm:"column:cache_write_tokens"`
}

func searchLogsByChannel(groupSelect, extraWhere string, args ...interface{}) ([]*ChannelStatistic, error) {
	var stats []*ChannelStatistic
	err := LOG_DB.Raw(`
		SELECT `+groupSelect+`,
		channel_id, count(1) as request_count,
		sum(quota) as quota,
		sum(prompt_tokens) as prompt_tokens,
		sum(completion_tokens) as completion_tokens,
		sum(cache_read_tokens) as cache_read_tokens,
		sum(cache_write_tokens) as cache_write_tokens
		FROM logs
		WHERE type=2
		`+extraWhere+`
		AND created_at BETWEEN ? AND ?
		GROUP BY day, channel_id
		ORDER BY day, channel_id
	`, args...).Scan(&stats).Error
	return stats, err
}

func dayGroupSelect() string {
	if common.UsingPostgreSQL {
		return "TO_CHAR(date_trunc('day', to_timestamp(created_at)), 'YYYY-MM-DD') as day"
	}
	if common.UsingSQLite {
		return "strftime('%Y-%m-%d', datetime(created_at, 'unixepoch')) as day"
	}
	return "DATE_FORMAT(FROM_UNIXTIME(created_at), '%Y-%m-%d') as day"
}

func SearchAllLogsByDayAndChannel(start, end int) ([]*ChannelStatistic, error) {
	return searchLogsByChannel(dayGroupSelect(), "", start, end)
}

func SearchAllLogsByHourAndChannel(start, end int) ([]*ChannelStatistic, error) {
	return searchLogsByChannel(hourGroupSelect(), "", start, end)
}

func SearchLogsByUserDayAndChannel(userId, start, end int) ([]*ChannelStatistic, error) {
	return searchLogsByChannel(dayGroupSelect(), "AND user_id = ?", userId, start, end)
}

func SearchLogsByUserHourAndChannel(userId, start, end int) ([]*ChannelStatistic, error) {
	return searchLogsByChannel(hourGroupSelect(), "AND user_id = ?", userId, start, end)
}

func SearchLogsByUsernameDayAndChannel(username string, start, end int) ([]*ChannelStatistic, error) {
	return searchLogsByChannel(dayGroupSelect(), "AND username = ?", username, start, end)
}

func SearchLogsByUsernameHourAndChannel(username string, start, end int) ([]*ChannelStatistic, error) {
	return searchLogsByChannel(hourGroupSelect(), "AND username = ?", username, start, end)
}

type DailyTrend struct {
	Date   string `json:"date"`
	Total  int64  `json:"total"`
	Input  int64  `json:"input"`
	Output int64  `json:"output"`
	Count  int64  `json:"count"`
}

func GetUserDailyTrend(username string, days int) (trends []*DailyTrend, err error) {
	groupSelect := "DATE_FORMAT(FROM_UNIXTIME(created_at), '%Y-%m-%d') as date"

	if common.UsingPostgreSQL {
		groupSelect = "TO_CHAR(date_trunc('day', to_timestamp(created_at)), 'YYYY-MM-DD') as date"
	}

	if common.UsingSQLite {
		groupSelect = "strftime('%Y-%m-%d', datetime(created_at, 'unixepoch')) as date"
	}

	// Calculate start timestamp (days ago from now)
	startTimestamp := helper.GetTimestamp() - int64(days*24*3600)

	err = LOG_DB.Raw(`
		SELECT `+groupSelect+`,
		COALESCE(SUM(quota), 0) as total,
		COALESCE(SUM(prompt_tokens), 0) as input,
		COALESCE(SUM(completion_tokens), 0) as output,
		COUNT(*) as count
		FROM logs
		WHERE type = ?
		AND username = ?
		AND created_at >= ?
		AND completion_tokens > 0
		GROUP BY date
		ORDER BY date
	`, LogTypeConsume, username, startTimestamp).Scan(&trends).Error

	return trends, err
}

// OrgLogFilter 企业用量查询的可选过滤条件.
//   - UserIds 非 nil 时:按 user_id IN (...) 过滤(用于部门维度,空切片表示该部门无成员 → 返回空结果)
//   - StartTs/EndTs > 0 时:按 created_at 时间范围过滤
type OrgLogFilter struct {
	UserIds  []int
	StartTs  int64
	EndTs    int64
	HasUsers bool // 是否应用 UserIds 过滤(区分"不限部门"与"部门无成员")
}

func applyOrgLogFilter(db *gorm.DB, orgId int, f OrgLogFilter) *gorm.DB {
	db = db.Where("org_id = ?", orgId)
	if f.HasUsers {
		if len(f.UserIds) == 0 {
			// 部门无成员:构造永假条件,返回空集
			return db.Where("1 = 0")
		}
		db = db.Where("user_id IN ?", f.UserIds)
	}
	if f.StartTs > 0 {
		db = db.Where("created_at >= ?", f.StartTs)
	}
	if f.EndTs > 0 {
		db = db.Where("created_at <= ?", f.EndTs)
	}
	return db
}

func GetOrgLogs(orgId int, startIdx int, num int, f OrgLogFilter) ([]*Log, error) {
	var logs []*Log
	err := applyOrgLogFilter(LOG_DB.Model(&Log{}), orgId, f).
		Order("id desc").Limit(num).Offset(startIdx).Find(&logs).Error
	overlayLogsUsername(logs)
	return logs, err
}

// OrgMemberUsage 单个成员在筛选范围内的用量汇总.
type OrgMemberUsage struct {
	UserId           int    `json:"user_id" gorm:"column:user_id"`
	Username         string `json:"username" gorm:"column:username"`
	RequestCount     int64  `json:"request_count" gorm:"column:request_count"`
	PromptTokens     int64  `json:"prompt_tokens" gorm:"column:prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens" gorm:"column:completion_tokens"`
	Quota            int64  `json:"quota" gorm:"column:quota"`
}

// GetOrgUsageByMember 按成员聚合用量(总请求数 / 总 token / 总消耗),按消耗降序.
// 仅统计计费日志 type=LogTypeConsume,与 series/trend/health 口径一致(排除错误请求).
func GetOrgUsageByMember(orgId int, f OrgLogFilter) ([]*OrgMemberUsage, error) {
	var rows []*OrgMemberUsage
	err := applyOrgLogFilter(LOG_DB.Model(&Log{}), orgId, f).
		Where("type = ?", LogTypeConsume).
		Select(`user_id,
			MAX(username) AS username,
			COUNT(*) AS request_count,
			COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
			COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
			COALESCE(SUM(quota), 0) AS quota`).
		Group("user_id").
		Order("quota DESC").
		Scan(&rows).Error
	overlayOrgMemberUsername(rows)
	return rows, err
}

// overlayOrgMemberUsername 同 overlayLogsUsername,但作用于按成员聚合的用量行,
// 把聚合出的落库 username 覆盖为账号中心权威值。
func overlayOrgMemberUsername(rows []*OrgMemberUsage) {
	if len(rows) == 0 {
		return
	}
	userIDs := make([]int, 0, len(rows))
	for _, r := range rows {
		if r != nil && r.UserId != 0 {
			userIDs = append(userIDs, r.UserId)
		}
	}
	nameByUser := resolveUsernamesByLocalUsers(userIDs)
	if len(nameByUser) == 0 {
		return
	}
	for _, r := range rows {
		if r == nil || r.UserId == 0 {
			continue
		}
		if name, ok := nameByUser[r.UserId]; ok {
			r.Username = name
		}
	}
}

// GetOrgLogsStat 返回筛选范围内的总请求数与总消耗额度.
// 仅统计计费日志 type=LogTypeConsume,与用量表格/趋势图口径一致(排除错误请求).
func GetOrgLogsStat(orgId int, f OrgLogFilter) (map[string]interface{}, error) {
	var totalQuota int64
	var totalCount int64
	err := applyOrgLogFilter(LOG_DB.Model(&Log{}), orgId, f).
		Where("type = ?", LogTypeConsume).Count(&totalCount).Error
	if err != nil {
		return nil, err
	}
	err = applyOrgLogFilter(LOG_DB.Model(&Log{}), orgId, f).
		Where("type = ?", LogTypeConsume).
		Select("COALESCE(SUM(quota), 0)").Scan(&totalQuota).Error
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"total_count": totalCount,
		"total_quota": totalQuota,
	}, nil
}

// OrgModelUsage 单个模型在筛选范围内的用量汇总.
type OrgModelUsage struct {
	ModelName        string `json:"model_name" gorm:"column:model_name"`
	RequestCount     int64  `json:"request_count" gorm:"column:request_count"`
	PromptTokens     int64  `json:"prompt_tokens" gorm:"column:prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens" gorm:"column:completion_tokens"`
	Quota            int64  `json:"quota" gorm:"column:quota"`
}

// GetOrgUsageByModel 按模型聚合用量,按消耗降序.口径与 GetOrgUsageByMember 一致(仅计费日志 type=LogTypeConsume).
func GetOrgUsageByModel(orgId int, f OrgLogFilter) ([]*OrgModelUsage, error) {
	var rows []*OrgModelUsage
	err := applyOrgLogFilter(LOG_DB.Model(&Log{}), orgId, f).
		Where("type = ?", LogTypeConsume).
		Select(`model_name,
			COUNT(*) AS request_count,
			COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
			COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
			COALESCE(SUM(quota), 0) AS quota`).
		Group("model_name").
		Order("quota DESC").
		Scan(&rows).Error
	return rows, err
}

// OrgDailyTrend 企业某一天的消耗汇总(仅计费日志 type=2).
type OrgDailyTrend struct {
	Day   string `json:"day" gorm:"column:day"`
	Quota int64  `json:"quota" gorm:"column:quota"`
	Count int64  `json:"count" gorm:"column:count"`
}

// GetOrgDailyTrend 返回企业自 startTs 起按天聚合的消耗趋势(复用 dayGroupSelect 保证 DB 无关).
func GetOrgDailyTrend(orgId int, startTs int64) ([]*OrgDailyTrend, error) {
	var rows []*OrgDailyTrend
	err := LOG_DB.Raw(`
		SELECT `+dayGroupSelect()+`,
		       COALESCE(SUM(quota), 0) as quota,
		       COUNT(*) as count
		FROM logs
		WHERE org_id = ? AND type = ? AND created_at >= ?
		GROUP BY day
		ORDER BY day
	`, orgId, LogTypeConsume, startTs).Scan(&rows).Error
	return rows, err
}

// GetOrgQuotaInRange 统计企业在 [startTs, endTs) 区间内的消耗(仅计费日志).
func GetOrgQuotaInRange(orgId int, startTs, endTs int64) (int64, error) {
	var quota int64
	err := LOG_DB.Model(&Log{}).
		Where("org_id = ? AND type = ? AND created_at >= ? AND created_at < ?",
			orgId, LogTypeConsume, startTs, endTs).
		Select("COALESCE(SUM(quota), 0)").Scan(&quota).Error
	return quota, err
}

// OrgServiceHealth 企业服务质量统计的原始计数.
type OrgServiceHealth struct {
	ConsumeCount int64 `json:"consume_count"`
	ErrorCount   int64 `json:"error_count"`
	SlowCount    int64 `json:"slow_count"`
}

// GetOrgServiceHealth 统计企业自 startTs 起的成功/失败/慢请求计数.
//   - consume: 计费成功请求(type=2)
//   - error:   错误请求(type=LogTypeError)
//   - slow:    计费请求中被标记慢请求的(slow_reason 非空)
func GetOrgServiceHealth(orgId int, startTs int64) (*OrgServiceHealth, error) {
	var h OrgServiceHealth
	if err := LOG_DB.Model(&Log{}).
		Where("org_id = ? AND type = ? AND created_at >= ?", orgId, LogTypeConsume, startTs).
		Count(&h.ConsumeCount).Error; err != nil {
		return nil, err
	}
	if err := LOG_DB.Model(&Log{}).
		Where("org_id = ? AND type = ? AND created_at >= ?", orgId, LogTypeError, startTs).
		Count(&h.ErrorCount).Error; err != nil {
		return nil, err
	}
	if err := LOG_DB.Model(&Log{}).
		Where("org_id = ? AND type = ? AND created_at >= ? AND slow_reason <> ''", orgId, LogTypeConsume, startTs).
		Count(&h.SlowCount).Error; err != nil {
		return nil, err
	}
	return &h, nil
}

// OrgUsageSeriesPoint 用量时间序列的单个时间桶:活跃用户数 / 请求数 / token 消耗.
type OrgUsageSeriesPoint struct {
	Bucket      string `json:"bucket" gorm:"column:bucket"`
	ActiveUsers int64  `json:"active_users" gorm:"column:active_users"`
	Requests    int64  `json:"requests" gorm:"column:requests"`
	Tokens      int64  `json:"tokens" gorm:"column:tokens"`
}

// GetOrgUsageSeries 按时间桶(天或小时)聚合企业用量,返回每桶的活跃用户/请求/Token.
//   - byHour=true 用小时分组(适合「今天」短区间),否则按天
//   - f 复用 OrgLogFilter(部门/时间范围);仅统计计费日志 type=2
//   - active_users = COUNT(DISTINCT user_id),用于活跃用户曲线
func GetOrgUsageSeries(orgId int, f OrgLogFilter, byHour bool) ([]*OrgUsageSeriesPoint, error) {
	groupSelect := dayGroupSelect()
	if byHour {
		groupSelect = hourGroupSelect()
	}
	// dayGroupSelect/hourGroupSelect 末尾是 "... as day",这里统一取别名 bucket
	groupSelect = strings.Replace(groupSelect, " as day", " as bucket", 1)
	var rows []*OrgUsageSeriesPoint
	db := applyOrgLogFilter(LOG_DB.Model(&Log{}), orgId, f).
		Where("type = ?", LogTypeConsume).
		Select(groupSelect + `,
			COUNT(DISTINCT user_id) as active_users,
			COUNT(*) as requests,
			COALESCE(SUM(prompt_tokens + completion_tokens), 0) as tokens`).
		Group("bucket").
		Order("bucket")
	err := db.Scan(&rows).Error
	return rows, err
}

// GetOrgActiveUserCount 返回筛选区间内的去重活跃用户数(计费日志).
func GetOrgActiveUserCount(orgId int, f OrgLogFilter) (int64, error) {
	var count int64
	err := applyOrgLogFilter(LOG_DB.Model(&Log{}), orgId, f).
		Where("type = ?", LogTypeConsume).
		Distinct("user_id").
		Count(&count).Error
	return count, err
}


func GetOrgMemberLastUsed(orgId int) (map[int]int64, error) {
	type row struct {
		UserId   int   `gorm:"column:user_id"`
		LastUsed int64 `gorm:"column:last_used"`
	}
	var rows []row
	err := LOG_DB.Model(&Log{}).
		Where("org_id = ? AND type = ?", orgId, LogTypeConsume).
		Select("user_id, MAX(created_at) AS last_used").
		Group("user_id").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	result := make(map[int]int64, len(rows))
	for _, r := range rows {
		result[r.UserId] = r.LastUsed
	}
	return result, nil
}

type UserUsageRanking struct {
	UserId       int    `json:"user_id" gorm:"column:user_id"`
	Username     string `json:"username" gorm:"column:username"`
	Tokens       int64  `json:"tokens" gorm:"column:tokens"`
	Quota        int64  `json:"quota" gorm:"column:quota"`
	RequestCount int64  `json:"request_count" gorm:"column:request_count"`
}

var rankingSortWhitelist = map[string]string{
	"tokens": "tokens",
	"quota":  "quota",
	"count":  "request_count",
}

func GetUserUsageRanking(startTs, endTs int64, sort string, limit int) ([]*UserUsageRanking, error) {
	sortCol, ok := rankingSortWhitelist[sort]
	if !ok {
		sortCol = "tokens"
	}
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	var rows []*UserUsageRanking
	err := LOG_DB.Raw(`
		SELECT user_id, username,
		       COALESCE(SUM(prompt_tokens + completion_tokens), 0) as tokens,
		       COALESCE(SUM(quota), 0) as quota,
		       COUNT(*) as request_count
		FROM logs
		WHERE type = 2 AND created_at BETWEEN ? AND ?
		GROUP BY user_id, username
		ORDER BY `+sortCol+` DESC
		LIMIT ?
	`, startTs, endTs, limit).Scan(&rows).Error
	return rows, err
}
