package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/logger"
	"github.com/songquanpeng/one-api/common/random"
	"math/rand"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	TokenCacheSeconds         = config.SyncFrequency
	UserId2GroupCacheSeconds  = config.SyncFrequency
	UserId2QuotaCacheSeconds  = config.SyncFrequency
	UserId2StatusCacheSeconds = config.SyncFrequency
	GroupModelsCacheSeconds   = config.SyncFrequency
)

func CacheGetTokenByKey(key string) (*Token, error) {
	keyCol := quoteSQLIdentifier("key")
	var token Token
	if !common.RedisEnabled {
		err := DB.Where(keyCol+" = ?", key).First(&token).Error
		return &token, err
	}
	tokenObjectString, err := common.RedisGet(fmt.Sprintf("token:%s", key))
	if err != nil {
		err := DB.Where(keyCol+" = ?", key).First(&token).Error
		if err != nil {
			return nil, err
		}
		jsonBytes, err := json.Marshal(token)
		if err != nil {
			return nil, err
		}
		err = common.RedisSet(fmt.Sprintf("token:%s", key), string(jsonBytes), time.Duration(TokenCacheSeconds)*time.Second)
		if err != nil {
			logger.SysError("Redis set token error: " + err.Error())
		}
		return &token, nil
	}
	err = json.Unmarshal([]byte(tokenObjectString), &token)
	return &token, err
}

func CacheGetUserGroup(id int) (group string, err error) {
	if !common.RedisEnabled {
		return GetUserGroup(id)
	}
	group, err = common.RedisGet(fmt.Sprintf("user_group:%d", id))
	if err != nil {
		group, err = GetUserGroup(id)
		if err != nil {
			return "", err
		}
		err = common.RedisSet(fmt.Sprintf("user_group:%d", id), group, time.Duration(UserId2GroupCacheSeconds)*time.Second)
		if err != nil {
			logger.SysError("Redis set user group error: " + err.Error())
		}
	}
	return group, err
}

func fetchAndUpdateUserQuota(ctx context.Context, id int) (quota int64, err error) {
	quota, err = GetUserQuota(id)
	if err != nil {
		return 0, err
	}
	err = common.RedisSet(fmt.Sprintf("user_quota:%d", id), fmt.Sprintf("%d", quota), time.Duration(UserId2QuotaCacheSeconds)*time.Second)
	if err != nil {
		logger.Error(ctx, "Redis set user quota error: "+err.Error())
	}
	return
}

func CacheGetUserQuota(ctx context.Context, id int) (quota int64, err error) {
	if !common.RedisEnabled {
		return GetUserQuota(id)
	}
	quotaString, err := common.RedisGet(fmt.Sprintf("user_quota:%d", id))
	if err != nil {
		return fetchAndUpdateUserQuota(ctx, id)
	}
	quota, err = strconv.ParseInt(quotaString, 10, 64)
	if err != nil {
		return 0, nil
	}
	if quota <= config.PreConsumedQuota { // when user's quota is less than pre-consumed quota, we need to fetch from db
		logger.Infof(ctx, "user %d's cached quota is too low: %d, refreshing from db", quota, id)
		return fetchAndUpdateUserQuota(ctx, id)
	}
	return quota, nil
}

func CacheUpdateUserQuota(ctx context.Context, id int) error {
	if !common.RedisEnabled {
		return nil
	}
	quota, err := CacheGetUserQuota(ctx, id)
	if err != nil {
		return err
	}
	err = common.RedisSet(fmt.Sprintf("user_quota:%d", id), fmt.Sprintf("%d", quota), time.Duration(UserId2QuotaCacheSeconds)*time.Second)
	return err
}

func CacheDecreaseUserQuota(id int, quota int64) error {
	if !common.RedisEnabled {
		return nil
	}
	err := common.RedisDecrease(fmt.Sprintf("user_quota:%d", id), int64(quota))
	return err
}

