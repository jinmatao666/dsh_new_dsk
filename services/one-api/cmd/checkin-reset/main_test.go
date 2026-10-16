package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestBindQuery(t *testing.T) {
	query := "SELECT * FROM users WHERE id=? AND status=?"
	assert.Equal(t, query, bindQuery(query, false))
	assert.Equal(t, "SELECT * FROM users WHERE id=$1 AND status=$2", bindQuery(query, true))
}
