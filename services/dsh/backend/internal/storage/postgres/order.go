package postgres

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	phoneformat "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/phone"
)

var (
	ErrOrderNotFound               = errors.New("order was not found")
	ErrCheckoutEvidenceStale       = errors.New("checkout evidence is stale or invalid")
	ErrCheckoutIdempotencyConflict = errors.New("checkout idempotency key was already used with different facts")
	ErrCheckoutPaymentReconciled   = errors.New("the previous checkout payment was safely cancelled")
	ErrOrderStateConflict          = errors.New("order state does not allow this transition")
	ErrOrderVersionConflict        = errors.New("order version is stale")
	ErrOrderTransitionConflict     = errors.New("order transition idempotency key was already used with different facts")
	ErrOrderTransitionInvalid      = errors.New("order transition is invalid")
	ErrStorePickupProofInvalid     = errors.New("store pickup proof is invalid")
	ErrPaymentProvisioning         = errors.New("payment intent could not be provisioned")
	ErrExternalOutcomeUnknown      = errors.New("external business outcome is unknown")
	ErrDeliveryFeeUnavailable      = errors.New("delivery fee could not be resolved")
	ErrPaymentStateConflict        = errors.New("order payment state is stale or invalid")
	ErrCheckoutRecipientInvalid    = errors.New("checkout delivery recipient is invalid")
	ErrPartnerOrdersScopeInvalid   = errors.New("partner orders Store scope is invalid")
	ErrPartnerOrdersInvalidState   = errors.New("partner orders state filter is invalid")
	ErrPartnerOrdersInvalidQuery   = errors.New("partner orders search query is invalid")
	ErrPartnerOrdersInvalidCursor  = errors.New("partner orders cursor is invalid")
)

const CancellationReasonPickupCustomerNoShow = "pickup_customer_no_show"

type CheckoutEvidence struct {
	ServiceCityID        string
	PolicyVersion        string
	Status               string
	StoreVersion         int
	AddressVersion       int
	StoreOriginLatitude  float64
	StoreOriginLongitude float64
	AddressLatitude      float64
	AddressLongitude     float64
}

type ProvisionedPayment struct {
	IntentID        string
	State           string
	CashAmountMinor int64
}

type DeliveryFeeQuoteInput struct {
	StoreID              string
	FulfillmentMode      string
	ServiceCityID        string
	OriginLatitude       float64
	OriginLongitude      float64
	DestinationLatitude  float64
	DestinationLongitude float64
	OrderSizeBaseUnits   int64
}

type DeliveryFeeQuote struct {
	PlatformMarginMinor int64
	FeeMinor            int64
	PolicyVersion       string
}

type DeliveryFeeResolver func(ctx context.Context, input DeliveryFeeQuoteInput) (DeliveryFeeQuote, error)

// PromotionFunding carries the checkout-frozen promotion funding vocabulary to
// the payment provisioner so WLT can freeze the exact monetary split.
type PromotionFunding struct {
	PromotionID         string
	PromotionVersion    int
	PromotionCode       string
	FundingSource       string
	PartnerSharePercent *int
}

type PaymentIntentProvisioner func(ctx context.Context, orderID, externalReference, payerActorID string, subtotalMinor, discountMinor, deliveryFeeMinor, deliveryMarginMinor int64, deliveryPolicyVersion string, amountMinor int64, promotion PromotionFunding, idempotencyKey, correlationID string) (ProvisionedPayment, error)

type PaymentIntentCanceller func(ctx context.Context, intentID, reason, idempotencyKey, correlationID string) error

type PaymentIntentRecoveryRecord struct {
	IntentID          string
	ExternalReference string
	PayerActorID      string
	OrderID           string
	Method            string
	State             string
}

type PaymentIntentRecoveryReader func(ctx context.Context, externalReference string) (PaymentIntentRecoveryRecord, bool, error)

type DeliveryRecipientInput struct {
	Mode         string
	Name         string
	PhoneE164    string
	Instructions string
}

