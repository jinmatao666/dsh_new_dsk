package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsValidPhone(t *testing.T) {
	assert.True(t, isValidPhone("13800000000"))
	assert.True(t, isValidPhone("19912345678"))
	assert.False(t, isValidPhone(""))
	assert.False(t, isValidPhone("1380000000"))   // 10 位
	assert.False(t, isValidPhone("138000000000")) // 12 位
	assert.False(t, isValidPhone("23800000000"))  // 首位非 1
	assert.False(t, isValidPhone("1380000000a"))  // 含非数字
}

func TestParseImportLine(t *testing.T) {
	// 逗号分隔，三列齐全
	phone, name, channel := parseImportLine("13800000000,张三,douyin")
	assert.Equal(t, "13800000000", phone)
	assert.Equal(t, "张三", name)
	assert.Equal(t, "douyin", channel)

	// 仅手机号
	phone, name, channel = parseImportLine("13800000000")
	assert.Equal(t, "13800000000", phone)
	assert.Equal(t, "", name)
	assert.Equal(t, "", channel)

	// 制表符分隔
	phone, name, channel = parseImportLine("13800000000\t李四\txiaohongshu")
	assert.Equal(t, "13800000000", phone)
	assert.Equal(t, "李四", name)
	assert.Equal(t, "xiaohongshu", channel)

	// 带空格，去除两端空白
	phone, name, _ = parseImportLine(" 13800000000 , 王五 ")
	assert.Equal(t, "13800000000", phone)
	assert.Equal(t, "王五", name)
}
