package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/songquanpeng/one-api/common/ctxkey"
	"github.com/songquanpeng/one-api/model"
)

// RequirePersonalAccount 拦截非个体账户访问个人计费/资产入口.
//
// 适用路由:充值订单创建、兑换码、订阅购买、个人账户后台充值等.
// 实现策略:从 ctx 取 user_id,查 users.account_type;企业账户直接 403.
// 注意:必须挂在 UserAuth 之后,以确保 ctxkey.Id 已就绪.
func RequirePersonalAccount() func(c *gin.Context) {
	return func(c *gin.Context) {
		userId := c.GetInt(ctxkey.Id)
		if userId == 0 {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"message": "未登录",
			})
			c.Abort()
			return
		}
		user, err := model.GetUserById(userId, false)
		if err != nil || user == nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"message": "用户不存在",
			})
			c.Abort()
			return
		}
		if user.AccountType == model.AccountTypeEnterprise {
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"message": "企业账户不支持此操作,请联系企业管理员",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}