type DeliveryRecipientRecord struct {
	Mode         string
	Name         *string
	PhoneE164    *string
	Instructions *string
}

type CheckoutInput struct {
	ClientActorID               string
	CartID                      string
	StoreID                     string
	AddressID                   string
	FulfillmentMode             string
	InternalBalanceAmountMinor  int64
	ExpectedTotalAmountMinor    *int64
	ExpectedCartVersion         int
	Evidence                    CheckoutEvidence
	IdempotencyKey              string
	RequestHash                 string
	ActingActorID               string
	CorrelationID               string
	PaymentExternalReference    string
	PaymentIdempotencyKey       string
	PaymentCancellationKey      string
	PaymentMethod               string
	PromotionCode               string
	DiscoveryClickEventID       string
	CustomerNote                string
	Recipient                   DeliveryRecipientInput
	DeliveryProofKeyring        *DeliveryProofKeyring
	DeliveryFeeResolver         DeliveryFeeResolver
	PaymentProvisioner          PaymentIntentProvisioner
	PaymentIntentRecoveryReader PaymentIntentRecoveryReader
	PaymentCanceller            PaymentIntentCanceller
}

type OrderLineRecord struct {
	ID                         string
	OrderID                    string
	StoreOfferID               string
	VariantID                  string
	ProductID                  string
	ProductName                string
	VariantTitle               string
	MeasurementKind            string
	BaseUnit                   string
	PricingBasis               string
	QuantityPolicy             string
	QuantityMinBaseUnits       int64
	QuantityMaxBaseUnits       int64
	QuantityStepBaseUnits      int64
	PricingUnitBaseUnits       int64
	RequestedQuantityBaseUnits int64
	FinalQuantityBaseUnits     *int64
	UnitPriceMinor             int64
	LineAmountMinor            int64
	Currency                   string
	SelectedModifierOptionIDs  []string
	ModifierSnapshots          []OrderLineModifierSnapshotRecord
	AttributeSnapshots         []OrderLineAttributeSnapshotRecord
	ModifierAmountMinor        int64
	CreatedAt                  time.Time
}

type OrderLineModifierSnapshotRecord struct {
	OptionID        string
	OptionNameAr    string
	PriceDeltaMinor int64
}

type OrderLineAttributeSnapshotRecord struct {
	AttributeID     string
	Code            string
	ValueKind       string
	TextValue       *string
	IntegerValue    *int64
	DecimalValue    *string
	BooleanValue    *bool
	EnumValue       *string
	DateValue       *string
	MeasurementUnit *string
}

type OrderRecord struct {
	ID                           string
	ClientActorID                string
	StoreID                      string
	CancellationMode             string
	CancellationPolicyVersion    int
	StoreName                    string
	PickupLocation               *OrderPickupLocationRecord
	CartID                       string
	CustomerNote                 string
	FulfillmentMode              string
	AddressID                    string
	AddressVersion               int
	AddressText                  string
	AddressLatitude              float64
	AddressLongitude             float64
	ServiceCityID                string
	ServiceabilityPolicyVersion  string
	ServiceabilityStatus         string
	ServiceabilityStoreVersion   int
	ServiceabilityAddressVersion int
	Recipient                    DeliveryRecipientRecord
	StoreOrderabilityState       string
	StoreOrderabilityVersion     int
	StoreOrderabilityEvaluatedAt *time.Time
	State                        string
	SubtotalAmountMinor          int64
	DiscountMinor                int64
	PromotionID                  string
	PromotionCode                string
	PromotionVersion             int
	PromotionFundingSource       string
	PromotionFundingSharePercent int
	TotalAmountMinor             int64
	PaymentCashAmountMinor       int64
	Currency                     string
	PaymentIntentID              *string
	PaymentMethod                string
	PaymentState                 string
	StoreCashHandoffState        string
	Version                      int
	Lines                        []OrderLineRecord
	Adjustments                  []OrderAdjustmentRecord
	CreatedAt                    time.Time
	UpdatedAt                    time.Time
}

