package wlt

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	methodCashOnDelivery = "CASH_ON_DELIVERY"
	MethodCashAtStore    = "CASH_AT_STORE"
	stateRequiresCollect = "REQUIRES_COLLECTION"
	stateCollected       = "COLLECTED"
	stateCancelled       = "CANCELLED"
)

type Client struct {
	baseURL      string
	serviceToken string
	httpClient   *http.Client
}

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
	CustomerPaymentAllocation *CustomerPaymentAllocation `json:"customerPaymentAllocation,omitempty"`
}

type CustomerPaymentAllocation struct {
	ID                         string `json:"id,omitempty"`
	OrderID                    string `json:"orderId"`
	StoreID                    string `json:"storeId"`
	PartnerActorID             string `json:"partnerActorId"`
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
}

type paymentIntentResponse struct {
	PaymentIntent    PaymentIntent `json:"paymentIntent"`
	IdempotentReplay bool          `json:"idempotentReplay"`
}

type CashLiability struct {
	PaymentIntentID   string `json:"paymentIntentId"`
	ExternalReference string `json:"externalReference"`
	CaptainActorID    string `json:"captainActorId"`
	AmountMinor       int64  `json:"amountMinor"`
	Currency          string `json:"currency"`
	PaymentVersion    int    `json:"paymentVersion"`
	CollectedAt       string `json:"collectedAt"`
}

type CashLiabilityResponse struct {
	Items            []CashLiability `json:"items"`
	TotalAmountMinor int64           `json:"totalAmountMinor"`
}

type CashRemittance struct {
	ID                  string `json:"id"`
	PaymentIntentID     string `json:"paymentIntentId"`
	CaptainActorID      string `json:"captainActorId"`
	AmountMinor         int64  `json:"amountMinor"`
	Currency            string `json:"currency"`
	RemittanceReference string `json:"remittanceReference"`
	State               string `json:"state"`
	CreatedAt           string `json:"createdAt"`
}

type CaptainWalletState struct {
	CaptainActorID     string `json:"captainActorId"`
	Currency           string `json:"currency"`
	LedgerBalanceMinor int64  `json:"ledgerBalanceMinor"`
	HeldMinor          int64  `json:"heldMinor"`
	AvailableMinor     int64  `json:"availableMinor"`
}

