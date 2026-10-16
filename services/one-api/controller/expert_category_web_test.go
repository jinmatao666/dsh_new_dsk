package controller

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/songquanpeng/one-api/model"
)

func TestExpertWebsiteCategoryManagement(t *testing.T) {
	expertWebTestRouter(t)
	if err := model.DB.AutoMigrate(&model.ExpertProfile{}); err != nil {
		t.Fatal(err)
	}
	legacy := model.ExpertProfile{Key: "legacy", Name: "旧专家", Category: "办公工具"}
	website := model.ExpertWebProfile{Key: "website", Name: "网站专家", Category: "办公工具"}
	for _, row := range []interface{}{&legacy, &website} {
		if err := model.DB.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	router.GET("/categories", ListExpertCategories)
	router.PUT("/categories/:id", UpdateExpertCategory)
	router.DELETE("/categories/:id", DeleteExpertCategory)
	response := expertWebRequest(router, "GET", "/categories", "", "")
	var result struct {
		Data []struct {
			Id          uint64 `json:"id"`
			ExpertCount int64  `json:"expert_count"`
			WebCount    int64  `json:"web_expert_count"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || len(result.Data) != 1 || result.Data[0].ExpertCount != 1 || result.Data[0].WebCount != 1 {
		t.Fatalf("separate counts: %d %s", response.Code, response.Body.String())
	}
	path := fmt.Sprintf("/categories/%d", result.Data[0].Id)
	response = expertWebRequest(router, "PUT", path, `{"name":"文档工具","status":1}`, "")
	if response.Code != 200 {
		t.Fatalf("rename: %s", response.Body.String())
	}
	model.DB.First(&website, "key = ?", website.Key)
	model.DB.First(&legacy, "key = ?", legacy.Key)
	if website.Category != "文档工具" || legacy.Category != "文档工具" {
		t.Fatal("rename must preserve both expert catalogs")
	}
	if err := model.DB.Delete(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	response = expertWebRequest(router, "PUT", path, `{"name":"文档工具","status":0}`, "")
	if response.Code != 400 {
		t.Fatalf("cannot disable a website's category: %s", response.Body.String())
	}
	response = expertWebRequest(router, "DELETE", path, "", "")
	if response.Code != 400 {
		t.Fatalf("cannot delete a website's category: %s", response.Body.String())
	}
	if err := model.DB.Delete(&website).Error; err != nil {
		t.Fatal(err)
	}
	response = expertWebRequest(router, "DELETE", path, "", "")
	if response.Code != 200 {
		t.Fatalf("delete unused category: %s", response.Body.String())
	}
}
