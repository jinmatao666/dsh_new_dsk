package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// CrowdRules 分群规则结构
type CrowdRules struct {
	Conditions []CrowdCondition `json:"conditions"`
	Logic      string           `json:"logic"` // 兼容旧数据：全局逻辑，仅当条件未携带 connector 时作为回退
}

// CrowdCondition 分群条件
type CrowdCondition struct {
	Field       string      `json:"field"`
	Operator    string      `json:"operator"`
	Value       interface{} `json:"value"`
	Description string      `json:"description"`
	Connector   string      `json:"connector"` // AND/OR，表示与上一个条件之间的连接符（第一个条件忽略）
}

// resolveConnector 解析第 i 个条件与上一个条件之间的连接符
// 优先使用条件自带的 connector，回退到全局 Logic，再回退到 AND
func (r *CrowdRules) resolveConnector(i int) string {
	if i > 0 && i < len(r.Conditions) {
		switch strings.ToUpper(r.Conditions[i].Connector) {
		case "AND", "OR":
			return strings.ToUpper(r.Conditions[i].Connector)
		}
	}
	if strings.ToUpper(r.Logic) == "OR" {
		return "OR"
	}
	return "AND"
}

// ParseRules 解析分群规则 JSON
func (c *UserCrowd) ParseRules() (*CrowdRules, error) {
	if c.Rules == "" {
		return nil, errors.New("分群规则不能为空")
	}

	var rules CrowdRules
	if err := json.Unmarshal([]byte(c.Rules), &rules); err != nil {
		return nil, fmt.Errorf("解析分群规则失败: %v", err)
	}

	// 验证条件
	if len(rules.Conditions) == 0 {
		return nil, errors.New("分群规则至少需要一个条件")
	}

	return &rules, nil
}

// BuildSQLQuery 根据规则构建 SQL 查询
func (c *UserCrowd) BuildSQLQuery() (string, []interface{}, error) {
	rules, err := c.ParseRules()
	if err != nil {
		return "", nil, err
	}

	var parts []string
	var args []interface{}

	for i, condition := range rules.Conditions {
		sql, condArgs, err := buildConditionSQL(condition)
		if err != nil {
			return "", nil, fmt.Errorf("构建条件失败 [%s]: %v", condition.Field, err)
		}
		if i > 0 {
			parts = append(parts, " "+rules.resolveConnector(i)+" ")
		}
		parts = append(parts, "("+sql+")")
		args = append(args, condArgs...)
	}

	if len(parts) == 0 {
		return "", nil, errors.New("没有有效的查询条件")
	}

	// AND/OR 按 SQL 原生优先级求值（AND 紧于 OR），与从左到右的自然阅读一致
	whereClause := strings.Join(parts, "")
	return whereClause, args, nil
}

// allowedFields 是允许在 SQL 查询中使用的字段白名单，防止 SQL 注入
var allowedFields = map[string]bool{
	"id":             true,
	"username":       true,
	"created_at":     true,
	"last_active_at": true,
	"purchase_time":  true,
	"purchase_count": true,
	"used_quota":     true,
	"quota":          true,
	"request_count":  true,
	"account_type":   true,
	"status":         true,
}

