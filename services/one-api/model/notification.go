package model

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Notification 通知/公告/站内信。
// 后台为唯一配置源，客户端按 category + audience + platform + version + 生效时间窗过滤后展示。
// 维度组合描述一条通知，避免写死类型：category × display_mode × blocking × audience。
type Notification struct {
	Id          int    `json:"id" gorm:"primaryKey;autoIncrement"`
	Category    string `json:"category" gorm:"type:varchar(20);not null;default:'notification';index;comment:分类 notification/inbox"`
	Title       string `json:"title" gorm:"type:varchar(200);not null;comment:标题"`
	Content     string `json:"content" gorm:"type:text;not null;comment:正文(Markdown)"`
	DisplayMode string `json:"display_mode" gorm:"type:varchar(20);not null;default:'modal';comment:展示形态(仅通知类) modal_block/modal/banner/toast"`
	Blocking    bool   `json:"blocking" gorm:"not null;comment:是否阻断使用(由 display_mode=modal_block 派生，勿手动配)"`
	Dismissible bool   `json:"dismissible" gorm:"not null;comment:是否可关闭(有无关闭按钮)"`
	Audience    string `json:"audience" gorm:"type:varchar(20);not null;default:'all';comment:定向范围 all/crowd/users"`
	CrowdId     *int   `json:"crowd_id" gorm:"comment:audience=crowd 时关联 user_crowds.id"`
	TargetUsers string `json:"target_users" gorm:"type:text;comment:audience=users 时的 user_id JSON 数组"`
	Platforms   string `json:"platforms" gorm:"type:varchar(100);comment:平台 JSON 数组 如 [\"web\",\"app\",\"desktop\"]，空=全部"`
	MinVersion  string `json:"min_version" gorm:"type:varchar(50);comment:最低适用版本(含)，空=不限"`
	MaxVersion  string `json:"max_version" gorm:"type:varchar(50);comment:最高适用版本(含)，空=不限"`
	ActionJSON  string `json:"action" gorm:"type:text;comment:按钮/跳转配置 JSON"`
	Plane       string `json:"plane" gorm:"type:varchar(2);not null;default:'A';comment:投递平面 A(one-api)/B(广播文件，仅 service)"`
	PreLogin    bool   `json:"pre_login" gorm:"not null;default:false;comment:登录前是否可见(仅 audience=all 有效，走公开接口，不定向)"`
	Priority    int    `json:"priority" gorm:"default:0;index;comment:优先级，大者优先/抢占"`
	Status      string `json:"status" gorm:"type:varchar(20);not null;default:'draft';index;comment:状态 draft/published/archived"`

	StartAt     *time.Time `json:"start_at" gorm:"comment:生效开始，空=立即"`
	EndAt       *time.Time `json:"end_at" gorm:"comment:生效结束，空=不过期"`
	PublishedAt *time.Time `json:"published_at" gorm:"comment:最近一次发布时间，重新发布会刷新；客户端按 id+此值去重，重发即重新触达"`
	CreatedAt time.Time  `json:"created_at" gorm:"autoCreateTime;comment:创建时间"`
	UpdatedAt time.Time  `json:"updated_at" gorm:"autoUpdateTime;comment:更新时间"`
}

func (Notification) TableName() string {
	return "notifications"
}

// NotificationRead 每用户对某条通知的已读/关闭状态，支撑站内信未读红点。
// announcement 类的"看过"用客户端 localStorage 去重，不落此表。
type NotificationRead struct {
	Id             int        `json:"id" gorm:"primaryKey;autoIncrement"`
	NotificationId int        `json:"notification_id" gorm:"not null;index:idx_notif_user,unique;comment:通知ID"`
	UserId         int        `json:"user_id" gorm:"not null;index:idx_notif_user,unique;comment:用户ID"`
	ReadAt         *time.Time `json:"read_at" gorm:"comment:已读时间"`
	DismissedAt    *time.Time `json:"dismissed_at" gorm:"comment:关闭时间"`
	CreatedAt      time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt      time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
}

func (NotificationRead) TableName() string {
	return "notification_reads"
}

// 分类常量
const (
	NotificationCategoryNotification = "notification" // 通知(公告/服务/活动，区分展示形态)
	NotificationCategoryInbox        = "inbox"        // 站内信(进消息中心，无形态)
)

