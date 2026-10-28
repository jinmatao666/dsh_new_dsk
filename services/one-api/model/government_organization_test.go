package model

import (
	"encoding/json"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGovernmentOrganizationEmptyListIsJSONArray(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	previous := DB
	DB = db
	t.Cleanup(func() { DB = previous })
	require.NoError(t, db.AutoMigrate(&GovernmentOrganizationNode{}))
	nodes, err := ListGovernmentOrganizationNodes()
	require.NoError(t, err)
	encoded, err := json.Marshal(nodes)
	require.NoError(t, err)
	require.Equal(t, "[]", string(encoded))
	node := GovernmentOrganizationNode{Name: "顶层组织"}
	require.NoError(t, SaveGovernmentOrganizationNode(&node))
	nodes, err = ListGovernmentOrganizationNodes()
	require.NoError(t, err)
	require.Len(t, nodes, 1)
	require.Equal(t, node.ID, nodes[0].ID)
}
