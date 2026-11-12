package model

// KnowledgeFolder persists empty desktop folders independently of RAGFlow documents.
type KnowledgeFolder struct {
	Id              int    `json:"id" gorm:"primaryKey"`
	KnowledgeBaseId int    `json:"knowledge_base_id" gorm:"uniqueIndex:uk_knowledge_folder;not null"`
	Name            string `json:"name" gorm:"uniqueIndex:uk_knowledge_folder;type:varchar(512);not null"`
}

// ListKnowledgeFolders returns saved folder paths in display order.
func ListKnowledgeFolders(baseId int) ([]string, error) {
	names := make([]string, 0)
	err := DB.Model(&KnowledgeFolder{}).Where("knowledge_base_id = ?", baseId).Order("name").Pluck("name", &names).Error
	return names, err
}
