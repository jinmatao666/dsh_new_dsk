package timing

import (
	"fmt"
	"strconv"
	"strings"
)

// Field 是 timing 日志中的单个键值对，避免在首包路径调用方拼字符串。
type Field struct {
	Key   string
	Value string
}

// F 构造一个 Field，value 会通过 fmt.Sprint 转为字符串。
func F(key string, value any) Field {
	switch v := value.(type) {
	case string:
		return Field{Key: key, Value: v}
	case int:
		return Field{Key: key, Value: strconv.Itoa(v)}
	case int64:
		return Field{Key: key, Value: strconv.FormatInt(v, 10)}
	case bool:
		return Field{Key: key, Value: strconv.FormatBool(v)}
	default:
		return Field{Key: key, Value: fmt.Sprint(v)}
	}
}

// errorBrief 截断错误摘要：最多 200 字符，去除换行/制表，避免泄露大段 body。
func errorBrief(s string) string {
	if s == "" {
		return ""
	}
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\t", " ")
	s = strings.TrimSpace(s)
	const maxLen = 200
	if len(s) > maxLen {
		s = s[:maxLen]
	}
	return s
}

// formatPairs 将一组 key=value 拼接为日志行片段。value 中如包含空格会被去除。
func formatPairs(pairs []Field) string {
	var b strings.Builder
	for i, p := range pairs {
		if i > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(p.Key)
		b.WriteByte('=')
		b.WriteString(sanitizeValue(p.Value))
	}
	return b.String()
}

// sanitizeValue 去除 value 中的换行和空格，避免破坏单行日志结构。
func sanitizeValue(v string) string {
	if v == "" {
		return ""
	}
	if !strings.ContainsAny(v, " \r\n\t") {
		return v
	}
	r := strings.NewReplacer(" ", "_", "\r", "_", "\n", "_", "\t", "_")
	return r.Replace(v)
}
