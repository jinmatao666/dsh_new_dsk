package model

import (
	"errors"
	"time"

	"github.com/songquanpeng/one-api/common/config"
)

type RechargePackage struct {
	Id                 int       `json:"id" gorm:"primaryKey;comment:套餐ID"`
	Name               string    `json:"name" gorm:"type:varchar(50);not null;comment:套餐名称"`
	Description        string    `json:"description" gorm:"type:varchar(255);comment:套餐描述"`
	Price              int       `json:"price" gorm:"not null;comment:默认展示价格-分"`
	QuotaOriginalPrice int       `json:"quota_original_price" gorm:"default:0;comment:原价-分(划线价)"`
	QuotaDays          int       `json:"quota_days" gorm:"default:0;comment:增值包有效期天数 0=不限时"`
	Point              float64   `json:"point" gorm:"type:decimal(20,2);default:0;comment:发放积分数"`
	Level              int       `json:"level" gorm:"default:0;comment:套餐等级"`
	MonthlyPrice       int       `json:"monthly_price" gorm:"default:0;comment:月付价格-分"`
	YearlyPrice        int       `json:"yearly_price" gorm:"default:0;comment:年付价格-分"`
	MonthlyPriceSale   int       `json:"monthly_price_sale" gorm:"default:0;comment:月付折扣价-分"`
	YearlyPriceSale    int       `json:"yearly_price_sale" gorm:"default:0;comment:年付折扣价-分"`
	Features           string    `json:"features" gorm:"type:text;comment:套餐特性JSON数组"`
	Badge              string    `json:"badge" gorm:"type:varchar(50);comment:角标文字"`
	CardStyle          string    `json:"card_style" gorm:"type:varchar(20);comment:卡片样式"`
	Sort               int       `json:"sort" gorm:"default:0;comment:排序权重"`
	Enabled            bool      `json:"enabled" gorm:"default:true;comment:是否启用"`
	Scope              string    `json:"scope" gorm:"type:varchar(20);default:'personal';index;comment:套餐范围 personal/enterprise"`
	PackageType        string    `json:"package_type" gorm:"type:varchar(20);default:'subscription';comment:套餐类型 subscription/quota"`
	DurationUnit       string    `json:"duration_unit" gorm:"type:varchar(20);default:'month';comment:订阅时长单位 day/month/quarter/year"`
	DurationValue      int       `json:"duration_value" gorm:"default:1;comment:订阅时长数值"`
	PointCycle         string    `json:"point_cycle" gorm:"type:varchar(20);default:'month';comment:积分发放周期 once/month/quarter/year"`
	IdentityId         int       `json:"identity_id" gorm:"default:0;comment:关联会员身份ID 0=未关联"`
	Detail             string    `json:"detail" gorm:"type:text;comment:商品说明"`
	CreatedAt          time.Time `json:"created_at" gorm:"autoCreateTime;comment:创建时间"`
	UpdatedAt          time.Time `json:"updated_at" gorm:"autoUpdateTime;comment:更新时间"`
}

// 套餐范围:个人订阅 / 企业一次性充值
const (
	RechargeScopePersonal   = "personal"
	RechargeScopeEnterprise = "enterprise"
)

func (RechargePackage) TableName() string {
	return "recharge_packages"
}

// 时长单位换算成天数: day=值 / month=30×值 / quarter=90×值 / year=365×值
func durationUnitDays(unit string) int {
	switch unit {
	case "day":
		return 1
	case "quarter":
		return 90
	case "year":
		return 365
	case "month":
		fallthrough
	default:
		return 30
	}
}

// DurationDays 订阅时长换算成天数, 供 payment 计算订阅到期日复用. 数据缺失时回退 30 天.
func (p *RechargePackage) DurationDays() int {
	value := p.DurationValue
	if value <= 0 {
		value = 1
	}
	days := durationUnitDays(p.DurationUnit) * value
	if days <= 0 {
		return 30
	}
	return days
}

// PointCycleDays 积分发放周期换算成天数; once(一次性)返回 0.
func (p *RechargePackage) PointCycleDays() int {
	if p.PointCycle == "" || p.PointCycle == "once" {
		return 0
	}
	return durationUnitDays(p.PointCycle)
}

// EffectiveLevel 套餐生效等级: 优先取所关联会员身份的 package_level, 未关联则回退到 Level 列.
func (p *RechargePackage) EffectiveLevel() int {
	if p.IdentityId > 0 {
		if identity, err := GetMemberIdentityById(p.IdentityId); err == nil && identity != nil {
			return identity.PackageLevel
		}
	}
	return p.Level
}