// 展示形态常量(仅 notification 分类有形态；inbox 无形态)
const (
	NotificationDisplayModalBlock = "modal_block" // 全屏弹窗(阻断)
	NotificationDisplayModal      = "modal"       // 普通弹窗
	NotificationDisplayBanner     = "banner"      // 横幅(文字超长时前端自动滚动)
	NotificationDisplayToast      = "toast"       // toast 轻提示
)

// 定向范围常量
const (
	NotificationAudienceAll   = "all"
	NotificationAudienceCrowd = "crowd"
	NotificationAudienceUsers = "users"
)

// 投递平面常量
const (
	NotificationPlaneA = "A"
	NotificationPlaneB = "B"
)

// 状态常量
const (
	NotificationStatusDraft     = "draft"
	NotificationStatusPublished = "published"
	NotificationStatusArchived  = "archived"
)

// ---- 后台 CRUD ----

// ListNotifications 后台:列出全部通知(可按 category/status 过滤)，按优先级+创建时间倒序。
func ListNotifications(category, status string) ([]*Notification, error) {
	var list []*Notification
	q := DB.Order("priority desc, created_at desc, id desc")
	if category != "" {
		q = q.Where("category = ?", category)
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}
	err := q.Find(&list).Error
	return list, err
}

// GetNotificationById 按 ID 查询单条通知。
func GetNotificationById(id int) (*Notification, error) {
	if id == 0 {
		return nil, errors.New("ID不能为空")
	}
	var n Notification
	if err := DB.First(&n, id).Error; err != nil {
		return nil, err
	}
	return &n, nil
}

func (n *Notification) validate() error {
	if n.Title == "" {
		return errors.New("标题不能为空")
	}
	if n.Content == "" {
		return errors.New("正文不能为空")
	}
	if n.Audience == NotificationAudienceCrowd && (n.CrowdId == nil || *n.CrowdId == 0) {
		return errors.New("定向人群时必须选择分群")
	}
	if n.Plane == NotificationPlaneB && n.Category != NotificationCategoryNotification {
		return errors.New("广播平面(B)仅限通知类(全屏弹窗停服公告)")
	}
	// blocking 由 display_mode 派生，服务端权威，不信任前端传值(仅 modal_block 阻断)。
	n.Blocking = n.DisplayMode == NotificationDisplayModalBlock
	// pre_login(登录前可见)仅对全体通知有意义；定向通知无匿名身份，强制关闭。
	if n.Audience != NotificationAudienceAll {
		n.PreLogin = false
	}
	return nil
}

// CreateNotification 后台:新建通知(默认 draft)。
func CreateNotification(n *Notification) error {
	if err := n.validate(); err != nil {
		return err
	}
	n.Id = 0
	return DB.Create(n).Error
}

// UpdateNotification 后台:更新通知全部可编辑字段。
func UpdateNotification(n *Notification) error {
	if n.Id == 0 {
		return errors.New("ID不能为空")
	}
	if err := n.validate(); err != nil {
		return err
	}
	return DB.Model(&Notification{}).Where("id = ?", n.Id).
		Select("category", "title", "content", "display_mode", "blocking", "dismissible",
			"audience", "crowd_id", "target_users", "platforms", "min_version", "max_version",
			"action_json", "plane", "pre_login", "priority", "status", "start_at", "end_at").
		Updates(n).Error
}

// DeleteNotification 后台:删除通知。
func DeleteNotification(id int) error {
	if id == 0 {
		return errors.New("ID不能为空")
	}
	return DB.Where("id = ?", id).Delete(&Notification{}).Error
}

// SetNotificationStatus 后台:切换状态(发布/归档)。
func SetNotificationStatus(id int, status string) error {
	if id == 0 {
		return errors.New("ID不能为空")
	}
	updates := map[string]interface{}{"status": status}
	// 每次(重新)发布刷新 published_at：客户端去重键含此值，重发即对老用户重新触达。
	if status == NotificationStatusPublished {
		now := time.Now()
		updates["published_at"] = &now
	}
	return DB.Model(&Notification{}).Where("id = ?", id).
		Updates(updates).Error
}

// ---- 客户端拉取 ----