// FlushUserQuotaCache 用 SCAN + DEL 清空 Redis 中所有 user_quota:* 缓存条目.
//   - 在 PR2 启动迁移完成后调用一次,避免老缓存值与新求和读取语义不一致
//   - Redis 未启用时早退;不存在密钥时无副作用
//   - SCAN 分批游标遍历,COUNT=500 兼顾延迟与内存
func FlushUserQuotaCache() error {
	if !common.RedisEnabled || common.RDB == nil {
		return nil
	}
	ctx := context.Background()
	var cursor uint64
	deleted := 0
	for {
		keys, nextCursor, err := common.RDB.Scan(ctx, cursor, "user_quota:*", 500).Result()
		if err != nil {
			return err
		}
		if len(keys) > 0 {
			if err := common.RDB.Del(ctx, keys...).Err(); err != nil {
				return err
			}
			deleted += len(keys)
		}
		if nextCursor == 0 {
			break
		}
		cursor = nextCursor
	}
	if deleted > 0 {
		logger.SysLogf("user_quota cache: flushed %d Redis keys", deleted)
	}
	return nil
}

// InvalidateUserAccountCache 失效单个用户的额度与 group 缓存.
// 账户类型转移(个体<->企业)会清零/改写 users.quota 与所属 group,
// 必须主动删除 user_quota:{id} 与 user_group:{id},否则:
//   - 个体转企业后若 Distribute 因企业被禁用等回落到个人分支,会读到未失效的旧个人额度计费;
//   - 企业 group 不会立即生效。
//
// Redis 未启用或键不存在时均无副作用。
func InvalidateUserAccountCache(id int) {
	if !common.RedisEnabled || common.RDB == nil {
		return
	}
	if err := common.RedisDel(fmt.Sprintf("user_quota:%d", id)); err != nil {
		logger.SysError("Redis del user quota error: " + err.Error())
	}
	if err := common.RedisDel(fmt.Sprintf("user_group:%d", id)); err != nil {
		logger.SysError("Redis del user group error: " + err.Error())
	}
	if err := common.RedisDel(fmt.Sprintf("user_account:%d", id)); err != nil {
		logger.SysError("Redis del user account error: " + err.Error())
	}
}

// CacheGetUserAccount 读取用户的账户类型与所属企业(account_type, org_id),带 Redis 缓存.
// relay 热路径每请求都要判定个体/企业身份,直接查 users 表会成为新的 DB 压力点;
// 这里复用与 user_group 一致的 TTL 缓存,转移账户类型时由 InvalidateUserAccountCache 失效.
// 缓存值编码为 "accountType:orgId"。Redis 未启用时回退直查。
func CacheGetUserAccount(id int) (accountType int, orgId int, err error) {
	if !common.RedisEnabled || common.RDB == nil {
		return getUserAccountFromDB(id)
	}
	cached, rErr := common.RedisGet(fmt.Sprintf("user_account:%d", id))
	if rErr == nil {
		if at, oid, ok := parseUserAccount(cached); ok {
			return at, oid, nil
		}
	}
	accountType, orgId, err = getUserAccountFromDB(id)
	if err != nil {
		return 0, 0, err
	}
	if sErr := common.RedisSet(fmt.Sprintf("user_account:%d", id),
		fmt.Sprintf("%d:%d", accountType, orgId),
		time.Duration(UserId2GroupCacheSeconds)*time.Second); sErr != nil {
		logger.SysError("Redis set user account error: " + sErr.Error())
	}
	return accountType, orgId, nil
}

func getUserAccountFromDB(id int) (accountType int, orgId int, err error) {
	var user User
	if err = DB.Model(&User{}).Select("account_type", "org_id").Where("id = ?", id).First(&user).Error; err != nil {
		return 0, 0, err
	}
	return user.AccountType, user.OrgId, nil
}

func parseUserAccount(s string) (accountType int, orgId int, ok bool) {
	parts := strings.SplitN(s, ":", 2)
	if len(parts) != 2 {
		return 0, 0, false
	}
	at, err1 := strconv.Atoi(parts[0])
	oid, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return at, oid, true
}

func CacheIsUserEnabled(userId int) (bool, error) {
	if !common.RedisEnabled {
		return IsUserEnabled(userId)
	}
	enabled, err := common.RedisGet(fmt.Sprintf("user_enabled:%d", userId))
	if err == nil {
		return enabled == "1", nil
	}

	userEnabled, err := IsUserEnabled(userId)
	if err != nil {
		return false, err
	}
	enabled = "0"
	if userEnabled {
		enabled = "1"
	}
	err = common.RedisSet(fmt.Sprintf("user_enabled:%d", userId), enabled, time.Duration(UserId2StatusCacheSeconds)*time.Second)
	if err != nil {
		logger.SysError("Redis set user enabled error: " + err.Error())
	}
	return userEnabled, err
}

