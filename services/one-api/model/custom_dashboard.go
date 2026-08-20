package model

type CustomDashboardChart struct {
	Id        int    `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId    int    `json:"user_id" gorm:"index;not null"`
	Title     string `json:"title" gorm:"size:200;not null"`
	Config    string `json:"config" gorm:"type:text;not null"`
	CreatedAt int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

func ListCustomDashboardCharts(userId int) ([]*CustomDashboardChart, error) {
	var charts []*CustomDashboardChart
	err := DB.Where("user_id = ?", userId).Order("created_at ASC").Find(&charts).Error
	return charts, err
}

func CreateCustomDashboardChart(chart *CustomDashboardChart) error {
	return DB.Create(chart).Error
}

func UpdateCustomDashboardChart(chart *CustomDashboardChart) error {
	return DB.Model(&CustomDashboardChart{}).
		Where("id = ? AND user_id = ?", chart.Id, chart.UserId).
		Updates(map[string]interface{}{
			"title":  chart.Title,
			"config": chart.Config,
		}).Error
}

func DeleteCustomDashboardChart(userId, id int) error {
	return DB.Where("id = ? AND user_id = ?", id, userId).Delete(&CustomDashboardChart{}).Error
}
