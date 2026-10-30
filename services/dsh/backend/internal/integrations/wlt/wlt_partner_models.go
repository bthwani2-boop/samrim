package wlt

import (
	"time"
)

type PartnerFinancialProfile struct {
	ID                 string  `json:"id"`
	JoiningCaseID      string  `json:"joiningCaseId"`
	PartnerActorID     string  `json:"partnerActorId"`
	Origin             string  `json:"origin"`
	SettlementPeriod   string  `json:"settlementPeriod"`
	TermsPolicyVersion string  `json:"termsPolicyVersion,omitempty"`
	RoundingUnitMinor  int64   `json:"roundingUnitMinor"`
	State              string  `json:"state"`
	Version            int     `json:"version"`
	ActivatedAt        *string `json:"activatedAt"`
	CreatedAt          string  `json:"createdAt"`
	UpdatedAt          string  `json:"updatedAt"`
}

type PreparePartnerFinancialProfileInput struct {
	JoiningCaseID      string
	PartnerActorID     string
	Origin             string
	SettlementPeriod   string
	TermsPolicyVersion string
	IdempotencyKey     string
	CorrelationID      string
}

type CreateFieldAcquisitionRewardPolicyInput struct {
	ScopeType         string
	ScopeID           string
	RewardMinor       int64
	RoundingUnitMinor int64
	ExpectedVersion   int
	Reason            string
	IdempotencyKey    string
	CorrelationID     string
	ActingActorID     string
}

type FinalizeFieldAcquisitionRewardInput struct {
	JoiningCaseID         string
	StoreID               string
	PartnerActorID        string
	FieldActorID          string
	VerticalID            string
	CommercialStoreTypeID string
	IdempotencyKey        string
	CorrelationID         string
}

type PartnerOrderEarning struct {
	OrderID                         string `json:"orderId"`
	PaymentIntentID                 string `json:"paymentIntentId"`
	PartnerActorID                  string `json:"partnerActorId"`
	CaptainActorID                  string `json:"captainActorId"`
	Currency                        string `json:"currency"`
	GrossProductMinor               int64  `json:"grossProductMinor"`
	DeliveryFeeMinor                int64  `json:"deliveryFeeMinor"`
	CommissionMinor                 int64  `json:"commissionMinor"`
	PartnerNetMinor                 int64  `json:"partnerNetMinor"`
	CommissionReceivableOffsetMinor int64  `json:"commissionReceivableOffsetMinor"`
	ProfileID                       string `json:"profileId"`
	ProfileVersion                  int    `json:"profileVersion"`
	PolicyVersion                   string `json:"policyVersion"`
	LedgerTransactionID             string `json:"ledgerTransactionId"`
	CreatedAt                       string `json:"createdAt"`
}

type PartnerStoreFinance struct {
	AttributionComplete        bool   `json:"attributionComplete"`
	StoreID                    string `json:"storeId"`
	PartnerActorID             string `json:"partnerActorId"`
	Currency                   string `json:"currency"`
	EarnedMinor                int64  `json:"earnedMinor"`
	CommissionMinor            int64  `json:"commissionMinor"`
	OrderCount                 int64  `json:"orderCount"`
	EligibleAvailableMinor     int64  `json:"eligibleAvailableMinor"`
	HeldMinor                  int64  `json:"heldMinor"`
	SettledMinor               int64  `json:"settledMinor"`
	RecipientState             string `json:"recipientState"`
	BeneficiaryActorID         string `json:"beneficiaryActorId"`
	RecipientAssignmentVersion int64  `json:"recipientAssignmentVersion"`
	PayoutReady                bool   `json:"payoutReady"`
}

type PartnerFinancialSummary struct {
	SettledMinor                         int64                 `json:"settledMinor"`
	EligibleAvailableMinor               int64                 `json:"eligibleAvailableMinor"`
	HeldMinor                            int64                 `json:"heldMinor"`
	Stores                               []PartnerStoreFinance `json:"stores"`
	PartnerActorID                       string                `json:"partnerActorId"`
	Currency                             string                `json:"currency"`
	EarnedMinor                          int64                 `json:"earnedMinor"`
	CommissionMinor                      int64                 `json:"commissionMinor"`
	OutstandingCommissionReceivableMinor int64                 `json:"outstandingCommissionReceivableMinor"`
	OrderCount                           int64                 `json:"orderCount"`
	SettlementPeriod                     string                `json:"settlementPeriod"`
	ProfileState                         string                `json:"profileState"`
	ProfileVersion                       int                   `json:"profileVersion"`
	LastEarningAt                        *string               `json:"lastEarningAt"`
}

