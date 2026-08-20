package controller

import (
	"encoding/json"
	"io"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
)

func ListPersonalSkills(c *gin.Context) {
	username := c.GetString(ctxkey.Username)
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("perPage", "20"))
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}

	skills, total, err := model.GetPersonalSkillsByOwner(username, page, perPage)
	if err != nil {
		// 返回非 2xx，让前端 catch 分支感知错误并提示，而不是被当作空列表静默吞掉
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	totalPages := int(math.Ceil(float64(total) / float64(perPage)))
	c.JSON(http.StatusOK, gin.H{
		"page":       page,
		"perPage":    perPage,
		"totalPages": totalPages,
		"totalItems": total,
		"items":      skills,
	})
}

func GetPersonalSkill(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid id",
		})
		return
	}
	username := c.GetString(ctxkey.Username)
	skill, err := model.GetPersonalSkillById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	if skill.Owner != username {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "permission denied",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    skill,
	})
}

// GetPersonalSkillBundle returns body + assets for a personal skill,
// scoped to the calling user (plan §3.2/§3.4).
func GetPersonalSkillBundle(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid id",
		})
		return
	}
	username := c.GetString(ctxkey.Username)
	skill, err := model.GetPersonalSkillById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	if skill.Owner != username {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "permission denied",
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"body":              skill.EffectiveBody(),
			"assets":            skill.Assets,
			"body_updated_at":   skill.BodyUpdatedAt,
			"assets_updated_at": skill.AssetsUpdatedAt,
		},
	})
}

func CreatePersonalSkill(c *gin.Context) {
	raw, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid request: " + err.Error(),
		})
		return
	}
	var payload map[string]json.RawMessage
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &payload); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "invalid request: " + err.Error(),
			})
			return
		}
	} else {
		payload = map[string]json.RawMessage{}
	}

	var skill model.PersonalSkill
	now := time.Now().Unix()
	// allowOwner=false because user route always sets owner to caller below
	applyPersonalSkillPayload(&skill, payload, false, now)

	skill.Owner = c.GetString(ctxkey.Username)
	if skill.Name == "" {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "name is required",
		})
		return
	}
	skill.CreatedAt = now
	skill.UpdatedAt = now
	if err := model.CreatePersonalSkill(&skill); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    skill,
	})
}

func UpdatePersonalSkill(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid id",
		})
		return
	}
	username := c.GetString(ctxkey.Username)
	existing, err := model.GetPersonalSkillById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	if existing.Owner != username {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "permission denied",
		})
		return
	}

	raw, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid request: " + err.Error(),
		})
		return
	}
	var payload map[string]json.RawMessage
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &payload); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "invalid request: " + err.Error(),
			})
			return
		}
	} else {
		payload = map[string]json.RawMessage{}
	}

	now := time.Now().Unix()
	applyPersonalSkillPayload(existing, payload, false, now)

	existing.Id = id
	existing.Owner = username
	if err := model.UpdatePersonalSkill(existing); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    existing,
	})
}

func DeletePersonalSkill(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid id",
		})
		return
	}
	username := c.GetString(ctxkey.Username)
	existing, err := model.GetPersonalSkillById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	if existing.Owner != username {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "permission denied",
		})
		return
	}
	if err := model.DeletePersonalSkill(id); err != nil {
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
}

// AdminListPersonalSkills lists ALL users' personal skills with optional
// keyword + owner filters. Admin-only.
func AdminListPersonalSkills(c *gin.Context) {
	keyword := c.Query("keyword")
	owner := c.Query("owner")
	sortField := c.Query("sort_field")
	sortOrder := c.Query("sort_order")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("perPage", "20"))
	if page < 1 {
		page = 1
	}
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}

	skills, total, err := model.SearchPersonalSkillsSorted(keyword, owner, page, perPage, sortField, sortOrder)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	totalPages := int(math.Ceil(float64(total) / float64(perPage)))
	c.JSON(http.StatusOK, gin.H{
		"page":       page,
		"perPage":    perPage,
		"totalPages": totalPages,
		"totalItems": total,
		"items":      skills,
	})
}