// listActiveByCategories 取当前生效(published + 时间窗内)的通知，可限定分类集合。
// 生效时间窗:start_at 为空或 <=now,end_at 为空或 >=now。按优先级倒序。
func listActiveByCategories(categories []string) ([]*Notification, error) {
	now := time.Now()
	var list []*Notification
	q := DB.Where("status = ?", NotificationStatusPublished).
		Where("start_at IS NULL OR start_at <= ?", now).
		Where("end_at IS NULL OR end_at >= ?", now)
	if len(categories) > 0 {
		q = q.Where("category IN ?", categories)
	}
	err := q.Order("priority desc, created_at desc, id desc").Find(&list).Error
	return list, err
}

// ListPlaneBBroadcastNotifications 取当前生效的广播平面(B)通知，按优先级倒序。
// 供 Plane B 广播文件生成用:取第一条(最高优先级)写入文件。
// Plane B 只承载通知类(停服/维护的全屏弹窗)，不含站内信。
func ListPlaneBBroadcastNotifications() ([]*Notification, error) {
	now := time.Now()
	var list []*Notification
	err := DB.Where("status = ?", NotificationStatusPublished).
		Where("plane = ?", NotificationPlaneB).
		Where("category = ?", NotificationCategoryNotification).
		Where("start_at IS NULL OR start_at <= ?", now).
		Where("end_at IS NULL OR end_at >= ?", now).
		Order("priority desc, created_at desc, id desc").
		Find(&list).Error
	return list, err
}

// ListPublicNotifications 公开(登录前/官网):audience=all 且 pre_login=true 的生效通知类。
// 只有显式勾选「登录前可见」的通知才在此暴露；站内信、需登录的通知不走此接口，不做定向。
func ListPublicNotifications() ([]*Notification, error) {
	all, err := listActiveByCategories([]string{
		NotificationCategoryNotification,
	})
	if err != nil {
		return nil, err
	}
	out := all[:0]
	for _, n := range all {
		if n.Audience == NotificationAudienceAll && n.Plane == NotificationPlaneA && n.PreLogin {
			out = append(out, n)
		}
	}
	return out, nil
}

// ListNotificationsForUser 登录用户:返回该用户可见的生效通知(已叠加定向过滤)。
// 定向统一走 SQL 路径判命中:audience=all 全员;audience=users 命中 target_users;
// audience=crowd 则该用户 id 是否落入分群 SQL 结果集(规避单用户内存路径字段缺失)。
func ListNotificationsForUser(userId int) ([]*Notification, error) {
	all, err := listActiveByCategories(nil)
	if err != nil {
		return nil, err
	}
	// 预取:该用户命中的分群 id 集合，避免每条通知重复跑 SQL。
	matchedCrowds := map[int]bool{}
	out := make([]*Notification, 0, len(all))
	for _, n := range all {
		switch n.Audience {
		case NotificationAudienceAll:
			out = append(out, n)
		case NotificationAudienceUsers:
			if targetUsersContains(n.TargetUsers, userId) {
				out = append(out, n)
			}
		case NotificationAudienceCrowd:
			if n.CrowdId == nil || *n.CrowdId == 0 {
				continue
			}
			hit, ok := matchedCrowds[*n.CrowdId]
			if !ok {
				hit = userInCrowd(*n.CrowdId, userId)
				matchedCrowds[*n.CrowdId] = hit
			}
			if hit {
				out = append(out, n)
			}
		}
	}
	return out, nil
}

// userInCrowd 用分群的 SQL 路径判断单用户是否命中:在编译出的 WHERE 上再叠加 id=? 计数。
// 走 SQL 而非 UserMatchesCrowd 内存路径,后者仅支持 4 个字段,会漏判额度类条件。
func userInCrowd(crowdId, userId int) bool {
	crowd, err := GetUserCrowdById(crowdId)
	if err != nil || crowd == nil {
		return false
	}
	whereClause, args, err := crowd.BuildSQLQuery()
	if err != nil {
		return false
	}
	var count int64
	err = DB.Table("users").
		Where(whereClause, args...).
		Where("id = ?", userId).
		Count(&count).Error
	if err != nil {
		return false
	}
	return count > 0
}