type CaptainWalletFunding struct {
	ID                  string `json:"id"`
	CaptainActorID      string `json:"captainActorId"`
	AmountMinor         int64  `json:"amountMinor"`
	Currency            string `json:"currency"`
	FundingReason       string `json:"fundingReason"`
	EvidenceReference   string `json:"evidenceReference"`
	CreatedBy           string `json:"createdBy"`
	LedgerTransactionID string `json:"ledgerTransactionId"`
	CreatedAt           string `json:"createdAt"`
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

type PartnerFinancialProfile struct {
	ID                 string  `json:"id"`
	JoiningCaseID      string  `json:"joiningCaseId"`
	PartnerActorID     string  `json:"partnerActorId"`
	Origin             string  `json:"origin"`
	CommissionRateBps  int     `json:"commissionRateBps"`
	SettlementPeriod   string  `json:"settlementPeriod"`
	TermsPolicyVersion string  `json:"termsPolicyVersion,omitempty"`
	RoundingUnitMinor  int64   `json:"roundingUnitMinor"`
	State              string  `json:"state"`
	Version            int     `json:"version"`
	ActivatedAt        *string `json:"activatedAt"`
	CreatedAt          string  `json:"createdAt"`
	UpdatedAt          string  `json:"updatedAt"`
}

type PartnerOrderEarning struct {
	OrderID             string `json:"orderId"`
	PaymentIntentID     string `json:"paymentIntentId"`
	PartnerActorID      string `json:"partnerActorId"`
	CaptainActorID      string `json:"captainActorId"`
	Currency            string `json:"currency"`
	GrossProductMinor   int64  `json:"grossProductMinor"`
	DeliveryFeeMinor    int64  `json:"deliveryFeeMinor"`
	CommissionMinor     int64  `json:"commissionMinor"`
	PartnerNetMinor     int64  `json:"partnerNetMinor"`
	ProfileID           string `json:"profileId"`
	ProfileVersion      int    `json:"profileVersion"`
	PolicyVersion       string `json:"policyVersion"`
	LedgerTransactionID string `json:"ledgerTransactionId"`
	CreatedAt           string `json:"createdAt"`
}

type PartnerFinancialSummary struct {
	PartnerActorID                       string  `json:"partnerActorId"`
	Currency                             string  `json:"currency"`
	EarnedMinor                          int64   `json:"earnedMinor"`
	CommissionMinor                      int64   `json:"commissionMinor"`
	OutstandingCommissionReceivableMinor int64   `json:"outstandingCommissionReceivableMinor"`
	OrderCount                           int64   `json:"orderCount"`
	SettlementPeriod                     string  `json:"settlementPeriod"`
	ProfileState                         string  `json:"profileState"`
	ProfileVersion                       int     `json:"profileVersion"`
	LastEarningAt                        *string `json:"lastEarningAt"`
}

type FieldCommissionPolicy struct {
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

type FieldCommissionEarning struct {
	StoreID             string `json:"storeId"`
	FieldActorID        string `json:"fieldActorId"`
	VerticalID          string `json:"verticalId"`
	PolicyID            string `json:"policyId"`
	PolicyVersion       int    `json:"policyVersion"`
	RewardMinor         int64  `json:"rewardMinor"`
	Currency            string `json:"currency"`
	LedgerTransactionID string `json:"ledgerTransactionId"`
	CreatedAt           string `json:"createdAt"`
}

type FieldFinancialSummary struct {
	FieldActorID    string  `json:"fieldActorId"`
	Currency        string  `json:"currency"`
	EarnedMinor     int64   `json:"earnedMinor"`
	CommissionMinor int64   `json:"commissionMinor"`
	StoreCount      int64   `json:"storeCount"`
	LastEarningAt   *string `json:"lastEarningAt"`
}

type OfficialWalletDestination struct {
	ID                            string  `json:"id"`
	ActorType                     string  `json:"actorType"`
	ActorID                       string  `json:"actorId"`
	ProviderKey                   string  `json:"providerKey"`
	WalletIdentifierMasked        string  `json:"walletIdentifierMasked"`
	BeneficiaryName               string  `json:"beneficiaryName"`
	VerificationStatus            string  `json:"verificationStatus"`
	Status                        string  `json:"status"`
	Version                       int     `json:"version"`
	ChangeReason                  string  `json:"changeReason"`
	SubmittedBy                   string  `json:"submittedBy"`
	SubmittedAt                   string  `json:"submittedAt"`
	VerifiedBy                    *string `json:"verifiedBy"`
	VerifiedAt                    *string `json:"verifiedAt"`
	ApprovedBy                    *string `json:"approvedBy"`
	ApprovedAt                    *string `json:"approvedAt"`
	VerificationEvidenceReference string  `json:"verificationEvidenceReference"`
	ChangeEvidenceReference       string  `json:"changeEvidenceReference"`
	CreatedAt                     string  `json:"createdAt"`
	UpdatedAt                     string  `json:"updatedAt"`
}

type PayoutRequest struct {
	ID                   string `json:"id"`
	ActorType            string `json:"actorType"`
	ActorID              string `json:"actorId"`
	AmountMode           string `json:"amountMode"`
	RequestedAmountMinor *int64 `json:"requestedAmountMinor"`
	ResolvedAmountMinor  int64  `json:"resolvedAmountMinor"`
	Currency             string `json:"currency"`
	DestinationID        string `json:"destinationId"`
	DestinationVersion   int    `json:"destinationVersion"`
	Status               string `json:"status"`
	PolicyVersion        string `json:"policyVersion"`
	LedgerTransactionID  string `json:"ledgerTransactionId,omitempty"`
	CreatedAt            string `json:"createdAt"`
}

type SettlementBatch struct {
	ID               string  `json:"id"`
	ProviderKey      string  `json:"providerKey"`
	Currency         string  `json:"currency"`
	Status           string  `json:"status"`
	RowCount         int     `json:"rowCount"`
	TotalAmountMinor int64   `json:"totalAmountMinor"`
	CreatedBy        string  `json:"createdBy"`
	CreatedAt        string  `json:"createdAt"`
	ApprovedBy       *string `json:"approvedBy,omitempty"`
	ApprovedAt       *string `json:"approvedAt,omitempty"`
	FrozenBy         *string `json:"frozenBy,omitempty"`
	FrozenAt         *string `json:"frozenAt,omitempty"`
	BatchHash        string  `json:"batchHash,omitempty"`
}

type ManualTransferExecution struct {
	ID                   string  `json:"id"`
	BatchID              string  `json:"batchId"`
	PayoutID             string  `json:"payoutId"`
	ApprovedSnapshotHash string  `json:"approvedSnapshotHash"`
	ExecutedBy           string  `json:"executedBy"`
	ExecutedAt           string  `json:"executedAt"`
	ProviderKey          string  `json:"providerKey"`
	ExternalReference    string  `json:"externalTransferReference"`
	AmountMinor          int64   `json:"amountMinor"`
	Currency             string  `json:"currency"`
	DestinationID        string  `json:"destinationId"`
	DestinationVersion   int     `json:"destinationVersion"`
	EvidenceReference    string  `json:"evidenceReference"`
	ExecutionStatus      string  `json:"executionStatus"`
	VerifiedBy           *string `json:"verifiedBy,omitempty"`
	VerifiedAt           *string `json:"verifiedAt,omitempty"`
	StatementReference   *string `json:"statementReference,omitempty"`
	ReconciledBy         *string `json:"reconciledBy,omitempty"`
	ReconciledAt         *string `json:"reconciledAt,omitempty"`
}

type PayoutState struct {
	ActorType              string                     `json:"actorType"`
	ActorID                string                     `json:"actorId"`
	Currency               string                     `json:"currency"`
	EligibleAvailableMinor int64                      `json:"eligibleAvailableMinor"`
	HeldMinor              int64                      `json:"heldMinor"`
	Destination            *OfficialWalletDestination `json:"destination"`
	LatestPayout           *PayoutRequest             `json:"latestPayout"`
}

type DeliveryFeePolicy struct {
	ID                     string  `json:"id"`
	ServiceCityID          string  `json:"serviceCityId"`
	PolicyVersion          string  `json:"policyVersion"`
	State                  string  `json:"state"`
	BaseFeeMinor           int64   `json:"baseFeeMinor"`
	DistanceUnitMeters     int64   `json:"distanceUnitMeters"`
	DistanceRateMinor      int64   `json:"distanceRateMinor"`
	OrderSizeUnitBaseUnits int64   `json:"orderSizeUnitBaseUnits"`
	OrderSizeRateMinor     int64   `json:"orderSizeRateMinor"`
	ZoneSurchargeMinor     int64   `json:"zoneSurchargeMinor"`
	RoundingUnitMinor      int64   `json:"roundingUnitMinor"`
	Version                int     `json:"version"`
	CreatedBy              string  `json:"createdBy"`
	CreatedAt              string  `json:"createdAt"`
	RetiredAt              *string `json:"retiredAt"`
}

type PartnerFinancialTermsPolicy struct {
	ID                string  `json:"id"`
	PolicyVersion     string  `json:"policyVersion"`
	State             string  `json:"state"`
	CommissionRateBps int     `json:"commissionRateBps"`
	SettlementPeriod  string  `json:"settlementPeriod"`
	Version           int     `json:"version"`
	CreatedBy         string  `json:"createdBy"`
	CreatedAt         string  `json:"createdAt"`
	RetiredAt         *string `json:"retiredAt"`
}

type PartnerStoreCommissionPolicy struct {
	StoreID           string `json:"storeId"`
	PartnerActorID    string `json:"partnerActorId"`
	FulfillmentMode   string `json:"fulfillmentMode"`
	CommissionRateBps int    `json:"commissionRateBps"`
	PolicyVersion     int    `json:"policyVersion"`
	ProfileID         string `json:"profileId"`
	ProfileVersion    int    `json:"profileVersion"`
	RoundingUnitMinor int64  `json:"roundingUnitMinor"`
	SettlementPeriod  string `json:"settlementPeriod"`
	UpdatedAt         string `json:"updatedAt"`
	ChangedByActorID  string `json:"changedByActorId,omitempty"`
	ChangeReason      string `json:"changeReason,omitempty"`
}

type PartnerStoreCommissionPoliciesResponse struct {
	StoreID  string                         `json:"storeId"`
	Policies []PartnerStoreCommissionPolicy `json:"policies"`
}

type PartnerStoreCommissionPolicyResponse struct {
	Policy           PartnerStoreCommissionPolicy `json:"policy"`
	IdempotentReplay bool                         `json:"idempotentReplay"`
}

type DeliveryFeeQuote struct {
	FeeMinor           int64  `json:"feeMinor"`
	PolicyVersion      string `json:"policyVersion"`
	ServiceCityID      string `json:"serviceCityId"`
	DistanceMeters     int64  `json:"distanceMeters"`
	DistanceUnits      int64  `json:"distanceUnits"`
	OrderSizeBaseUnits int64  `json:"orderSizeBaseUnits"`
	OrderSizeUnits     int64  `json:"orderSizeUnits"`
	RoundingUnitMinor  int64  `json:"roundingUnitMinor"`
}

type DeliveryFeeQuoteInput struct {
	ServiceCityID        string  `json:"serviceCityId"`
	OriginLatitude       float64 `json:"originLatitude"`
	OriginLongitude      float64 `json:"originLongitude"`
	DestinationLatitude  float64 `json:"destinationLatitude"`
	DestinationLongitude float64 `json:"destinationLongitude"`
	OrderSizeBaseUnits   int64   `json:"orderSizeBaseUnits"`
}

type cashRemittanceResponse struct {
	CashRemittance   CashRemittance `json:"cashRemittance"`
	IdempotentReplay bool           `json:"idempotentReplay"`
}

type partnerFinancialProfileResponse struct {
	Profile          PartnerFinancialProfile `json:"profile"`
	IdempotentReplay bool                    `json:"idempotentReplay"`
}

type partnerOrderEarningResponse struct {
	Earning          PartnerOrderEarning `json:"earning"`
	IdempotentReplay bool                `json:"idempotentReplay"`
}

type partnerFinancialSummaryResponse struct {
	Summary PartnerFinancialSummary `json:"summary"`
}

type fieldCommissionPolicyResponse struct {
	Policy           FieldCommissionPolicy `json:"policy"`
	IdempotentReplay bool                  `json:"idempotentReplay"`
}

type fieldCommissionEarningResponse struct {
	Earning          FieldCommissionEarning `json:"earning"`
	IdempotentReplay bool                   `json:"idempotentReplay"`
}

type fieldFinancialSummaryResponse struct {
	Summary FieldFinancialSummary `json:"summary"`
}

type officialWalletDestinationResponse struct {
	Destination      OfficialWalletDestination `json:"destination"`
	IdempotentReplay bool                      `json:"idempotentReplay"`
}

type payoutRequestResponse struct {
	Payout           PayoutRequest `json:"payout"`
	IdempotentReplay bool          `json:"idempotentReplay"`
}

type payoutStateResponse struct {
	State PayoutState `json:"state"`
}

type payoutListResponse struct {
	Payouts []PayoutRequest `json:"payouts"`
}

type settlementBatchResponse struct {
	Batch SettlementBatch `json:"batch"`
}

type transferResponse struct {
	Transfer ManualTransferExecution `json:"transfer"`
}

type deliveryFeePolicyResponse struct {
	Policy           DeliveryFeePolicy `json:"policy"`
	IdempotentReplay bool              `json:"idempotentReplay"`
}

type partnerFinancialTermsPolicyResponse struct {
	Policy           PartnerFinancialTermsPolicy `json:"policy"`
	IdempotentReplay bool                        `json:"idempotentReplay"`
}

type deliveryFeeQuoteResponse struct {
	Quote DeliveryFeeQuote `json:"quote"`
}

type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string {
	return fmt.Sprintf("WLT request failed with status %d and code %s: %s", e.Status, e.Code, e.Message)
}

func New(rawBaseURL, environment, serviceToken string) (*Client, error) {
	baseURL, err := ResolveBaseURL(rawBaseURL, environment)
	if err != nil {
		return nil, err
	}
	serviceToken = strings.TrimSpace(serviceToken)
	if serviceToken == "" {
		return nil, errors.New("WLT service token is required")
	}
	return &Client{baseURL: baseURL, serviceToken: serviceToken, httpClient: &http.Client{Timeout: 8 * time.Second}}, nil
}

func ResolveBaseURL(raw, environment string) (string, error) {
	environment = strings.ToLower(strings.TrimSpace(environment))
	if environment != "development" && environment != "test" && environment != "staging" && environment != "production" {
		return "", errors.New("BTHWANI_ENV must be development, test, staging, or production")
	}
	value := strings.TrimRight(strings.TrimSpace(raw), "/")
	if value == "" {
		if environment == "development" || environment == "test" {
			value = "http://wlt:8083"
		} else {
			return "", errors.New("DSH_WLT_API_BASE_URL is required outside local environments")
		}
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", errors.New("DSH_WLT_API_BASE_URL is invalid")
	}
	if (environment == "staging" || environment == "production") && parsed.Scheme != "https" {
		return "", errors.New("DSH_WLT_API_BASE_URL must use HTTPS outside local environments")
	}
	return value, nil
}

func DerivedIdempotencyKey(scope, source string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(scope) + "\x00" + strings.TrimSpace(source)))
	return "wlt-" + hex.EncodeToString(digest[:])
}