// AdminGetPersonalSkill returns the full record (incl. body/assets/content)
// without owner-scope check. Admin-only.
func AdminGetPersonalSkill(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid id",
		})
		return
	}
	skill, err := model.GetPersonalSkillById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    skill,
	})
}

// AdminUpdatePersonalSkill updates a personal skill across owner boundaries.
// The `owner` field in the payload is IGNORED (we never re-assign cross-user).
func AdminUpdatePersonalSkill(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid id",
		})
		return
	}
	existing, err := model.GetPersonalSkillById(id)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	raw, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid request: " + err.Error(),
		})
		return
	}
	var payload map[string]json.RawMessage
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &payload); err != nil {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "invalid request: " + err.Error(),
			})
			return
		}
	} else {
		payload = map[string]json.RawMessage{}
	}

	now := time.Now().Unix()
	applyPersonalSkillPayload(existing, payload, false, now)
	existing.Id = id
	// existing.Owner left untouched — admin must NOT re-assign across users.

	if err := model.UpdatePersonalSkill(existing); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    existing,
	})
}

// AdminDeletePersonalSkill deletes a personal skill regardless of owner.
func AdminDeletePersonalSkill(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "invalid id",
		})
		return
	}
	if _, err := model.GetPersonalSkillById(id); err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	if err := model.DeletePersonalSkill(id); err != nil {
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
}

// applyPersonalSkillPayload mutates `existing` based on a JSON payload presence
// map, mirroring the field handling done in Create/UpdatePersonalSkill.
//
// Returns whether `content` was newly supplied (caller may need this to drive
// auto-split). Forces `existing.UpdatedAt = now` and refreshes
// BodyUpdatedAt / AssetsUpdatedAt when those fields appear.
//
// When allowOwner is false, the `owner` key in the payload is silently
// ignored — admin route uses this to prevent cross-user re-assignment.
func applyPersonalSkillPayload(existing *model.PersonalSkill, payload map[string]json.RawMessage, allowOwner bool, now int64) bool {
	if v, ok := payload["name"]; ok {
		_ = json.Unmarshal(v, &existing.Name)
	}
	if v, ok := payload["description"]; ok {
		_ = json.Unmarshal(v, &existing.Description)
	}
	if v, ok := payload["scenario"]; ok {
		_ = json.Unmarshal(v, &existing.Scenario)
	}
	if v, ok := payload["forked_from"]; ok {
		_ = json.Unmarshal(v, &existing.ForkedFrom)
	}
	if v, ok := payload["forked_from_updated"]; ok {
		_ = json.Unmarshal(v, &existing.ForkedFromUpdated)
	}
	if v, ok := payload["forked_from_content"]; ok {
		_ = json.Unmarshal(v, &existing.ForkedFromContent)
	}
	if v, ok := payload["forked_from_submitter"]; ok {
		_ = json.Unmarshal(v, &existing.ForkedFromSubmitter)
	}
	if v, ok := payload["tags"]; ok {
		existing.Tags = v
	}
	if allowOwner {
		if v, ok := payload["owner"]; ok {
			_ = json.Unmarshal(v, &existing.Owner)
		}
	}
	if v, ok := payload["content"]; ok {
		_ = json.Unmarshal(v, &existing.Content)
	}
	if v, ok := payload["body"]; ok {
		_ = json.Unmarshal(v, &existing.Body)
		existing.BodyUpdatedAt = now
	}
	if v, ok := payload["assets"]; ok {
		_ = json.Unmarshal(v, &existing.Assets)
		existing.AssetsUpdatedAt = now
	}

	_, hasContent := payload["content"]
	if hasContent {
		_, hasBody := payload["body"]
		_, hasAssets := payload["assets"]
		if !hasBody && !hasAssets {
			if body, assetsText := model.SplitContent(existing.Content); assetsText != "" {
				existing.Body = body
				existing.Assets = assetsText
				existing.BodyUpdatedAt = now
				existing.AssetsUpdatedAt = now
			} else {
				existing.Body = existing.Content
				existing.BodyUpdatedAt = now
			}
		}
	}

	existing.UpdatedAt = now
	return hasContent
}
