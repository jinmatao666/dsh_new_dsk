package model

import (
	"testing"

	"github.com/songquanpeng/one-api/common"
	"github.com/stretchr/testify/require"
)

func TestPasswordPunctuationAccountCenter(t *testing.T) {
	mainDB, accountDB := setupAccountTestDB(t)
	hash, err := common.Password2Hash("Abc123!")
	require.NoError(t, err)
	user := &User{Username: "punctuation", Password: hash, Status: UserStatusEnabled, AccessToken: "punctuation_token", AffCode: "punctuation_aff"}
	require.NoError(t, mainDB.Create(user).Error)
	_, err = EnsureAccountForUser(user)
	require.NoError(t, err)

	for _, password := range []string{"Abc123!", "Abc123！"} {
		login := &User{Username: "punctuation", Password: password}
		require.NoError(t, login.ValidateAndFill())
		require.Equal(t, user.Id, login.Id)
		ok, err := ValidateAccountPasswordByLocalUserID(user.Id, password)
		require.NoError(t, err)
		require.True(t, ok)
	}
	bad := &User{Username: "punctuation", Password: "abc123！"}
	require.Error(t, bad.ValidateAndFill())
	var credential AccountCredential
	require.NoError(t, accountDB.First(&credential, "account_id = ?", user.AccountId).Error)
	require.Equal(t, hash, credential.PasswordHash)
}

func TestPasswordPunctuationLegacyAccount(t *testing.T) {
	mainDB, _ := setupAccountTestDB(t)
	ACCOUNT_DB = nil
	hash, err := common.Password2Hash("Abc123!")
	require.NoError(t, err)
	user := &User{Username: "legacy_punctuation", Password: hash, Status: UserStatusEnabled, AccessToken: "legacy_punctuation_token", AffCode: "legacy_punctuation_aff"}
	require.NoError(t, mainDB.Create(user).Error)
	login := &User{Username: user.Username, Password: "Abc123！"}
	require.NoError(t, login.ValidateAndFill())
	require.Equal(t, user.Id, login.Id)
	var stored User
	require.NoError(t, mainDB.First(&stored, user.Id).Error)
	require.Equal(t, hash, stored.Password)
}