func DerivedExternalReference(scope, source string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(scope) + "\x00" + strings.TrimSpace(source)))
	return "dsh-" + strings.TrimSpace(scope) + "-" + hex.EncodeToString(digest[:])
}

func (c *Client) Create(ctx context.Context, externalReference, payerActorID string, amountMinor int64, idempotencyKey, correlationID string) (PaymentIntent, bool, error) {
	body := map[string]any{
		"externalReference": strings.TrimSpace(externalReference),
		"payerActorId":      strings.TrimSpace(payerActorID),
		"amountMinor":       amountMinor,
		"currency":          "YER",
		"method":            methodCashOnDelivery,
	}
	var response paymentIntentResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/payment-intents", body, idempotencyKey, correlationID, 0, &response)
	return response.PaymentIntent, response.IdempotentReplay, err
}

func (c *Client) CreateForOrder(ctx context.Context, orderID, externalReference, payerActorID string, amountMinor int64, allocation CustomerPaymentAllocation, idempotencyKey, correlationID string) (PaymentIntent, bool, error) {
	return c.CreateForOrderWithMethod(ctx, orderID, externalReference, payerActorID, amountMinor, methodCashOnDelivery, allocation, idempotencyKey, correlationID)
}

func (c *Client) CreateForOrderWithMethod(ctx context.Context, orderID, externalReference, payerActorID string, amountMinor int64, method string, allocation CustomerPaymentAllocation, idempotencyKey, correlationID string) (PaymentIntent, bool, error) {
	body := map[string]any{
		"orderId":                   strings.TrimSpace(orderID),
		"externalReference":         strings.TrimSpace(externalReference),
		"payerActorId":              strings.TrimSpace(payerActorID),
		"amountMinor":               amountMinor,
		"currency":                  "YER",
		"method":                    strings.TrimSpace(method),
		"customerPaymentAllocation": allocation,
	}
	var response paymentIntentResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/payment-intents", body, idempotencyKey, correlationID, 0, &response)
	return response.PaymentIntent, response.IdempotentReplay, err
}

