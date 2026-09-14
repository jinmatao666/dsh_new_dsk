package model

import (
	"encoding/json"
	"fmt"
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

// CreateRole creates a new role definition. The caller supplies the role code
// because it is the value persisted directly on users.role.
func CreateRole(role *Role) error {
	if role.Role <= RoleGuestUser {
		return fmt.Errorf("角色编号必须大于 0")
	}
	if role.Role >= RoleAdminUser && role.Role != RoleRootUser {
		return fmt.Errorf("角色编号 10 及以上保留给系统管理权限")
	}
	if role.Name == "" {
		return fmt.Errorf("角色名称不能为空")
	}
	if len(role.Permissions) == 0 {
		role.Permissions = defaultRolePermissions()
	}
	return DB.Create(role).Error
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
