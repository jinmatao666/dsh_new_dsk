package model

import (
	"time"
)

// 账号中心（account_center）模型定义。
//
// 设计要点（详见 docs/plans/2026-06-02-unified-account-center-design.md）：
//   - 认证与业务解耦：账号中心只回答「你是谁」，不持有任何产品的业务数据。
//   - 主键统一用雪花值（int64），MySQL/PG 双兼容；GORM 字段须关自增。
//   - 登录方式即数据行：新增登录方式 = 插一行，不改表、不动历史用户。
//
// 这些表建在独立库 ACCOUNT_DB 上，不在主业务库。所有读写须显式用 ACCOUNT_DB。

const (
	AccountStatusEnabled  = 1 // 正常
	AccountStatusDisabled = 2 // 禁用
	AccountStatusDeleted  = 3 // 注销
)

// 登录标识类型。本期开放 username/phone/wechat 三种入口（手机号密码与手机验证码
// 共用 phone 标识）；email/github/lark/oidc 仅迁移历史绑定数据做兼容，入口暂不开放。
const (
	IdentifierTypeUsername = "username"
	IdentifierTypePhone    = "phone"
	IdentifierTypeWeChat   = "wechat"
	IdentifierTypeEmail    = "email"
	IdentifierTypeGitHub   = "github"
	IdentifierTypeLark     = "lark"
	IdentifierTypeOidc     = "oidc"
)

// 各产品在账号中心登记的全局唯一编码。
const (
	ProductCodeParvis = "parvis"
)

// Account 全局账号主表，全公司唯一身份源。
type Account struct {
	Id        int64     `json:"id" gorm:"primaryKey;autoIncrement:false;comment:账号ID(雪花值,应用层生成)"`
	Status    int       `json:"status" gorm:"type:int;default:1;index;comment:账号状态 1正常 2禁用 3注销"`
	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime;comment:创建时间"`
	UpdatedAt time.Time `json:"updated_at" gorm:"autoUpdateTime;comment:更新时间(随status等变更刷新)"`
}

func (Account) TableName() string { return "accounts" }

// AccountIdentifier 登录标识，一个账号可挂多种登录方式。
// 复合唯一索引 uk_type_identifier 保证「同一种登录方式下 identifier 全局唯一」。
type AccountIdentifier struct {
	Id         int64     `json:"id" gorm:"primaryKey;autoIncrement:false;comment:标识ID(雪花值)"`
	AccountId  int64     `json:"account_id" gorm:"index;not null;comment:所属账号ID"`
	Type       string    `json:"type" gorm:"type:varchar(20);not null;uniqueIndex:uk_type_identifier;comment:登录方式 username/phone/wechat/email/github/lark/oidc"`
	Identifier string    `json:"identifier" gorm:"type:varchar(255);not null;uniqueIndex:uk_type_identifier;comment:标识值(同type下全局唯一)"`
	Verified   bool      `json:"verified" gorm:"default:false;comment:是否已验证"`
	CreatedAt  time.Time `json:"created_at" gorm:"autoCreateTime;comment:创建时间"`
}

func (AccountIdentifier) TableName() string { return "account_identifiers" }

// AccountCredential 账号级密码，与登录标识解耦。
// 用户名密码、手机号密码登录校验同一套密码；微信扫码、手机验证码登录可无此行。
type AccountCredential struct {
	AccountId    int64     `json:"account_id" gorm:"primaryKey;autoIncrement:false;comment:所属账号ID"`
	PasswordHash string    `json:"-" gorm:"type:varchar(255);not null;comment:bcrypt密码哈希(绝不外泄)"`
	UpdatedAt    time.Time `json:"updated_at" gorm:"autoUpdateTime;comment:更新时间(改密刷新)"`
}

func (AccountCredential) TableName() string { return "account_credentials" }

// AccountProduct 账号 ↔ 各产品本地用户映射。复合主键 (account_id, product_code)。
// local_user_id 指向各产品自己业务表的主键，账号中心不关心其字段。
// uk_product_local 保证「同一产品下一个本地用户只能映射一个账号」，从 DB 层兜底防止
// 双写竞态（回填失败重试）等情况建出重复映射，是「一个 local user 一条映射」的硬约束。
type AccountProduct struct {
	AccountId   int64     `json:"account_id" gorm:"primaryKey;autoIncrement:false;comment:账号ID"`
	ProductCode string    `json:"product_code" gorm:"primaryKey;type:varchar(32);uniqueIndex:uk_product_local;comment:产品编码 如parvis"`
	LocalUserId int64     `json:"local_user_id" gorm:"not null;index;uniqueIndex:uk_product_local;comment:该产品业务库的用户主键"`
	Status      int       `json:"status" gorm:"type:int;default:1;comment:映射状态 1启用"`
	CreatedAt   time.Time `json:"created_at" gorm:"autoCreateTime;comment:创建时间"`
}

func (AccountProduct) TableName() string { return "account_products" }

// AccountProfile 全局档案（B 类）：昵称、头像等「全公司一份、改一处处处变」的展示信息。
// 与登录身份分表，因为档案可频繁改且语义独立。各产品「读穿」此表，不在本地存副本。
// 写入唯一收口在账号中心（见 account_profile.go），产品要改档案须调账号中心。
type AccountProfile struct {
	AccountId   int64     `json:"account_id" gorm:"primaryKey;autoIncrement:false;comment:账号ID"`
	DisplayName string    `json:"display_name" gorm:"type:varchar(64);comment:昵称(全局档案)"`
	AvatarURL   string    `json:"avatar_url" gorm:"type:varchar(512);comment:头像URL(全局档案)"`
	UpdatedAt   time.Time `json:"updated_at" gorm:"autoUpdateTime;comment:更新时间"`
}

func (AccountProfile) TableName() string { return "account_profiles" }