// buildConditionSQL 为单个条件构建 SQL
func buildConditionSQL(condition CrowdCondition) (string, []interface{}, error) {
	field := condition.Field
	operator := condition.Operator
	value := condition.Value

	if !allowedFields[field] {
		return "", nil, fmt.Errorf("不支持的字段: %s", field)
	}

	// 购买字段来自订单表。时间取最近一次有效支付，次数仅统计当前仍为已支付的订单，
	// 因此退款、取消和未支付订单不会进入用户运营筛选结果。
	fieldExpression := field
	switch field {
	case "purchase_time":
		fieldExpression = "(SELECT MAX(paid_at) FROM orders WHERE orders.user_id = users.id AND orders.status = 'paid')"
	case "purchase_count":
		fieldExpression = "(SELECT COUNT(*) FROM orders WHERE orders.user_id = users.id AND orders.status = 'paid')"
	}

	// 根据操作符构建 SQL
	// username 是受管标识(真实值在账号中心,users.username 可能是占位符),
	// 精确类操作符(=/!=/包含于)须同时比对本地 username 列与账号中心,
	// 否则会漏掉真实用户名存在账号中心的用户。
	if field == "username" {
		switch operator {
		case "=", "!=", "in":
			return buildUsernameExactSQL(operator, value)
		}
	}

	switch operator {
	case ">", "<", ">=", "<=", "=", "!=":
		// 解析特殊时间值
		if isTimeField(field) {
			parsedValue, err := parseTimeValue(value)
			if err != nil {
				return "", nil, err
			}
			value = parsedValue
		}
		return fmt.Sprintf("%s %s ?", fieldExpression, operator), []interface{}{value}, nil
	case "in":
		// value 应该是数组或逗号分隔的字符串
		valueStr, ok := value.(string)
		if !ok {
			return "", nil, errors.New("in 操作符的值必须是字符串")
		}
		values := strings.Split(valueStr, ",")
		placeholders := strings.Repeat("?,", len(values))
		placeholders = placeholders[:len(placeholders)-1]
		args := make([]interface{}, len(values))
		for i, v := range values {
			args[i] = strings.TrimSpace(v)
		}
		return fmt.Sprintf("%s IN (%s)", fieldExpression, placeholders), args, nil
	case "between":
		// value 应该是 "min,max" 格式
		valueStr, ok := value.(string)
		if !ok {
			return "", nil, errors.New("between 操作符的值必须是字符串")
		}
		parts := strings.Split(valueStr, ",")
		if len(parts) != 2 {
			return "", nil, errors.New("between 操作符的值格式错误，应为 'min,max'")
		}
		// 如果是时间字段，需要解析每个部分
		if isTimeField(field) {
			minTime, err := parseTimeValue(strings.TrimSpace(parts[0]))
			if err != nil {
				return "", nil, fmt.Errorf("解析最小值失败: %v", err)
			}
			maxTime, err := parseTimeValue(strings.TrimSpace(parts[1]))
			if err != nil {
				return "", nil, fmt.Errorf("解析最大值失败: %v", err)
			}
			return fmt.Sprintf("%s BETWEEN ? AND ?", fieldExpression), []interface{}{minTime, maxTime}, nil
		}
		return fmt.Sprintf("%s BETWEEN ? AND ?", fieldExpression), []interface{}{strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])}, nil
	case "like_any":
		// value 是逗号分隔的关键词列表，生成 (field LIKE '%a%' OR field LIKE '%b%')
		valueStr, ok := value.(string)
		if !ok {
			return "", nil, errors.New("like_any 操作符的值必须是字符串")
		}
		keywords := strings.Split(valueStr, ",")
		if len(keywords) == 0 {
			return "", nil, errors.New("like_any 操作符的值不能为空")
		}
		var likeParts []string
		var args []interface{}
		for _, kw := range keywords {
			kw = strings.TrimSpace(kw)
			if kw == "" {
				continue
			}
			likeParts = append(likeParts, fmt.Sprintf("%s LIKE ?", field))
			args = append(args, "%"+kw+"%")
			// username 字段额外查账号中心（手机号/邮箱存在账号中心而非本地）
			if field == "username" {
				accountIDs, err := searchAccountIDsByIdentifier(kw)
				if err == nil && len(accountIDs) > 0 {
					placeholders := strings.Repeat("?,", len(accountIDs))
					placeholders = placeholders[:len(placeholders)-1]
					likeParts = append(likeParts, "account_id IN ("+placeholders+")")
					for _, id := range accountIDs {
						args = append(args, id)
					}
				}
			}
		}
		if len(likeParts) == 0 {
			return "", nil, errors.New("like_any 操作符没有有效关键词")
		}
		return "(" + strings.Join(likeParts, " OR ") + ")", args, nil
	case "not_like_any":
		// value 是逗号分隔的关键词列表，生成所有关键词均不匹配的条件：
		// (field NOT LIKE '%a%' AND field NOT LIKE '%b%' AND (account_id IS NULL OR account_id NOT IN (...)))
		valueStr, ok := value.(string)
		if !ok {
			return "", nil, errors.New("not_like_any 操作符的值必须是字符串")
		}
		var notParts []string
		var args []interface{}
		var accIDSet []int64
		for _, kw := range strings.Split(valueStr, ",") {
			kw = strings.TrimSpace(kw)
			if kw == "" {
				continue
			}
			notParts = append(notParts, fmt.Sprintf("%s NOT LIKE ?", field))
			args = append(args, "%"+kw+"%")
			// username 字段额外查账号中心（手机号/邮箱存在账号中心而非本地）
			if field == "username" {
				if accountIDs, err := searchAccountIDsByIdentifier(kw); err == nil {
					accIDSet = append(accIDSet, accountIDs...)
				}
			}
		}
		if len(notParts) == 0 {
			return "", nil, errors.New("not_like_any 操作符没有有效关键词")
		}
		if len(accIDSet) > 0 {
			placeholders := strings.TrimSuffix(strings.Repeat("?,", len(accIDSet)), ",")
			notParts = append(notParts, fmt.Sprintf("(account_id IS NULL OR account_id NOT IN (%s))", placeholders))
			for _, id := range accIDSet {
				args = append(args, id)
			}
		}
		return "(" + strings.Join(notParts, " AND ") + ")", args, nil
	default:
		return "", nil, fmt.Errorf("不支持的操作符: %s", operator)
	}
}

