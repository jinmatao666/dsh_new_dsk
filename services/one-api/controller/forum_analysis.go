package controller

import (
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/model"
	"gorm.io/gorm"
)

type forumPrice struct {
	Credits string `json:"credits"`
	Version int64  `json:"version"`
}

// GetForumCreditSettings exposes the two fixed, versioned charge points.
func GetForumCreditSettings(c *gin.Context) {
	rules, err := model.EnsureForumRules(model.DB)
	if err != nil {
		billingError(c, err)
		return
	}
	data := gin.H{}
	for _, rule := range rules {
		data[rule.Action] = gin.H{"credits": float64(rule.UnitQuota) / config.QuotaPerUnit, "version": rule.Version}
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"success": true, "data": data})
}

// PutForumCreditSettings changes both prices atomically and rejects stale administrators.
func PutForumCreditSettings(c *gin.Context) {
	var input struct {
		QA     forumPrice `json:"qa"`
		Report forumPrice `json:"report"`
	}
	if c.ShouldBindJSON(&input) != nil {
		billingError(c, errors.New("INVALID_REQUEST"))
		return
	}
	qa, err := model.BillingPointsQuota(input.QA.Credits)
	if err != nil {
		billingError(c, err)
		return
	}
	report, err := model.BillingPointsQuota(input.Report.Credits)
	if err != nil {
		billingError(c, err)
		return
	}
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		if _, err := model.EnsureForumRules(tx); err != nil {
			return err
		}
		for _, point := range []struct {
			action         string
			quota, version int64
		}{{"qa", qa, input.QA.Version}, {"report", report, input.Report.Version}} {
			changed := tx.Model(&model.BillingRule{}).Where("kind = ? AND item_id = ? AND action = ? AND version = ?", model.BillingKindForum, "default", point.action, point.version).Updates(map[string]interface{}{"unit_quota": point.quota, "enabled": true, "version": point.version + 1})
			if changed.Error != nil {
				return changed.Error
			}
			if changed.RowsAffected != 1 {
				return errors.New("PRICE_CHANGED")
			}
		}
		return nil
	})
	if err != nil {
		billingError(c, err)
		return
	}
	GetForumCreditSettings(c)
}

type forumQuestion struct {
	Item struct {
		ID   string `json:"id"`
		Type string `json:"type"`
	} `json:"item"`
	Question string `json:"question"`
	Action   string `json:"action"`
}

func (input *forumQuestion) key() (string, error) {
	input.Action = "qa"
	if forumReportIntent.MatchString(strings.Join(strings.Fields(input.Question), "")) {
		input.Action = "report"
	}
	return model.ForumQuestionKey(input.Item.Type, input.Item.ID, input.Question, input.Action)
}

var forumReportIntent = regexp.MustCompile(`(?i)(生成|撰写|编写|写|起草|出具|输出|制作|形成|做|产出|拟写|整理).{0,30}(报告|研报)|(报告|研报).{0,12}(生成|撰写|编写|起草|制作)|(generate|write|draft|create|produce).{0,50}report`)

// QuoteForumAnalysis resolves the action and current price before reservation.
func QuoteForumAnalysis(c *gin.Context) {
	var input forumQuestion
	if c.ShouldBindJSON(&input) != nil {
		billingError(c, errors.New("INVALID_REQUEST"))
		return
	}
	key, err := input.key()
	if err != nil {
		billingError(c, err)
		return
	}
	rules, err := model.EnsureForumRules(model.DB)
	if err != nil {
		billingError(c, err)
		return
	}
	var existing model.ForumAnalysis
	err = model.DB.Where("user_id = ? AND question_key = ? AND state = ?", c.GetInt("id"), key, "succeeded").First(&existing).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		billingError(c, err)
		return
	}
	for _, rule := range rules {
		if rule.Action != input.Action {
			continue
		}
		credits := float64(rule.UnitQuota) / config.QuotaPerUnit
		if config.CreditsDisabled() || existing.ID != "" || !rule.Enabled {
			credits = 0
		}
		c.Header("Cache-Control", "no-store")
		c.JSON(200, gin.H{"success": true, "data": gin.H{"credits": credits, "version": rule.Version, "cached": existing.ID != "", "action": input.Action}})
		return
	}
	billingError(c, errors.New("INVALID_REQUEST"))
}

// BeginForumAnalysis reserves a fee for the authenticated account, never an iframe-supplied user ID.
func BeginForumAnalysis(c *gin.Context) {
	var input struct {
		forumQuestion
		SessionID    string `json:"session_id"`
		ManagedModel string `json:"managed_model"`
		Version      int64  `json:"version"`
	}
	if c.ShouldBindJSON(&input) != nil || len(input.SessionID) < 16 || len(input.SessionID) > 128 || len(input.ManagedModel) > 200 {
		billingError(c, errors.New("INVALID_REQUEST"))
		return
	}
	key, err := input.key()
	if err != nil {
		billingError(c, err)
		return
	}
	result, lease, err := model.BeginForumAnalysis(c.GetInt("id"), key, input.Action, input.SessionID, input.ManagedModel, input.Version)
	if err != nil {
		forumAnalysisError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"success": true, "data": result, "lease": lease})
}

// FinishForumAnalysis saves a successful answer and settles the same unified billing task.
func FinishForumAnalysis(c *gin.Context) {
	var input struct {
		Lease    string `json:"lease"`
		Status   string `json:"status"`
		Text     string `json:"text"`
		Provider string `json:"provider"`
		Model    string `json:"model"`
	}
	if c.ShouldBindJSON(&input) != nil || len(input.Lease) != 72 {
		billingError(c, errors.New("INVALID_REQUEST"))
		return
	}
	result, err := model.FinishForumAnalysis(c.GetInt("id"), c.Param("id"), input.Lease, input.Status, input.Text, input.Provider, input.Model)
	if err != nil {
		forumAnalysisError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"success": true, "data": result})
}

func forumAnalysisError(c *gin.Context, err error) {
	if strings.Contains(err.Error(), "ANALYSIS_PENDING") {
		c.JSON(http.StatusConflict, gin.H{"success": false, "code": "ANALYSIS_PENDING", "message": "相同问题正在分析中，请稍后重试"})
		return
	}
	billingError(c, err)
}
