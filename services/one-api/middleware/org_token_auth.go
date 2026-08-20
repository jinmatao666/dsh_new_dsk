package middleware

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"

	"github.com/songquanpeng/one-api/common/config"
)

type OrgClaims struct {
	OrgId   int    `json:"org_id"`
	OrgName string `json:"org_name"`
	jwt.StandardClaims
}

func GenerateOrgToken(orgId int, orgName string) (string, error) {
	claims := OrgClaims{
		OrgId:   orgId,
		OrgName: orgName,
		StandardClaims: jwt.StandardClaims{
			ExpiresAt: time.Now().Add(24 * time.Hour).Unix(),
			IssuedAt:  time.Now().Unix(),
			Issuer:    "org-admin",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(config.SessionSecret))
}

func OrgTokenAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		authHeader := c.Request.Header.Get("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "未提供认证信息"})
			c.Abort()
			return
		}
		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		claims := &OrgClaims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
			return []byte(config.SessionSecret), nil
		})
		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "认证信息无效或已过期"})
			c.Abort()
			return
		}
		c.Set("org_id", claims.OrgId)
		c.Set("org_name", claims.OrgName)
		c.Next()
	}
}