type PartnerStoreCashCommission struct {
	OrderID             string `json:"orderId"`
	PaymentIntentID     string `json:"paymentIntentId"`
	PartnerActorID      string `json:"partnerActorId"`
	FulfillmentMode     string `json:"fulfillmentMode"`
	Currency            string `json:"currency"`
	GrossProductMinor   int64  `json:"grossProductMinor"`
	CommissionMinor     int64  `json:"commissionMinor"`
	ProfileID           string `json:"profileId"`
	ProfileVersion      int    `json:"profileVersion"`
	PolicyVersion       string `json:"policyVersion"`
	LedgerTransactionID string `json:"ledgerTransactionId,omitempty"`
	CreatedAt           string `json:"createdAt"`
}

type PartnerCommissionRemittance struct {
	ID                  string `json:"id"`
	PartnerActorID      string `json:"partnerActorId"`
	AmountMinor         int64  `json:"amountMinor"`
	Currency            string `json:"currency"`
	RemittanceReference string `json:"remittanceReference"`
	EvidenceReference   string `json:"evidenceReference"`
	VerifiedBy          string `json:"verifiedBy"`
	VerifiedAt          string `json:"verifiedAt"`
	LedgerTransactionID string `json:"ledgerTransactionId"`
	CreatedAt           string `json:"createdAt"`
}

type partnerStoreCashCommissionResponse struct {
	Commission       PartnerStoreCashCommission `json:"commission"`
	IdempotentReplay bool                       `json:"idempotentReplay"`
}

type partnerCommissionRemittanceResponse struct {
	Remittance       PartnerCommissionRemittance `json:"remittance"`
	IdempotentReplay bool                        `json:"idempotentReplay"`
}

func (c *Client) Read(ctx context.Context, intentID string) (PaymentIntent, error) {
	var response paymentIntentResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/payment-intents/"+url.PathEscape(strings.TrimSpace(intentID)), nil, "", "", 0, &response)
	return response.PaymentIntent, err
}

func (c *Client) ReadByExternalReference(ctx context.Context, externalReference string) (PaymentIntent, error) {
	query := url.Values{}
	query.Set("externalReference", strings.TrimSpace(externalReference))
	var response paymentIntentResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/payment-intents/by-external-reference?"+query.Encode(), nil, "", "", 0, &response)
	return response.PaymentIntent, err
}

func (c *Client) Collect(ctx context.Context, intentID, collectedByActorID, collectionReference string, amountMinor int64, expectedVersion int, idempotencyKey, correlationID string) (PaymentIntent, bool, error) {
	body := map[string]any{
		"collectedAmountMinor": amountMinor,
		"collectedByActorId":   strings.TrimSpace(collectedByActorID),
		"collectionReference":  strings.TrimSpace(collectionReference),
	}
	var response paymentIntentResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/payment-intents/"+url.PathEscape(strings.TrimSpace(intentID))+"/collect", body, idempotencyKey, correlationID, expectedVersion, &response)
	return response.PaymentIntent, response.IdempotentReplay, err
}

func (c *Client) EnsureCollected(ctx context.Context, intentID, collectedByActorID, collectionReference string, amountMinor int64, idempotencyKey, correlationID string) (PaymentIntent, error) {
	current, err := c.Read(ctx, intentID)
	if err != nil {
		return PaymentIntent{}, err
	}
	if current.AmountMinor != amountMinor {
		return PaymentIntent{}, &Error{Status: http.StatusConflict, Code: "AMOUNT_MISMATCH", Message: "WLT amount does not match the DSH order total"}
	}
	if current.State == stateCollected {
		return current, nil
	}
	if current.State != stateRequiresCollect {
		return PaymentIntent{}, &Error{Status: http.StatusConflict, Code: "STATE_CONFLICT", Message: "WLT payment intent is not collectable"}
	}
	collected, _, collectErr := c.Collect(ctx, intentID, collectedByActorID, collectionReference, amountMinor, current.Version, idempotencyKey, correlationID)
	if collectErr == nil {
		return collected, nil
	}
	var wltErr *Error
	if !errors.As(collectErr, &wltErr) || wltErr.Code != "VERSION_CONFLICT" {
		return PaymentIntent{}, collectErr
	}
	current, readErr := c.Read(ctx, intentID)
	if readErr != nil {
		return PaymentIntent{}, readErr
	}
	if current.State == stateCollected && current.AmountMinor == amountMinor {
		return current, nil
	}
	return PaymentIntent{}, collectErr
}

func (c *Client) EnsureCancelled(ctx context.Context, intentID, reason, idempotencyKey, correlationID string) (PaymentIntent, error) {
	current, err := c.Read(ctx, intentID)
	if err != nil {
		return PaymentIntent{}, err
	}
	if current.State == stateCancelled {
		return current, nil
	}
	if current.State != stateRequiresCollect {
		return PaymentIntent{}, &Error{Status: http.StatusConflict, Code: "STATE_CONFLICT", Message: "WLT payment intent is not cancellable"}
	}
	body := map[string]any{"reason": strings.TrimSpace(reason)}
	var response paymentIntentResponse
	err = c.request(ctx, http.MethodPost, "/wlt/v1/payment-intents/"+url.PathEscape(strings.TrimSpace(intentID))+"/cancel", body, idempotencyKey, correlationID, current.Version, &response)
	if err == nil {
		return response.PaymentIntent, nil
	}
	var wltErr *Error
	if !errors.As(err, &wltErr) || wltErr.Code != "VERSION_CONFLICT" {
		return PaymentIntent{}, err
	}
	current, readErr := c.Read(ctx, intentID)
	if readErr == nil && current.State == stateCancelled {
		return current, nil
	}
	return PaymentIntent{}, err
}

