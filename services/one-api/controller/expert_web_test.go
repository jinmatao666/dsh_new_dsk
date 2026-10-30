package controller

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/songquanpeng/one-api/model"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func TestExpertWebQueriesQuoteReservedKey(t *testing.T) {
	for _, driver := range []struct {
		name    string
		dialect gorm.Dialector
		quoted  string
	}{
		{"mysql", mysql.New(mysql.Config{DSN: "test:test@tcp(localhost:3306)/test", SkipInitializeWithVersion: true}), "`key`"},
		{"postgres", postgres.Open("host=localhost user=test dbname=test sslmode=disable"), `"key"`},
	} {
		t.Run(driver.name, func(t *testing.T) {
			db, err := gorm.Open(driver.dialect, &gorm.Config{DryRun: true, DisableAutomaticPing: true, SkipDefaultTransaction: true})
			if err != nil {
				t.Fatal(err)
			}
			query := expertWebCatalogQuery(db).Where(clause.Eq{Column: "key", Value: "demo-expert"}).Find(&[]model.ExpertWebProfile{})
			if query.Error != nil {
				t.Fatal(query.Error)
			}
			sql := query.Statement.SQL.String()
			if !strings.Contains(sql, driver.quoted+" = ") || !strings.Contains(sql, ","+driver.quoted) {
				t.Fatalf("reserved key is not quoted in filter/order: %s", sql)
			}
		})
	}
}

func TestExpertWebInputRequiresPortableKeyAndWebURL(t *testing.T) {
	valid := expertWebInput{Key: "geology-analysis", Name: "地质条件分析专家", Category: "空间分析", Provider: "万维", WorkbenchURL: "https://geology.example.com/workbench", Tags: `[]`}
	if err := validateExpertWebInput(valid); err != nil {
		t.Fatalf("valid input rejected: %v", err)
	}
	valid.WorkbenchURL = "http://ac.zjugis.com:3301/"
	if err := validateExpertWebInput(valid); err != nil {
		t.Fatalf("HTTP deployment rejected: %v", err)
	}
	valid.WorkbenchURL = "http://ac.zjugis.com:8088/#/ai"
	if err := validateExpertWebInput(valid); err != nil {
		t.Fatal(err)
	}
	invalid := []expertWebInput{
		{Key: "a", Name: valid.Name, Provider: valid.Provider, WorkbenchURL: valid.WorkbenchURL, Tags: valid.Tags},
		{Key: valid.Key, Name: valid.Name, Provider: valid.Provider, WorkbenchURL: "file:///geology.html", Tags: valid.Tags},
		{Key: valid.Key, Name: valid.Name, Provider: valid.Provider, WorkbenchURL: "https://user:pass@geology.example.com", Tags: valid.Tags},

		{Key: valid.Key, Name: valid.Name, Provider: valid.Provider, WorkbenchURL: valid.WorkbenchURL, Tags: `{"not":"array"}`},
	}
	for _, input := range invalid {
		if err := validateExpertWebInput(input); err == nil {
			t.Fatalf("invalid input accepted: %#v", input)
		}
	}
}

func TestExpertWebPresentationFields(t *testing.T) {
	icon := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("image"))
	valid := expertWebInput{Key: "meeting-minutes", Name: "会议纪要", Provider: "wanwei", WorkbenchURL: "https://example.com/", Tags: `[]`, Icon: icon, FooterNote: "生成正式纪要"}
	if err := validateExpertWebInput(valid); err != nil {
		t.Fatalf("valid presentation rejected: %v", err)
	}
	profile := expertWebFromInput(valid)
	if profile.Icon != icon || profile.FooterNote != valid.FooterNote {
		t.Fatal("icon or footer note was not preserved")
	}
	valid.Icon = "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte("<svg/>"))
	if validateExpertWebInput(valid) == nil {
		t.Fatal("unsupported image type accepted")
	}
	valid.Icon = "data:image/png;base64," + strings.Repeat("a", 60*1024)
	if validateExpertWebInput(valid) == nil {
		t.Fatal("oversized image accepted")
	}
}

func TestExpertWebDigestDoesNotStoreRawCredential(t *testing.T) {
	secret, err := expertWebRandom()
	if err != nil || len(secret) != 64 {
		t.Fatalf("cannot generate secret: %v", err)
	}
	if expertWebDigest(secret) == secret || expertWebDigest(secret) == expertWebDigest(secret+"x") {
		t.Fatal("secret digest is not distinct from the credential")
	}
}
