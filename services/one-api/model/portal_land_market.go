package model

// PortalFeatureTicket stores only a digest of a one-use desktop portal launch ticket.
type PortalFeatureTicket struct {
	Hash       string `gorm:"primaryKey;size:64"`
	FeatureKey string `gorm:"size:40;index;not null"`
	UserID     int
	ExpiresAt  int64 `gorm:"index"`
	Consumed   bool  `gorm:"default:false"`
}

// LandMarketProviderSecretOption is the OptionMap key for the land-market provider secret digest.
const LandMarketProviderSecretOption = "LandMarketProviderSecretHash"

// LandMarketFeatureKey identifies land-market portal tickets.
const LandMarketFeatureKey = "landMarket"

// PlanningLectureProviderSecretOption stores the planning lecture provider credential digest.
const PlanningLectureProviderSecretOption = "PlanningLectureProviderSecretHash"

// PlanningLectureFeatureKey identifies planning lecture tickets.
const PlanningLectureFeatureKey = "planningLecture"