type OrderPickupLocationRecord struct {
	Latitude  float64
	Longitude float64
}

type DeliveryProofRecord struct {
	OrderID    string
	ProofType  string
	State      string
	Code       string
	VerifiedAt *time.Time
}

func newDeliveryProofCode() (string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(900000))
	if err != nil {
		return "", err
	}
	return strconv.FormatInt(value.Int64()+100000, 10), nil
}

func HashDeliveryProofCode(orderID, code string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(orderID) + "|" + strings.TrimSpace(code)))
	return fmt.Sprintf("%x", digest[:])
}

func stableCheckoutOrderID(clientActorID, cartID, idempotencyKey string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(clientActorID) + "|" + strings.TrimSpace(cartID) + "|" + strings.TrimSpace(idempotencyKey)))
	return "order_" + hex.EncodeToString(digest[:16])
}

func ReadClientDeliveryProof(ctx context.Context, db *sql.DB, orderID, clientActorID string, keys *DeliveryProofKeyring) (DeliveryProofRecord, error) {
	if db == nil || keys == nil || strings.TrimSpace(orderID) == "" || strings.TrimSpace(clientActorID) == "" {
		return DeliveryProofRecord{}, ErrOrderNotFound
	}
	var proof DeliveryProofRecord
	var keyID, ciphertext string
	err := db.QueryRowContext(ctx, `SELECT p.order_id,p.proof_type,p.state,CASE WHEN p.state='PENDING' AND ((p.proof_type='STORE_PICKUP' AND o.state='READY_FOR_PICKUP') OR (p.proof_type='DELIVERY' AND o.state='IN_CUSTODY')) THEN p.code_key_id ELSE '' END,CASE WHEN p.state='PENDING' AND ((p.proof_type='STORE_PICKUP' AND o.state='READY_FOR_PICKUP') OR (p.proof_type='DELIVERY' AND o.state='IN_CUSTODY')) THEN p.code_ciphertext ELSE '' END,p.verified_at FROM dsh.commerce_order_delivery_proofs p JOIN dsh.commerce_orders o ON o.id=p.order_id AND o.client_actor_id=p.client_actor_id WHERE p.order_id=$1 AND p.client_actor_id=$2`, strings.TrimSpace(orderID), strings.TrimSpace(clientActorID)).Scan(&proof.OrderID, &proof.ProofType, &proof.State, &keyID, &ciphertext, &proof.VerifiedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return DeliveryProofRecord{}, ErrOrderNotFound
	} else if err != nil {
		return DeliveryProofRecord{}, err
	}
	if ciphertext != "" {
		proof.Code, err = keys.Decrypt(proof.OrderID, keyID, ciphertext)
		if err != nil {
			return DeliveryProofRecord{}, err
		}
	}
	return proof, nil
}

type OperatorOperationEventRecord struct {
	ID        string
	Source    string
	EventType string
	State     string
	ActorID   string
	Reason    string
	At        time.Time
}

type OperatorOperationRecord struct {
	Order                         OrderRecord
	History                       []OperatorOperationEventRecord
	HistoryHasMore                bool
	StoreName                     string
	Assignment                    *CaptainAssignment
	CustomerSuccessfulOrdersCount int
	SuccessfulOrderOrdinal        int
}

type OperatorOperationListRecord struct {
	StageSLA             OperatorStageSLA
	StageStartedAt       *time.Time
	PreparationMinutes   *int
	OrderID              string
	StoreName            string
	MultiStoreCheckoutID string
	State                string
	UpdatedAt            time.Time
	Assignment           *OperatorAssignmentListRecord
}

type OperatorAssignmentListRecord struct {
	ID             string
	OrderID        string
	CaptainActorID string
	State          string
	Version        int
	HandoffState   string
}

type OperatorOperationsResult struct {
	Operations []OperatorOperationListRecord
	NextCursor string
	Summary    OperatorOperationsSummary
}

