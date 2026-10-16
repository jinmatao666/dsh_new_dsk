package model

import "testing"

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		left, right string
		want        int
	}{
		{"1.0.0", "1.0.0", 0},
		{"2.0.5", "2.0.4", 1},
		{"2.0.4", "2.0.5", -1},
		{"v2.1.0", "2.1.0", 0},   // v 前缀应被忽略
		{"2.1", "2.1.0", 0},      // 缺省段按 0
		{"2.1.1", "2.1", 1},      // 更长且更大
		{"1.10.0", "1.9.0", 1},   // 数值比较非字典序
		{"2.0.4-beta", "2.0.4", 0}, // 段内非数字截断
	}
	for _, tc := range cases {
		if got := compareVersions(tc.left, tc.right); got != tc.want {
			t.Errorf("compareVersions(%q,%q)=%d, want %d", tc.left, tc.right, got, tc.want)
		}
	}
}

func TestMatchesPlatformVersion(t *testing.T) {
	n := &Notification{
		Platforms:  `["app","desktop"]`,
		MinVersion: "2.0.0",
		MaxVersion: "2.5.0",
	}
	// 平台命中 + 版本在区间内
	if !n.matchesPlatformVersion("app", "2.1.0") {
		t.Error("app/2.1.0 应命中")
	}
	// 平台不在列表
	if n.matchesPlatformVersion("web", "2.1.0") {
		t.Error("web 不在平台列表，应不命中")
	}
	// 版本低于下限
	if n.matchesPlatformVersion("app", "1.9.0") {
		t.Error("1.9.0 低于 min，应不命中")
	}
	// 版本高于上限
	if n.matchesPlatformVersion("app", "2.6.0") {
		t.Error("2.6.0 高于 max，应不命中")
	}
	// 边界值(含)
	if !n.matchesPlatformVersion("app", "2.0.0") || !n.matchesPlatformVersion("app", "2.5.0") {
		t.Error("边界版本应命中(闭区间)")
	}
	// 客户端未声明平台/版本 => 不在该维度过滤
	if !n.matchesPlatformVersion("", "") {
		t.Error("未声明平台/版本应放行")
	}
}

func TestMatchesPlatformVersion_NoConstraints(t *testing.T) {
	n := &Notification{} // 无平台/版本限制
	if !n.matchesPlatformVersion("app", "1.0.0") {
		t.Error("无限制时任何平台/版本都应命中")
	}
}

func TestTargetUsersContains(t *testing.T) {
	if !targetUsersContains("[1,2,3]", 2) {
		t.Error("应包含 2")
	}
	if targetUsersContains("[1,2,3]", 4) {
		t.Error("不应包含 4")
	}
	if targetUsersContains("", 1) {
		t.Error("空串应视为不包含")
	}
	if targetUsersContains("not-json", 1) {
		t.Error("非法 JSON 应视为不包含")
	}
}

func TestNotificationValidate(t *testing.T) {
	base := func() *Notification {
		return &Notification{Title: "t", Content: "c", Audience: NotificationAudienceAll, Plane: NotificationPlaneA}
	}
	if err := base().validate(); err != nil {
		t.Errorf("合法通知不应报错: %v", err)
	}
	// 缺标题
	n := base()
	n.Title = ""
	if n.validate() == nil {
		t.Error("缺标题应报错")
	}
	// crowd 定向但未选分群
	n = base()
	n.Audience = NotificationAudienceCrowd
	if n.validate() == nil {
		t.Error("crowd 定向未选分群应报错")
	}
	// crowd 定向且选了分群
	n = base()
	n.Audience = NotificationAudienceCrowd
	cid := 5
	n.CrowdId = &cid
	if err := n.validate(); err != nil {
		t.Errorf("crowd 定向且选分群不应报错: %v", err)
	}
	// Plane B 必须是 notification 类
	n = base()
	n.Plane = NotificationPlaneB
	n.Category = NotificationCategoryInbox
	if n.validate() == nil {
		t.Error("Plane B 非 notification 类应报错")
	}
	// Plane B + notification
	n = base()
	n.Plane = NotificationPlaneB
	n.Category = NotificationCategoryNotification
	if err := n.validate(); err != nil {
		t.Errorf("Plane B + notification 不应报错: %v", err)
	}
}