// EffectivePrice 返回套餐实际售价（分）。
// 计费模型已收敛为"一个商品一个售价"（季/年卡为独立商品），price 列即权威售价。
// monthly_price/yearly_price/*_sale 为旧"同商品多周期"模型遗留字段，仅当 price 未设置（=0）时兜底，
// 保证未重新保存过的历史商品不被改 0；新逻辑只认 price。
func (p *RechargePackage) EffectivePrice() int {
	if p.Price > 0 {
		return p.Price
	}
	// price 未设置时回退旧多周期字段（历史数据兼容）
	if p.DurationUnit == "year" {
		if p.YearlyPriceSale > 0 {
			return p.YearlyPriceSale
		}
		if p.YearlyPrice > 0 {
			return p.YearlyPrice
		}
		return p.Price
	}
	if p.MonthlyPriceSale > 0 {
		return p.MonthlyPriceSale
	}
	if p.MonthlyPrice > 0 {
		return p.MonthlyPrice
	}
	return p.Price
}

func (p *RechargePackage) IsLegacyPersonalLike() bool {
	if p.Scope != "" {
		return false
	}
	if p.Level > 0 {
		return true
	}
	if p.HasSubscriptionHistory() {
		return true
	}
	return p.HasPersonalOrderHistory()
}

func (p *RechargePackage) IsPersonalScope() bool {
	return p.Scope == RechargeScopePersonal || p.IsLegacyPersonalLike()
}

func (p *RechargePackage) HasEnterpriseOrderHistory() bool {
	if p.Id == 0 {
		return false
	}
	var count int64
	err := DB.Table("orders").
		Where("package_id = ? AND org_id IS NOT NULL AND org_id > 0", p.Id).
		Count(&count).Error
	return err == nil && count > 0
}

func (p *RechargePackage) HasPersonalOrderHistory() bool {
	if p.Id == 0 {
		return false
	}
	var count int64
	err := DB.Table("orders").
		Where("package_id = ? AND (org_id IS NULL OR org_id <= 0)", p.Id).
		Count(&count).Error
	return err == nil && count > 0
}

func (p *RechargePackage) HasSubscriptionHistory() bool {
	if p.Id == 0 {
		return false
	}
	var count int64
	err := DB.Table("subscriptions").
		Where("package_id = ?", p.Id).
		Count(&count).Error
	return err == nil && count > 0
}

func (p *RechargePackage) IsEnterpriseScope() bool {
	if p.Scope == RechargeScopeEnterprise {
		return true
	}
	if p.Scope != "" || p.IsLegacyPersonalLike() {
		return false
	}
	return p.HasEnterpriseOrderHistory()
}

// CalcQuota 根据 point * QuotaPerUnit 计算内部额度
func (p *RechargePackage) CalcQuota() int64 {
	return int64(p.Point * config.QuotaPerUnit)
}

// GetTrialFreeQuota 返回试用包对应的内部免费额度(point × QuotaPerUnit)。
// 试用包 = 个人套餐(scope=personal)中 price=0 且 enabled=true 的套餐(按 sort,id 取第一条)。
// 每月免费额度发放(IssueMonthlyFreeQuotas)与注册首月发放均以此为准,不再读 option QuotaForMonthlyFree。
// 找不到试用包时返回 0,调用方据此跳过发放。
func GetTrialFreeQuota() int64 {
	var pkg RechargePackage
	err := DB.Where("enabled = ? AND price = ? AND scope = ?", true, 0, RechargeScopePersonal).
		Order("sort asc, id asc").First(&pkg).Error
	if err != nil {
		return 0
	}
	return pkg.CalcQuota()
}

// GetAllRechargePackages 获取所有启用的个人充值套餐.
// 兼容少量历史数据: scope 为空但具备个人订阅特征/历史的套餐,按个人订阅处理.
func GetAllRechargePackages() ([]*RechargePackage, error) {
	var packages []*RechargePackage
	err := DB.Where(`enabled = ? AND (
		scope = ? OR
		((scope = '' OR scope IS NULL) AND (
			level > 0 OR
			EXISTS (SELECT 1 FROM subscriptions s WHERE s.package_id = recharge_packages.id) OR
			EXISTS (SELECT 1 FROM orders o WHERE o.package_id = recharge_packages.id AND (o.org_id IS NULL OR o.org_id <= 0))
		))
	)`, true, RechargeScopePersonal).
		Order("sort asc, id asc").Find(&packages).Error
	for _, pkg := range packages {
		if pkg.Scope == "" {
			pkg.Scope = RechargeScopePersonal
		}
	}
	return packages, err
}