type OperatorOperationsSummary struct {
	TotalCount               int
	ActionableCount          int
	AwaitingDispatchCount    int
	ActiveCount              int
	InCustodyOrderCount      int
	InCustodyOrderValueMinor int64
	DeliveredCount           int
	MeasuredAt               time.Time
}

// Legacy multi-store children omit a displayed total. Direct client checkout
// requires one at the HTTP boundary; when present, the actual locked financial
// total must match before any external payment intent can be provisioned.
func checkoutTotalMatchesConfirmation(expected *int64, actual int64) bool {
	return actual > 0 && (expected == nil || (*expected > 0 && *expected == actual))
}

func HashCheckoutRequest(input CheckoutInput) string {
	facts := []string{strings.TrimSpace(input.ClientActorID), strings.TrimSpace(input.CartID), strings.TrimSpace(input.StoreID), strings.TrimSpace(input.AddressID), strings.TrimSpace(input.FulfillmentMode), strings.TrimSpace(input.PaymentMethod)}
	if strings.EqualFold(strings.TrimSpace(input.Recipient.Mode), "OTHER") {
		facts = append(facts, "delivery-recipient-other", strings.TrimSpace(input.Recipient.Name), phoneformat.NormalizeYemenE164(input.Recipient.PhoneE164), strings.TrimSpace(input.Recipient.Instructions))
	}
	if input.CustomerNote != "" {
		facts = append(facts, "customer-note", input.CustomerNote)
	}
	if input.InternalBalanceAmountMinor > 0 {
		facts = append(facts, "internal-balance", strconv.FormatInt(input.InternalBalanceAmountMinor, 10))
	}
	if input.ExpectedTotalAmountMinor != nil {
		facts = append(facts, "confirmed-total", strconv.FormatInt(*input.ExpectedTotalAmountMinor, 10))
	}
	if clickID := strings.TrimSpace(input.DiscoveryClickEventID); clickID != "" {
		facts = append(facts, "discovery-click", clickID)
	}
	facts = append(facts, strconv.Itoa(input.ExpectedCartVersion), input.Evidence.ServiceCityID, input.Evidence.PolicyVersion, input.Evidence.Status, strconv.Itoa(input.Evidence.StoreVersion), strconv.Itoa(input.Evidence.AddressVersion), strings.TrimSpace(input.PromotionCode))
	return hashFacts(facts...)
}

func NormalizeDeliveryRecipient(input DeliveryRecipientInput, fulfillmentMode string) (DeliveryRecipientInput, error) {
	input.Mode = strings.ToUpper(strings.TrimSpace(input.Mode))
	input.Name = strings.TrimSpace(input.Name)
	input.PhoneE164 = phoneformat.NormalizeYemenE164(input.PhoneE164)
	input.Instructions = strings.TrimSpace(input.Instructions)
	if input.Mode == "" {
		input.Mode = "SELF"
	}
	if input.Mode == "SELF" {
		if input.Name != "" || input.PhoneE164 != "" || input.Instructions != "" {
			return DeliveryRecipientInput{}, ErrCheckoutRecipientInvalid
		}
		return input, nil
	}
	if input.Mode != "OTHER" || fulfillmentMode == FulfillmentModeCustomerPickup || utf8.RuneCountInString(input.Name) < 2 || utf8.RuneCountInString(input.Name) > 120 || !validRecipientPhoneE164(input.PhoneE164) || utf8.RuneCountInString(input.Instructions) > 500 {
		return DeliveryRecipientInput{}, ErrCheckoutRecipientInvalid
	}
	return input, nil
}

func validRecipientPhoneE164(value string) bool {
	return phoneformat.IsE164(value)
}

func HashOrderTransition(orderID, state string, expectedVersion int) string {
	return hashFacts(strings.TrimSpace(orderID), strings.TrimSpace(state), strconv.Itoa(expectedVersion))
}
