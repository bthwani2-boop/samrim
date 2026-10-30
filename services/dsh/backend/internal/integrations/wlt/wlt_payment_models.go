package wlt

import (
	"time"
)

type PaymentIntent struct {
	ID                        string                     `json:"id"`
	ExternalReference         string                     `json:"externalReference"`
	PayerActorID              string                     `json:"payerActorId"`
	AmountMinor               int64                      `json:"amountMinor"`
	Currency                  string                     `json:"currency"`
	Method                    string                     `json:"method"`
	State                     string                     `json:"state"`
	Version                   int                        `json:"version"`
	CollectedAmountMinor      *int64                     `json:"collectedAmountMinor"`
	CollectedByActorID        *string                    `json:"collectedByActorId"`
	CollectionReference       *string                    `json:"collectionReference"`
	CancellationReason        *string                    `json:"cancellationReason"`
	CreatedAt                 string                     `json:"createdAt"`
	UpdatedAt                 string                     `json:"updatedAt"`
	CustomerPaymentAllocation *CustomerPaymentAllocation `json:"customerPaymentAllocation,omitempty"`
}

type CustomerPaymentAllocation struct {
	ID                         string `json:"id,omitempty"`
	OrderID                    string `json:"orderId"`
	StoreID                    string `json:"storeId"`
	PartnerActorID             string `json:"partnerActorId"`
	CommercialStoreTypeID      string `json:"commercialStoreTypeId"`
	FulfillmentMode            string `json:"fulfillmentMode"`
	PaymentIntentID            string `json:"paymentIntentId,omitempty"`
	Currency                   string `json:"currency"`
	SubtotalMinor              int64  `json:"subtotalMinor"`
	DeliveryFeeMinor           int64  `json:"deliveryFeeMinor"`
	DiscountMinor              int64  `json:"discountMinor"`
	InternalBalanceAmountMinor int64  `json:"internalBalanceAmountMinor"`
	CashAmountMinor            int64  `json:"cashAmountMinor"`
	CustomerPayableMinor       int64  `json:"customerPayableMinor"`
	PolicyVersion              string `json:"policyVersion"`
	CreatedAt                  string `json:"createdAt"`
}

// PromotionFundingRequest carries the checkout-frozen promotion funding facts
// to WLT; the monetary split is derived server-side by WLT.
type PromotionFundingRequest struct {
	PromotionID         string `json:"promotionId"`
	PromotionVersion    int    `json:"promotionVersion"`
	PromotionCode       string `json:"promotionCode"`
	FundingSource       string `json:"fundingSource"`
	PartnerSharePercent *int   `json:"partnerSharePercent"`
}

type OrderAdjustmentReconciliationCase struct {
	ID               string `json:"id"`
	OrderID          string `json:"orderId"`
	AdjustmentID     string `json:"adjustmentId"`
	PaymentIntentID  string `json:"paymentIntentId"`
	AdjustmentKind   string `json:"adjustmentKind"`
	RequestedByActor string `json:"requestedByActorId"`
	CustomerActorID  string `json:"customerActorId"`
	State            string `json:"state"`
	ReasonCode       string `json:"reasonCode"`
	IdempotencyKey   string `json:"idempotencyKey"`
	RequestHash      string `json:"requestHash"`
	CorrelationID    string `json:"correlationId"`
	CreatedAt        string `json:"createdAt"`
}

type OrderAdjustmentReconciliationCases struct {
	Cases []OrderAdjustmentReconciliationCase `json:"cases"`
}

type CustomerPaymentAllocationInput struct {
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
	PromotionFunding           *PromotionFundingRequest `json:"promotionFunding,omitempty"`
}

type paymentIntentResponse struct {
	PaymentIntent    PaymentIntent `json:"paymentIntent"`
	IdempotentReplay bool          `json:"idempotentReplay"`
}

type CashLiability struct {
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

type CashLiabilityResponse struct {
	Items            []CashLiability `json:"items"`
	TotalAmountMinor int64           `json:"totalAmountMinor"`
}

type CashLiabilityRegistryResponse struct {
	Items            []CashLiability `json:"items"`
	TotalAmountMinor int64           `json:"totalAmountMinor"`
	TotalItems       int             `json:"totalItems"`
	Limit            int             `json:"limit"`
	NextCursor       string          `json:"nextCursor,omitempty"`
}

type CashRemittance struct {
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

type CaptainWalletState struct {
	CaptainActorID     string `json:"captainActorId"`
	Currency           string `json:"currency"`
	LedgerBalanceMinor int64  `json:"ledgerBalanceMinor"`
	HeldMinor          int64  `json:"heldMinor"`
	AvailableMinor     int64  `json:"availableMinor"`
}

type CustomerWalletCompensationSummary struct {
	ID          string    `json:"id"`
	OrderID     string    `json:"orderId"`
	AmountMinor int64     `json:"amountMinor"`
	Currency    string    `json:"currency"`
	CreatedAt   time.Time `json:"createdAt"`
}

type WalletState struct {
	RecentCompensations []CustomerWalletCompensationSummary `json:"recentCompensations,omitempty"`

	ActorType          string `json:"actorType"`
	ActorID            string `json:"actorId"`
	Currency           string `json:"currency"`
	LedgerBalanceMinor int64  `json:"ledgerBalanceMinor"`
	HeldMinor          int64  `json:"heldMinor"`
	AvailableMinor     int64  `json:"availableMinor"`
	CashInEnabled      bool   `json:"cashInEnabled"`
	Simulator          bool   `json:"simulator"`
	ProviderMock       bool   `json:"providerMock"`
}

type CashInFundingIntent struct {
	ID                           string  `json:"id"`
	ActorType                    string  `json:"actorType"`
	ActorID                      string  `json:"actorId"`
	FundingPurpose               string  `json:"fundingPurpose"`
	ProviderKey                  string  `json:"providerKey"`
	ExternalReference            string  `json:"externalReference"`
	ProviderReference            *string `json:"providerReference,omitempty"`
	ProviderTransactionReference *string `json:"providerTransactionReference,omitempty"`
	AmountMinor                  int64   `json:"amountMinor"`
	Currency                     string  `json:"currency"`
	State                        string  `json:"state"`
	Version                      int     `json:"version"`
	LedgerTransactionID          *string `json:"ledgerTransactionId,omitempty"`
	CreatedAt                    string  `json:"createdAt"`
	UpdatedAt                    string  `json:"updatedAt"`
}

type CaptainCODReservation struct {
	ID              string  `json:"id"`
	OrderID         string  `json:"orderId"`
	PaymentIntentID string  `json:"paymentIntentId"`
	CaptainActorID  string  `json:"captainActorId"`
	AmountMinor     int64   `json:"amountMinor"`
	Currency        string  `json:"currency"`
	State           string  `json:"state"`
	CreatedAt       string  `json:"createdAt"`
	UpdatedAt       string  `json:"updatedAt"`
	ReleasedAt      *string `json:"releasedAt,omitempty"`
	FinalizedAt     *string `json:"finalizedAt,omitempty"`
	RemittedAt      *string `json:"remittedAt,omitempty"`
}