// buildUsernameExactSQL 为 username 字段的精确操作符(=/!=/包含于 in)构建 SQL。
// username 真实值可能存在账号中心,故同时比对本地 username 列与命中的 account_id:
//   - = / in：(username IN (?) OR account_id IN (?))，任一命中即算匹配
//   - !=     ：(username != ? AND (account_id IS NULL OR account_id NOT IN (?)))，两边都不命中才算
func buildUsernameExactSQL(operator string, value interface{}) (string, []interface{}, error) {
	valueStr, ok := value.(string)
	if !ok {
		return "", nil, fmt.Errorf("%s 操作符的值必须是字符串", operator)
	}
	var names []string
	for _, v := range strings.Split(valueStr, ",") {
		if v = strings.TrimSpace(v); v != "" {
			names = append(names, v)
		}
	}
	if len(names) == 0 {
		return "", nil, fmt.Errorf("%s 操作符的值不能为空", operator)
	}
	// = 只取单值；!= 同理；in（包含于）允许多值
	if operator != "in" {
		names = names[:1]
	}

	accountIDs, err := searchAccountIDsByIdentifierExact(names)
	if err != nil {
		return "", nil, err
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(names)), ",")
	nameArgs := make([]interface{}, len(names))
	for i, n := range names {
		nameArgs[i] = n
	}

	if operator == "!=" {
		// 取反：本地列不等且账号中心也未命中
		if len(accountIDs) == 0 {
			return fmt.Sprintf("username NOT IN (%s)", placeholders), nameArgs, nil
		}
		accPlaceholders := strings.TrimSuffix(strings.Repeat("?,", len(accountIDs)), ",")
		args := append([]interface{}{}, nameArgs...)
		for _, id := range accountIDs {
			args = append(args, id)
		}
		sql := fmt.Sprintf("(username NOT IN (%s) AND (account_id IS NULL OR account_id NOT IN (%s)))",
			placeholders, accPlaceholders)
		return sql, args, nil
	}

	// = 与 in：本地列命中或账号中心命中
	if len(accountIDs) == 0 {
		return fmt.Sprintf("username IN (%s)", placeholders), nameArgs, nil
	}
	accPlaceholders := strings.TrimSuffix(strings.Repeat("?,", len(accountIDs)), ",")
	args := append([]interface{}{}, nameArgs...)
	for _, id := range accountIDs {
		args = append(args, id)
	}
	sql := fmt.Sprintf("(username IN (%s) OR account_id IN (%s))", placeholders, accPlaceholders)
	return sql, args, nil
}

// isTimeField 判断是否是时间字段
func isTimeField(field string) bool {
	timeFields := []string{"last_login_at", "created_at", "last_active_at", "purchase_time"}
	for _, tf := range timeFields {
		if field == tf {
			return true
		}
	}
	return false
}

// parseTimeValue 解析时间特殊值
func parseTimeValue(value interface{}) (time.Time, error) {
	// 如果已经是 time.Time，直接返回
	if t, ok := value.(time.Time); ok {
		return t, nil
	}

	// 如果是字符串，解析特殊值
	valueStr, ok := value.(string)
	if !ok {
		return time.Time{}, errors.New("时间值必须是字符串或 time.Time")
	}

	now := time.Now()
	switch valueStr {
	case "30_days_ago":
		return now.AddDate(0, 0, -30), nil
	case "7_days_ago":
		return now.AddDate(0, 0, -7), nil
	case "today":
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()), nil
	case "this_month":
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()), nil
	default:
		// 尝试解析标准时间格式
		formats := []string{
			time.RFC3339,
			"2006-01-02 15:04:05",
			"2006-01-02",
		}
		for _, format := range formats {
			if t, err := time.Parse(format, valueStr); err == nil {
				return t, nil
			}
		}
		return time.Time{}, fmt.Errorf("无法解析时间值: %s", valueStr)
	}
}