// matchesPlatformVersion 判断通知是否适用于给定平台+版本。
// platform/version 任一为空表示客户端未声明,则不在该维度过滤(放行)。
func (n *Notification) matchesPlatformVersion(platform, version string) bool {
	if platform != "" && n.Platforms != "" {
		var ps []string
		if err := json.Unmarshal([]byte(n.Platforms), &ps); err == nil && len(ps) > 0 {
			hit := false
			for _, p := range ps {
				if p == platform {
					hit = true
					break
				}
			}
			if !hit {
				return false
			}
		}
	}
	if version != "" {
		if n.MinVersion != "" && compareVersions(version, n.MinVersion) < 0 {
			return false
		}
		if n.MaxVersion != "" && compareVersions(version, n.MaxVersion) > 0 {
			return false
		}
	}
	return true
}

// compareVersions 语义版本比较,与桌面端 index.tsx compareVersions 对齐:
// 去掉前缀 v、按 . 拆分逐段比数值。left<right 返回 -1,相等 0,left>right 1。
func compareVersions(left, right string) int {
	parse := func(s string) []int {
		s = strings.TrimPrefix(strings.TrimSpace(s), "v")
		parts := strings.Split(s, ".")
		nums := make([]int, len(parts))
		for i, p := range parts {
			n := 0
			for _, ch := range p {
				if ch < '0' || ch > '9' {
					break
				}
				n = n*10 + int(ch-'0')
			}
			nums[i] = n
		}
		return nums
	}
	a, b := parse(left), parse(right)
	max := len(a)
	if len(b) > max {
		max = len(b)
	}
	for i := 0; i < max; i++ {
		av, bv := 0, 0
		if i < len(a) {
			av = a[i]
		}
		if i < len(b) {
			bv = b[i]
		}
		if av < bv {
			return -1
		}
		if av > bv {
			return 1
		}
	}
	return 0
}

// FilterByPlatformVersion 按平台+版本过滤通知列表(供公开/登录接口复用)。
func FilterByPlatformVersion(list []*Notification, platform, version string) []*Notification {
	if platform == "" && version == "" {
		return list
	}
	out := make([]*Notification, 0, len(list))
	for _, n := range list {
		if n.matchesPlatformVersion(platform, version) {
			out = append(out, n)
		}
	}
	return out
}

// targetUsersContains 判断 target_users(JSON 数组)是否包含 userId。空/非法均视为不包含。
func targetUsersContains(targetUsers string, userId int) bool {
	if targetUsers == "" {
		return false
	}
	var ids []int
	if err := json.Unmarshal([]byte(targetUsers), &ids); err != nil {
		return false
	}
	for _, id := range ids {
		if id == userId {
			return true
		}
	}
	return false
}

// GetUserReadMap 取用户对一组通知的已读/关闭状态,key=notification_id。
func GetUserReadMap(userId int, notificationIds []int) (map[int]*NotificationRead, error) {
	result := map[int]*NotificationRead{}
	if len(notificationIds) == 0 {
		return result, nil
	}
	var reads []*NotificationRead
	err := DB.Where("user_id = ? AND notification_id IN ?", userId, notificationIds).
		Find(&reads).Error
	if err != nil {
		return nil, err
	}
	for _, r := range reads {
		result[r.NotificationId] = r
	}
	return result, nil
}

// MarkNotificationRead 标记某用户对某通知已读(read)或关闭(dismiss)。
// upsert:无记录则创建,有则更新对应时间戳。
func MarkNotificationRead(userId, notificationId int, dismiss bool) error {
	if userId == 0 || notificationId == 0 {
		return errors.New("参数不能为空")
	}
	now := time.Now()
	var read NotificationRead
	err := DB.Where("user_id = ? AND notification_id = ?", userId, notificationId).
		First(&read).Error
	if err != nil {
		read = NotificationRead{UserId: userId, NotificationId: notificationId}
		read.ReadAt = &now
		if dismiss {
			read.DismissedAt = &now
		}
		return DB.Create(&read).Error
	}
	updates := map[string]interface{}{"read_at": &now}
	if dismiss {
		updates["dismissed_at"] = &now
	}
	return DB.Model(&NotificationRead{}).Where("id = ?", read.Id).Updates(updates).Error
}
