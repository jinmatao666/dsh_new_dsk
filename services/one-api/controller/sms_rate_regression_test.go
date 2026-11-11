package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/songquanpeng/one-api/common/config"
	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The second handler call must stop before resolving a real SMS provider.
func TestPasswordSMSHonorsSharedPhoneCooldown(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	conn, err := db.DB()
	require.NoError(t, err)
	defer conn.Close()
	oldDB, oldAC, oldSMS := model.DB, model.ACCOUNT_DB, config.SMSEnabled
	model.DB, model.ACCOUNT_DB, config.SMSEnabled = db, nil, true
	defer func() { model.DB, model.ACCOUNT_DB, config.SMSEnabled = oldDB, oldAC, oldSMS }()
	require.NoError(t, db.AutoMigrate(&model.User{}))
	const phone = "13966668888"
	require.NoError(t, db.Create(&model.User{Id: 77, Username: "sms_test", Phone: "+86" + phone, PhoneVerified: true}).Error)
	phoneRateLimitMutex.Lock()
	previous, existed := phoneRateLimitMap[phone]
	phoneRateLimitMap[phone] = []time.Time{time.Now()}
	phoneRateLimitMutex.Unlock()
	defer func() {
		phoneRateLimitMutex.Lock()
		defer phoneRateLimitMutex.Unlock()
		if existed {
			phoneRateLimitMap[phone] = previous
		} else {
			delete(phoneRateLimitMap, phone)
		}
	}()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("POST", "/", nil)
	c.Set(ctxkey.Id, 77)
	SendResetPasswordCode(c)
	require.True(t, strings.Contains(recorder.Body.String(), "发送过于频繁"), recorder.Body.String())
	require.False(t, checkPhoneRateLimit("+86"+phone))
}
