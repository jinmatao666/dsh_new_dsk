package model

import (
	"encoding/json"
	"fmt"
	"sort"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestParseRules(t *testing.T) {
	tests := []struct {
		name      string
		rules     string
		wantError bool
	}{
		{
			name: "Valid AND rules",
			rules: `{
				"conditions": [
					{"field": "account_type", "operator": "=", "value": 1, "description": "个人用户"},
					{"field": "created_at", "operator": "<=", "value": "7_days_ago", "description": "注册7天内"}
				],
				"logic": "AND"
			}`,
			wantError: false,
		},
		{
			name: "Valid OR rules",
			rules: `{
				"conditions": [
					{"field": "status", "operator": "=", "value": 1, "description": "启用状态"}
				],
				"logic": "OR"
			}`,
			wantError: false,
		},
		{
			name:      "Empty rules",
			rules:     "",
			wantError: true,
		},
		{
			name:      "Invalid JSON",
			rules:     `{invalid json}`,
			wantError: true,
		},
		{
			name: "Invalid logic operator",
			rules: `{
				"conditions": [
					{"field": "account_type", "operator": "=", "value": 1}
				],
				"logic": "XOR"
			}`,
			wantError: true,
		},
		{
			name: "No conditions",
			rules: `{
				"conditions": [],
				"logic": "AND"
			}`,
			wantError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			crowd := &UserCrowd{Rules: tt.rules}
			_, err := crowd.ParseRules()
			if (err != nil) != tt.wantError {
				t.Errorf("ParseRules() error = %v, wantError %v", err, tt.wantError)
			}
		})
	}
}

func TestBuildSQLQuery(t *testing.T) {
	tests := []struct {
		name      string
		rules     string
		wantError bool
		checkSQL  bool
	}{
		{
			name: "Simple equality",
			rules: `{
				"conditions": [
					{"field": "account_type", "operator": "=", "value": 1}
				],
				"logic": "AND"
			}`,
			wantError: false,
			checkSQL:  true,
		},
		{
			name: "Multiple conditions with AND",
			rules: `{
				"conditions": [
					{"field": "account_type", "operator": "=", "value": 1},
					{"field": "status", "operator": "=", "value": 1}
				],
				"logic": "AND"
			}`,
			wantError: false,
			checkSQL:  true,
		},
		{
			name: "IN operator",
			rules: `{
				"conditions": [
					{"field": "status", "operator": "in", "value": "1,2,3"}
				],
				"logic": "AND"
			}`,
			wantError: false,
			checkSQL:  true,
		},
		{
			name: "Time comparison",
			rules: `{
				"conditions": [
					{"field": "created_at", "operator": "<=", "value": "7_days_ago"}
				],
				"logic": "AND"
			}`,
			wantError: false,
			checkSQL:  true,
		},
		{
			name: "BETWEEN operator",
			rules: `{
				"conditions": [
					{"field": "created_at", "operator": "between", "value": "2024-01-01,2024-12-31"}
				],
				"logic": "AND"
			}`,
			wantError: false,
			checkSQL:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			crowd := &UserCrowd{Rules: tt.rules}
			sql, args, err := crowd.BuildSQLQuery()
			if (err != nil) != tt.wantError {
				t.Errorf("BuildSQLQuery() error = %v, wantError %v", err, tt.wantError)
				return
			}
			if tt.checkSQL && sql == "" {
				t.Error("BuildSQLQuery() returned empty SQL")
			}
			if tt.checkSQL && len(args) == 0 {
				t.Error("BuildSQLQuery() returned empty args")
			}
			if !tt.wantError {
				t.Logf("SQL: %s, Args: %v", sql, args)
			}
		})
	}
}