// UserMatchesCrowd 检查指定用户是否匹配分群规则
func (c *UserCrowd) UserMatchesCrowd(userId int) (bool, error) {
	rules, err := c.ParseRules()
	if err != nil {
		return false, err
	}

	provider := GetUserProvider()
	userInfo, err := provider.GetUserBasicInfo(userId)
	if err != nil {
		return false, fmt.Errorf("获取用户信息失败: %v", err)
	}

	// 逐个检查条件
	results := make([]bool, len(rules.Conditions))
	for i, condition := range rules.Conditions {
		match, err := evaluateCondition(userInfo, condition)
		if err != nil {
			return false, fmt.Errorf("评估条件失败 [%s]: %v", condition.Field, err)
		}
		results[i] = match
	}

	// 按每对条件的连接符组合，沿用 SQL 的优先级（AND 紧于 OR）：
	// 整体是若干 OR 段，每段内部用 AND 连接；任意一段为真则匹配。
	segment := results[0]
	for i := 1; i < len(results); i++ {
		if rules.resolveConnector(i) == "OR" {
			if segment {
				return true, nil
			}
			segment = results[i]
		} else { // AND
			segment = segment && results[i]
		}
	}
	return segment, nil
}

// evaluateCondition 评估单个条件
func evaluateCondition(user *UserBasicInfo, condition CrowdCondition) (bool, error) {
	field := condition.Field
	operator := condition.Operator
	value := condition.Value

	// 根据字段获取用户数据
	var userValue interface{}
	switch field {
	case "account_type":
		userValue = user.AccountType
	case "status":
		userValue = user.Status
	case "created_at":
		userValue = user.CreatedAt
	case "last_active_at":
		if user.LastActiveAt != nil {
			userValue = *user.LastActiveAt
		} else {
			return false, nil
		}
	default:
		return false, fmt.Errorf("不支持的字段: %s", field)
	}

	// 根据操作符比较
	return compareValues(userValue, operator, value)
}

// compareValues 比较两个值
func compareValues(userValue interface{}, operator string, targetValue interface{}) (bool, error) {
	switch operator {
	case "=":
		return fmt.Sprint(userValue) == fmt.Sprint(targetValue), nil
	case "!=":
		return fmt.Sprint(userValue) != fmt.Sprint(targetValue), nil
	case ">", "<", ">=", "<=":
		// 时间比较
		if t1, ok := userValue.(time.Time); ok {
			t2, err := parseTimeValue(targetValue)
			if err != nil {
				return false, err
			}
			switch operator {
			case ">":
				return t1.After(t2), nil
			case "<":
				return t1.Before(t2), nil
			case ">=":
				return t1.After(t2) || t1.Equal(t2), nil
			case "<=":
				return t1.Before(t2) || t1.Equal(t2), nil
			}
		}
		// 数值比较暂不支持
		return false, errors.New("暂不支持数值比较")
	case "in":
		valueStr := fmt.Sprint(targetValue)
		values := strings.Split(valueStr, ",")
		userValueStr := fmt.Sprint(userValue)
		for _, v := range values {
			if strings.TrimSpace(v) == userValueStr {
				return true, nil
			}
		}
		return false, nil
	default:
		return false, fmt.Errorf("不支持的操作符: %s", operator)
	}
}

// CalculateUserCount 计算并更新用户数量
func (c *UserCrowd) CalculateUserCount() error {
	users, err := c.GetMatchedUsersWithPagination(0, 0)
	if err != nil {
		return fmt.Errorf("计算用户数量失败: %v", err)
	}

	now := time.Now()
	c.UserCount = len(users)
	c.LastCalculatedAt = &now

	// 更新到数据库
	return DB.Model(c).Updates(map[string]interface{}{
		"user_count":         c.UserCount,
		"last_calculated_at": c.LastCalculatedAt,
	}).Error
}

// GetMatchedUsersWithPagination 获取匹配分群规则的用户列表（带分页）
func (c *UserCrowd) GetMatchedUsersWithPagination(offset, limit int) ([]int, error) {
	whereClause, args, err := c.BuildSQLQuery()
	if err != nil {
		return nil, err
	}

	// 构建完整的查询
	query := DB.Table("users").Select("id").Where(whereClause, args...)

	// 添加分页
	if limit > 0 {
		query = query.Limit(limit).Offset(offset)
	}

	var userIds []int
	err = query.Pluck("id", &userIds).Error
	if err != nil {
		return nil, fmt.Errorf("查询用户失败: %v", err)
	}

	return userIds, nil
}