func (c *Client) ListCashLiability(ctx context.Context, captainActorID string) (CashLiabilityResponse, error) {
	var response CashLiabilityResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/captains/"+url.PathEscape(strings.TrimSpace(captainActorID))+"/cash-liability", nil, "", "", 0, &response)
	return response, err
}

func (c *Client) ListOperatorCashLiability(ctx context.Context) (CashLiabilityResponse, error) {
	var response CashLiabilityResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/operator/cash-liability", nil, "", "", 0, &response)
	return response, err
}

func (c *Client) RemitCash(ctx context.Context, intentID, captainActorID string, amountMinor int64, remittanceReference string, expectedPaymentVersion int, idempotencyKey, correlationID string) (CashRemittance, bool, error) {
	body := map[string]any{
		"captainActorId":      strings.TrimSpace(captainActorID),
		"amountMinor":         amountMinor,
		"remittanceReference": strings.TrimSpace(remittanceReference),
	}
	var response cashRemittanceResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/payment-intents/"+url.PathEscape(strings.TrimSpace(intentID))+"/remit", body, idempotencyKey, correlationID, expectedPaymentVersion, &response)
	return response.CashRemittance, response.IdempotentReplay, err
}

func (c *Client) CreateCaptainOpeningFunding(ctx context.Context, captainActorID string, amountMinor int64, fundingReason, evidenceReference, idempotencyKey, correlationID, actingActorID string) (CaptainWalletFunding, bool, error) {
	body := map[string]any{"amountMinor": amountMinor, "fundingReason": strings.TrimSpace(fundingReason), "evidenceReference": strings.TrimSpace(evidenceReference)}
	var response struct {
		Funding          CaptainWalletFunding `json:"funding"`
		IdempotentReplay bool                 `json:"idempotentReplay"`
	}
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/captains/"+url.PathEscape(strings.TrimSpace(captainActorID))+"/opening-funding", body, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Funding, response.IdempotentReplay, err
}

func (c *Client) ReadCaptainWalletState(ctx context.Context, captainActorID string) (CaptainWalletState, error) {
	var response struct {
		State CaptainWalletState `json:"state"`
	}
	err := c.request(ctx, http.MethodGet, "/wlt/v1/captains/"+url.PathEscape(strings.TrimSpace(captainActorID))+"/wallet-state", nil, "", "", 0, &response)
	return response.State, err
}

func (c *Client) ReserveCaptainCOD(ctx context.Context, orderID, paymentIntentID, captainActorID, idempotencyKey, correlationID string) (CaptainCODReservation, bool, error) {
	body := map[string]any{"orderId": strings.TrimSpace(orderID), "paymentIntentId": strings.TrimSpace(paymentIntentID), "captainActorId": strings.TrimSpace(captainActorID)}
	var response struct {
		Reservation      CaptainCODReservation `json:"reservation"`
		IdempotentReplay bool                  `json:"idempotentReplay"`
	}
	err := c.request(ctx, http.MethodPost, "/wlt/v1/captain-cod-reservations", body, idempotencyKey, correlationID, 0, &response)
	return response.Reservation, response.IdempotentReplay, err
}

func (c *Client) ReleaseCaptainCOD(ctx context.Context, orderID, paymentIntentID, captainActorID, idempotencyKey, correlationID string) (CaptainCODReservation, bool, error) {
	return c.transitionCaptainCOD(ctx, "release", orderID, paymentIntentID, captainActorID, idempotencyKey, correlationID)
}

func (c *Client) FinalizeCaptainCOD(ctx context.Context, orderID, paymentIntentID, captainActorID, idempotencyKey, correlationID string) (CaptainCODReservation, bool, error) {
	return c.transitionCaptainCOD(ctx, "finalize", orderID, paymentIntentID, captainActorID, idempotencyKey, correlationID)
}

func (c *Client) transitionCaptainCOD(ctx context.Context, operation, orderID, paymentIntentID, captainActorID, idempotencyKey, correlationID string) (CaptainCODReservation, bool, error) {
	body := map[string]any{"paymentIntentId": strings.TrimSpace(paymentIntentID), "captainActorId": strings.TrimSpace(captainActorID)}
	var response struct {
		Reservation      CaptainCODReservation `json:"reservation"`
		IdempotentReplay bool                  `json:"idempotentReplay"`
	}
	err := c.request(ctx, http.MethodPost, "/wlt/v1/captain-cod-reservations/"+url.PathEscape(strings.TrimSpace(orderID))+"/"+operation, body, idempotencyKey, correlationID, 0, &response)
	return response.Reservation, response.IdempotentReplay, err
}

func (c *Client) PreparePartnerFinancialProfile(ctx context.Context, joiningCaseID, partnerActorID, origin string, commissionRateBps int, settlementPeriod, termsPolicyVersion, idempotencyKey, correlationID string) (PartnerFinancialProfile, bool, error) {
	body := map[string]any{
		"joiningCaseId":      joiningCaseID,
		"partnerActorId":     partnerActorID,
		"origin":             origin,
		"commissionRateBps":  commissionRateBps,
		"settlementPeriod":   settlementPeriod,
		"termsPolicyVersion": termsPolicyVersion,
	}
	var response partnerFinancialProfileResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/partner-financial-profiles", body, idempotencyKey, correlationID, 0, &response)
	return response.Profile, response.IdempotentReplay, err
}

func (c *Client) ReadPartnerFinancialProfile(ctx context.Context, profileID string) (PartnerFinancialProfile, error) {
	var response partnerFinancialProfileResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/partner-financial-profiles/"+url.PathEscape(strings.TrimSpace(profileID)), nil, "", "", 0, &response)
	return response.Profile, err
}

func (c *Client) ActivatePartnerFinancialProfile(ctx context.Context, profileID string, expectedVersion int, idempotencyKey, correlationID, actingActorID string) (PartnerFinancialProfile, bool, error) {
	var response partnerFinancialProfileResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/partner-financial-profiles/"+url.PathEscape(strings.TrimSpace(profileID))+"/activate", map[string]any{}, idempotencyKey, correlationID, expectedVersion, actingActorID, &response)
	return response.Profile, response.IdempotentReplay, err
}

func (c *Client) InitializePartnerStoreCommissionPolicies(ctx context.Context, storeID, partnerActorID, profileID, idempotencyKey, correlationID string) error {
	body := map[string]any{"storeId": strings.TrimSpace(storeID), "partnerActorId": strings.TrimSpace(partnerActorID)}
	if strings.TrimSpace(profileID) != "" {
		body["profileId"] = strings.TrimSpace(profileID)
	}
	return c.request(ctx, http.MethodPost, "/wlt/v1/partner-store-commission-policies/initialize", body, idempotencyKey, correlationID, 0, nil)
}