func CacheGetGroupModels(ctx context.Context, group string) ([]string, error) {
	if !common.RedisEnabled {
		return GetGroupModels(ctx, group)
	}
	modelsStr, err := common.RedisGet(fmt.Sprintf("group_models:%s", group))
	if err == nil {
		return strings.Split(modelsStr, ","), nil
	}
	models, err := GetGroupModels(ctx, group)
	if err != nil {
		return nil, err
	}
	err = common.RedisSet(fmt.Sprintf("group_models:%s", group), strings.Join(models, ","), time.Duration(GroupModelsCacheSeconds)*time.Second)
	if err != nil {
		logger.SysError("Redis set group models error: " + err.Error())
	}
	return models, nil
}

var group2model2channels map[string]map[string][]*Channel
var channelSyncLock sync.RWMutex

func InitChannelCache() {
	newChannelId2channel := make(map[int]*Channel)
	var channels []*Channel
	DB.Where("status = ?", ChannelStatusEnabled).Find(&channels)
	for _, channel := range channels {
		newChannelId2channel[channel.Id] = channel
	}
	var abilities []*Ability
	DB.Find(&abilities)
	groups := make(map[string]bool)
	for _, ability := range abilities {
		groups[ability.Group] = true
	}
	newGroup2model2channels := make(map[string]map[string][]*Channel)
	for group := range groups {
		newGroup2model2channels[group] = make(map[string][]*Channel)
	}
	// T1.5 ability 权威化:路由表以 ability 表为准,不再 split channel.Models。
	// 只纳入 enabled 的 ability 且其渠道处于启用态(在 newChannelId2channel 中)。
	// 每条来源克隆一份渠道并用 ability.Priority 覆盖优先级 —— 因为模型页可对单个来源
	// 独立设优先级,而后续选择逻辑(CacheGetRandomSatisfiedChannel)读 channel.GetPriority()。
	for _, ability := range abilities {
		if !ability.Enabled {
			continue
		}
		channel, ok := newChannelId2channel[ability.ChannelId]
		if !ok {
			continue // 渠道未启用或不存在,跳过
		}
		if _, ok := newGroup2model2channels[ability.Group][ability.Model]; !ok {
			newGroup2model2channels[ability.Group][ability.Model] = make([]*Channel, 0)
		}
		cloned := *channel
		cloned.Priority = ability.Priority
		newGroup2model2channels[ability.Group][ability.Model] = append(
			newGroup2model2channels[ability.Group][ability.Model], &cloned)
	}

	// sort by priority
	for group, model2channels := range newGroup2model2channels {
		for model, channels := range model2channels {
			sort.Slice(channels, func(i, j int) bool {
				return channels[i].GetPriority() > channels[j].GetPriority()
			})
			newGroup2model2channels[group][model] = channels
		}
	}

	channelSyncLock.Lock()
	group2model2channels = newGroup2model2channels
	channelSyncLock.Unlock()
	logger.SysLog("channels synced from database")
}

func SyncChannelCache(frequency int) {
	for {
		time.Sleep(time.Duration(frequency) * time.Second)
		logger.SysLog("syncing channels from database")
		InitChannelCache()
	}
}

func CacheGetRandomSatisfiedChannel(group string, model string, ignoreFirstPriority bool) (*Channel, error) {
	if !config.MemoryCacheEnabled {
		return GetRandomSatisfiedChannel(group, model, ignoreFirstPriority)
	}
	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()
	channels := group2model2channels[group][model]
	if len(channels) == 0 {
		return nil, errors.New("channel not found")
	}
	endIdx := len(channels)
	// choose by priority
	firstChannel := channels[0]
	if firstChannel.GetPriority() > 0 {
		for i := range channels {
			if channels[i].GetPriority() != firstChannel.GetPriority() {
				endIdx = i
				break
			}
		}
	}
	idx := rand.Intn(endIdx)
	if ignoreFirstPriority {
		if endIdx < len(channels) { // which means there are more than one priority
			idx = random.RandRange(endIdx, len(channels))
		}
	}
	return channels[idx], nil
}
