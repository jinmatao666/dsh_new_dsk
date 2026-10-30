package controller

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestExpertWebFieldErrorsReachCreateAndUpdate(t *testing.T) {
	cases := []struct {
		field   string
		value   string
		message string
	}{
		{"key", "Bad_Key", "专家编号须为3至80位，以小写字母开头，只能包含小写字母、数字和短横线（-）"},
		{"name", "", "请填写专家名称"},
		{"name", strings.Repeat("字", 101), "专家名称不能超过100字"},
		{"provider", "  ", "请填写提供方，例如 wanwei"},
		{"provider", strings.Repeat("字", 101), "提供方不能超过100字"},
		{"summary", strings.Repeat("字", 501), "专家简介不能超过500字"},
		{"footer_note", strings.Repeat("字", 501), "弹窗底部说明不能超过500字"},
		{"workbench_url", "file:///test", "工作台必须使用有效的 HTTP 或 HTTPS 地址"},
		{"icon", strings.Repeat("x", 60*1024+1), "专家图标编码后超过60 KB，请压缩或更换较小的图片"},
		{"icon", "invalid icon", "专家图标格式无效，请使用PNG、JPEG、WebP或GIF图片"},
		{"tags", "{}", "标签格式无效，应为文字标签数组"},
		{"tags", "[" + strings.TrimSuffix(strings.Repeat(`"tag",`, 13), ",") + "]", "标签不能超过12个，请删除多余标签"},
		{"detail_sections", "{}", "介绍弹窗区块格式无效，请刷新页面后重新填写"},
		{"detail_sections", "[" + strings.TrimSuffix(strings.Repeat(`{},`, 9), ",") + "]", "介绍弹窗区块不能超过8个"},
	}
	for _, row := range cases {
		for _, update := range []bool{false, true} {
			if update && row.field == "key" {
				continue
			} // Updates use the immutable route key.
			t.Run(row.field+row.message+map[bool]string{false: "create", true: "update"}[update], func(t *testing.T) {
				payload := map[string]string{"key": "valid-expert", "name": "测试", "provider": "wanwei", "workbench_url": "https://example.com/", "tags": "[]"}
				payload[row.field] = row.value
				body, _ := json.Marshal(payload)
				recorder := httptest.NewRecorder()
				ctx, _ := gin.CreateTestContext(recorder)
				ctx.Request = httptest.NewRequest("POST", "/", strings.NewReader(string(body)))
				ctx.Request.Header.Set("Content-Type", "application/json")
				if update {
					ctx.Params = gin.Params{{Key: "key", Value: "valid-expert"}}
					AdminUpdateExpertWebsite(ctx)
				} else {
					AdminCreateExpertWebsite(ctx)
				}
				var result struct {
					Message string `json:"message"`
				}
				_ = json.Unmarshal(recorder.Body.Bytes(), &result)
				if recorder.Code != 400 || result.Message != row.message {
					t.Fatalf("status=%d message=%q expected=%q", recorder.Code, result.Message, row.message)
				}
			})
		}
	}
}

func TestExpertWebCreateDistinguishesDuplicateFromDatabaseFailure(t *testing.T) {
	router := expertWebTestRouter(t)
	body := `{"key":"test-expert","name":"测试","provider":"wanwei","category":"办公工具","workbench_url":"https://example.com/","tags":"[]"}`
	first := expertWebRequest(router, "POST", "/create", body, "")
	if first.Code != 201 {
		t.Fatalf("create: %d %s", first.Code, first.Body.String())
	}
	duplicate := expertWebRequest(router, "POST", "/create", body, "")
	if duplicate.Code != 409 || !strings.Contains(duplicate.Body.String(), "专家编号已存在，请更换编号") {
		t.Fatalf("duplicate: %d %s", duplicate.Code, duplicate.Body.String())
	}
	if err := model.DB.Migrator().DropTable(&model.ExpertWebProfile{}); err != nil {
		t.Fatal(err)
	}
	broken := expertWebRequest(router, "POST", "/create", body, "")
	if broken.Code != 500 || !strings.Contains(broken.Body.String(), "无法检查专家编号") {
		t.Fatalf("database: %d %s", broken.Code, broken.Body.String())
	}
}