func (c *Client) EnsurePartnerStoreCommissionPolicies(ctx context.Context, storeID, partnerActorID, idempotencyKey, correlationID string) error {
	return c.InitializePartnerStoreCommissionPolicies(ctx, storeID, partnerActorID, "", idempotencyKey, correlationID)
}

func (c *Client) FinalizePartnerOrderEarning(ctx context.Context, orderID, paymentIntentID, partnerActorID, captainActorID, idempotencyKey, correlationID string) (PartnerOrderEarning, bool, error) {
	body := map[string]any{"orderId": strings.TrimSpace(orderID), "paymentIntentId": strings.TrimSpace(paymentIntentID), "partnerActorId": strings.TrimSpace(partnerActorID), "captainActorId": strings.TrimSpace(captainActorID)}
	var response partnerOrderEarningResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/partner-order-earnings/finalize", body, idempotencyKey, correlationID, 0, &response)
	return response.Earning, response.IdempotentReplay, err
}

func (c *Client) FinalizePartnerStoreCashCommission(ctx context.Context, orderID, paymentIntentID, partnerActorID, fulfillmentMode, idempotencyKey, correlationID string) (PartnerStoreCashCommission, bool, error) {
	body := map[string]any{"orderId": strings.TrimSpace(orderID), "paymentIntentId": strings.TrimSpace(paymentIntentID), "partnerActorId": strings.TrimSpace(partnerActorID), "fulfillmentMode": strings.TrimSpace(fulfillmentMode)}
	var response partnerStoreCashCommissionResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/partner-store-cash-commissions/finalize", body, idempotencyKey, correlationID, 0, &response)
	return response.Commission, response.IdempotentReplay, err
}

func (c *Client) RecordPartnerCommissionRemittance(ctx context.Context, partnerActorID string, amountMinor int64, remittanceReference, evidenceReference, idempotencyKey, correlationID, actingActorID string) (PartnerCommissionRemittance, bool, error) {
	body := map[string]any{"amountMinor": amountMinor, "remittanceReference": strings.TrimSpace(remittanceReference), "evidenceReference": strings.TrimSpace(evidenceReference)}
	var response partnerCommissionRemittanceResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/partners/"+url.PathEscape(strings.TrimSpace(partnerActorID))+"/commission-remittances", body, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Remittance, response.IdempotentReplay, err
}

func (c *Client) ReadPartnerFinancialSummary(ctx context.Context, partnerActorID string) (PartnerFinancialSummary, error) {
	var response partnerFinancialSummaryResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/partners/"+url.PathEscape(strings.TrimSpace(partnerActorID))+"/financial-summary", nil, "", "", 0, &response)
	return response.Summary, err
}

func (c *Client) CreateFieldCommissionPolicy(ctx context.Context, scopeType, scopeID string, rewardMinor, roundingUnitMinor int64, expectedVersion int, reason, idempotencyKey, correlationID, actingActorID string) (FieldCommissionPolicy, bool, error) {
	body := map[string]any{"scopeType": strings.TrimSpace(scopeType), "scopeId": strings.TrimSpace(scopeID), "rewardMinor": rewardMinor, "roundingUnitMinor": roundingUnitMinor, "expectedVersion": expectedVersion, "reason": strings.TrimSpace(reason)}
	var response fieldCommissionPolicyResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/field-commission-policies", body, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Policy, response.IdempotentReplay, err
}

func (c *Client) ReadFieldCommissionPolicyByScope(ctx context.Context, scopeType, scopeID string) (FieldCommissionPolicy, error) {
	query := url.Values{}
	query.Set("scopeType", strings.TrimSpace(scopeType))
	query.Set("scopeId", strings.TrimSpace(scopeID))
	var response fieldCommissionPolicyResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/operator/field-commission-policies?"+query.Encode(), nil, "", "", 0, &response)
	return response.Policy, err
}

func (c *Client) ReadFieldCommissionPolicy(ctx context.Context, policyID string) (FieldCommissionPolicy, error) {
	var response fieldCommissionPolicyResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/field-commission-policies/"+url.PathEscape(strings.TrimSpace(policyID)), nil, "", "", 0, &response)
	return response.Policy, err
}

func (c *Client) FinalizeFieldCommission(ctx context.Context, storeID, fieldActorID, verticalID, idempotencyKey, correlationID string) (FieldCommissionEarning, bool, error) {
	body := map[string]any{"storeId": strings.TrimSpace(storeID), "fieldActorId": strings.TrimSpace(fieldActorID), "verticalId": strings.TrimSpace(verticalID)}
	var response fieldCommissionEarningResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/field-commission-earnings/finalize", body, idempotencyKey, correlationID, 0, &response)
	return response.Earning, response.IdempotentReplay, err
}

func (c *Client) ReadFieldFinancialSummary(ctx context.Context, fieldActorID string) (FieldFinancialSummary, error) {
	var response fieldFinancialSummaryResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/fields/"+url.PathEscape(strings.TrimSpace(fieldActorID))+"/financial-summary", nil, "", "", 0, &response)
	return response.Summary, err
}

func (c *Client) CreateOfficialWalletDestination(ctx context.Context, destination OfficialWalletDestination, walletIdentifier, changeReason, verificationEvidenceReference, changeEvidenceReference, idempotencyKey, correlationID, actingActorID string) (OfficialWalletDestination, bool, error) {
	body := map[string]any{"actorType": strings.TrimSpace(destination.ActorType), "actorId": strings.TrimSpace(destination.ActorID), "providerKey": strings.TrimSpace(destination.ProviderKey), "walletIdentifier": strings.TrimSpace(walletIdentifier), "beneficiaryName": strings.TrimSpace(destination.BeneficiaryName), "changeReason": strings.TrimSpace(changeReason), "verificationEvidenceReference": strings.TrimSpace(verificationEvidenceReference), "changeEvidenceReference": strings.TrimSpace(changeEvidenceReference)}
	var response officialWalletDestinationResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/official-wallet-destinations", body, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Destination, response.IdempotentReplay, err
}

