package common

import (
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestPasswordChinesePunctuationCompatibility(t *testing.T) {
	cases := []struct {
		name, stored, input string
		match               bool
	}{
		{"exact", "Abc123!", "Abc123!", true},
		{"Chinese exclamation", "Abc123!", "Abc123！", true},
		{"mixed punctuation", "Abc123!?:;,@#()[]{}<>~", "Abc123！？：；，＠＃（）［］｛｝＜＞～", true},
		{"Chinese quotes and brackets", "Abc123'\"[].,<>", "Abc123’”【】。、《》", true},
		{"legacy Chinese punctuation exact", "Abc123！", "Abc123！", true},
		{"legacy Chinese punctuation not rewritten", "Abc123！", "Abc123!", false},
		{"wrong letter", "Abc123!", "Abd123！", false},
		{"wrong punctuation", "Abc123!", "Abc123？", false},
		{"case remains significant", "Abc123!", "abc123！", false},
		{"leading space", "Abc123!", " Abc123！", false},
		{"trailing space", "Abc123!", "Abc123！ ", false},
		{"fullwidth letters", "Abc123!", "Ａbc123！", false},
		{"fullwidth digits", "Abc123!", "Abc１２３！", false},
		{"Han not removed", "Abc123!", "Abc123中！", false},
		{"Han exact unaffected", "密码Abc123!", "密码Abc123!", true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			hash, err := bcrypt.GenerateFromPassword([]byte(test.stored), bcrypt.MinCost)
			if err != nil {
				t.Fatal(err)
			}
			if got := ValidatePasswordAndHash(test.input, string(hash)); got != test.match {
				t.Fatalf("match = %v, want %v", got, test.match)
			}
			if err := bcrypt.CompareHashAndPassword(hash, []byte(test.stored)); err != nil {
				t.Fatal("original password hash was changed")
			}
		})
	}
}

func TestPasswordPunctuationDoesNotChangeHashCreation(t *testing.T) {
	hash, err := Password2Hash("Abc123！")
	if err != nil {
		t.Fatal(err)
	}
	if !ValidatePasswordAndHash("Abc123！", hash) || ValidatePasswordAndHash("Abc123!", hash) {
		t.Fatal("hash creation must preserve original password")
	}
}

func TestPasswordPunctuationInvalidHashAndLongInput(t *testing.T) {
	if ValidatePasswordAndHash("Abc123！", "invalid-hash") {
		t.Fatal("invalid hash accepted")
	}
	// Compatibility also works when multibyte punctuation exceeds bcrypt's
	// creation byte limit, but the existing ASCII password fits that limit.
	stored := strings.Repeat("!", 30)
	hash, err := bcrypt.GenerateFromPassword([]byte(stored), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	if !ValidatePasswordAndHash(strings.Repeat("！", 30), string(hash)) {
		t.Fatal("multibyte punctuation did not match existing ASCII password")
	}
}
