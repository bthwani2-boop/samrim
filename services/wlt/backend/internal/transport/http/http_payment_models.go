package http

import (
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

type createRequest struct {
	ExternalReference         string                            `json:"externalReference"`
	PayerActorID              string                            `json:"payerActorId"`
	OrderID                   string                            `json:"orderId"`
	AmountMinor               int64                             `json:"amountMinor"`
	Currency                  string                            `json:"currency"`
	Method                    string                            `json:"method"`
	CustomerPaymentAllocation *customerPaymentAllocationRequest `json:"customerPaymentAllocation"`
}

type customerPaymentAllocationRequest struct {
	OrderID                    string                   `json:"orderId"`
	StoreID                    string                   `json:"storeId"`
	PartnerActorID             string                   `json:"partnerActorId"`
	CommercialStoreTypeID      string                   `json:"commercialStoreTypeId"`
	FulfillmentMode            string                   `json:"fulfillmentMode"`
	Currency                   string                   `json:"currency"`
	SubtotalMinor              int64                    `json:"subtotalMinor"`
	DeliveryFeeMinor           int64                    `json:"deliveryFeeMinor"`
	DeliveryMarginMinor        int64                    `json:"deliveryMarginMinor"`
	DiscountMinor              int64                    `json:"discountMinor"`
	InternalBalanceAmountMinor int64                    `json:"internalBalanceAmountMinor"`
	CashAmountMinor            int64                    `json:"cashAmountMinor"`
	CustomerPayableMinor       int64                    `json:"customerPayableMinor"`
	PolicyVersion              string                   `json:"policyVersion"`
	PromotionFunding           *promotionFundingRequest `json:"promotionFunding"`
}

type promotionFundingRequest struct {
	PromotionID         string `json:"promotionId"`
	PromotionVersion    int    `json:"promotionVersion"`
	PromotionCode       string `json:"promotionCode"`
	FundingSource       string `json:"fundingSource"`
	PartnerSharePercent *int   `json:"partnerSharePercent"`
}

type updateStoreTypeCommissionDefaultRequest struct {
	CommercialStoreTypeID string `json:"commercialStoreTypeId"`
	FulfillmentMode       string `json:"fulfillmentMode"`
	CommissionRateBps     int    `json:"suggestedCommissionRateBps"`
	ExpectedVersion       int    `json:"expectedDefaultVersion"`
	Reason                string `json:"reason"`
}

type collectRequest struct {
	CollectedAmountMinor int64  `json:"collectedAmountMinor"`
	CollectedByActorID   string `json:"collectedByActorId"`
	CollectionReference  string `json:"collectionReference"`
}

type cancelRequest struct {
	Reason string `json:"reason"`
}

type remitCashRequest struct {
	CaptainActorID      string `json:"captainActorId"`
	AmountMinor         int64  `json:"amountMinor"`
	RemittanceReference string `json:"remittanceReference"`
}

type preparePartnerFinancialProfileRequest struct {
	JoiningCaseID      string `json:"joiningCaseId"`
	PartnerActorID     string `json:"partnerActorId"`
	Origin             string `json:"origin"`
	SettlementPeriod   string `json:"settlementPeriod"`
	TermsPolicyVersion string `json:"termsPolicyVersion"`
}

type createFieldAcquisitionRewardPolicyRequest struct {
	ScopeType         string `json:"scopeType"`
	ScopeID           string `json:"scopeId"`
	RewardMinor       int64  `json:"rewardMinor"`
	RoundingUnitMinor int64  `json:"roundingUnitMinor"`
	ExpectedVersion   int    `json:"expectedVersion"`
	Reason            string `json:"reason"`
}

type finalizeFieldAcquisitionEntitlementRequest struct {
	JoiningCaseID         string `json:"joiningCaseId"`
	StoreID               string `json:"storeId"`
	PartnerActorID        string `json:"partnerActorId"`
	FieldActorID          string `json:"fieldActorId"`
	VerticalID            string `json:"verticalId"`
	CommercialStoreTypeID string `json:"commercialStoreTypeId"`
}

type activatePartnerFinancialProfileRequest struct{}

type finalizePartnerOrderEarningRequest struct {
	OrderID         string `json:"orderId"`
	PaymentIntentID string `json:"paymentIntentId"`
	PartnerActorID  string `json:"partnerActorId"`
	CaptainActorID  string `json:"captainActorId"`
}

type finalizePartnerStoreCashCommissionRequest struct {
	OrderID         string `json:"orderId"`
	PaymentIntentID string `json:"paymentIntentId"`
	PartnerActorID  string `json:"partnerActorId"`
	FulfillmentMode string `json:"fulfillmentMode"`
}

type partnerCommissionRemittanceRequest struct {
	AmountMinor         int64  `json:"amountMinor"`
	RemittanceReference string `json:"remittanceReference"`
	EvidenceDocumentID  string `json:"evidenceDocumentId"`
}

type createOfficialWalletDestinationRequest struct {
	ActorType                     string                 `json:"actorType"`
	ActorID                       string                 `json:"actorId"`
	ProviderKey                   string                 `json:"providerKey"`
	IdentityFacts                 postgres.IdentityFacts `json:"identityFacts"`
	ChangeReason                  string                 `json:"changeReason"`
	VerificationEvidenceReference string                 `json:"verificationEvidenceReference"`
	ChangeEvidenceReference       string                 `json:"changeEvidenceReference"`
}

type transitionOfficialWalletDestinationRequest struct {
	EvidenceReference string                 `json:"evidenceReference"`
	IdentityFacts     postgres.IdentityFacts `json:"identityFacts"`
}

type payoutIntentRequest struct {
	ActorType     string                 `json:"actorType"`
	ActorID       string                 `json:"actorId"`
	AmountMode    string                 `json:"amountMode"`
	AmountMinor   *int64                 `json:"amountMinor"`
	IdentityFacts postgres.IdentityFacts `json:"identityFacts"`
}
