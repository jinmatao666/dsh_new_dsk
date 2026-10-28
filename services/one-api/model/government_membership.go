package model

import (
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// GovernmentOrganizationMember records direct membership independently from permission roles.
type GovernmentOrganizationMember struct {
	UserID int  `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	NodeID uint `json:"node_id" gorm:"primaryKey;autoIncrement:false;index"`
}

// GovernmentMemberDirectory exposes only account labels and direct organization assignments.
type GovernmentMemberDirectory struct {
	Users       []GovernmentMemberUser         `json:"users"`
	Memberships []GovernmentOrganizationMember `json:"memberships"`
}
type GovernmentMemberUser struct {
	ID          int    `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
}

func ListGovernmentMembers() (GovernmentMemberDirectory, error) {
	result := GovernmentMemberDirectory{Users: []GovernmentMemberUser{}, Memberships: []GovernmentOrganizationMember{}}
	var users []*User
	if err := DB.Select("id", "username", "display_name").Where("status != ?", UserStatusDeleted).Order("id").Find(&users).Error; err != nil {
		return result, err
	}
	OverlayUsersIdentity(users)
	for _, user := range users {
		result.Users = append(result.Users, GovernmentMemberUser{user.Id, user.Username, user.DisplayName})
	}
	err := DB.Order("node_id, user_id").Find(&result.Memberships).Error
	return result, err
}

// SaveGovernmentMemberships replaces one user's organizations or one node's members, preserving other affiliations.
func SaveGovernmentMemberships(userID int, nodeID uint, ids []uint) error {
	if userID < 0 || (userID > 0) == (nodeID > 0) {
		return errors.New("请选择一个用户或组织节点")
	}
	seen := map[uint]bool{}
	for _, id := range ids {
		if id == 0 || seen[id] {
			return errors.New("编号无效或重复")
		}
		seen[id] = true
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if userID > 0 {
			var user User
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND status != ?", userID, UserStatusDeleted).First(&user).Error; err != nil {
				return errors.New("用户不存在")
			}
			var count int64
			if len(ids) > 0 {
				if err := tx.Model(&GovernmentOrganizationNode{}).Where("id IN ?", ids).Count(&count).Error; err != nil {
					return err
				}
				if count != int64(len(ids)) {
					return errors.New("所选组织节点不存在")
				}
			}
			if err := tx.Where("user_id = ?", userID).Delete(&GovernmentOrganizationMember{}).Error; err != nil {
				return err
			}
			for _, id := range ids {
				if err := tx.Create(&GovernmentOrganizationMember{UserID: userID, NodeID: id}).Error; err != nil {
					return err
				}
			}
		} else {
			var node GovernmentOrganizationNode
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&node, nodeID).Error; err != nil {
				return errors.New("组织节点不存在")
			}
			var count int64
			if len(ids) > 0 {
				if err := tx.Model(&User{}).Where("id IN ? AND status != ?", ids, UserStatusDeleted).Count(&count).Error; err != nil {
					return err
				}
				if count != int64(len(ids)) {
					return errors.New("所选用户不存在或已删除")
				}
			}
			if err := tx.Where("node_id = ?", nodeID).Delete(&GovernmentOrganizationMember{}).Error; err != nil {
				return err
			}
			for _, id := range ids {
				if err := tx.Create(&GovernmentOrganizationMember{UserID: int(id), NodeID: nodeID}).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}