type PartnerCommissionReceivable struct {
	PartnerActorID                       string  `json:"partnerActorId"`
	Currency                             string  `json:"currency"`
	OutstandingCommissionReceivableMinor int64   `json:"outstandingCommissionReceivableMinor"`
	OldestUnpaidAt                       *string `json:"oldestUnpaidAt"`
	ProfileState                         string  `json:"profileState"`
}

type PartnerCommissionReceivableRegistry struct {
	Items      []PartnerCommissionReceivable `json:"items"`
	NextCursor string                        `json:"nextCursor,omitempty"`
	Limit      int                           `json:"limit"`
}

type FieldAcquisitionRewardPolicy struct {
	ID                string  `json:"id"`
	ScopeType         string  `json:"scopeType"`
	ScopeID           string  `json:"scopeId"`
	RewardMinor       int64   `json:"rewardMinor"`
	RoundingUnitMinor int64   `json:"roundingUnitMinor"`
	State             string  `json:"state"`
	Version           int     `json:"version"`
	CreatedBy         string  `json:"createdBy"`
	CreatedAt         string  `json:"createdAt"`
	RetiredAt         *string `json:"retiredAt"`
}

type FieldAcquisitionEntitlement struct {
	JoiningCaseID         string `json:"joiningCaseId"`
	StoreID               string `json:"storeId"`
	PartnerActorID        string `json:"partnerActorId"`
	FieldActorID          string `json:"fieldActorId"`
	VerticalID            string `json:"verticalId"`
	CommercialStoreTypeID string `json:"commercialStoreTypeId"`
	PolicyID              string `json:"policyId"`
	PolicyVersion         int    `json:"policyVersion"`
	RewardMinor           int64  `json:"rewardMinor"`
	Currency              string `json:"currency"`
	LedgerTransactionID   string `json:"ledgerTransactionId"`
	CreatedAt             string `json:"createdAt"`
	EffectiveAt           string `json:"effectiveAt"`
	Status                string `json:"status"`
}

type FieldAcquisitionEntitlementReadback struct {
	JoiningCaseID         string `json:"joiningCaseId"`
	StoreID               string `json:"storeId"`
	PartnerActorID        string `json:"partnerActorId"`
	FieldActorID          string `json:"fieldActorId"`
	VerticalID            string `json:"verticalId"`
	CommercialStoreTypeID string `json:"commercialStoreTypeId"`
	PolicyID              string `json:"policyId"`
	PolicyVersion         int    `json:"policyVersion"`
	RewardMinor           int64  `json:"rewardMinor"`
	Currency              string `json:"currency"`
	LedgerTransactionID   string `json:"ledgerTransactionId"`
	Status                string `json:"status"`
	CreatedAt             string `json:"createdAt"`
	EffectiveAt           string `json:"effectiveAt"`
}

type FieldFinancialSummary struct {
	FieldActorID     string  `json:"fieldActorId"`
	Currency         string  `json:"currency"`
	EarnedMinor      int64   `json:"earnedMinor"`
	EntitlementMinor int64   `json:"entitlementMinor"`
	PartnerCount     int64   `json:"partnerCount"`
	LastEarningAt    *string `json:"lastEarningAt"`
}

type FieldAcquisitionEntitlementPage struct {
	Entitlements []FieldAcquisitionEntitlement `json:"entitlements"`
	NextCursor   string                        `json:"nextCursor,omitempty"`
}

type FieldWalletHistoryEntry struct {
	Type              string    `json:"type"`
	Direction         string    `json:"direction"`
	AmountMinor       int64     `json:"amountMinor"`
	Currency          string    `json:"currency"`
	CreatedAt         time.Time `json:"createdAt"`
	BalanceAfterMinor int64     `json:"balanceAfterMinor"`
}

type FieldWalletHistoryPage struct {
	Currency   string                    `json:"currency"`
	Entries    []FieldWalletHistoryEntry `json:"entries"`
	NextCursor string                    `json:"nextCursor,omitempty"`
	Limit      int                       `json:"limit"`
}

type FieldPayoutRequest struct {
	Status      string    `json:"status"`
	AmountMinor int64     `json:"amountMinor"`
	Currency    string    `json:"currency"`
	CreatedAt   time.Time `json:"createdAt"`
}

type FieldPayoutRequestPage struct {
	Requests   []FieldPayoutRequest `json:"requests"`
	NextCursor string               `json:"nextCursor,omitempty"`
	Limit      int                  `json:"limit"`
}
