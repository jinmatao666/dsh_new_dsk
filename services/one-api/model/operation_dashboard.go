package model

// OperationDashboard 运营看板配置（存储到操作人账号）
type OperationDashboard struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId    int    `json:"user_id" gorm:"index;not null"`
	Name      string `json:"name" gorm:"size:100;not null"`
	Config    string `json:"config" gorm:"type:text;not null"` // JSON: {dimension, target_id, period, metrics[]}
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

// ListOperationDashboards 获取用户的看板列表
func ListOperationDashboards(userId int) ([]*OperationDashboard, error) {
	var dashboards []*OperationDashboard
	err := DB.Where("user_id = ?", userId).Order("created_at ASC").Find(&dashboards).Error
	return dashboards, err
}

// CreateOperationDashboard 创建看板
func CreateOperationDashboard(dashboard *OperationDashboard) error {
	return DB.Create(dashboard).Error
}

// UpdateOperationDashboard 更新看板
func UpdateOperationDashboard(dashboard *OperationDashboard) error {
	return DB.Model(&OperationDashboard{}).
		Where("id = ? AND user_id = ?", dashboard.Id, dashboard.UserId).
		Updates(map[string]interface{}{
			"name":   dashboard.Name,
			"config": dashboard.Config,
		}).Error
}

// DeleteOperationDashboard 删除看板
func DeleteOperationDashboard(userId, id int) error {
	return DB.Where("id = ? AND user_id = ?", id, userId).Delete(&OperationDashboard{}).Error
}
