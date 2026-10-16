package common

import (
	"strings"

	"golang.org/x/crypto/bcrypt"
)

func Password2Hash(password string) (string, error) {
	passwordBytes := []byte(password)
	hashedPassword, err := bcrypt.GenerateFromPassword(passwordBytes, bcrypt.DefaultCost)
	return string(hashedPassword), err
}

// ValidatePasswordAndHash tries the exact password first, then Chinese punctuation
// converted to ASCII. It never changes stored hashes, letters, case or whitespace.
func ValidatePasswordAndHash(password string, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	if err == nil {
		return true
	}
	if err != bcrypt.ErrMismatchedHashAndPassword {
		return false
	}
	normalized := normalizePasswordPunctuation(password)
	return normalized != password && bcrypt.CompareHashAndPassword([]byte(hash), []byte(normalized)) == nil
}

func normalizePasswordPunctuation(password string) string {
	return strings.Map(func(char rune) rune {
		// Fullwidth ASCII punctuation only; fullwidth letters/digits stay distinct.
		if char >= '\uFF01' && char <= '\uFF5E' {
			ascii := char - 0xFEE0
			if ascii >= '!' && ascii <= '/' || ascii >= ':' && ascii <= '@' ||
				ascii >= '[' && ascii <= '`' || ascii >= '{' && ascii <= '~' {
				return ascii
			}
		}
		switch char {
		case '。':
			return '.'
		case '、':
			return ','
		case '‘', '’':
			return '\''
		case '“', '”':
			return '"'
		case '【':
			return '['
		case '】':
			return ']'
		case '《':
			return '<'
		case '》':
			return '>'
		default:
			return char
		}
	}, password)
}