// GetAllUserCrowds 获取所有分群列表
func GetAllUserCrowds(offset, limit int) ([]*UserCrowd, int64, error) {
	var crowds []*UserCrowd
	var total int64

	query := DB.Model(&UserCrowd{})

	// 统计总数
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// 分页查询
	if limit > 0 {
		query = query.Limit(limit).Offset(offset)
	}

	err := query.Order("id desc").Find(&crowds).Error
	return crowds, total, err
}

// GetUserCrowdById 根据ID获取分群
func GetUserCrowdById(id int) (*UserCrowd, error) {
	var crowd UserCrowd
	err := DB.First(&crowd, id).Error
	if err != nil {
		return nil, err
	}
	return &crowd, nil
}

// CreateUserCrowd 创建分群
func CreateUserCrowd(crowd *UserCrowd) error {
	if crowd.Name == "" {
		return errors.New("分群名称不能为空")
	}
	if crowd.Rules == "" {
		return errors.New("分群规则不能为空")
	}

	// 验证规则格式
	_, err := crowd.ParseRules()
	if err != nil {
		return fmt.Errorf("分群规则格式错误: %v", err)
	}

	return DB.Create(crowd).Error
}

// UpdateUserCrowd 更新分群
func UpdateUserCrowd(crowd *UserCrowd) error {
	if crowd.Id == 0 {
		return errors.New("分群ID不能为空")
	}
	if crowd.Name == "" {
		return errors.New("分群名称不能为空")
	}
	if crowd.Rules == "" {
		return errors.New("分群规则不能为空")
	}

	// 验证规则格式
	_, err := crowd.ParseRules()
	if err != nil {
		return fmt.Errorf("分群规则格式错误: %v", err)
	}

	return DB.Model(&UserCrowd{}).Where("id = ?", crowd.Id).Updates(crowd).Error
}

// DeleteUserCrowd 删除分群
func DeleteUserCrowd(id int) error {
	if id == 0 {
		return errors.New("分群ID不能为空")
	}

	// 检查是否有活动正在使用该分群
	var count int64
	err := DB.Model(&Activity{}).Where("target_crowd_id = ? AND status = ?", id, "active").Count(&count).Error
	if err != nil {
		return fmt.Errorf("检查关联活动失败: %v", err)
	}
	if count > 0 {
		return fmt.Errorf("该分群正在被 %d 个活动使用，无法删除", count)
	}

	return DB.Delete(&UserCrowd{}, id).Error
}

// GetCrowdUserDetails 按分群命中的本地用户 id 批量取详情，供分群预览/用户列表展示。
//
// 数据按字段实际所在的库分别取，再拼装(遵守「库可换」铁律，不跨库 JOIN):
//   - 业务/计费字段(account_type/quota/used_quota/request_count/status/group) 来自本地 users 表;
//   - 身份展示字段(display_name/phone/username 等) 经 OverlayUsersIdentity 覆盖为账号中心权威值。
//
// 返回顺序与入参 userIds 一致(GetMatchedUsersWithPagination 已按需分页/排序);
// 缺失的 id 直接跳过。后台展示统一以 account_id 为准,故一并返回 AccountId 字段。
func GetCrowdUserDetails(userIds []int) ([]*User, error) {
	if len(userIds) == 0 {
		return []*User{}, nil
	}

	var users []*User
	groupCol := quoteSQLIdentifier("group")
	err := DB.Select("id", "username", "display_name", "email", "phone", "account_type",
		"account_id", "created_at", "last_active_at", "status", "quota", "used_quota", "request_count", groupCol).
		Where("id IN ?", userIds).
		Find(&users).Error
	if err != nil {
		return nil, fmt.Errorf("查询用户详情失败: %v", err)
	}

	// 叠加账号中心权威身份字段(display_name/phone/username),未启用/未迁移则保留本地值。
	OverlayUsersIdentity(users)

	// 按入参顺序重排,保证分页展示顺序与匹配结果一致。
	byId := make(map[int]*User, len(users))
	for _, u := range users {
		byId[u.Id] = u
	}
	ordered := make([]*User, 0, len(userIds))
	for _, id := range userIds {
		if u, ok := byId[id]; ok {
			ordered = append(ordered, u)
		}
	}
	return ordered, nil
}
