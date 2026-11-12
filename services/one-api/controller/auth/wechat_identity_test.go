package auth

import (
	"encoding/json"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common/snowflake"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"net/http/httptest"
	"testing"
	"time"
)

func TestWeChatPollRequiresPhoneUnlessUsernamePasswordExists(t *testing.T) {
	require.NoError(t, snowflake.Init(0))
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	oldDB, oldAC := model.DB, model.ACCOUNT_DB
	model.DB, model.ACCOUNT_DB = db, db
	t.Cleanup(func() { model.DB, model.ACCOUNT_DB = oldDB, oldAC; sqlDB, _ := db.DB(); sqlDB.Close() })
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Account{}, &model.AccountProduct{}, &model.AccountIdentifier{}, &model.AccountProfile{}, &model.AccountCredential{}))
	router := gin.New()
	router.Use(sessions.Sessions("test", cookie.NewStore([]byte("test-key-123456789012345678901234"))))
	router.GET("/poll", WeChatQRPoll)
	for i, tc := range []struct {
		name                 string
		phone, password      bool
		wantName, wantStatus string
	}{
		{"custom_user", true, false, "custom_user", "success"},
		{"", true, false, "13800138000", "success"},
		{"custom_user", false, false, "custom_user", "need_bind_phone"},
		{"existing_password", false, true, "existing_password", "success"},
	} {
		accountID := int64(100 + i)
		userID := 1 + i
		require.NoError(t, db.Create(&model.Account{Id: accountID, Status: model.AccountStatusEnabled}).Error)
		require.NoError(t, db.Create(&model.User{Id: userID, Username: "acc_placeholder_" + string(rune('a'+i)), AccountId: &accountID, AccessToken: "token_" + string(rune('a'+i)), AffCode: "aff_" + string(rune('a'+i)), Status: model.UserStatusEnabled}).Error)
		require.NoError(t, db.Create(&model.AccountProduct{AccountId: accountID, ProductCode: model.ProductCodeParvis, LocalUserId: int64(userID)}).Error)
		if tc.name != "" {
			require.NoError(t, db.Create(&model.AccountIdentifier{Id: int64(200 + i*2), AccountId: accountID, Type: model.IdentifierTypeUsername, Identifier: tc.name + string(rune('a'+i)), Verified: true}).Error)
		}
		if tc.password {
			require.NoError(t, db.Create(&model.AccountCredential{AccountId: accountID, PasswordHash: "existing-hash"}).Error)
		}
		if tc.phone {
			require.NoError(t, db.Create(&model.AccountIdentifier{Id: int64(201 + i*2), AccountId: accountID, Type: model.IdentifierTypePhone, Identifier: "1380013800" + string(rune('0'+i)), Verified: true}).Error)
		}
		state := "identity-" + string(rune('a'+i))
		wechatStateStore.Store(state, &wechatQRResult{Status: "success", CreatedAt: time.Now(), User: &model.User{Id: userID, Username: "acc_stale"}})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", "/poll?state="+state, nil))
		var response struct {
			Status string `json:"status"`
			Data   struct {
				Username string `json:"username"`
				Id       int    `json:"id"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response), w.Body.String())
		require.Equal(t, tc.wantStatus, response.Status)
		want := tc.wantName
		if tc.name != "" {
			want = tc.name + string(rune('a'+i))
		} else {
			want = "1380013800" + string(rune('0'+i))
		}
		require.Equal(t, want, response.Data.Username)
		require.Equal(t, userID, response.Data.Id)
	}
}
