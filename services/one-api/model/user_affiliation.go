package model

import "strings"

// UpdateUserAffiliation is administrator-owned profile data, independent of billing.
// Nil preserves an existing field; an explicit empty string clears it.
func UpdateUserAffiliation(userID int, unitName, departmentName *string) error {
	updates := map[string]interface{}{}
	if unitName != nil {
		updates["unit_name"] = strings.TrimSpace(*unitName)
	}
	if departmentName != nil {
		updates["department_name"] = strings.TrimSpace(*departmentName)
	}
	if len(updates) == 0 {
		return nil
	}
	return DB.Model(&User{}).Where("id = ?", userID).Updates(updates).Error
}
