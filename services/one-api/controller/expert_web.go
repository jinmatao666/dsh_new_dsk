package controller

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const expertTicketLifetime = 90 * time.Second

var expertKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{2,79}$`)
var expertCredentialPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var expertIconNamePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,39}$`)

type expertWebInput struct {
	Key              string `json:"key"`
	Name             string `json:"name"`
	Subtitle         string `json:"subtitle"`
	Category         string `json:"category"`
	Summary          string `json:"summary"`
	Icon             string `json:"icon"`
	Tags             string `json:"tags"`
	Scenario         string `json:"scenario"`
	Materials        string `json:"materials"`
	DetailSections   string `json:"detail_sections"`
	FooterNote       string `json:"footer_note"`
	Provider         string `json:"provider"`
	WorkbenchURL     string `json:"workbench_url"`
	SortOrder        *int   `json:"sort_order"`
	RequiresInternet *bool  `json:"requires_internet"`
}

func expertWebDigest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func expertWebRandom() (string, error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}

func validExpertWebIcon(icon string) bool {
	if icon == "" || expertIconNamePattern.MatchString(icon) {
		return true
	}
	if len(icon) > 60*1024 {
		return false
	}
	for _, mime := range []string{"image/png", "image/jpeg", "image/webp", "image/gif"} {
		prefix := "data:" + mime + ";base64,"
		if strings.HasPrefix(icon, prefix) {
			_, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(icon, prefix))
			return err == nil
		}
	}
	return false
}

func validateExpertWebInput(input expertWebInput) error {
	if !expertKeyPattern.MatchString(input.Key) {
		return errors.New("专家编号须为3至80位，以小写字母开头，只能包含小写字母、数字和短横线（-）")
	}
	if strings.TrimSpace(input.Name) == "" {
		return errors.New("请填写专家名称")
	}
	if len([]rune(input.Name)) > 100 {
		return errors.New("专家名称不能超过100字")
	}
	if strings.TrimSpace(input.Provider) == "" {
		return errors.New("请填写提供方，例如 wanwei")
	}
	if len([]rune(input.Provider)) > 100 {
		return errors.New("提供方不能超过100字")
	}
	if len([]rune(input.Summary)) > 500 {
		return errors.New("专家简介不能超过500字")
	}
	if len([]rune(input.FooterNote)) > 500 {
		return errors.New("弹窗底部说明不能超过500字")
	}
	if len(input.Icon) > 60*1024 {
		return errors.New("专家图标编码后超过60 KB，请压缩或更换较小的图片")
	}
	if !validExpertWebIcon(input.Icon) {
		return errors.New("专家图标格式无效，请使用PNG、JPEG、WebP或GIF图片")
	}
	address, err := url.Parse(input.WorkbenchURL)
	if err != nil || (address.Scheme != "http" && address.Scheme != "https") || address.Hostname() == "" || address.User != nil || address.Opaque != "" {
		return errors.New("工作台必须使用有效的 HTTP 或 HTTPS 地址")
	}
	var tags []string
	if err := json.Unmarshal([]byte(input.Tags), &tags); err != nil {
		return errors.New("标签格式无效，应为文字标签数组")
	}
	if len(tags) > 12 {
		return errors.New("标签不能超过12个，请删除多余标签")
	}
	var sections []expertSection
	if input.DetailSections != "" && json.Unmarshal([]byte(input.DetailSections), &sections) != nil {
		return errors.New("介绍弹窗区块格式无效，请刷新页面后重新填写")
	}
	if len(sections) > 8 {
		return errors.New("介绍弹窗区块不能超过8个")
	}
	return nil
}

func expertWebFromInput(input expertWebInput) model.ExpertWebProfile {
	profile := model.ExpertWebProfile{
		Key: input.Key, Name: strings.TrimSpace(input.Name), Subtitle: strings.TrimSpace(input.Subtitle), Category: strings.TrimSpace(input.Category), Summary: strings.TrimSpace(input.Summary), Icon: input.Icon, Tags: input.Tags, Scenario: input.Scenario, Materials: input.Materials, DetailSections: input.DetailSections, FooterNote: strings.TrimSpace(input.FooterNote), Provider: strings.TrimSpace(input.Provider), WorkbenchURL: input.WorkbenchURL, SortOrder: input.SortOrder,
	}
	profile.RequiresInternet = input.RequiresInternet
	return profile
}