func TestParseTimeValue(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name      string
		value     interface{}
		wantError bool
		check     func(time.Time) bool
	}{
		{
			name:      "30_days_ago",
			value:     "30_days_ago",
			wantError: false,
			check: func(t time.Time) bool {
				expected := now.AddDate(0, 0, -30)
				return t.Year() == expected.Year() && t.Month() == expected.Month() && t.Day() == expected.Day()
			},
		},
		{
			name:      "7_days_ago",
			value:     "7_days_ago",
			wantError: false,
			check: func(t time.Time) bool {
				expected := now.AddDate(0, 0, -7)
				return t.Year() == expected.Year() && t.Month() == expected.Month() && t.Day() == expected.Day()
			},
		},
		{
			name:      "today",
			value:     "today",
			wantError: false,
			check: func(t time.Time) bool {
				return t.Year() == now.Year() && t.Month() == now.Month() && t.Day() == now.Day() &&
					t.Hour() == 0 && t.Minute() == 0 && t.Second() == 0
			},
		},
		{
			name:      "this_month",
			value:     "this_month",
			wantError: false,
			check: func(t time.Time) bool {
				return t.Year() == now.Year() && t.Month() == now.Month() && t.Day() == 1
			},
		},
		{
			name:      "RFC3339 format",
			value:     "2024-01-01T00:00:00Z",
			wantError: false,
			check: func(t time.Time) bool {
				return t.Year() == 2024 && t.Month() == time.January && t.Day() == 1
			},
		},
		{
			name:      "Date only format",
			value:     "2024-06-03",
			wantError: false,
			check: func(t time.Time) bool {
				return t.Year() == 2024 && t.Month() == time.June && t.Day() == 3
			},
		},
		{
			name:      "Invalid format",
			value:     "invalid-date",
			wantError: true,
		},
		{
			name:      "Already time.Time",
			value:     now,
			wantError: false,
			check: func(t time.Time) bool {
				return t.Equal(now)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := parseTimeValue(tt.value)
			if (err != nil) != tt.wantError {
				t.Errorf("parseTimeValue() error = %v, wantError %v", err, tt.wantError)
				return
			}
			if !tt.wantError && tt.check != nil && !tt.check(result) {
				t.Errorf("parseTimeValue() result check failed, got %v", result)
			}
		})
	}
}

func TestUserMatchesCrowd(t *testing.T) {
	// 设置 Mock Provider
	mockProvider := NewMockUserProvider()
	now := time.Now()

	// 添加测试用户
	mockProvider.AddMockUser(&UserBasicInfo{
		Id:          1,
		Username:    "test_user_1",
		DisplayName: "测试用户1",
		Email:       "user1@test.com",
		Phone:       "+8613800000001",
		AccountType: AccountTypePersonal,
		CreatedAt:   now.AddDate(0, 0, -3), // 3天前注册
		Status:      UserStatusEnabled,
	})
	mockProvider.AddMockUser(&UserBasicInfo{
		Id:          2,
		Username:    "test_user_2",
		DisplayName: "测试用户2",
		Email:       "user2@test.com",
		Phone:       "+8613800000002",
		AccountType: AccountTypeEnterprise,
		CreatedAt:   now.AddDate(0, 0, -30), // 30天前注册
		Status:      UserStatusEnabled,
	})

	SetUserProvider(mockProvider)

	tests := []struct {
		name      string
		crowd     *UserCrowd
		userId    int
		wantMatch bool
		wantError bool
	}{
		{
			name: "Match personal user (account_type=1)",
			crowd: &UserCrowd{
				Rules: `{
					"conditions": [
						{"field": "account_type", "operator": "=", "value": 1}
					],
					"logic": "AND"
				}`,
			},
			userId:    1,
			wantMatch: true,
			wantError: false,
		},
		{
			name: "Not match personal user (enterprise)",
			crowd: &UserCrowd{
				Rules: `{
					"conditions": [
						{"field": "account_type", "operator": "=", "value": 1}
					],
					"logic": "AND"
				}`,
			},
			userId:    2,
			wantMatch: false,
			wantError: false,
		},
		{
			name: "Match with IN operator",
			crowd: &UserCrowd{
				Rules: `{
					"conditions": [
						{"field": "status", "operator": "in", "value": "1,2"}
					],
					"logic": "AND"
				}`,
			},
			userId:    1,
			wantMatch: true,
			wantError: false,
		},
		{
			name: "Invalid user ID",
			crowd: &UserCrowd{
				Rules: `{
					"conditions": [
						{"field": "account_type", "operator": "=", "value": 1}
					],
					"logic": "AND"
				}`,
			},
			userId:    999,
			wantMatch: false,
			wantError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			match, err := tt.crowd.UserMatchesCrowd(tt.userId)
			if (err != nil) != tt.wantError {
				t.Errorf("UserMatchesCrowd() error = %v, wantError %v", err, tt.wantError)
				return
			}
			if !tt.wantError && match != tt.wantMatch {
				t.Errorf("UserMatchesCrowd() = %v, want %v", match, tt.wantMatch)
			}
		})
	}
}