func (c *Client) VerifyOfficialWalletDestination(ctx context.Context, destinationID, evidenceReference, idempotencyKey, correlationID, actingActorID string) (OfficialWalletDestination, error) {
	var response officialWalletDestinationResponse
	body := map[string]any{"evidenceReference": strings.TrimSpace(evidenceReference)}
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/official-wallet-destinations/"+url.PathEscape(strings.TrimSpace(destinationID))+"/verify", body, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Destination, err
}

func (c *Client) ActivateOfficialWalletDestination(ctx context.Context, destinationID, idempotencyKey, correlationID, actingActorID string) (OfficialWalletDestination, error) {
	var response officialWalletDestinationResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/official-wallet-destinations/"+url.PathEscape(strings.TrimSpace(destinationID))+"/activate", map[string]any{}, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Destination, err
}

func (c *Client) ReadOfficialWalletDestination(ctx context.Context, actorType, actorID string) (OfficialWalletDestination, error) {
	var response officialWalletDestinationResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/official-wallet-destinations/"+url.PathEscape(strings.TrimSpace(actorType))+"/"+url.PathEscape(strings.TrimSpace(actorID)), nil, "", "", 0, &response)
	return response.Destination, err
}

func (c *Client) CreatePayoutIntent(ctx context.Context, actorType, actorID, amountMode string, amountMinor *int64, idempotencyKey, correlationID string) (PayoutRequest, bool, error) {
	body := map[string]any{"actorType": strings.TrimSpace(actorType), "actorId": strings.TrimSpace(actorID), "amountMode": strings.TrimSpace(amountMode)}
	if amountMinor != nil {
		body["amountMinor"] = *amountMinor
	}
	var response payoutRequestResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/payout-intents", body, idempotencyKey, correlationID, 0, &response)
	return response.Payout, response.IdempotentReplay, err
}

func (c *Client) ReadPayoutState(ctx context.Context, actorType, actorID string) (PayoutState, error) {
	var response payoutStateResponse
	path := "/wlt/v1/payout-state/" + url.PathEscape(strings.ToLower(strings.TrimSpace(actorType))) + "/" + url.PathEscape(strings.TrimSpace(actorID))
	err := c.request(ctx, http.MethodGet, path, nil, "", "", 0, &response)
	return response.State, err
}

func (c *Client) ListPayoutRequests(ctx context.Context, status, actingActorID string) ([]PayoutRequest, error) {
	path := "/wlt/v1/operator/payout-requests"
	if strings.TrimSpace(status) != "" {
		path += "?status=" + url.QueryEscape(strings.TrimSpace(status))
	}
	var response payoutListResponse
	err := c.requestWithActor(ctx, http.MethodGet, path, nil, "", "", 0, actingActorID, &response)
	return response.Payouts, err
}

func (c *Client) ReadOperatorPayoutRequest(ctx context.Context, payoutID, actingActorID string) (PayoutRequest, error) {
	var response payoutRequestResponse
	err := c.requestWithActor(ctx, http.MethodGet, "/wlt/v1/operator/payout-requests/"+url.PathEscape(strings.TrimSpace(payoutID)), nil, "", "", 0, actingActorID, &response)
	return response.Payout, err
}

func (c *Client) PreparePayout(ctx context.Context, payoutID, reason, evidenceReference, idempotencyKey, correlationID, actingActorID string) (PayoutRequest, error) {
	body := map[string]any{"reason": strings.TrimSpace(reason), "evidenceReference": strings.TrimSpace(evidenceReference)}
	var response payoutRequestResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/payout-requests/"+url.PathEscape(strings.TrimSpace(payoutID))+"/prepare", body, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Payout, err
}

func (c *Client) ApprovePayout(ctx context.Context, payoutID, reason, idempotencyKey, correlationID, actingActorID string) (PayoutRequest, error) {
	body := map[string]any{"reason": strings.TrimSpace(reason)}
	var response payoutRequestResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/payout-requests/"+url.PathEscape(strings.TrimSpace(payoutID))+"/approve", body, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Payout, err
}

func (c *Client) CancelPayout(ctx context.Context, payoutID, reason, idempotencyKey, correlationID, actingActorID string) (PayoutRequest, error) {
	body := map[string]any{"reason": strings.TrimSpace(reason)}
	var response payoutRequestResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/payout-requests/"+url.PathEscape(strings.TrimSpace(payoutID))+"/cancel", body, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Payout, err
}

func (c *Client) CreateSettlementBatch(ctx context.Context, payoutIDs []string, idempotencyKey, correlationID, actingActorID string) (SettlementBatch, error) {
	body := map[string]any{"payoutIds": payoutIDs}
	var response settlementBatchResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/settlement-batches", body, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Batch, err
}

func (c *Client) ReadSettlementBatch(ctx context.Context, batchID, actingActorID string) (SettlementBatch, error) {
	var response settlementBatchResponse
	err := c.requestWithActor(ctx, http.MethodGet, "/wlt/v1/operator/settlement-batches/"+url.PathEscape(strings.TrimSpace(batchID)), nil, "", "", 0, actingActorID, &response)
	return response.Batch, err
}

func (c *Client) ApproveSettlementBatch(ctx context.Context, batchID, reason, idempotencyKey, correlationID, actingActorID string) (SettlementBatch, error) {
	var response settlementBatchResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/settlement-batches/"+url.PathEscape(strings.TrimSpace(batchID))+"/approve", map[string]any{"reason": strings.TrimSpace(reason)}, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Batch, err
}

func (c *Client) FreezeSettlementBatch(ctx context.Context, batchID, reason, idempotencyKey, correlationID, actingActorID string) (SettlementBatch, error) {
	var response settlementBatchResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/settlement-batches/"+url.PathEscape(strings.TrimSpace(batchID))+"/freeze", map[string]any{"reason": strings.TrimSpace(reason)}, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Batch, err
}

func (c *Client) RecordManualTransfer(ctx context.Context, batchID, payoutID, externalReference, evidenceReference, idempotencyKey, correlationID, actingActorID string) (ManualTransferExecution, error) {
	body := map[string]any{"payoutId": strings.TrimSpace(payoutID), "externalTransferReference": strings.TrimSpace(externalReference), "evidenceReference": strings.TrimSpace(evidenceReference)}
	var response transferResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/settlement-batches/"+url.PathEscape(strings.TrimSpace(batchID))+"/transfers", body, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Transfer, err
}

