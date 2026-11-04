package model

import (
	"fmt"
	"github.com/songquanpeng/one-api/common/config"
	"strconv"
	"strings"
)

// ResolveRegistrationRole selects only an enabled ordinary role. Blank configuration
// selects the existing 注册用户 role by name; it never creates or elevates a role.
func ResolveRegistrationRole(value string) (int, error) {
	var role Role
	query := DB.Where("name = ?", "注册用户")
	if strings.TrimSpace(value) != "" {
		code, err := strconv.Atoi(value)
		if err != nil || code < RoleCommonUser || code >= RoleAdminUser {
			return 0, fmt.Errorf("注册默认角色必须是普通成员角色")
		}
		query = DB.Where("role = ?", code)
	}
	if err := query.First(&role).Error; err != nil {
		return 0, fmt.Errorf("注册默认角色未配置或不存在，请联系管理员")
	}
	if role.Status != 1 || role.Role < RoleCommonUser || role.Role >= RoleAdminUser {
		return 0, fmt.Errorf("注册默认角色已停用或不属于普通成员")
	}
	return role.Role, nil
}

// AssignRegistrationRole applies the configured role only to an explicitly new public registration.
func AssignRegistrationRole(user *User) error {
	config.OptionMapRWMutex.RLock()
	value := config.OptionMap["RegistrationDefaultRole"]
	config.OptionMapRWMutex.RUnlock()
	role, err := ResolveRegistrationRole(value)
	if err != nil {
		return err
	}
	user.Role = role
	return nil
}

// Protect the configured registration destination from accidental deletion or disabling.
func registrationRoleSelection() (int, string) {
	config.OptionMapRWMutex.RLock()
	value := config.OptionMap["RegistrationDefaultRole"]
	config.OptionMapRWMutex.RUnlock()
	if DB == nil {
		return 0, value
	}
	role, _ := ResolveRegistrationRole(value)
	return role, value
}
