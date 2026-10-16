package controller

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var usageEventIDPattern = regexp.MustCompile(`^[A-Za-z0-9:._-]{8,128}$`)
var usageItemIDPattern = regexp.MustCompile(`^[A-Za-z0-9:._/-]{1,160}$`)

type usageInput struct {
	EventID        string `json:"event_id"`
	ItemID         string `json:"item_id"`
	ItemName       string `json:"item_name"`
	InvocationType string `json:"invocation_type"`
	UserID         int    `json:"user_id"`
}

func validUsageInput(input usageInput, kind string) bool {
	if !usageEventIDPattern.MatchString(input.EventID) {
		return false
	}
	if kind == "skill" {
		return usageItemIDPattern.MatchString(input.ItemID) && strings.TrimSpace(input.ItemName) != "" && len([]rune(input.ItemName)) <= 160 &&
			(input.InvocationType == "user_explicit" || input.InvocationType == "model_auto")
	}
	return input.InvocationType == "" && input.UserID > 0
}

func insertUsage(input usageInput, kind string, user model.User) error {
	now := time.Now().UTC()
	day := now.In(time.FixedZone("CST", 8*60*60)).Format("2006-01-02")
	record := model.UsageEvent{
		EventID: input.EventID, Kind: kind, InvocationType: input.InvocationType,
		ItemID: input.ItemID, ItemName: strings.TrimSpace(input.ItemName),
		UserID: user.Id, Username: user.Username, Day: day, OccurredAt: now,
	}
	return model.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&record).Error
}

// RecordSkillUsage records each accepted send or actual model skill call. The
// authenticated user is authoritative; payloads cannot choose a person.
func RecordSkillUsage(c *gin.Context) {
	var input usageInput
	if c.ShouldBindJSON(&input) != nil || !validUsageInput(input, "skill") {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "技能使用事件无效"})
		return
	}
	var user model.User
	if err := model.DB.Select("id", "username").First(&user, c.GetInt("id")).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "用户身份无效"})
		return
	}
	var skill model.Skill
	if model.DB.Select("display_name").Where("name = ?", input.ItemID).First(&skill).Error == nil && strings.TrimSpace(skill.DisplayName) != "" {
		input.ItemName = skill.DisplayName
	}
	if err := insertUsage(input, "skill", user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "技能使用记录失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// RecordExpertUsage accepts a started task only from the expert's registered
// provider credential. The website supplies its redeemed user and task ID.
func RecordExpertUsage(c *gin.Context) {
	var input usageInput
	if c.ShouldBindJSON(&input) != nil || !validUsageInput(input, "expert") {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "专家使用事件无效"})
		return
	}
	credential := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
	if !expertCredentialPattern.MatchString(credential) {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "提供方凭据无效"})
		return
	}
	var profile model.ExpertWebProfile
	if err := model.DB.Where("provider_secret_hash = ? AND published = ?", expertWebDigest(credential), true).First(&profile).Error; err != nil ||
		subtle.ConstantTimeCompare([]byte(expertWebDigest(credential)), []byte(profile.ProviderSecretHash)) != 1 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "提供方凭据无效"})
		return
	}
	var user model.User
	if err := model.DB.Select("id", "username").First(&user, input.UserID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "用户身份无效"})
		return
	}
	input.ItemID, input.ItemName = profile.Key, profile.Name
	if err := insertUsage(input, "expert", user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "专家使用记录失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func usageQuery(c *gin.Context) (*gorm.DB, string, error) {
	kind := c.Query("kind")
	if kind != "skill" && kind != "expert" {
		return nil, "", errors.New("使用类型无效")
	}
	today := time.Now().In(time.FixedZone("CST", 8*60*60))
	from, to := c.DefaultQuery("from", today.AddDate(0, 0, -29).Format("2006-01-02")),
		c.DefaultQuery("to", today.Format("2006-01-02"))
	start, errStart := time.Parse("2006-01-02", from)
	end, errEnd := time.Parse("2006-01-02", to)
	if errStart != nil || errEnd != nil || start.After(end) || end.Sub(start) > 366*24*time.Hour {
		return nil, "", errors.New("日期范围无效或超过一年")
	}
	query := model.DB.Model(&model.UsageEvent{}).Where("kind = ? AND day >= ? AND day <= ?", kind, from, to)
	if department := c.Query("department_id"); department != "" {
		id, err := strconv.Atoi(department)
		if err != nil || id < 0 {
			return nil, "", errors.New("部门编号无效")
		}
		if id == 0 {
			query = query.Where("department_id IS NULL")
		} else {
			query = query.Where("department_id = ?", id)
		}
	}
	if item := strings.TrimSpace(c.Query("item_id")); item != "" {
		if !usageItemIDPattern.MatchString(item) {
			return nil, "", errors.New("对象编号无效")
		}
		query = query.Where("item_id = ?", item)
	}
	return query, kind, nil
}

// GetUsageDetails returns a paged, person-level ledger without prompts or files.
func GetUsageDetails(c *gin.Context) {
	query, _, err := usageQuery(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	if page > 100000 {
		page = 100000
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(500, gin.H{"success": false})
		return
	}
	var items []model.UsageEvent
	pageQuery, _, _ := usageQuery(c)
	if err := pageQuery.Order("occurred_at DESC, event_id DESC").Limit(20).Offset((page - 1) * 20).Find(&items).Error; err != nil {
		c.JSON(500, gin.H{"success": false})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"items": items, "total": total, "page": page}})
}

type usageCount struct {
	ItemID         string `json:"item_id"`
	ItemName       string `json:"item_name"`
	DepartmentID   *int   `json:"department_id"`
	DepartmentName string `json:"department_name"`
	Day            string `json:"day"`
	Count          int64  `json:"count"`
}

// GetUsageStats returns the count, top ten, department groups and daily buckets.
// Weekly and monthly views group these server-day buckets without changing totals.
func GetUsageStats(c *gin.Context) {
	query, _, err := usageQuery(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		c.JSON(500, gin.H{"success": false})
		return
	}
	var top, departments, days []usageCount
	topQuery, _, _ := usageQuery(c)
	if err := topQuery.Select("item_id, MAX(item_name) AS item_name, COUNT(*) AS count").Group("item_id").Order("count DESC, item_id ASC").Limit(10).Scan(&top).Error; err != nil {
		c.JSON(500, gin.H{"success": false})
		return
	}
	departmentQuery, _, _ := usageQuery(c)
	if err := departmentQuery.Select("department_id, MAX(department_name) AS department_name, COUNT(*) AS count").Group("department_id").Order("count DESC").Scan(&departments).Error; err != nil {
		c.JSON(500, gin.H{"success": false})
		return
	}
	dayQuery, _, _ := usageQuery(c)
	if err := dayQuery.Select("day, COUNT(*) AS count").Group("day").Order("day ASC").Scan(&days).Error; err != nil {
		c.JSON(500, gin.H{"success": false})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{"total": total, "top10": top, "departments": departments, "days": days}})
}
