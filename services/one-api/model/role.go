package model

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm/clause"
)

// Role stores the configuration addressed by User.Role. Permissions is
// intentionally extensible; models is its first supported entry.
type Role struct {
	Role        int             `json:"role" gorm:"primaryKey;comment:与users.role对应的角色编号"`
	Name        string          `json:"name" gorm:"size:64;not null;uniqueIndex"`
	Description string          `json:"description" gorm:"size:255;default:''"`
	Permissions json.RawMessage `json:"permissions" gorm:"type:json;not null"`
	Status      int             `json:"status" gorm:"default:1;index"`
	IsBuiltin   bool            `json:"is_builtin" gorm:"default:false"`
	CreatedAt   time.Time       `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time       `json:"updated_at" gorm:"autoUpdateTime"`
}

// RolePermissions is the currently supported subset of a role configuration.
type RolePermissions struct {
	Models []string `json:"models"`
}

func defaultRolePermissions() json.RawMessage {
	return json.RawMessage(`{}`)
}

// ListRoles returns all active and disabled role definitions for administration.
func ListRoles() ([]Role, error) {
	var roles []Role
	err := DB.Order("role ASC").Find(&roles).Error
	return roles, err
}

// GetRole returns one role definition by the number stored on users.role.
func GetRole(role int) (*Role, error) {
	var result Role
	if err := DB.First(&result, "role = ?", role).Error; err != nil {
		return nil, err
	}
	return &result, nil
}

// CreateRole 在现有权限区间内分配编号，不允许客户端创建超级管理员。
func CreateRole(role *Role, roleType string) error {
	first, limit := RoleCommonUser+1, RoleAdminUser
	switch roleType {
	case "member":
	case "admin":
		first, limit = RoleAdminUser, RoleRootUser
	default:
		return fmt.Errorf("请选择普通成员或管理员")
	}
	role.Name = strings.TrimSpace(role.Name)
	if role.Name == "" {
		return fmt.Errorf("角色名称不能为空")
	}
	if len([]rune(role.Name)) > 64 || len([]rune(role.Description)) > 255 {
		return fmt.Errorf("角色名称最多 64 字，说明最多 255 字")
	}
	role.IsBuiltin = false
	if len(role.Permissions) == 0 {
		role.Permissions = defaultRolePermissions()
	}
	for code := first; code < limit; code++ {
		var used int64
		// 历史账号可能没有对应的角色定义，也不能占用它的权限编号。
		if err := DB.Unscoped().Model(&User{}).Where("role = ?", code).Count(&used).Error; err != nil {
			return err
		}
		if used > 0 {
			continue
		}
		role.Role = code
		result := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(role)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected > 0 {
			return nil
		}
		// 唯一约束同时处理并发分配与名称重复，避免返回数据库内部错误。
		var names int64
		if err := DB.Model(&Role{}).Where("name = ?", role.Name).Count(&names).Error; err != nil {
			return err
		}
		if names > 0 {
			return fmt.Errorf("角色名称已存在，请换一个名称")
		}
	}
	return fmt.Errorf("该类型的角色编号已用完，请先清理未使用的自定义角色")
}

// DeleteRole 保护内置角色及仍被账号引用的角色，不修改账号权限。
func DeleteRole(code int) error {
	if code <= RoleCommonUser || code >= RoleRootUser {
		return fmt.Errorf("内置角色不能删除")
	}
	result := DB.Where("role = ? AND is_builtin = ?", code, false).
		Where("NOT EXISTS (SELECT 1 FROM users WHERE users.role = ?)", code).Delete(&Role{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return fmt.Errorf("角色不存在、属于内置角色或仍有用户使用，请先调整用户角色")
	}
	return nil
}

// UpdateRole updates mutable role metadata and permissions without changing its code.
func UpdateRole(role *Role) error {
	if role.Role <= RoleGuestUser {
		return fmt.Errorf("角色编号必须大于 0")
	}
	if role.Name == "" {
		return fmt.Errorf("角色名称不能为空")
	}
	if len(role.Permissions) == 0 {
		role.Permissions = defaultRolePermissions()
	}
	return DB.Model(&Role{}).Where("role = ?", role.Role).Updates(map[string]interface{}{
		"name": role.Name, "description": role.Description, "permissions": role.Permissions, "status": role.Status,
	}).Error
}

// SeedBuiltinRoles creates definitions for the role values already used by users.
func SeedBuiltinRoles() error {
	roles := []Role{
		{Role: RoleCommonUser, Name: "普通成员", Description: "适用于日常使用。", Permissions: defaultRolePermissions(), Status: 1, IsBuiltin: true},
		{Role: RoleRootUser, Name: "超级管理员", Description: "系统超级管理员。", Permissions: defaultRolePermissions(), Status: 1, IsBuiltin: true},
	}
	return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&roles).Error
}

// RoleAllowsModel reports whether a role has explicitly configured model access
// and, when it has, whether the named model is included. A missing models entry
// preserves the existing group-based model policy until an administrator saves
// the first model configuration for that role.
func RoleAllowsModel(roleCode int, modelName string) (configured bool, allowed bool, err error) {
	models, configured, err := GetRoleModels(roleCode)
	if err != nil || !configured {
		return configured, configured == false, err
	}
	for _, allowedModel := range models {
		if allowedModel == "*" || allowedModel == modelName {
			return true, true, nil
		}
	}
	return true, false, nil
}

// GetRoleModels returns the explicit model allow-list for a role. A false
// configured value means the role still inherits the existing group policy.
func GetRoleModels(roleCode int) (models []string, configured bool, err error) {
	role, err := GetRole(roleCode)
	if err != nil {
		return nil, false, err
	}
	var permissions map[string]json.RawMessage
	if err = json.Unmarshal(role.Permissions, &permissions); err != nil {
		return nil, false, err
	}
	rawModels, configured := permissions["models"]
	if !configured {
		return nil, false, nil
	}
	if err = json.Unmarshal(rawModels, &models); err != nil {
		return nil, false, err
	}
	return models, true, nil
}
