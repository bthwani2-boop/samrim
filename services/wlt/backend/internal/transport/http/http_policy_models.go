package http

import (
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

type partnerFinancialSummaryJSON struct {
	SettledMinor                         int64                                `json:"settledMinor"`
	EligibleAvailableMinor               int64                                `json:"eligibleAvailableMinor"`
	HeldMinor                            int64                                `json:"heldMinor"`
	Stores                               []postgres.PartnerStoreFinanceRecord `json:"stores"`
	PartnerActorID                       string                               `json:"partnerActorId"`
	Currency                             string                               `json:"currency"`
	EarnedMinor                          int64                                `json:"earnedMinor"`
	CommissionMinor                      int64                                `json:"commissionMinor"`
	OutstandingCommissionReceivableMinor int64                                `json:"outstandingCommissionReceivableMinor"`
	OrderCount                           int64                                `json:"orderCount"`
	SettlementPeriod                     string                               `json:"settlementPeriod"`
	ProfileState                         string                               `json:"profileState"`
	ProfileVersion                       int                                  `json:"profileVersion"`
	LastEarningAt                        *string                              `json:"lastEarningAt"`
}

type deliveryFeeQuoteRequest struct {
	StoreID              string  `json:"storeId,omitempty"`
	FulfillmentMode      string  `json:"fulfillmentMode,omitempty"`
	ServiceCityID        string  `json:"serviceCityId"`
	OriginLatitude       float64 `json:"originLatitude"`
	OriginLongitude      float64 `json:"originLongitude"`
	DestinationLatitude  float64 `json:"destinationLatitude"`
	DestinationLongitude float64 `json:"destinationLongitude"`
	OrderSizeBaseUnits   int64   `json:"orderSizeBaseUnits"`
}

type createDeliveryFeePolicyRequest struct {
	ServiceCityID          string `json:"serviceCityId"`
	BaseFeeMinor           int64  `json:"baseFeeMinor"`
	DistanceUnitMeters     int64  `json:"distanceUnitMeters"`
	DistanceRateMinor      int64  `json:"distanceRateMinor"`
	OrderSizeUnitBaseUnits int64  `json:"orderSizeUnitBaseUnits"`
	OrderSizeRateMinor     int64  `json:"orderSizeRateMinor"`
	ZoneSurchargeMinor     int64  `json:"zoneSurchargeMinor"`
	RoundingUnitMinor      int64  `json:"roundingUnitMinor"`
	ExpectedVersion        int    `json:"expectedVersion"`
	Reason                 string `json:"reason"`
}

type paymentIntentResponse struct {
	PaymentIntent    paymentIntentJSON `json:"paymentIntent"`
	IdempotentReplay bool              `json:"idempotentReplay"`
}

type paymentIntentJSON struct {
	ID                        string                         `json:"id"`
	ExternalReference         string                         `json:"externalReference"`
	PayerActorID              string                         `json:"payerActorId"`
	AmountMinor               int64                          `json:"amountMinor"`
	Currency                  string                         `json:"currency"`
	Method                    string                         `json:"method"`
	State                     string                         `json:"state"`
	Version                   int                            `json:"version"`
	CollectedAmountMinor      *int64                         `json:"collectedAmountMinor"`
	CollectedByActorID        *string                        `json:"collectedByActorId"`
	CollectionReference       *string                        `json:"collectionReference"`
	CollectedAt               *string                        `json:"collectedAt"`
	CancellationReason        *string                        `json:"cancellationReason"`
	CreatedAt                 string                         `json:"createdAt"`
	UpdatedAt                 string                         `json:"updatedAt"`
	CustomerPaymentAllocation *customerPaymentAllocationJSON `json:"customerPaymentAllocation,omitempty"`
}

type customerPaymentAllocationJSON struct {
	ID                         string                              `json:"id"`
	OrderID                    string                              `json:"orderId"`
	PaymentIntentID            string                              `json:"paymentIntentId"`
	StoreID                    string                              `json:"storeId"`
	PartnerActorID             string                              `json:"partnerActorId"`
	CommercialStoreTypeID      string                              `json:"commercialStoreTypeId,omitempty"`
	FulfillmentMode            string                              `json:"fulfillmentMode"`
	Currency                   string                              `json:"currency"`
	SubtotalMinor              int64                               `json:"subtotalMinor"`
	DeliveryFeeMinor           int64                               `json:"deliveryFeeMinor"`
	DeliveryMarginMinor        int64                               `json:"deliveryMarginMinor"`
	DiscountMinor              int64                               `json:"discountMinor"`
	InternalBalanceAmountMinor int64                               `json:"internalBalanceAmountMinor"`
	CashAmountMinor            int64                               `json:"cashAmountMinor"`
	CustomerPayableMinor       int64                               `json:"customerPayableMinor"`
	PolicyVersion              string                              `json:"policyVersion"`
	CommissionSnapshot         *partnerStoreCommissionSnapshotJSON `json:"commissionSnapshot,omitempty"`
	CreatedAt                  string                              `json:"createdAt"`
}

type partnerStoreCommissionSnapshotJSON struct {
	CommercialStoreTypeID string `json:"commercialStoreTypeId,omitempty"`
	RateBps               int    `json:"rateBps"`
	PolicyVersion         int    `json:"policyVersion"`
	ProfileID             string `json:"profileId"`
	ProfileVersion        int    `json:"profileVersion"`
	RoundingUnitMinor     int64  `json:"roundingUnitMinor"`
	SettlementPeriod      string `json:"settlementPeriod"`
}

type cashLiabilityItemJSON struct {
	PaymentIntentID     string `json:"paymentIntentId"`
	ExternalReference   string `json:"externalReference"`
	CaptainActorID      string `json:"captainActorId"`
	AmountMinor         int64  `json:"amountMinor"`
	Currency            string `json:"currency"`
	PaymentVersion      int    `json:"paymentVersion"`
	CollectedAt         string `json:"collectedAt"`
	RemittanceState     string `json:"remittanceState"`
	RemittanceReference string `json:"remittanceReference,omitempty"`
	RemittanceID        string `json:"remittanceId,omitempty"`
}

type cashLiabilityResponse struct {
	Items            []cashLiabilityItemJSON `json:"items"`
	TotalAmountMinor int64                   `json:"totalAmountMinor"`
	TotalItems       int                     `json:"totalItems"`
	HasMore          bool                    `json:"hasMore"`
}

type cashLiabilityRegistryResponse struct {
	Items            []cashLiabilityItemJSON `json:"items"`
	TotalAmountMinor int64                   `json:"totalAmountMinor"`
	TotalItems       int                     `json:"totalItems"`
	Limit            int                     `json:"limit"`
	NextCursor       string                  `json:"nextCursor,omitempty"`
}

type cashRemittanceJSON struct {
	ID                  string  `json:"id"`
	PaymentIntentID     string  `json:"paymentIntentId"`
	CaptainActorID      string  `json:"captainActorId"`
	AmountMinor         int64   `json:"amountMinor"`
	Currency            string  `json:"currency"`
	RemittanceReference string  `json:"remittanceReference"`
	State               string  `json:"state"`
	CreatedAt           string  `json:"createdAt"`
	ReconciledBy        *string `json:"reconciledBy,omitempty"`
	ReconciledAt        *string `json:"reconciledAt,omitempty"`
	ReceiptDocumentID   *string `json:"receiptDocumentId,omitempty"`
}

type reconcileCashRemittanceRequest struct {
	EvidenceDocumentID string `json:"evidenceDocumentId"`
}

type cashRemittanceResponse struct {
	CashRemittance   cashRemittanceJSON `json:"cashRemittance"`
	IdempotentReplay bool               `json:"idempotentReplay"`
}

type partnerFinancialProfileResponse struct {
	Profile          partnerFinancialProfileJSON `json:"profile"`
	IdempotentReplay bool                        `json:"idempotentReplay"`
}

type partnerFinancialProfileJSON struct {
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

type deliveryFeePolicyResponse struct {
	Policy           deliveryFeePolicyJSON `json:"policy"`
	IdempotentReplay bool                  `json:"idempotentReplay"`
}

type partnerFinancialTermsPolicyResponse struct {
	Policy           partnerFinancialTermsPolicyJSON `json:"policy"`
	IdempotentReplay bool                            `json:"idempotentReplay,omitempty"`
}

type partnerFinancialTermsPolicyJSON struct {
	ID               string  `json:"id"`
	PolicyVersion    string  `json:"policyVersion"`
	State            string  `json:"state"`
	SettlementPeriod string  `json:"settlementPeriod"`
	Version          int     `json:"version"`
	CreatedBy        string  `json:"createdBy"`
	CreatedAt        string  `json:"createdAt"`
	RetiredAt        *string `json:"retiredAt"`
}

type createPartnerFinancialTermsPolicyRequest struct {
	SettlementPeriod string `json:"settlementPeriod"`
	ExpectedVersion  int    `json:"expectedVersion"`
	Reason           string `json:"reason"`
}

type deliveryFeePolicyJSON struct {
	DistanceBands          []postgres.DeliveryDistanceBand `json:"distanceBands"`
	ID                     string                          `json:"id"`
	ServiceCityID          string                          `json:"serviceCityId"`
	PolicyVersion          string                          `json:"policyVersion"`
	State                  string                          `json:"state"`
	BaseFeeMinor           int64                           `json:"baseFeeMinor"`
	DistanceUnitMeters     int64                           `json:"distanceUnitMeters"`
	DistanceRateMinor      int64                           `json:"distanceRateMinor"`
	OrderSizeUnitBaseUnits int64                           `json:"orderSizeUnitBaseUnits"`
	OrderSizeRateMinor     int64                           `json:"orderSizeRateMinor"`
	ZoneSurchargeMinor     int64                           `json:"zoneSurchargeMinor"`
	RoundingUnitMinor      int64                           `json:"roundingUnitMinor"`
	Version                int                             `json:"version"`
	CreatedBy              string                          `json:"createdBy"`
	CreatedAt              string                          `json:"createdAt"`
	RetiredAt              *string                         `json:"retiredAt"`
}

type deliveryFeeQuoteResponse struct {
	Quote deliveryFeeQuoteJSON `json:"quote"`
}

type deliveryFeeQuoteJSON struct {
	CaptainEarningMinor int64  `json:"captainEarningMinor"`
	PlatformMarginMinor int64  `json:"platformMarginMinor"`
	FeeMinor            int64  `json:"feeMinor"`
	PolicyVersion       string `json:"policyVersion"`
	ServiceCityID       string `json:"serviceCityId"`
	DistanceMeters      int64  `json:"distanceMeters"`
	DistanceUnits       int64  `json:"distanceUnits"`
	OrderSizeBaseUnits  int64  `json:"orderSizeBaseUnits"`
	OrderSizeUnits      int64  `json:"orderSizeUnits"`
	RoundingUnitMinor   int64  `json:"roundingUnitMinor"`
}