func (c *Client) VerifyManualTransfer(ctx context.Context, transferID, evidenceReference, idempotencyKey, correlationID, actingActorID string) (ManualTransferExecution, error) {
	var response transferResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/transfers/"+url.PathEscape(strings.TrimSpace(transferID))+"/verify", map[string]any{"evidenceReference": strings.TrimSpace(evidenceReference)}, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Transfer, err
}

func (c *Client) ReconcileManualTransfer(ctx context.Context, transferID, statementReference, idempotencyKey, correlationID, actingActorID string) (ManualTransferExecution, error) {
	var response transferResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/transfers/"+url.PathEscape(strings.TrimSpace(transferID))+"/reconcile", map[string]any{"statementReference": strings.TrimSpace(statementReference)}, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Transfer, err
}

func (c *Client) QuoteDeliveryFee(ctx context.Context, input DeliveryFeeQuoteInput) (DeliveryFeeQuote, error) {
	var response deliveryFeeQuoteResponse
	err := c.request(ctx, http.MethodPost, "/wlt/v1/delivery-quotes", input, "", "", 0, &response)
	return response.Quote, err
}

func (c *Client) ReadDeliveryFeePolicy(ctx context.Context, serviceCityID string) (DeliveryFeePolicy, error) {
	var response deliveryFeePolicyResponse
	path := "/wlt/v1/operator/delivery-fee-policies?serviceCityId=" + url.QueryEscape(strings.TrimSpace(serviceCityID))
	err := c.request(ctx, http.MethodGet, path, nil, "", "", 0, &response)
	return response.Policy, err
}

func (c *Client) ReadPartnerFinancialTermsPolicy(ctx context.Context) (PartnerFinancialTermsPolicy, error) {
	var response partnerFinancialTermsPolicyResponse
	err := c.request(ctx, http.MethodGet, "/wlt/v1/operator/partner-financial-terms-policy", nil, "", "", 0, &response)
	return response.Policy, err
}

func (c *Client) CreatePartnerFinancialTermsPolicy(ctx context.Context, commissionRateBps int, settlementPeriod string, expectedVersion int, reason, idempotencyKey, correlationID, actingActorID string) (PartnerFinancialTermsPolicy, bool, error) {
	body := map[string]any{"commissionRateBps": commissionRateBps, "settlementPeriod": strings.ToUpper(strings.TrimSpace(settlementPeriod)), "expectedVersion": expectedVersion, "reason": strings.TrimSpace(reason)}
	var response partnerFinancialTermsPolicyResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/partner-financial-terms-policy", body, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Policy, response.IdempotentReplay, err
}

func (c *Client) ReadPartnerStoreCommissionPolicies(ctx context.Context, storeID string) (PartnerStoreCommissionPoliciesResponse, error) {
	var response PartnerStoreCommissionPoliciesResponse
	path := "/wlt/v1/operator/partner-store-commission-policies?storeId=" + url.QueryEscape(strings.TrimSpace(storeID))
	err := c.request(ctx, http.MethodGet, path, nil, "", "", 0, &response)
	return response, err
}

func (c *Client) UpdatePartnerStoreCommissionPolicy(ctx context.Context, storeID, fulfillmentMode string, commissionRateBps, expectedVersion int, reason, idempotencyKey, correlationID, actingActorID string) (PartnerStoreCommissionPolicyResponse, error) {
	body := map[string]any{
		"storeId": strings.TrimSpace(storeID), "fulfillmentMode": strings.TrimSpace(fulfillmentMode),
		"commissionRateBps": commissionRateBps, "expectedVersion": expectedVersion, "reason": strings.TrimSpace(reason),
	}
	var response PartnerStoreCommissionPolicyResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/partner-store-commission-policies", body, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response, err
}

func (c *Client) CreateDeliveryFeePolicy(ctx context.Context, policy DeliveryFeePolicy, expectedVersion int, reason, idempotencyKey, correlationID, actingActorID string) (DeliveryFeePolicy, bool, error) {
	body := map[string]any{
		"serviceCityId":          strings.TrimSpace(policy.ServiceCityID),
		"baseFeeMinor":           policy.BaseFeeMinor,
		"distanceUnitMeters":     policy.DistanceUnitMeters,
		"distanceRateMinor":      policy.DistanceRateMinor,
		"orderSizeUnitBaseUnits": policy.OrderSizeUnitBaseUnits,
		"orderSizeRateMinor":     policy.OrderSizeRateMinor,
		"zoneSurchargeMinor":     policy.ZoneSurchargeMinor,
		"roundingUnitMinor":      policy.RoundingUnitMinor,
		"expectedVersion":        expectedVersion,
		"reason":                 strings.TrimSpace(reason),
	}
	var response deliveryFeePolicyResponse
	err := c.requestWithActor(ctx, http.MethodPost, "/wlt/v1/operator/delivery-fee-policies", body, idempotencyKey, correlationID, 0, actingActorID, &response)
	return response.Policy, response.IdempotentReplay, err
}

func (c *Client) request(ctx context.Context, method, path string, body any, idempotencyKey, correlationID string, expectedVersion int, target any) error {
	return c.requestWithActor(ctx, method, path, body, idempotencyKey, correlationID, expectedVersion, "", target)
}

func (c *Client) requestWithActor(ctx context.Context, method, path string, body any, idempotencyKey, correlationID string, expectedVersion int, actingActorID string, target any) error {
	if c == nil || c.httpClient == nil || strings.TrimSpace(c.baseURL) == "" || strings.TrimSpace(c.serviceToken) == "" {
		return errors.New("WLT client is not configured")
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = strings.NewReader(string(encoded))
	}
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+c.serviceToken)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(idempotencyKey) != "" {
		request.Header.Set("Idempotency-Key", strings.TrimSpace(idempotencyKey))
	}
	if strings.TrimSpace(correlationID) != "" {
		request.Header.Set("X-Correlation-ID", strings.TrimSpace(correlationID))
	}
	if expectedVersion > 0 {
		request.Header.Set("X-Expected-Version", fmt.Sprintf("%d", expectedVersion))
	}
	if strings.TrimSpace(actingActorID) != "" {
		request.Header.Set("X-Acting-Actor-ID", strings.TrimSpace(actingActorID))
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if !targetedStatus(response.StatusCode) {
		var payload struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return &Error{Status: response.StatusCode, Code: payload.Error.Code, Message: payload.Error.Message}
	}
	if target == nil {
		return nil
	}
	return json.NewDecoder(response.Body).Decode(target)
}

func targetedStatus(status int) bool {
	return status >= http.StatusOK && status < http.StatusMultipleChoices
}
