package model

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/songquanpeng/one-api/common"
)

func setupOrgAuditTestDB(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&OrgAuditLog{}))
	DB = db
	common.UsingSQLite = true
	common.UsingPostgreSQL = false
}

func TestWriteOrgAuditLog_PersistsDetailAsJSON(t *testing.T) {
	setupOrgAuditTestDB(t)
	detail := map[string]interface{}{"name": "研发", "quota_cap": 1000}
	require.NoError(t, WriteOrgAuditLog(1, 99, "admin", OrgAuditActionDeptCreate, OrgAuditTargetDepartment, 5, detail, "10.0.0.1"))

	var row OrgAuditLog
	require.NoError(t, DB.First(&row).Error)
	assert.Equal(t, 1, row.OrgId)
	assert.Equal(t, 99, row.ActorId)
	assert.Equal(t, "admin", row.ActorName)
	assert.Equal(t, OrgAuditActionDeptCreate, row.Action)
	assert.Equal(t, OrgAuditTargetDepartment, row.TargetType)
	assert.Equal(t, 5, row.TargetId)
	assert.Equal(t, "10.0.0.1", row.Ip)

	var parsed map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(row.Detail), &parsed))
	assert.Equal(t, "研发", parsed["name"])
	assert.EqualValues(t, 1000, parsed["quota_cap"])
}

func TestWriteOrgAuditLog_NilDetailIsEmptyString(t *testing.T) {
	setupOrgAuditTestDB(t)
	require.NoError(t, WriteOrgAuditLog(1, 0, "system", OrgAuditActionMemberRemove, OrgAuditTargetMember, 7, nil, ""))
	var row OrgAuditLog
	require.NoError(t, DB.First(&row).Error)
	assert.Empty(t, row.Detail, "nil detail 应落库为空字符串而非 null/报错")
}

func TestWriteOrgAuditLog_RejectsEmptyOrgOrAction(t *testing.T) {
	setupOrgAuditTestDB(t)
	assert.Error(t, WriteOrgAuditLog(0, 1, "a", OrgAuditActionDeptCreate, "", 0, nil, ""))
	assert.Error(t, WriteOrgAuditLog(1, 1, "a", "", "", 0, nil, ""))
}

func TestGetOrgAuditLogs_PaginationAndOrder(t *testing.T) {
	setupOrgAuditTestDB(t)
	for i := 0; i < 25; i++ {
		require.NoError(t, WriteOrgAuditLog(1, 1, "admin", OrgAuditActionQuotaTopup, OrgAuditTargetQuota, i, map[string]int{"n": i}, ""))
	}
	// 默认 pageSize=20,第一页拿满 20 条
	rows, total, err := GetOrgAuditLogs(1, "", 1, 0)
	require.NoError(t, err)
	assert.EqualValues(t, 25, total)
	assert.Len(t, rows, 20)
	// 倒序:第一条应是最后写入的 target_id=24
	assert.Equal(t, 24, rows[0].TargetId)

	// 第二页剩 5 条
	rows2, _, err := GetOrgAuditLogs(1, "", 2, 20)
	require.NoError(t, err)
	assert.Len(t, rows2, 5)
}

func TestGetOrgAuditLogs_FilterByAction(t *testing.T) {
	setupOrgAuditTestDB(t)
	require.NoError(t, WriteOrgAuditLog(1, 1, "a", OrgAuditActionDeptCreate, OrgAuditTargetDepartment, 1, nil, ""))
	require.NoError(t, WriteOrgAuditLog(1, 1, "a", OrgAuditActionQuotaTopup, OrgAuditTargetQuota, 0, nil, ""))
	require.NoError(t, WriteOrgAuditLog(1, 1, "a", OrgAuditActionQuotaTopup, OrgAuditTargetQuota, 0, nil, ""))

	rows, total, err := GetOrgAuditLogs(1, OrgAuditActionQuotaTopup, 1, 20)
	require.NoError(t, err)
	assert.EqualValues(t, 2, total)
	assert.Len(t, rows, 2)
	for _, r := range rows {
		assert.Equal(t, OrgAuditActionQuotaTopup, r.Action)
	}
}

func TestGetOrgAuditLogs_ScopedByOrg(t *testing.T) {
	setupOrgAuditTestDB(t)
	require.NoError(t, WriteOrgAuditLog(1, 1, "a", OrgAuditActionDeptCreate, OrgAuditTargetDepartment, 1, nil, ""))
	require.NoError(t, WriteOrgAuditLog(2, 1, "a", OrgAuditActionDeptCreate, OrgAuditTargetDepartment, 1, nil, ""))

	rows, total, err := GetOrgAuditLogs(1, "", 1, 20)
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	assert.Len(t, rows, 1)
	assert.Equal(t, 1, rows[0].OrgId)
}

func TestDeleteOrgAuditLogsByOrg(t *testing.T) {
	setupOrgAuditTestDB(t)
	require.NoError(t, WriteOrgAuditLog(1, 1, "a", OrgAuditActionDeptCreate, OrgAuditTargetDepartment, 1, nil, ""))
	require.NoError(t, WriteOrgAuditLog(2, 1, "a", OrgAuditActionDeptCreate, OrgAuditTargetDepartment, 1, nil, ""))
	require.NoError(t, DeleteOrgAuditLogsByOrg(nil, 1))

	_, total1, _ := GetOrgAuditLogs(1, "", 1, 20)
	_, total2, _ := GetOrgAuditLogs(2, "", 1, 20)
	assert.EqualValues(t, 0, total1)
	assert.EqualValues(t, 1, total2, "只清理目标企业,不误删其它企业")
}
