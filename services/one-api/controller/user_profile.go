package controller

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

type profileRank struct {
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

type profileDay struct {
	Day   string `json:"day"`
	Count int64  `json:"count"`
}

type profileUsage struct {
	Count int64         `json:"count"`
	Top   []profileRank `json:"top"`
	Days  []profileDay  `json:"days"`
}

type profileModelUsage struct {
	profileUsage
	PromptTokens     int64 `json:"prompt_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
}

type profileDownload struct {
	Name      string `json:"name"`
	Count     int64  `json:"count"`
	Installed bool   `json:"installed"`
}

type profileDownloads struct {
	Count          int64             `json:"count"`
	InstalledCount int64             `json:"installed_count"`
	Top            []profileDownload `json:"top"`
}

func profileUsageEvents(userID int, kind, from, to string) (profileUsage, error) {
	result := profileUsage{Top: []profileRank{}, Days: []profileDay{}}
	base := func() *gorm.DB {
		return model.DB.Model(&model.UsageEvent{}).
			Where("user_id = ? AND kind = ? AND day >= ? AND day <= ?", userID, kind, from, to)
	}
	if err := base().Count(&result.Count).Error; err != nil {
		return result, err
	}
	if err := base().Select("MAX(item_name) AS name, COUNT(*) AS count").
		Group("item_id").Order("count DESC, item_id ASC").Limit(5).Scan(&result.Top).Error; err != nil {
		return result, err
	}
	if err := base().Select("day, COUNT(*) AS count").Group("day").Order("day ASC").Scan(&result.Days).Error; err != nil {
		return result, err
	}
	return result, nil
}

// GetUserProfile returns observed activity only. Model logs may be absent when
// consume logging is disabled; the response never includes prompts or files.
func GetUserProfile(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "用户编号无效"})
		return
	}
	var user model.User
	if err := model.DB.Select("id").First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "用户不存在"})
		return
	}
	location := time.FixedZone("CST", 8*60*60)
	today := time.Now().In(location)
	start := time.Date(today.Year(), today.Month(), today.Day()-29, 0, 0, 0, 0, location)
	end := time.Date(today.Year(), today.Month(), today.Day()+1, 0, 0, 0, 0, location)
	from, to := start.Format("2006-01-02"), today.Format("2006-01-02")
	models := profileModelUsage{profileUsage: profileUsage{Top: []profileRank{}, Days: []profileDay{}}}
	logBase := func() *gorm.DB {
		return model.LOG_DB.Model(&model.Log{}).
			Where("user_id = ? AND type = ? AND created_at >= ? AND created_at < ?", id, model.LogTypeConsume, start.Unix(), end.Unix())
	}
	var totals struct {
		Count            int64
		PromptTokens     int64
		CompletionTokens int64
	}
	if err := logBase().Select("COUNT(*) AS count, COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens, COALESCE(SUM(completion_tokens), 0) AS completion_tokens").Scan(&totals).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "模型统计读取失败"})
		return
	}
	models.Count, models.PromptTokens, models.CompletionTokens = totals.Count, totals.PromptTokens, totals.CompletionTokens
	if err := logBase().Select("model_name AS name, COUNT(*) AS count").Group("model_name").Order("count DESC, model_name ASC").Limit(5).Scan(&models.Top).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "模型统计读取失败"})
		return
	}
	var logDays []struct {
		Day   int64
		Count int64
	}
	dayBucket := "FLOOR((created_at + 28800) / 86400)"
	if err := logBase().Select(dayBucket + " AS day, COUNT(*) AS count").
		Group(dayBucket).Order("day ASC").Scan(&logDays).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "模型统计读取失败"})
		return
	}
	for _, row := range logDays {
		day := time.Unix(row.Day*86400-28800, 0).In(location).Format("2006-01-02")
		models.Days = append(models.Days, profileDay{Day: day, Count: row.Count})
	}
	skills, err := profileUsageEvents(id, "skill", from, to)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "message": "技能统计读取失败"})
		return
	}
	experts, err := profileUsageEvents(id, "expert", from, to)
	if err != nil {
		c.JSON(500, gin.H{"success": false, "message": "专家统计读取失败"})
		return
	}
	downloads := profileDownloads{Top: []profileDownload{}}
	base := model.DB.Model(&model.SkillUserStat{}).Where("user_id = ?", id)
	var downloadTotals struct {
		Count          int64
		InstalledCount int64
	}
	if err := base.Select("COALESCE(SUM(download_count), 0) AS count, COALESCE(SUM(CASE WHEN installed THEN 1 ELSE 0 END), 0) AS installed_count").Scan(&downloadTotals).Error; err != nil {
		c.JSON(500, gin.H{"success": false, "message": "下载统计读取失败"})
		return
	}
	downloads.Count, downloads.InstalledCount = downloadTotals.Count, downloadTotals.InstalledCount
	if err := model.DB.Table("skill_user_stats AS stats").
		Joins("LEFT JOIN skills ON skills.id = stats.skill_id").Where("stats.user_id = ?", id).
		Select("COALESCE(NULLIF(skills.display_name, ''), skills.name, '已下架技能') AS name, stats.download_count AS count, stats.installed").
		Order("stats.download_count DESC, stats.skill_id ASC").Limit(5).Scan(&downloads.Top).Error; err != nil {
		c.JSON(500, gin.H{"success": false, "message": "下载统计读取失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"from": from, "to": to, "models": models, "skills": skills, "experts": experts, "downloads": downloads,
	}})
}
