package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UserTag 用户标签定义
//
// 标签用于对用户分群进行二次归类：一个标签可关联多个人群(分群)，
// crowd_ids 以 JSON 数组形式存储分群 id（可为空，表示标签暂未关联任何人群）。
type UserTag struct {
	Id          int       `json:"id" gorm:"primaryKey;autoIncrement"`
	Name        string    `json:"name" gorm:"type:varchar(100);not null;index"`
	Description string    `json:"description" gorm:"type:text"`
	CrowdIds    string    `json:"crowd_ids" gorm:"type:text"` // JSON 数组，关联的分群 id
	CreatedAt   time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

// TableName 指定表名
func (UserTag) TableName() string {
	return "user_tags"
}

// ParseCrowdIds 解析关联人群 id 列表，空字符串返回空切片。
func (t *UserTag) ParseCrowdIds() ([]int, error) {
	if t.CrowdIds == "" {
		return []int{}, nil
	}
	var ids []int
	if err := json.Unmarshal([]byte(t.CrowdIds), &ids); err != nil {
		return nil, fmt.Errorf("解析关联人群失败: %v", err)
	}
	return ids, nil
}

// GetAllUserTags 获取所有标签列表（分页）。
func GetAllUserTags(offset, limit int) ([]*UserTag, int64, error) {
	var tags []*UserTag
	var total int64

	query := DB.Model(&UserTag{})
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	if limit > 0 {
		query = query.Limit(limit).Offset(offset)
	}

	err := query.Order("id desc").Find(&tags).Error
	return tags, total, err
}

// GetUserTagById 根据 id 获取标签。
func GetUserTagById(id int) (*UserTag, error) {
	var tag UserTag
	err := DB.First(&tag, id).Error
	if err != nil {
		return nil, err
	}
	return &tag, nil
}

// CreateUserTag 创建标签。
func CreateUserTag(tag *UserTag) error {
	if tag.Name == "" {
		return errors.New("标签名称不能为空")
	}
	if err := validateTagCrowdIds(tag); err != nil {
		return err
	}
	// 重名校验：标签名全局唯一。
	exists, err := isTagNameTaken(tag.Name, 0)
	if err != nil {
		return err
	}
	if exists {
		return errors.New("标签名已存在")
	}
	return DB.Create(tag).Error
}

// UpdateUserTag 更新标签。
func UpdateUserTag(tag *UserTag) error {
	if tag.Id == 0 {
		return errors.New("标签ID不能为空")
	}
	if tag.Name == "" {
		return errors.New("标签名称不能为空")
	}
	if err := validateTagCrowdIds(tag); err != nil {
		return err
	}
	// 重名校验：排除自身后标签名不可与他人重复。
	exists, err := isTagNameTaken(tag.Name, tag.Id)
	if err != nil {
		return err
	}
	if exists {
		return errors.New("标签名已存在")
	}
	// 使用 Select 显式更新字段，确保 description / crowd_ids 清空时也能落库。
	return DB.Model(&UserTag{}).Where("id = ?", tag.Id).
		Select("name", "description", "crowd_ids").
		Updates(map[string]interface{}{
			"name":        tag.Name,
			"description": tag.Description,
			"crowd_ids":   tag.CrowdIds,
		}).Error
}

// isTagNameTaken 检查标签名是否已被占用（excludeId>0 时排除该 id 自身，用于更新场景）。
func isTagNameTaken(name string, excludeId int) (bool, error) {
	query := DB.Model(&UserTag{}).Where("name = ?", name)
	if excludeId > 0 {
		query = query.Where("id <> ?", excludeId)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return false, fmt.Errorf("校验标签名失败: %v", err)
	}
	return count > 0, nil
}

// GetUserTagByName 按名称查标签，不存在返回 (nil, nil)（用于"运营"标签的可选打标场景）。
func GetUserTagByName(name string) (*UserTag, error) {
	if name == "" {
		return nil, nil
	}
	var tag UserTag
	err := DB.Where("name = ?", name).First(&tag).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &tag, nil
}

// DeleteUserTag 删除标签。
func DeleteUserTag(id int) error {
	if id == 0 {
		return errors.New("标签ID不能为空")
	}
	return DB.Delete(&UserTag{}, id).Error
}

// UserTagRelation 用户与标签的多对多关联。
//
// 一个用户可被打多个标签，同一 (user_id, tag_id) 至多一条（唯一索引保证打标幂等/追加去重）。
type UserTagRelation struct {
	Id        int       `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId    int       `json:"user_id" gorm:"not null;uniqueIndex:idx_user_tag,priority:1;index"`
	TagId     int       `json:"tag_id" gorm:"not null;uniqueIndex:idx_user_tag,priority:2;index"`
	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
}

// TableName 指定表名
func (UserTagRelation) TableName() string {
	return "user_tag_relations"
}

// BatchAttachTagsToUsers 给一批用户追加一批标签（追加语义：已有的保留，重复的去重）。
//
// 利用 (user_id, tag_id) 唯一索引 + OnConflict DoNothing 实现幂等：重复打标不报错、不产生重复行。
// 返回新增的关联条数。
func BatchAttachTagsToUsers(userIds []int, tagIds []int) (int64, error) {
	if len(userIds) == 0 {
		return 0, errors.New("用户列表不能为空")
	}
	if len(tagIds) == 0 {
		return 0, errors.New("标签列表不能为空")
	}

	// 校验标签均存在，避免打上无效标签。
	var validTagCount int64
	if err := DB.Model(&UserTag{}).Where("id IN ?", tagIds).Count(&validTagCount).Error; err != nil {
		return 0, fmt.Errorf("校验标签失败: %v", err)
	}
	if int(validTagCount) != len(tagIds) {
		return 0, errors.New("标签列表中存在无效的标签")
	}

	relations := make([]UserTagRelation, 0, len(userIds)*len(tagIds))
	for _, uid := range userIds {
		for _, tid := range tagIds {
			relations = append(relations, UserTagRelation{UserId: uid, TagId: tid})
		}
	}

	// OnConflict DoNothing：命中唯一索引的行跳过，实现追加去重。
	result := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&relations)
	if result.Error != nil {
		return 0, fmt.Errorf("批量打标失败: %v", result.Error)
	}
	return result.RowsAffected, nil
}

// BatchDetachTagsFromUsers 从一批用户身上移除一批标签。
//
// 删除命中 (user_id IN, tag_id IN) 的关联行；用户未持有该标签的不受影响。返回删除的关联条数。
func BatchDetachTagsFromUsers(userIds []int, tagIds []int) (int64, error) {
	if len(userIds) == 0 {
		return 0, errors.New("用户列表不能为空")
	}
	if len(tagIds) == 0 {
		return 0, errors.New("标签列表不能为空")
	}

	result := DB.Where("user_id IN ? AND tag_id IN ?", userIds, tagIds).Delete(&UserTagRelation{})
	if result.Error != nil {
		return 0, fmt.Errorf("批量取消打标失败: %v", result.Error)
	}
	return result.RowsAffected, nil
}

// GetTagsForUsers 批量查询多个用户各自的标签，返回 user_id -> 标签列表 的映射。
//
// 一次 JOIN 取全部关联，避免逐用户查询的 N+1 问题。结果中没有任何标签的用户不会出现在 map 里。
func GetTagsForUsers(userIds []int) (map[int][]*UserTag, error) {
	result := make(map[int][]*UserTag)
	if len(userIds) == 0 {
		return result, nil
	}

	// 关联行 + 标签信息一并取出。
	type row struct {
		UserId      int
		Id          int
		Name        string
		Description string
	}
	var rows []row
	err := DB.Table("user_tag_relations AS r").
		Select("r.user_id AS user_id, t.id AS id, t.name AS name, t.description AS description").
		Joins("JOIN user_tags AS t ON t.id = r.tag_id").
		Where("r.user_id IN ?", userIds).
		Order("r.user_id, t.id").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("查询用户标签失败: %v", err)
	}

	for _, item := range rows {
		result[item.UserId] = append(result[item.UserId], &UserTag{
			Id:          item.Id,
			Name:        item.Name,
			Description: item.Description,
		})
	}
	return result, nil
}

// AttachTagsToUsers 为一批用户填充各自的 Tags 字段（用于后台用户列表展示）。
//
// 一次批量查询取全部标签，避免逐用户查询。无标签的用户 Tags 保持为 nil。
func AttachTagsToUsers(users []*User) error {
	if len(users) == 0 {
		return nil
	}
	userIds := make([]int, 0, len(users))
	for _, u := range users {
		userIds = append(userIds, u.Id)
	}
	tagsMap, err := GetTagsForUsers(userIds)
	if err != nil {
		return err
	}
	for _, u := range users {
		if tags, ok := tagsMap[u.Id]; ok {
			u.Tags = tags
		}
	}
	return nil
}

// validateTagCrowdIds 校验 crowd_ids 为合法 JSON 数组，并剔除不存在的分群 id。
func validateTagCrowdIds(tag *UserTag) error {
	ids, err := tag.ParseCrowdIds()
	if err != nil {
		return err
	}
	if len(ids) == 0 {
		tag.CrowdIds = ""
		return nil
	}

	var validCount int64
	if err := DB.Model(&UserCrowd{}).Where("id IN ?", ids).Count(&validCount).Error; err != nil {
		return fmt.Errorf("校验关联人群失败: %v", err)
	}
	if int(validCount) != len(ids) {
		return errors.New("关联人群中存在无效的分群")
	}
	return nil
}