// GetEnterpriseRechargePackages 获取所有启用的企业充值套餐
func GetEnterpriseRechargePackages() ([]*RechargePackage, error) {
	var packages []*RechargePackage
	err := DB.Where(`enabled = ? AND (
		scope = ? OR
		((scope = '' OR scope IS NULL) AND EXISTS (
			SELECT 1 FROM orders o WHERE o.package_id = recharge_packages.id AND o.org_id IS NOT NULL AND o.org_id > 0
		))
	)`, true, RechargeScopeEnterprise).
		Order("sort asc, id asc").Find(&packages).Error
	for _, pkg := range packages {
		if pkg.Scope == "" {
			pkg.Scope = RechargeScopeEnterprise
		}
	}
	return packages, err
}

// ListRechargePackagesByScope 后台:按 scope 列出全部套餐(含禁用)
func ListRechargePackagesByScope(scope string) ([]*RechargePackage, error) {
	var packages []*RechargePackage
	q := DB.Order("sort asc, id asc")
	if scope == RechargeScopeEnterprise {
		q = q.Where(`scope = ? OR ((scope = '' OR scope IS NULL) AND EXISTS (
			SELECT 1 FROM orders o WHERE o.package_id = recharge_packages.id AND o.org_id IS NOT NULL AND o.org_id > 0
		))`, RechargeScopeEnterprise)
	} else {
		q = q.Where(`scope = ? OR ((scope = '' OR scope IS NULL) AND (
			level > 0 OR
			EXISTS (SELECT 1 FROM subscriptions s WHERE s.package_id = recharge_packages.id) OR
			EXISTS (SELECT 1 FROM orders o WHERE o.package_id = recharge_packages.id AND (o.org_id IS NULL OR o.org_id <= 0))
		))`, RechargeScopePersonal)
	}
	err := q.Find(&packages).Error
	for _, pkg := range packages {
		if pkg.Scope == "" {
			pkg.Scope = scope
		}
	}
	return packages, err
}

// GetAllRechargePackagesForAdmin 获取所有套餐（含停用），按 sort,id 排序，供后台管理使用
func GetAllRechargePackagesForAdmin() ([]*RechargePackage, error) {
	var packages []*RechargePackage
	err := DB.Order("sort asc, id asc").Find(&packages).Error
	return packages, err
}

// GetRechargePackageById 根据ID获取套餐
func GetRechargePackageById(id int) (*RechargePackage, error) {
	if id == 0 {
		return nil, errors.New("套餐ID不能为空")
	}
	var pkg RechargePackage
	err := DB.Where("id = ?", id).First(&pkg).Error
	return &pkg, err
}

// CreateRechargePackage 创建充值套餐（管理员）
// 新建后再用 Update 强制写一次 enabled，因 GORM 在 Create 阶段对带
// default:true 标签的 bool 零值 false 处理不可靠(会落默认值 true)，
// 此处分两步确保「新建默认停用」可靠落库。
func CreateRechargePackage(pkg *RechargePackage) error {
	if pkg.Name == "" {
		return errors.New("请填写商品名称")
	}
	if pkg.Price < 0 {
		return errors.New("售价不能为负数")
	}
	if pkg.Point < 0 {
		return errors.New("积分数不能为负数")
	}
	wantEnabled := pkg.Enabled
	if err := DB.Create(pkg).Error; err != nil {
		return err
	}
	// 显式回写 enabled，覆盖 Create 阶段可能落入的默认值
	return DB.Model(&RechargePackage{}).Where("id = ?", pkg.Id).
		Update("enabled", wantEnabled).Error
}

// UpdateRechargePackage 更新充值套餐（管理员）
// 使用 Select 显式列出可更新字段，确保 Enabled=false、价格清零等零值也能写入
func UpdateRechargePackage(pkg *RechargePackage) error {
	return DB.Model(&RechargePackage{}).Where("id = ?", pkg.Id).
		Select("name", "description", "price", "point", "level",
			"monthly_price", "yearly_price", "monthly_price_sale", "yearly_price_sale",
			"features", "badge", "card_style", "sort", "enabled", "scope",
			"package_type", "duration_unit", "duration_value", "point_cycle",
			"identity_id", "detail", "quota_original_price", "quota_days").
		Updates(pkg).Error
}

// UpdateRechargePackageStatus 仅更新启用状态（管理员）
func UpdateRechargePackageStatus(id int, enabled bool) error {
	return DB.Model(&RechargePackage{}).Where("id = ?", id).
		Update("enabled", enabled).Error
}

// DeleteRechargePackage 删除充值套餐（管理员）
func DeleteRechargePackage(id int) error {
	return DB.Where("id = ?", id).Delete(&RechargePackage{}).Error
}