// ListExpertWebCatalog returns published websites without exposing provider secrets.
func ListExpertWebCatalog(c *gin.Context) {
	var items []model.ExpertWebProfile
	if err := expertWebCatalogQuery(model.DB).Where("published = ?", true).Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取专家目录失败"})
		return
	}
	var categories []model.ExpertCategory
	if err := model.DB.Order(model.CatalogOrder("") + ", id DESC").Find(&categories).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取专家分类失败"})
		return
	}
	positions := make(map[string]int, len(categories))
	for index, category := range categories {
		positions[category.Name] = index
	}
	for index := range items {
		position, exists := positions[items[index].Category]
		if !exists {
			position = len(categories)
		}
		items[index].CategoryOrder = position
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

// AdminListExpertWebsites lists draft and published website registrations.
func AdminListExpertWebsites(c *gin.Context) {
	var items []model.ExpertWebProfile
	if err := expertWebCatalogQuery(model.DB).Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取专家失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": items})
}

// AdminCreateExpertWebsite registers a draft and returns its provider secret once.
func AdminCreateExpertWebsite(c *gin.Context) {
	var input expertWebInput
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "提交的数据格式错误，请刷新页面后重新填写专家资料"})
		return
	}
	if err := validateExpertWebInput(input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err := model.ValidateExpertCategory(input.Category); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	var existing int64
	if err := model.DB.Model(&model.ExpertWebProfile{}).Where(clause.Eq{Column: "key", Value: input.Key}).Count(&existing).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "无法检查专家编号，请检查数据库服务后重试"})
		return
	}
	if existing > 0 {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": "专家编号已存在，请更换编号"})
		return
	}
	secret, err := expertWebRandom()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "生成接入凭据失败"})
		return
	}
	profile := expertWebFromInput(input)
	profile.ProviderSecretHash = expertWebDigest(secret)
	if err := model.DB.Create(&profile).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存专家资料失败，请稍后重试或检查数据库服务"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": profile, "provider_credential": secret})
}

// AdminUpdateExpertWebsite updates presentation and launch URL without rotating the provider secret.
func AdminUpdateExpertWebsite(c *gin.Context) {
	var input expertWebInput
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "专家资料格式无效"})
		return
	}
	input.Key = c.Param("key")
	if err := validateExpertWebInput(input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err := model.ValidateExpertCategory(input.Category); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	var profile model.ExpertWebProfile
	if err := model.DB.Where(clause.Eq{Column: "key", Value: input.Key}).First(&profile).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "专家不存在"})
		return
	}
	updated := expertWebFromInput(input)
	if input.RequiresInternet == nil {
		updated.RequiresInternet = profile.RequiresInternet
	}
	if err := model.DB.Model(&profile).Updates(map[string]interface{}{"name": updated.Name, "subtitle": updated.Subtitle, "category": updated.Category, "summary": updated.Summary, "icon": updated.Icon, "tags": updated.Tags, "scenario": updated.Scenario, "materials": updated.Materials, "detail_sections": updated.DetailSections, "footer_note": updated.FooterNote, "provider": updated.Provider, "workbench_url": updated.WorkbenchURL, "sort_order": updated.SortOrder, "requires_internet": updated.RequiresInternet}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存专家失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// AdminDeleteExpertWebsite removes the registration and launch tickets while retaining usage history.
func AdminDeleteExpertWebsite(c *gin.Context) {
	key := c.Param("key")
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Where(clause.Eq{Column: "key", Value: key}).Delete(&model.ExpertWebProfile{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return tx.Where("expert_key = ?", key).Delete(&model.ExpertWebTicket{}).Error
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "专家不存在"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "删除专家失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// AdminPublishExpertWebsite changes whether the website appears in the desktop catalog.
func AdminPublishExpertWebsite(c *gin.Context) {
	var input struct {
		Published bool `json:"published"`
	}
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "上下架状态无效"})
		return
	}
	result := model.DB.Model(&model.ExpertWebProfile{}).Where(clause.Eq{Column: "key", Value: c.Param("key")}).Update("published", input.Published)
	if result.Error != nil || result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "专家不存在或保存失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// AdminRotateExpertWebCredential invalidates the previous provider credential immediately.
func AdminRotateExpertWebCredential(c *gin.Context) {
	secret, err := expertWebRandom()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "生成接入凭据失败"})
		return
	}
	result := model.DB.Model(&model.ExpertWebProfile{}).Where(clause.Eq{Column: "key", Value: c.Param("key")}).Update("provider_secret_hash", expertWebDigest(secret))
	if result.Error != nil || result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "专家不存在或保存失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "provider_credential": secret})
}