func TestCompareValues(t *testing.T) {
	now := time.Now()
	yesterday := now.AddDate(0, 0, -1)

	tests := []struct {
		name        string
		userValue   interface{}
		operator    string
		targetValue interface{}
		want        bool
		wantError   bool
	}{
		{
			name:        "Equal integers",
			userValue:   1,
			operator:    "=",
			targetValue: 1,
			want:        true,
			wantError:   false,
		},
		{
			name:        "Not equal integers",
			userValue:   1,
			operator:    "!=",
			targetValue: 2,
			want:        true,
			wantError:   false,
		},
		{
			name:        "Time after",
			userValue:   now,
			operator:    ">",
			targetValue: yesterday,
			want:        true,
			wantError:   false,
		},
		{
			name:        "Time before",
			userValue:   yesterday,
			operator:    "<",
			targetValue: now,
			want:        true,
			wantError:   false,
		},
		{
			name:        "In operator - match",
			userValue:   1,
			operator:    "in",
			targetValue: "1,2,3",
			want:        true,
			wantError:   false,
		},
		{
			name:        "In operator - no match",
			userValue:   4,
			operator:    "in",
			targetValue: "1,2,3",
			want:        false,
			wantError:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := compareValues(tt.userValue, tt.operator, tt.targetValue)
			if (err != nil) != tt.wantError {
				t.Errorf("compareValues() error = %v, wantError %v", err, tt.wantError)
				return
			}
			if !tt.wantError && got != tt.want {
				t.Errorf("compareValues() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCrowdRulesSerialization(t *testing.T) {
	rules := CrowdRules{
		Conditions: []CrowdCondition{
			{
				Field:       "account_type",
				Operator:    "=",
				Value:       1,
				Description: "个人用户",
			},
			{
				Field:       "created_at",
				Operator:    "<=",
				Value:       "7_days_ago",
				Description: "注册7天内",
			},
		},
		Logic: "AND",
	}

	// 序列化
	data, err := json.Marshal(rules)
	if err != nil {
		t.Fatalf("Failed to marshal rules: %v", err)
	}

	// 反序列化
	var decoded CrowdRules
	err = json.Unmarshal(data, &decoded)
	if err != nil {
		t.Fatalf("Failed to unmarshal rules: %v", err)
	}

	// 验证
	if decoded.Logic != rules.Logic {
		t.Errorf("Logic mismatch: got %s, want %s", decoded.Logic, rules.Logic)
	}
	if len(decoded.Conditions) != len(rules.Conditions) {
		t.Errorf("Conditions count mismatch: got %d, want %d", len(decoded.Conditions), len(rules.Conditions))
	}
}

func TestBuildConditionSQL(t *testing.T) {
	tests := []struct {
		name      string
		condition CrowdCondition
		wantError bool
		wantSQL   string
	}{
		{
			name: "Simple equality",
			condition: CrowdCondition{
				Field:    "account_type",
				Operator: "=",
				Value:    1,
			},
			wantError: false,
			wantSQL:   "account_type = ?",
		},
		{
			name: "Greater than",
			condition: CrowdCondition{
				Field:    "status",
				Operator: ">",
				Value:    0,
			},
			wantError: false,
			wantSQL:   "status > ?",
		},
		{
			name: "IN operator",
			condition: CrowdCondition{
				Field:    "account_type",
				Operator: "in",
				Value:    "1,2",
			},
			wantError: false,
			wantSQL:   "account_type IN (?,?)",
		},
		{
			name: "BETWEEN operator",
			condition: CrowdCondition{
				Field:    "created_at",
				Operator: "between",
				Value:    "2024-01-01,2024-12-31",
			},
			wantError: false,
			wantSQL:   "created_at BETWEEN ? AND ?",
		},
		{
			name: "Latest purchase time",
			condition: CrowdCondition{
				Field:    "purchase_time",
				Operator: ">=",
				Value:    "7_days_ago",
			},
			wantError: false,
			wantSQL:   "(SELECT MAX(paid_at) FROM orders WHERE orders.user_id = users.id AND orders.status = 'paid') >= ?",
		},
		{
			name: "Paid purchase count",
			condition: CrowdCondition{
				Field:    "purchase_count",
				Operator: "between",
				Value:    "1,3",
			},
			wantError: false,
			wantSQL:   "(SELECT COUNT(*) FROM orders WHERE orders.user_id = users.id AND orders.status = 'paid') BETWEEN ? AND ?",
		},
		{
			name: "Username equals (account center disabled)",
			condition: CrowdCondition{
				Field:    "username",
				Operator: "=",
				Value:    "alice",
			},
			wantError: false,
			wantSQL:   "username IN (?)",
		},
		{
			name: "Username not equals (account center disabled)",
			condition: CrowdCondition{
				Field:    "username",
				Operator: "!=",
				Value:    "alice",
			},
			wantError: false,
			wantSQL:   "username NOT IN (?)",
		},
		{
			name: "Username in list (account center disabled)",
			condition: CrowdCondition{
				Field:    "username",
				Operator: "in",
				Value:    "alice,bob",
			},
			wantError: false,
			wantSQL:   "username IN (?,?)",
		},
		{
			name: "Username not contains (account center disabled)",
			condition: CrowdCondition{
				Field:    "username",
				Operator: "not_like_any",
				Value:    "alice,bob",
			},
			wantError: false,
			wantSQL:   "(username NOT LIKE ? AND username NOT LIKE ?)",
		},
		{
			name: "Unsupported operator",
			condition: CrowdCondition{
				Field:    "status",
				Operator: "LIKE",
				Value:    "%test%",
			},
			wantError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sql, args, err := buildConditionSQL(tt.condition)
			if (err != nil) != tt.wantError {
				t.Errorf("buildConditionSQL() error = %v, wantError %v", err, tt.wantError)
				return
			}
			if !tt.wantError {
				if sql != tt.wantSQL {
					t.Errorf("buildConditionSQL() SQL = %v, want %v", sql, tt.wantSQL)
				}
				if len(args) == 0 {
					t.Error("buildConditionSQL() returned empty args")
				}
				t.Logf("SQL: %s, Args: %v", sql, args)
			}
		})
	}
}

func TestPurchaseFiltersMatchPaidOrders(t *testing.T) {
	oldDB := DB
	t.Cleanup(func() { DB = oldDB })

	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", t.Name())), &gorm.Config{})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	if err = db.Exec("CREATE TABLE users (id INTEGER PRIMARY KEY)").Error; err != nil {
		t.Fatalf("create users table: %v", err)
	}
	if err = db.Exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, paid_at DATETIME)").Error; err != nil {
		t.Fatalf("create orders table: %v", err)
	}
	DB = db

	now := time.Now()
	rows := []struct {
		userID int
		status string
		paidAt time.Time
	}{
		{userID: 1, status: OrderStatusPaid, paidAt: now.Add(-48 * time.Hour)},
		{userID: 1, status: OrderStatusPaid, paidAt: now.Add(-2 * time.Hour)},
		{userID: 1, status: OrderStatusRefunded, paidAt: now.Add(-time.Hour)},
		{userID: 2, status: OrderStatusPaid, paidAt: now.Add(-10 * 24 * time.Hour)},
		{userID: 3, status: OrderStatusPending, paidAt: now.Add(-time.Hour)},
	}
	for userID := 1; userID <= 3; userID++ {
		if err = db.Exec("INSERT INTO users (id) VALUES (?)", userID).Error; err != nil {
			t.Fatalf("insert user: %v", err)
		}
	}
	for i, row := range rows {
		if err = db.Exec("INSERT INTO orders (id, user_id, status, paid_at) VALUES (?, ?, ?, ?)", i+1, row.userID, row.status, row.paidAt).Error; err != nil {
			t.Fatalf("insert order: %v", err)
		}
	}

	tests := []struct {
		name    string
		rules   string
		wantIDs []int
	}{
		{
			name:    "purchase count excludes refunded and pending orders",
			rules:   `{"conditions":[{"field":"purchase_count","operator":">=","value":2}],"logic":"AND"}`,
			wantIDs: []int{1},
		},
		{
			name:    "purchase time uses latest paid order",
			rules:   `{"conditions":[{"field":"purchase_time","operator":">=","value":"7_days_ago"}],"logic":"AND"}`,
			wantIDs: []int{1},
		},
		{
			name:    "zero purchases includes users without paid orders",
			rules:   `{"conditions":[{"field":"purchase_count","operator":"=","value":0}],"logic":"AND"}`,
			wantIDs: []int{3},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			crowd := &UserCrowd{Rules: tt.rules}
			got, err := crowd.GetMatchedUsersWithPagination(0, 0)
			if err != nil {
				t.Fatalf("query matched users: %v", err)
			}
			sort.Ints(got)
			if fmt.Sprint(got) != fmt.Sprint(tt.wantIDs) {
				t.Fatalf("matched users = %v, want %v", got, tt.wantIDs)
			}
		})
	}
}
