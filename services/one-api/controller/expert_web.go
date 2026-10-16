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
	Key            string `json:"key"`
	Name           string `json:"name"`
	Subtitle       string `json:"subtitle"`
	Category       string `json:"category"`
	Summary        string `json:"summary"`
	Icon           string `json:"icon"`
	Tags           string `json:"tags"`
	Scenario       string `json:"scenario"`
	Materials      string `json:"materials"`
	DetailSections string `json:"detail_sections"`
	FooterNote     string `json:"footer_note"`
	Provider       string `json:"provider"`
	WorkbenchURL   string `json:"workbench_url"`
	SortOrder      int    `json:"sort_order"`
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
	if !expertKeyPattern.MatchString(input.Key) || strings.TrimSpace(input.Name) == "" || len([]rune(input.Name)) > 100 || len([]rune(input.Summary)) > 500 || len([]rune(input.FooterNote)) > 500 || strings.TrimSpace(input.Provider) == "" || len([]rune(input.Provider)) > 100 {
		return errors.New("专家编号、名称、提供方或简介无效")
	}
	if !validExpertWebIcon(input.Icon) {
		return errors.New("专家图标格式无效或超过 60 KB")
	}
	address, err := url.Parse(input.WorkbenchURL)
	if err != nil || (address.Scheme != "http" && address.Scheme != "https") || address.Hostname() == "" || address.User != nil || address.Fragment != "" || address.Opaque != "" {
		return errors.New("工作台必须使用有效的 HTTP 或 HTTPS 地址")
	}
	var tags []string
	if err := json.Unmarshal([]byte(input.Tags), &tags); err != nil || len(tags) > 12 {
		return errors.New("标签格式无效")
	}
	var sections []expertSection
	if input.DetailSections != "" && (json.Unmarshal([]byte(input.DetailSections), &sections) != nil || len(sections) > 8) {
		return errors.New("介绍区块格式无效")
	}
	return nil
}

func expertWebFromInput(input expertWebInput) model.ExpertWebProfile {
	return model.ExpertWebProfile{
		Key: input.Key, Name: strings.TrimSpace(input.Name), Subtitle: strings.TrimSpace(input.Subtitle), Category: strings.TrimSpace(input.Category), Summary: strings.TrimSpace(input.Summary), Icon: input.Icon, Tags: input.Tags, Scenario: input.Scenario, Materials: input.Materials, DetailSections: input.DetailSections, FooterNote: strings.TrimSpace(input.FooterNote), Provider: strings.TrimSpace(input.Provider), WorkbenchURL: input.WorkbenchURL, SortOrder: input.SortOrder,
	}
}

// ListExpertWebCatalog returns published websites without exposing provider secrets.
func ListExpertWebCatalog(c *gin.Context) {
	var items []model.ExpertWebProfile
	if err := expertWebCatalogQuery(model.DB).Where("published = ?", true).Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "读取专家目录失败"})
		return
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
	if c.ShouldBindJSON(&input) != nil || validateExpertWebInput(input) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "专家资料无效，请检查编号、HTTP/HTTPS 地址和展示资料"})
		return
	}
	if err := model.ValidateExpertCategory(input.Category); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
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
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": "专家编号已存在或无法保存"})
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
	if validateExpertWebInput(input) != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "专家资料无效，请检查 HTTP/HTTPS 地址和展示资料"})
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
	if err := model.DB.Model(&profile).Updates(map[string]interface{}{"name": updated.Name, "subtitle": updated.Subtitle, "category": updated.Category, "summary": updated.Summary, "icon": updated.Icon, "tags": updated.Tags, "scenario": updated.Scenario, "materials": updated.Materials, "detail_sections": updated.DetailSections, "footer_note": updated.FooterNote, "provider": updated.Provider, "workbench_url": updated.WorkbenchURL, "sort_order": updated.SortOrder}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存专家失败"})
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
	return db.Order(clause.OrderByColumn{Column: clause.Column{Name: "sort_order"}}).
		Order(clause.OrderByColumn{Column: clause.Column{Name: "key"}})
}
