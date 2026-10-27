package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

// GovernmentOrganizationNode 是独立于企业账务组织的政务组织树节点。
// ParentID 为 0 表示顶层；节点类型由管理员填写，不限定树的深度。
type GovernmentOrganizationNode struct {
	ID        uint      `json:"id" gorm:"primaryKey"`
	ParentID  uint      `json:"parent_id" gorm:"not null;default:0;index"`
	Name      string    `json:"name" gorm:"size:120;not null"`
	Kind      string    `json:"kind" gorm:"size:60;not null;default:''"`
	SortOrder int       `json:"sort_order" gorm:"not null;default:0"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ListGovernmentOrganizationNodes 返回用于后台树和角色选择器的完整节点列表。
func ListGovernmentOrganizationNodes() ([]GovernmentOrganizationNode, error) {
	var nodes []GovernmentOrganizationNode
	err := DB.Order("parent_id ASC, sort_order ASC, id ASC").Find(&nodes).Error
	return nodes, err
}

// SaveGovernmentOrganizationNode 新建或修改节点，拒绝孤儿节点和循环引用。
func SaveGovernmentOrganizationNode(node *GovernmentOrganizationNode) error {
	node.Name = strings.TrimSpace(node.Name)
	node.Kind = strings.TrimSpace(node.Kind)
	if node.Name == "" || len([]rune(node.Name)) > 120 || len([]rune(node.Kind)) > 60 {
		return errors.New("名称不能为空且最多 120 字，类型最多 60 字")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if node.ID != 0 {
			var existing GovernmentOrganizationNode
			if err := tx.First(&existing, node.ID).Error; err != nil {
				return errors.New("组织节点不存在")
			}
		}
		seen := map[uint]bool{}
		for parentID := node.ParentID; parentID != 0; {
			if parentID == node.ID || seen[parentID] {
				return errors.New("不能将节点移动到自身或下级节点")
			}
			seen[parentID] = true
			var parent GovernmentOrganizationNode
			if err := tx.First(&parent, parentID).Error; err != nil {
				return errors.New("上级组织节点不存在")
			}
			parentID = parent.ParentID
		}
		if node.ID == 0 {
			return tx.Create(node).Error
		}
		return tx.Model(&GovernmentOrganizationNode{}).Where("id = ?", node.ID).Updates(map[string]interface{}{
			"parent_id": node.ParentID, "name": node.Name, "kind": node.Kind, "sort_order": node.SortOrder,
		}).Error
	})
}

// DeleteGovernmentOrganizationNode 仅删除没有下级且未被角色引用的叶节点。
func DeleteGovernmentOrganizationNode(id uint) error {
	if id == 0 {
		return errors.New("组织节点不存在")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var children int64
		if err := tx.Model(&GovernmentOrganizationNode{}).Where("parent_id = ?", id).Count(&children).Error; err != nil {
			return err
		}
		if children != 0 {
			return errors.New("请先删除下级节点")
		}
		var roles []Role
		if err := tx.Select("role", "permissions").Find(&roles).Error; err != nil {
			return err
		}
		for _, role := range roles {
			var permissions RolePermissions
			if err := json.Unmarshal(role.Permissions, &permissions); err != nil {
				return fmt.Errorf("角色 %d 的权限数据无效", role.Role)
			}
			for _, assignedID := range permissions.OrganizationNodeIDs {
				if assignedID == id {
					return errors.New("该节点仍被角色使用，请先调整角色的组织范围")
				}
			}
		}
		result := tx.Delete(&GovernmentOrganizationNode{}, id)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return errors.New("组织节点不存在")
		}
		return nil
	})
}

// ValidateGovernmentOrganizationNodes 检查角色引用的节点确实存在。
func ValidateGovernmentOrganizationNodes(ids []uint) error {
	if len(ids) == 0 {
		return nil
	}
	seen := make(map[uint]bool, len(ids))
	for _, id := range ids {
		if id == 0 || seen[id] {
			return errors.New("组织节点编号无效或重复")
		}
		seen[id] = true
	}
	var count int64
	if err := DB.Model(&GovernmentOrganizationNode{}).Where("id IN ?", ids).Count(&count).Error; err != nil {
		return err
	}
	if count != int64(len(ids)) {
		return errors.New("所选组织节点不存在，请刷新后重试")
	}
	return nil
}