// LaunchExpertWebsite creates an opaque, one-use credential for the selected website.
func LaunchExpertWebsite(c *gin.Context) {
	userID := c.GetInt("id")
	if userID <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	var profile model.ExpertWebProfile
	if err := model.DB.Where(clause.Eq{Column: "key", Value: c.Param("key")}).Where("published = ?", true).First(&profile).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "专家未上架"})
		return
	}
	ticket, err := expertWebRandom()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "生成登录票据失败"})
		return
	}
	now := time.Now()
	// Only expired login records are removed; active tickets remain exchangeable.
	if err := model.DB.Where("expires_at <= ?", now.Unix()).Delete(&model.ExpertWebTicket{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "登录票据维护失败"})
		return
	}
	record := model.ExpertWebTicket{Hash: expertWebDigest(ticket), ExpertKey: profile.Key, UserID: userID, ExpiresAt: now.Add(expertTicketLifetime).Unix()}
	if err := model.DB.Create(&record).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存登录票据失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "url": profile.WorkbenchURL, "ticket": ticket, "expires_in": int(expertTicketLifetime.Seconds())})
}

// RedeemExpertWebTicket atomically consumes a ticket for its registered provider.
func RedeemExpertWebTicket(c *gin.Context) {
	var input struct {
		Ticket string `json:"ticket"`
	}
	if c.ShouldBindJSON(&input) != nil || !expertCredentialPattern.MatchString(input.Ticket) {
		c.JSON(http.StatusBadRequest, gin.H{"message": "票据格式无效"})
		return
	}
	authorization := c.GetHeader("Authorization")
	credential := strings.TrimPrefix(authorization, "Bearer ")
	if !strings.HasPrefix(authorization, "Bearer ") || !expertCredentialPattern.MatchString(credential) {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "提供方凭据无效"})
		return
	}
	var userID int
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		var ticket model.ExpertWebTicket
		if err := tx.First(&ticket, "hash = ?", expertWebDigest(input.Ticket)).Error; err != nil {
			return err
		}
		var profile model.ExpertWebProfile
		if err := tx.Where(clause.Eq{Column: "key", Value: ticket.ExpertKey}).Where("published = ?", true).First(&profile).Error; err != nil {
			return err
		}
		provided := expertWebDigest(credential)
		if subtle.ConstantTimeCompare([]byte(provided), []byte(profile.ProviderSecretHash)) != 1 {
			return errors.New("provider mismatch")
		}
		result := tx.Model(&model.ExpertWebTicket{}).Where("hash = ? AND consumed = ? AND expires_at > ?", ticket.Hash, false, time.Now().Unix()).Update("consumed", true)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("ticket expired or used")
		}
		userID = ticket.UserID
		return nil
	})
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "票据无效、已过期或已使用"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user_id": strconv.Itoa(userID)})
}

// expertWebCatalogQuery quotes the reserved key column for every supported SQL dialect.
func expertWebCatalogQuery(db *gorm.DB) *gorm.DB {
	return db.Order(model.CatalogOrder("")).
		Order(clause.OrderByColumn{Column: clause.Column{Name: "key"}, Desc: true})
}
