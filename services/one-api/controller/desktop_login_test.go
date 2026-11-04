package controller

import (
	"encoding/json"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/common/snowflake"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDesktopPhoneRegistrationAndExistingAccount(t *testing.T) {
	require.NoError(t, snowflake.Init(0))
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	oldDB, oldAC, oldLog, oldOptions := model.DB, model.ACCOUNT_DB, model.LOG_DB, config.OptionMap
	oldRegister, oldPhoneRegister, oldPhoneLogin := config.RegisterEnabled, config.PhoneRegisterEnabled, config.PhoneLoginEnabled
	t.Cleanup(func() {
		model.DB, model.ACCOUNT_DB, model.LOG_DB, config.OptionMap = oldDB, oldAC, oldLog, oldOptions
		config.RegisterEnabled, config.PhoneRegisterEnabled, config.PhoneLoginEnabled = oldRegister, oldPhoneRegister, oldPhoneLogin
	})
	model.DB, model.ACCOUNT_DB, model.LOG_DB = db, db, db
	config.RegisterEnabled, config.PhoneRegisterEnabled, config.PhoneLoginEnabled = true, true, true
	config.OptionMap = map[string]string{"RegistrationDefaultRole": "", "RegistrationAgreementText": "协议正文", "RegistrationPrivacyText": "隐私正文"}
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Role{}, &model.Token{}, &model.Log{}, &model.RechargePackage{}, &model.Account{}, &model.AccountProduct{}, &model.AccountProfile{}, &model.AccountIdentifier{}, &model.AccountCredential{}))
	require.NoError(t, db.Create(&model.Role{Role: 3, Name: "注册用户", Status: 1, Permissions: json.RawMessage(`{}`)}).Error)
	router := gin.New()
	router.Use(sessions.Sessions("test", cookie.NewStore([]byte("local-test-secret-1234567890123456"))))
	router.POST("/login", PhoneLogin)
	router.POST("/register", PhoneRegister)
	router.POST("/reset", ResetPasswordByPhonePublic)
	call := func(path, body string) map[string]interface{} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, r)
		var value map[string]interface{}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &value), w.Body.String())
		return value
	}
	const phone = "13800138000"
	common.RegisterPhoneVerificationCode(phone, common.PhoneLoginPurpose, "123456")
	defer common.DeletePhoneVerificationCode(phone, common.PhoneLoginPurpose)
	require.Equal(t, "phone_not_registered", call("/login", `{"phone":"13800138000","code":"123456"}`)["code"])
	body := `{"phone":"13800138000","code":"123456","password":"Password123","use_login_sms":true,"agreed":true}`
	require.Equal(t, false, call("/register", strings.Replace(body, `"agreed":true`, `"agreed":false`, 1))["success"])
	registered := call("/register", body)
	require.Equal(t, true, registered["success"], registered)
	created := registered["data"].(map[string]interface{})
	id := created["id"]
	require.Equal(t, float64(3), created["role"])
	var count int64
	db.Model(&model.User{}).Count(&count)
	require.Equal(t, int64(1), count)
	// Existing accounts keep their role and local user ID on subsequent SMS login.
	db.Model(&model.User{}).Where("id = ?", id).Update("role", 1)
	common.RegisterPhoneVerificationCode(phone, common.PhoneLoginPurpose, "654321")
	logged := call("/login", `{"phone":"13800138000","code":"654321"}`)
	require.Equal(t, true, logged["success"], logged)
	require.Equal(t, id, logged["data"].(map[string]interface{})["id"])
	require.Equal(t, float64(1), logged["data"].(map[string]interface{})["role"])
	require.Equal(t, false, call("/login", `{"phone":"13800138000","code":"654321"}`)["success"])
	common.RegisterPhoneVerificationCode(phone, common.PhoneResetPasswordPurpose, "222222")
	reset := call("/reset", `{"phone":"13800138000","code":"222222","new_password":"Changed123"}`)
	require.Equal(t, true, reset["success"], reset)
	db.Model(&model.User{}).Count(&count)
	require.Equal(t, int64(1), count)
	matched, err := model.ValidateAccountPasswordByLocalUserID(int(id.(float64)), "Changed123")
	require.NoError(t, err)
	require.True(t, matched)
	matched, err = model.ValidateAccountPasswordByLocalUserID(int(id.(float64)), "Password123")
	require.NoError(t, err)
	require.False(t, matched)
	common.RegisterPhoneVerificationCode("13900139000", common.PhoneLoginPurpose, "333333")
	outcomes := make(chan []byte, 2)
	for i := 0; i < 2; i++ {
		go func() {
			w := httptest.NewRecorder()
			request := httptest.NewRequest("POST", "/register", strings.NewReader(`{"phone":"13900139000","code":"333333","use_login_sms":true,"agreed":true}`))
			request.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(w, request)
			outcomes <- w.Body.Bytes()
		}()
	}
	successes := 0
	for i := 0; i < 2; i++ {
		var result map[string]interface{}
		require.NoError(t, json.Unmarshal(<-outcomes, &result))
		if result["success"] == true {
			successes++
		}
	}
	require.Equal(t, 1, successes, "duplicate submissions must create only one account")
	db.Model(&model.User{}).Count(&count)
	require.Equal(t, int64(2), count)
}

func TestDesktopLoginOptionsRequireRoot(t *testing.T) {
	for _, key := range []string{"RegistrationDefaultRole", "SMSEnabled", "WeChatAppSecret"} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set(ctxkey.Id, 7)
		c.Set(ctxkey.Role, 1)
		c.Request = httptest.NewRequest("PUT", "/", strings.NewReader(`{"key":"`+key+`","value":"true"}`))
		UpdateOption(c)
		require.Equal(t, 403, w.Code, w.Body.String())
	}
}
