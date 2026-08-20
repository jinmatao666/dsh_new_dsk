package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/helper"
	"github.com/songquanpeng/one-api/model"
	"net/http"
	"strconv"
	"strings"
)

func GetAllChannels(c *gin.Context) {
	p, _ := strconv.Atoi(c.Query("p"))
	if p < 0 {
		p = 0
	}
	channels, err := model.GetAllChannels(p*config.ItemsPerPage, config.ItemsPerPage, "limited")
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    channels,
	})
	return
}

func SearchChannels(c *gin.Context) {
	keyword := c.Query("keyword")
	channels, err := model.SearchChannels(keyword)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    channels,
	})
	return
}

func GetChannel(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	// selectAll=true 读出 key 以便计算脱敏串；明文不返回前端。
	channel, err := model.GetChannelById(id, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	keyMasked := maskKey(channel.Key)
	channel.Key = "" // 清空明文，前端仅凭 key_masked 确认已有密钥
	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"message":    "",
		"data":       channel,
		"key_masked": keyMasked,
	})
	return
}

// maskKey 返回密钥的脱敏展示：保留前后各 3 位，中间用省略号。
// 过短（≤6 位）则全部打码，避免泄露。多 key（换行分隔）只展示第一个。
func maskKey(key string) string {
	key = strings.TrimSpace(key)
	if idx := strings.IndexAny(key, "\n"); idx >= 0 {
		key = strings.TrimSpace(key[:idx])
	}
	if key == "" {
		return ""
	}
	r := []rune(key)
	if len(r) <= 6 {
		return strings.Repeat("*", len(r))
	}
	return string(r[:3]) + "···" + string(r[len(r)-3:])
}

func AddChannel(c *gin.Context) {
	channel := model.Channel{}
	err := c.ShouldBindJSON(&channel)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	channel.CreatedTime = helper.GetTimestamp()
	// T2.1 渠道新增默认不启用(草稿要求),需启用时由「启用」操作单独开启
	channel.Status = model.ChannelStatusManuallyDisabled
	keys := strings.Split(channel.Key, "\n")
	channels := make([]model.Channel, 0, len(keys))
	for _, key := range keys {
		if key == "" {
			continue
		}
		localChannel := channel
		localChannel.Key = key
		channels = append(channels, localChannel)
	}
	err = model.BatchInsertChannels(channels)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

// CopyChannel 复制现有渠道：完整继承配置（含密钥），新渠道默认禁用。
// 密钥仅在服务端读取与写入，不经过前端，避免泄露。
func CopyChannel(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	channel, err := model.GetChannelById(id, true) // selectAll=true 以取到 key
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "渠道不存在或读取失败：" + err.Error(),
		})
		return
	}
	keyMasked := maskKey(channel.Key)
	channel.Id = 0 // 置空主键，作为新记录插入
	channel.Name = channel.Name + " - 副本"
	channel.Status = model.ChannelStatusManuallyDisabled // 复制后默认不启用
	channel.CreatedTime = helper.GetTimestamp()
	channel.TestTime = 0
	channel.ResponseTime = 0
	channel.Balance = 0
	channel.BalanceUpdatedTime = 0
	channel.UsedQuota = 0
	if err := channel.Insert(); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	channel.Key = ""
	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"message":    "",
		"data":       channel,
		"key_masked": keyMasked,
	})
	return
}

func DeleteChannel(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	// T2.1 仅允许删除已停用的渠道(草稿要求),防止误删在用渠道
	existing, err := model.GetChannelById(id, false)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "渠道不存在或读取失败:" + err.Error(),
		})
		return
	}
	if existing.Status == model.ChannelStatusEnabled {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "请先停用该渠道再删除",
		})
		return
	}
	channel := model.Channel{Id: id}
	err = channel.Delete()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func DeleteDisabledChannel(c *gin.Context) {
	rows, err := model.DeleteDisabledChannel()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    rows,
	})
	return
}

func UpdateChannel(c *gin.Context) {
	channel := model.Channel{}
	err := c.ShouldBindJSON(&channel)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	err = channel.Update()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	keyMasked := maskKey(channel.Key)
	channel.Key = ""
	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"message":    "",
		"data":       channel,
		"key_masked": keyMasked,
	})
	return
}
