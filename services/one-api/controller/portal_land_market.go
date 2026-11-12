package controller

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

const portalTicketLifetime = 90 * time.Second

type portalFeature struct {
	key          string
	secretOption string
	label        string
}

var landMarketPortal = portalFeature{model.LandMarketFeatureKey, model.LandMarketProviderSecretOption, "土地市场"}
var planningLecturePortal = portalFeature{model.PlanningLectureFeatureKey, model.PlanningLectureProviderSecretOption, "资规讲坛"}

func portalProviderSecretHash(feature portalFeature) string {
	config.OptionMapRWMutex.RLock()
	defer config.OptionMapRWMutex.RUnlock()
	return strings.TrimSpace(config.OptionMap[feature.secretOption])
}

func portalConfiguredURL(feature portalFeature) (string, error) {
	config.OptionMapRWMutex.RLock()
	raw := config.OptionMap["SystemDeploymentSettings"]
	config.OptionMapRWMutex.RUnlock()
	settings, err := parseDesktopDeploymentSettings(raw)
	if err != nil {
		return "", err
	}
	page, ok := settings.FeaturePages[feature.key]
	if !ok {
		return "", errors.New("missing portal page")
	}
	url := strings.TrimSpace(page.URL)
	if url == "" {
		return "", errors.New("portal url empty")
	}
	if err := validateDesktopFeaturePageURL(url); err != nil {
		return "", err
	}
	return url, nil
}

// GetLandMarketCredentialStatus reports whether a provider credential exists (never returns the secret).
func GetLandMarketCredentialStatus(c *gin.Context) {
	getPortalCredentialStatus(c, landMarketPortal)
}

// GetPlanningLectureCredentialStatus reports whether the planning lecture provider has a credential.
func GetPlanningLectureCredentialStatus(c *gin.Context) {
	getPortalCredentialStatus(c, planningLecturePortal)
}

func getPortalCredentialStatus(c *gin.Context, feature portalFeature) {
	hash := portalProviderSecretHash(feature)
	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"configured": expertCredentialPattern.MatchString(hash),
	})
}

// RotateLandMarketCredential replaces the land-market provider credential; plaintext is shown once.
func RotateLandMarketCredential(c *gin.Context) {
	rotatePortalCredential(c, landMarketPortal)
}

// RotatePlanningLectureCredential replaces the planning lecture provider credential and shows it once.
func RotatePlanningLectureCredential(c *gin.Context) {
	rotatePortalCredential(c, planningLecturePortal)
}

func rotatePortalCredential(c *gin.Context, feature portalFeature) {
	secret, err := expertWebRandom()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "生成接入凭据失败"})
		return
	}
	if err := model.UpdateOption(feature.secretOption, expertWebDigest(secret)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存接入凭据失败"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"success": true, "provider_credential": secret})
}

// LaunchLandMarket creates a one-use ticket for the configured land-market page.
func LaunchLandMarket(c *gin.Context) {
	launchPortal(c, landMarketPortal)
}

// LaunchPlanningLecture issues a single-use ticket for the configured planning lecture page.
func LaunchPlanningLecture(c *gin.Context) {
	launchPortal(c, planningLecturePortal)
}

func launchPortal(c *gin.Context, feature portalFeature) {
	userID := c.GetInt("id")
	if userID <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "请先登录"})
		return
	}
	if !expertCredentialPattern.MatchString(portalProviderSecretHash(feature)) {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "请先在功能设置中生成" + feature.label + "接入凭据"})
		return
	}
	pageURL, err := portalConfiguredURL(feature)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "请先在功能设置中配置" + feature.label + "页面地址"})
		return
	}
	ticket, err := expertWebRandom()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "生成登录票据失败"})
		return
	}
	now := time.Now()
	if err := model.DB.Where("feature_key = ? AND expires_at <= ?", feature.key, now.Unix()).
		Delete(&model.PortalFeatureTicket{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "登录票据维护失败"})
		return
	}
	record := model.PortalFeatureTicket{
		Hash:       expertWebDigest(ticket),
		FeatureKey: feature.key,
		UserID:     userID,
		ExpiresAt:  now.Add(portalTicketLifetime).Unix(),
	}
	if err := model.DB.Create(&record).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存登录票据失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"url":        pageURL,
		"ticket":     ticket,
		"expires_in": int(portalTicketLifetime.Seconds()),
	})
}

// RedeemLandMarketTicket consumes a land-market ticket for its provider credential.
func RedeemLandMarketTicket(c *gin.Context) {
	redeemPortalTicket(c, landMarketPortal)
}

// RedeemPlanningLectureTicket exchanges a planning lecture ticket for user identity.
func RedeemPlanningLectureTicket(c *gin.Context) {
	redeemPortalTicket(c, planningLecturePortal)
}

func redeemPortalTicket(c *gin.Context, feature portalFeature) {
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
	expected := portalProviderSecretHash(feature)
	if !expertCredentialPattern.MatchString(expected) {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "提供方凭据无效"})
		return
	}
	provided := expertWebDigest(credential)
	if subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "提供方凭据无效"})
		return
	}

	var userID int
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		var ticket model.PortalFeatureTicket
		if err := tx.First(&ticket, "hash = ? AND feature_key = ?", expertWebDigest(input.Ticket), feature.key).Error; err != nil {
			return err
		}
		result := tx.Model(&model.PortalFeatureTicket{}).
			Where("hash = ? AND consumed = ? AND expires_at > ?", ticket.Hash, false, time.Now().Unix()).
			Update("consumed", true)
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
	payload := gin.H{"user_id": strconv.Itoa(userID)}
	if user, lookupErr := model.GetUserById(userID, false); lookupErr == nil && user != nil {
		username := strings.TrimSpace(user.Username)
		displayName := strings.TrimSpace(user.DisplayName)
		if username != "" {
			payload["username"] = username
		}
		if displayName != "" {
			payload["display_name"] = displayName
		} else if username != "" {
			payload["display_name"] = username
		}
	}
	c.JSON(http.StatusOK, payload)
}
