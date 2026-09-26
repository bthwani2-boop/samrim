package postgres

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lib/pq"
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
	IntentID string
	State    string
}

type DeliveryFeeQuoteInput struct {
	ServiceCityID        string
	OriginLatitude       float64
	OriginLongitude      float64
	DestinationLatitude  float64
	DestinationLongitude float64
	OrderSizeBaseUnits   int64
}

type DeliveryFeeQuote struct {
	FeeMinor      int64
	PolicyVersion string
}

type DeliveryFeeResolver func(ctx context.Context, input DeliveryFeeQuoteInput) (DeliveryFeeQuote, error)

type PaymentIntentProvisioner func(ctx context.Context, orderID, externalReference, payerActorID string, subtotalMinor, discountMinor, deliveryFeeMinor int64, deliveryPolicyVersion string, amountMinor int64, idempotencyKey, correlationID string) (ProvisionedPayment, error)

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

type CheckoutInput struct {
	ClientActorID               string
	CartID                      string
	StoreID                     string
	AddressID                   string
	FulfillmentMode             string
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
	StoreName                    string
	PickupLocation               *OrderPickupLocationRecord
	CartID                       string
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
	State                        string
	SubtotalAmountMinor          int64
	DiscountMinor                int64
	PromotionID                  string
	PromotionCode                string
	TotalAmountMinor             int64
	Currency                     string
	PaymentIntentID              *string
	PaymentMethod                string
	PaymentState                 string
	StoreCashHandoffState        string
	Version                      int
	Lines                        []OrderLineRecord
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

type OperatorOperationRecord struct {
	Order      OrderRecord
	StoreName  string
	Assignment *CaptainAssignment
}

type OperatorOperationListRecord struct {
	OrderID    string
	StoreName  string
	State      string
	UpdatedAt  time.Time
	Assignment *OperatorAssignmentListRecord
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
}

func HashCheckoutRequest(input CheckoutInput) string {
	return hashFacts(strings.TrimSpace(input.ClientActorID), strings.TrimSpace(input.CartID), strings.TrimSpace(input.StoreID), strings.TrimSpace(input.AddressID), strings.TrimSpace(input.FulfillmentMode), strings.TrimSpace(input.PaymentMethod), strconv.Itoa(input.ExpectedCartVersion), input.Evidence.ServiceCityID, input.Evidence.PolicyVersion, input.Evidence.Status, strconv.Itoa(input.Evidence.StoreVersion), strconv.Itoa(input.Evidence.AddressVersion), strings.TrimSpace(input.PromotionCode))
}

func HashOrderTransition(orderID, state string, expectedVersion int) string {
	return hashFacts(strings.TrimSpace(orderID), strings.TrimSpace(state), strconv.Itoa(expectedVersion))
}

func ReadOrder(ctx context.Context, db *sql.DB, orderID string) (OrderRecord, error) {
	return readOrder(ctx, db, "o.id=$1", strings.TrimSpace(orderID))
}

func ReadOrderForClient(ctx context.Context, db *sql.DB, orderID, clientActorID string) (OrderRecord, error) {
	return readOrder(ctx, db, "o.id=$1 AND o.client_actor_id=$2", strings.TrimSpace(orderID), strings.TrimSpace(clientActorID))
}

func ListOrdersForClient(ctx context.Context, db *sql.DB, clientActorID, state string, limit int) ([]OrderRecord, error) {
	return listOrders(ctx, db, "o.client_actor_id=$1", []any{strings.TrimSpace(clientActorID)}, state, limit)
}

func ListOrdersForClientByCart(ctx context.Context, db *sql.DB, clientActorID, cartID string) ([]OrderRecord, error) {
	clientActorID, cartID = strings.TrimSpace(clientActorID), strings.TrimSpace(cartID)
	if clientActorID == "" || cartID == "" {
		return nil, ErrOrderNotFound
	}
	return listOrders(ctx, db, "o.client_actor_id=$1 AND o.cart_id=$2", []any{clientActorID, cartID}, "", 1)
}

func ListOrdersForStore(ctx context.Context, db *sql.DB, storeID, state string, limit int) ([]OrderRecord, error) {
	return listOrders(ctx, db, "o.store_id=$1", []any{strings.TrimSpace(storeID)}, state, limit)
}

var (
	ErrOperatorOperationInvalidCursor = errors.New("operator operation cursor is invalid")
	ErrOperatorOperationInvalidLimit  = errors.New("operator operation limit is invalid")
	ErrOperatorOperationInvalidQuery  = errors.New("operator operation search query is invalid")
	ErrOperatorOperationInvalidSort   = errors.New("operator operation sort is invalid")
)

type operatorOperationsCursor struct {
	UpdatedAt      time.Time `json:"updatedAt"`
	ID             string    `json:"id"`
	State          string    `json:"state"`
	ActionableOnly bool      `json:"actionableOnly"`
	Query          string    `json:"query"`
	Sort           string    `json:"sort"`
}

func ListOrdersForOperator(ctx context.Context, db *sql.DB, state, query, sort string, actionableOnly bool, limit int, cursor string) (OperatorOperationsResult, error) {
	if db == nil || limit < 1 || limit > 100 {
		return OperatorOperationsResult{}, ErrOperatorOperationInvalidLimit
	}
	state = strings.TrimSpace(state)
	query = strings.TrimSpace(query)
	if utf8.RuneCountInString(query) > 128 {
		return OperatorOperationsResult{}, ErrOperatorOperationInvalidQuery
	}
	sort = strings.TrimSpace(sort)
	if sort == "" {
		sort = "updated_desc"
	}
	if sort != "updated_desc" && sort != "updated_asc" {
		return OperatorOperationsResult{}, ErrOperatorOperationInvalidSort
	}
	ascending := sort == "updated_asc"
	args := []any{}
	where := "TRUE"
	if state != "" {
		args = append(args, state)
		where += " AND o.state=$" + strconv.Itoa(len(args))
	}
	if actionableOnly {
		where += " AND (o.state='READY_FOR_DISPATCH' OR (o.state='CAPTAIN_ASSIGNED' AND a.state='assigned') OR (o.state='DELIVERY_FAILED' AND a.state='delivery_failed'))"
	}
	if query != "" {
		args = append(args, "%"+escapeOperatorOperationSearch(query)+"%")
		where += " AND (o.id ILIKE $" + strconv.Itoa(len(args)) + " ESCAPE '!' OR s.name ILIKE $" + strconv.Itoa(len(args)) + " ESCAPE '!')"
	}
	if strings.TrimSpace(cursor) != "" {
		decoded, err := decodeOperatorOperationsCursor(cursor, state, actionableOnly, query, sort)
		if err != nil {
			return OperatorOperationsResult{}, err
		}
		args = append(args, decoded.UpdatedAt, decoded.ID)
		operator := "<"
		if ascending {
			operator = ">"
		}
		where += " AND (o.updated_at,o.id)" + operator + "($" + strconv.Itoa(len(args)-1) + ",$" + strconv.Itoa(len(args)) + ")"
	}
	args = append(args, limit+1)
	order := "DESC"
	if ascending {
		order = "ASC"
	}
	rows, err := db.QueryContext(ctx, `SELECT o.id,s.name,o.state,o.updated_at,
		a.id,a.order_id,a.captain_actor_id,a.state,a.version,COALESCE(h.state,'')
		FROM dsh.commerce_orders o
		JOIN dsh.stores s ON s.id=o.store_id
		LEFT JOIN LATERAL (
			SELECT id,order_id,captain_actor_id,state,version
			FROM dsh.captain_assignments
			WHERE order_id=o.id AND state IN ('assigned','in_custody','delivered','delivery_failed')
			ORDER BY created_at DESC LIMIT 1
		) a ON TRUE
		LEFT JOIN dsh.captain_handoffs h ON h.assignment_id=a.id
		WHERE `+where+" ORDER BY o.updated_at "+order+",o.id "+order+" LIMIT $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		return OperatorOperationsResult{}, err
	}
	defer rows.Close()
	operations := make([]OperatorOperationListRecord, 0, limit+1)
	for rows.Next() {
		var item OperatorOperationListRecord
		var assignmentID, assignmentOrderID, captainActorID, assignmentState, handoffState sql.NullString
		var assignmentVersion sql.NullInt64
		if err := rows.Scan(&item.OrderID, &item.StoreName, &item.State, &item.UpdatedAt,
			&assignmentID, &assignmentOrderID, &captainActorID, &assignmentState, &assignmentVersion, &handoffState); err != nil {
			return OperatorOperationsResult{}, err
		}
		if assignmentID.Valid {
			item.Assignment = &OperatorAssignmentListRecord{ID: assignmentID.String, OrderID: assignmentOrderID.String, CaptainActorID: captainActorID.String, State: assignmentState.String, Version: int(assignmentVersion.Int64), HandoffState: handoffState.String}
		}
		operations = append(operations, item)
	}
	if err := rows.Err(); err != nil {
		return OperatorOperationsResult{}, err
	}
	if err := rows.Close(); err != nil {
		return OperatorOperationsResult{}, err
	}

	result := OperatorOperationsResult{Operations: operations}
	if len(operations) > limit {
		last := operations[limit-1]
		result.Operations = operations[:limit]
		result.NextCursor = encodeOperatorOperationsCursor(operatorOperationsCursor{UpdatedAt: last.UpdatedAt, ID: last.OrderID, State: state, ActionableOnly: actionableOnly, Query: query, Sort: sort})
	}
	return result, nil
}

func ReadOperatorOperation(ctx context.Context, db *sql.DB, orderID string) (OperatorOperationRecord, error) {
	order, err := ReadOrder(ctx, db, orderID)
	if err != nil {
		return OperatorOperationRecord{}, err
	}
	operation := OperatorOperationRecord{Order: order, StoreName: order.StoreName}
	assignment, assignmentErr := ReadCaptainAssignmentForOrder(ctx, db, order.ID)
	if assignmentErr == nil {
		operation.Assignment = &assignment
	} else if !errors.Is(assignmentErr, ErrCaptainAssignmentNotFound) {
		return OperatorOperationRecord{}, assignmentErr
	}
	return operation, nil
}

func encodeOperatorOperationsCursor(cursor operatorOperationsCursor) string {
	value, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(value)
}

func decodeOperatorOperationsCursor(raw, state string, actionableOnly bool, query, sort string) (operatorOperationsCursor, error) {
	value, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return operatorOperationsCursor{}, ErrOperatorOperationInvalidCursor
	}
	var cursor operatorOperationsCursor
	if err := json.Unmarshal(value, &cursor); err != nil || cursor.ID == "" || cursor.UpdatedAt.IsZero() || cursor.State != strings.TrimSpace(state) || cursor.ActionableOnly != actionableOnly || cursor.Query != strings.TrimSpace(query) || cursor.Sort != strings.TrimSpace(sort) {
		return operatorOperationsCursor{}, ErrOperatorOperationInvalidCursor
	}
	return cursor, nil
}

func escapeOperatorOperationSearch(value string) string {
	value = strings.ReplaceAll(value, "!", "!!")
	value = strings.ReplaceAll(value, "%", "!%")
	return strings.ReplaceAll(value, "_", "!_")
}

const orderSelectColumns = `o.id,o.client_actor_id,o.store_id,o.cart_id,o.fulfillment_mode,COALESCE(o.address_id,''),COALESCE(o.address_version,0),COALESCE(o.address_text,''),COALESCE(o.address_latitude,0),COALESCE(o.address_longitude,0),o.service_city_id,COALESCE(o.serviceability_policy_version,''),COALESCE(o.serviceability_status,''),o.serviceability_store_version,COALESCE(o.serviceability_address_version,0),o.state,o.subtotal_amount_minor,o.discount_minor,o.promotion_id,o.promotion_code,o.total_amount_minor,o.currency,o.payment_intent_id,o.payment_method,o.payment_state,o.version,o.created_at,o.updated_at,COALESCE((SELECT h.state FROM dsh.commerce_order_store_cash_handoffs h WHERE h.order_id=o.id),'')`
const orderSelectColumnsWithStore = orderSelectColumns + `,s.name,CASE WHEN o.fulfillment_mode='CUSTOMER_PICKUP' THEN s.delivery_origin_latitude END,CASE WHEN o.fulfillment_mode='CUSTOMER_PICKUP' THEN s.delivery_origin_longitude END`

func scanOrder(row rowScanner) (OrderRecord, error) {
	return scanOrderColumns(row, false)
}

func scanOrderWithStore(row rowScanner) (OrderRecord, error) {
	return scanOrderColumns(row, true)
}

func scanOrderColumns(row rowScanner, includeStore bool) (OrderRecord, error) {
	var order OrderRecord
	var paymentIntentID, promotionID, promotionCode sql.NullString
	var pickupLatitude, pickupLongitude sql.NullFloat64
	destinations := []any{
		&order.ID, &order.ClientActorID, &order.StoreID, &order.CartID, &order.FulfillmentMode, &order.AddressID, &order.AddressVersion, &order.AddressText,
		&order.AddressLatitude, &order.AddressLongitude, &order.ServiceCityID, &order.ServiceabilityPolicyVersion, &order.ServiceabilityStatus,
		&order.ServiceabilityStoreVersion, &order.ServiceabilityAddressVersion, &order.State, &order.SubtotalAmountMinor, &order.DiscountMinor, &promotionID, &promotionCode, &order.TotalAmountMinor, &order.Currency,
		&paymentIntentID, &order.PaymentMethod, &order.PaymentState, &order.Version, &order.CreatedAt, &order.UpdatedAt, &order.StoreCashHandoffState,
	}
	if includeStore {
		destinations = append(destinations, &order.StoreName, &pickupLatitude, &pickupLongitude)
	}
	if err := row.Scan(destinations...); err != nil {
		return OrderRecord{}, err
	}
	if promotionID.Valid {
		order.PromotionID = promotionID.String
	}
	if promotionCode.Valid {
		order.PromotionCode = promotionCode.String
	}
	if paymentIntentID.Valid {
		value := paymentIntentID.String
		order.PaymentIntentID = &value
	}
	if includeStore {
		if pickupLatitude.Valid != pickupLongitude.Valid {
			return OrderRecord{}, errors.New("pickup location coordinates are incomplete")
		}
		if pickupLatitude.Valid {
			order.PickupLocation = &OrderPickupLocationRecord{Latitude: pickupLatitude.Float64, Longitude: pickupLongitude.Float64}
		}
	}
	return order, nil
}

func readOrder(ctx context.Context, source rowQueryer, where string, args ...any) (OrderRecord, error) {
	order, err := scanOrderWithStore(source.QueryRowContext(ctx, "SELECT "+orderSelectColumnsWithStore+" FROM dsh.commerce_orders o JOIN dsh.stores s ON s.id=o.store_id WHERE "+where, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, ErrOrderNotFound
	}
	if err != nil {
		return OrderRecord{}, err
	}
	order.Lines, err = listOrderLines(ctx, source, order.ID)
	if err != nil {
		return OrderRecord{}, err
	}
	return order, nil
}

func listOrders(ctx context.Context, db *sql.DB, where string, args []any, state string, limit int) ([]OrderRecord, error) {
	if limit < 1 || limit > 100 {
		return nil, errors.New("order limit is invalid")
	}
	if strings.TrimSpace(state) != "" {
		args = append(args, strings.TrimSpace(state))
		where += " AND o.state=$" + strconv.Itoa(len(args))
	}
	args = append(args, limit)
	rows, err := db.QueryContext(ctx, "SELECT "+orderSelectColumnsWithStore+" FROM dsh.commerce_orders o JOIN dsh.stores s ON s.id=o.store_id WHERE "+where+" ORDER BY o.created_at DESC,o.id DESC LIMIT $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	items := make([]OrderRecord, 0)
	for rows.Next() {
		order, scanErr := scanOrderWithStore(rows)
		if scanErr != nil {
			_ = rows.Close()
			return nil, scanErr
		}
		items = append(items, order)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range items {
		items[index].Lines, err = listOrderLines(ctx, db, items[index].ID)
		if err != nil {
			return nil, err
		}
	}
	return items, nil
}

func listOrderLines(ctx context.Context, source queryer, orderID string) ([]OrderLineRecord, error) {
	rows, err := source.QueryContext(ctx, `SELECT id,order_id,store_offer_id,variant_id,product_id,product_name,variant_title,measurement_kind,base_unit,pricing_basis,quantity_policy,quantity_min_base_units,quantity_max_base_units,quantity_step_base_units,pricing_unit_base_units,requested_quantity_base_units,final_quantity_base_units,unit_price_minor,line_amount_minor,currency,selected_modifier_option_ids,modifier_amount_minor,created_at FROM dsh.commerce_order_lines WHERE order_id=$1 ORDER BY created_at,id`, orderID)
	if err != nil {
		return nil, err
	}
	items := make([]OrderLineRecord, 0)
	for rows.Next() {
		var item OrderLineRecord
		var finalQuantity sql.NullInt64
		if err := rows.Scan(&item.ID, &item.OrderID, &item.StoreOfferID, &item.VariantID, &item.ProductID, &item.ProductName, &item.VariantTitle, &item.MeasurementKind, &item.BaseUnit, &item.PricingBasis, &item.QuantityPolicy, &item.QuantityMinBaseUnits, &item.QuantityMaxBaseUnits, &item.QuantityStepBaseUnits, &item.PricingUnitBaseUnits, &item.RequestedQuantityBaseUnits, &finalQuantity, &item.UnitPriceMinor, &item.LineAmountMinor, &item.Currency, pq.Array(&item.SelectedModifierOptionIDs), &item.ModifierAmountMinor, &item.CreatedAt); err != nil {
			return nil, err
		}
		if finalQuantity.Valid {
			value := finalQuantity.Int64
			item.FinalQuantityBaseUnits = &value
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range items {
		items[index].ModifierSnapshots, err = listOrderLineModifierSnapshots(ctx, source, items[index].ID)
		if err != nil {
			return nil, err
		}
		items[index].AttributeSnapshots, err = listOrderLineAttributeSnapshots(ctx, source, items[index].ID)
		if err != nil {
			return nil, err
		}
	}
	return items, nil
}

func listOrderLineModifierSnapshots(ctx context.Context, source queryer, orderLineID string) ([]OrderLineModifierSnapshotRecord, error) {
	rows, err := source.QueryContext(ctx, "SELECT option_id,option_name_ar,price_delta_minor FROM dsh.commerce_order_line_modifier_snapshots WHERE order_line_id=$1 ORDER BY created_at,option_id", orderLineID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]OrderLineModifierSnapshotRecord, 0)
	for rows.Next() {
		var item OrderLineModifierSnapshotRecord
		if err := rows.Scan(&item.OptionID, &item.OptionNameAr, &item.PriceDeltaMinor); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func listOrderLineAttributeSnapshots(ctx context.Context, source queryer, orderLineID string) ([]OrderLineAttributeSnapshotRecord, error) {
	rows, err := source.QueryContext(ctx, "SELECT attribute_id,attribute_code,value_kind,text_value,integer_value,decimal_value,boolean_value,enum_value,date_value,measurement_unit FROM dsh.commerce_order_line_attribute_snapshots WHERE order_line_id=$1 ORDER BY created_at,attribute_id", orderLineID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]OrderLineAttributeSnapshotRecord, 0)
	for rows.Next() {
		var item OrderLineAttributeSnapshotRecord
		if err := rows.Scan(&item.AttributeID, &item.Code, &item.ValueKind, &item.TextValue, &item.IntegerValue, &item.DecimalValue, &item.BooleanValue, &item.EnumValue, &item.DateValue, &item.MeasurementUnit); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func paymentCompensationFailure(returnErr, compensationErr error) error {
	if returnErr == nil {
		returnErr = fmt.Errorf("%w: payment compensation failed: %w", ErrPaymentProvisioning, compensationErr)
	} else {
		returnErr = fmt.Errorf("%w: payment compensation failed: %w", returnErr, compensationErr)
	}
	return fmt.Errorf("%w: %w", ErrExternalOutcomeUnknown, returnErr)
}

func reconcileCheckoutPayment(ctx context.Context, clientActorID, cartID, idempotencyKey, externalReference, paymentCancellationKey, correlationID string, reader PaymentIntentRecoveryReader, canceller PaymentIntentCanceller) error {
	payment, found, err := reader(ctx, externalReference)
	if err != nil {
		return fmt.Errorf("%w: payment intent recovery read failed: %w", ErrExternalOutcomeUnknown, err)
	}
	if !found {
		return nil
	}
	expectedOrderID := stableCheckoutOrderID(clientActorID, cartID, idempotencyKey)
	if strings.TrimSpace(payment.IntentID) == "" || payment.ExternalReference != externalReference || payment.PayerActorID != clientActorID || payment.OrderID != expectedOrderID || (payment.Method != "CASH_ON_DELIVERY" && payment.Method != "CASH_AT_STORE") {
		return fmt.Errorf("%w: recovered payment does not match the client checkout", ErrExternalOutcomeUnknown)
	}
	switch payment.State {
	case "CANCELLED":
		return ErrCheckoutPaymentReconciled
	case "REQUIRES_COLLECTION":
		if err := canceller(ctx, payment.IntentID, "order_creation_rolled_back", paymentCancellationKey, correlationID); err != nil {
			return fmt.Errorf("%w: payment intent recovery cancellation failed: %w", ErrExternalOutcomeUnknown, err)
		}
		return ErrCheckoutPaymentReconciled
	default:
		return fmt.Errorf("%w: recovered payment state %q is not safely cancellable", ErrExternalOutcomeUnknown, payment.State)
	}
}

func readCheckoutOrderReplay(ctx context.Context, tx *sql.Tx, clientActorID, cartID, idempotencyKey, requestHash string) (OrderRecord, bool, error) {
	var storedHash, storedCartID, orderID string
	err := tx.QueryRowContext(ctx, "SELECT request_hash,cart_id,order_id FROM dsh.commerce_order_checkout_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedCartID, &orderID)
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, nil
	}
	if err != nil {
		return OrderRecord{}, false, err
	}
	if (requestHash != "" && storedHash != requestHash) || storedCartID != cartID {
		return OrderRecord{}, false, ErrCheckoutIdempotencyConflict
	}
	order, err := readOrder(ctx, tx, "o.id=$1", orderID)
	if err != nil {
		return OrderRecord{}, false, err
	}
	if order.ClientActorID != clientActorID {
		return OrderRecord{}, false, ErrCheckoutIdempotencyConflict
	}
	return order, true, nil
}

func checkoutOrderMatchesRequest(order OrderRecord, input CheckoutInput) bool {
	return order.ClientActorID == strings.TrimSpace(input.ClientActorID) &&
		order.CartID == strings.TrimSpace(input.CartID) &&
		order.StoreID == strings.TrimSpace(input.StoreID) &&
		order.AddressID == strings.TrimSpace(input.AddressID) &&
		order.FulfillmentMode == strings.TrimSpace(input.FulfillmentMode) &&
		order.PaymentMethod == strings.TrimSpace(input.PaymentMethod) &&
		order.PromotionCode == strings.ToUpper(strings.TrimSpace(input.PromotionCode))
}

func checkoutCartVersionMatches(state string, cartVersion, expectedCartVersion int) bool {
	return expectedCartVersion > 0 && state == "checked_out" && cartVersion == expectedCartVersion+1
}

func validateCheckoutOrderReplay(ctx context.Context, tx *sql.Tx, order OrderRecord, input CheckoutInput) error {
	if !checkoutOrderMatchesRequest(order, input) {
		return ErrCheckoutIdempotencyConflict
	}
	var cartState string
	var cartVersion int
	err := tx.QueryRowContext(ctx, "SELECT state,version FROM dsh.commerce_carts WHERE id=$1 AND client_actor_id=$2", order.CartID, order.ClientActorID).Scan(&cartState, &cartVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrCheckoutIdempotencyConflict
	}
	if err != nil {
		return err
	}
	if !checkoutCartVersionMatches(cartState, cartVersion, input.ExpectedCartVersion) {
		return ErrCheckoutIdempotencyConflict
	}
	return nil
}

func ResolveCheckoutAttempt(ctx context.Context, db *sql.DB, input CheckoutInput) (OrderRecord, bool, error) {
	input.ClientActorID, input.CartID, input.StoreID = strings.TrimSpace(input.ClientActorID), strings.TrimSpace(input.CartID), strings.TrimSpace(input.StoreID)
	input.AddressID, input.FulfillmentMode = strings.TrimSpace(input.AddressID), strings.TrimSpace(input.FulfillmentMode)
	input.PaymentMethod, input.PromotionCode = strings.TrimSpace(input.PaymentMethod), strings.ToUpper(strings.TrimSpace(input.PromotionCode))
	input.IdempotencyKey, input.CorrelationID = strings.TrimSpace(input.IdempotencyKey), strings.TrimSpace(input.CorrelationID)
	input.PaymentExternalReference, input.PaymentCancellationKey = strings.TrimSpace(input.PaymentExternalReference), strings.TrimSpace(input.PaymentCancellationKey)
	if db == nil || input.ClientActorID == "" || input.CartID == "" || input.StoreID == "" || input.FulfillmentMode == "" || input.PaymentMethod == "" || input.ExpectedCartVersion < 1 || len(input.IdempotencyKey) < 8 || len(input.IdempotencyKey) > 128 || input.PaymentExternalReference == "" || input.PaymentCancellationKey == "" || input.CorrelationID == "" || input.PaymentIntentRecoveryReader == nil || input.PaymentCanceller == nil {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OrderRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:checkout:"+input.IdempotencyKey); err != nil {
		return OrderRecord{}, false, err
	}
	order, replayed, err := readCheckoutOrderReplay(ctx, tx, input.ClientActorID, input.CartID, input.IdempotencyKey, "")
	if err != nil {
		return OrderRecord{}, false, err
	}
	if replayed {
		if err := validateCheckoutOrderReplay(ctx, tx, order, input); err != nil {
			return OrderRecord{}, false, err
		}
		if err := tx.Commit(); err != nil {
			return OrderRecord{}, false, err
		}
		return order, true, nil
	}
	if err := reconcileCheckoutPayment(ctx, input.ClientActorID, input.CartID, input.IdempotencyKey, input.PaymentExternalReference, input.PaymentCancellationKey, input.CorrelationID, input.PaymentIntentRecoveryReader, input.PaymentCanceller); err != nil {
		return OrderRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return OrderRecord{}, false, err
	}
	return OrderRecord{}, false, nil
}

func CreateOrderFromCart(ctx context.Context, db *sql.DB, input CheckoutInput) (result OrderRecord, replayed bool, returnErr error) {
	pickup := input.FulfillmentMode == FulfillmentModeCustomerPickup
	partnerCaptain := input.FulfillmentMode == FulfillmentModePartnerCaptain
	validMode := input.FulfillmentMode == FulfillmentModeBthwaniCaptain || partnerCaptain || pickup
	validPaymentMethod := ((pickup || partnerCaptain) && input.PaymentMethod == "CASH_AT_STORE") || (input.FulfillmentMode == FulfillmentModeBthwaniCaptain && input.PaymentMethod == "CASH_ON_DELIVERY")
	validEvidence := input.Evidence.StoreVersion > 0 && strings.TrimSpace(input.Evidence.ServiceCityID) != ""
	if pickup {
		validEvidence = validEvidence && strings.TrimSpace(input.AddressID) == "" && input.Evidence.AddressVersion == 0 && strings.TrimSpace(input.Evidence.Status) == "" && strings.TrimSpace(input.Evidence.PolicyVersion) == ""
	} else {
		validEvidence = validEvidence && strings.TrimSpace(input.AddressID) != "" && input.Evidence.AddressVersion > 0 && input.Evidence.Status == "SERVICEABLE" && strings.TrimSpace(input.Evidence.PolicyVersion) != ""
	}
	if strings.TrimSpace(input.ClientActorID) == "" || strings.TrimSpace(input.CartID) == "" || strings.TrimSpace(input.StoreID) == "" || !validMode || !validPaymentMethod || !validEvidence || input.ExpectedCartVersion < 1 || strings.TrimSpace(input.IdempotencyKey) == "" || strings.TrimSpace(input.RequestHash) == "" || strings.TrimSpace(input.CorrelationID) == "" || strings.TrimSpace(input.PaymentExternalReference) == "" || strings.TrimSpace(input.PaymentIdempotencyKey) == "" || strings.TrimSpace(input.PaymentCancellationKey) == "" || input.PaymentProvisioner == nil || input.PaymentIntentRecoveryReader == nil || input.PaymentCanceller == nil || input.DeliveryProofKeyring == nil {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OrderRecord{}, false, err
	}
	var paymentIntentID string
	commitAttempted := false
	defer func() {
		_ = tx.Rollback()
		if paymentIntentID == "" || commitAttempted {
			return
		}
		compensationContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if compensationErr := input.PaymentCanceller(compensationContext, paymentIntentID, "order_creation_rolled_back", input.PaymentCancellationKey, input.CorrelationID); compensationErr != nil {
			returnErr = paymentCompensationFailure(returnErr, compensationErr)
		}
	}()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:checkout:"+input.IdempotencyKey); err != nil {
		return OrderRecord{}, false, err
	}
	order, replayed, err := readCheckoutOrderReplay(ctx, tx, input.ClientActorID, input.CartID, input.IdempotencyKey, input.RequestHash)
	if err != nil {
		return OrderRecord{}, false, err
	}
	if replayed {
		if err := tx.Commit(); err != nil {
			return OrderRecord{}, false, err
		}
		return order, true, nil
	}
	if err := reconcileCheckoutPayment(ctx, input.ClientActorID, input.CartID, input.IdempotencyKey, input.PaymentExternalReference, input.PaymentCancellationKey, input.CorrelationID, input.PaymentIntentRecoveryReader, input.PaymentCanceller); err != nil {
		return OrderRecord{}, false, err
	}
	var cart CartRecord
	err = tx.QueryRowContext(ctx, "SELECT id,store_id,state,version,created_at,updated_at FROM dsh.commerce_carts WHERE id=$1 AND client_actor_id=$2 FOR UPDATE", input.CartID, input.ClientActorID).Scan(&cart.ID, &cart.StoreID, &cart.State, &cart.Version, &cart.CreatedAt, &cart.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, ErrCartNotFound
	}
	if err != nil {
		return OrderRecord{}, false, err
	}
	if cart.StoreID != input.StoreID || cart.State != "open" || cart.Version != input.ExpectedCartVersion {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	var storeCityID string
	var storeVersion int
	var storeFulfillmentModes []string
	var addressCityID, addressText sql.NullString
	var addressVersion sql.NullInt64
	var latitude, longitude sql.NullFloat64
	err = tx.QueryRowContext(ctx, `SELECT s.service_city_id,s.version,s.fulfillment_modes,a.service_city_id,a.version,a.address_text,a.latitude,a.longitude
FROM dsh.stores s JOIN dsh.service_cities c ON c.id=s.service_city_id AND c.active=true
LEFT JOIN dsh.delivery_addresses a ON a.id=NULLIF($2,'') AND a.client_actor_id=$3
WHERE s.id=$1 AND s.publication_state='published' AND ($4='CUSTOMER_PICKUP' OR a.id IS NOT NULL)`, input.StoreID, input.AddressID, input.ClientActorID, input.FulfillmentMode).Scan(&storeCityID, &storeVersion, pq.Array(&storeFulfillmentModes), &addressCityID, &addressVersion, &addressText, &latitude, &longitude)
	modeSupported := false
	for _, mode := range storeFulfillmentModes {
		if mode == input.FulfillmentMode {
			modeSupported = true
			break
		}
	}
	if errors.Is(err, sql.ErrNoRows) || storeCityID != input.Evidence.ServiceCityID || storeVersion != input.Evidence.StoreVersion || !modeSupported {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	if !pickup && (!addressCityID.Valid || !addressVersion.Valid || !addressText.Valid || !latitude.Valid || !longitude.Valid || addressCityID.String != input.Evidence.ServiceCityID || int(addressVersion.Int64) != input.Evidence.AddressVersion) {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	var orderAddressID, orderAddressVersion, orderAddressText, orderAddressLatitude, orderAddressLongitude, serviceabilityPolicy, serviceabilityStatus, serviceabilityAddressVersion any
	if !pickup {
		orderAddressID, orderAddressVersion, orderAddressText = input.AddressID, int(addressVersion.Int64), addressText.String
		orderAddressLatitude, orderAddressLongitude = latitude.Float64, longitude.Float64
		serviceabilityPolicy, serviceabilityStatus, serviceabilityAddressVersion = input.Evidence.PolicyVersion, input.Evidence.Status, input.Evidence.AddressVersion
	}
	lineRows, err := tx.QueryContext(ctx, "SELECT id,store_offer_id,variant_id,quantity_base_units,selected_modifier_option_ids FROM dsh.commerce_cart_lines WHERE cart_id=$1 AND removed_at IS NULL ORDER BY created_at,id", input.CartID)
	if err != nil {
		return OrderRecord{}, false, err
	}
	type checkoutLine struct {
		id, offerID, variantID string
		quantity               int64
		modifiers              []string
		offer                  CatalogStoreOfferRecord
		modifierOptions        []CatalogModifierOptionRecord
		modifierAmount         int64
		amount                 int64
		inventoryReserved      int64
	}
	type cartLine struct {
		id, offerID, variantID string
		quantity               int64
		modifiers              []string
	}
	cartLines := make([]cartLine, 0)
	for lineRows.Next() {
		var line cartLine
		if err := lineRows.Scan(&line.id, &line.offerID, &line.variantID, &line.quantity, pq.Array(&line.modifiers)); err != nil {
			_ = lineRows.Close()
			return OrderRecord{}, false, err
		}
		cartLines = append(cartLines, line)
	}
	if err := lineRows.Err(); err != nil {
		_ = lineRows.Close()
		return OrderRecord{}, false, err
	}
	if err := lineRows.Close(); err != nil {
		return OrderRecord{}, false, err
	}
	lines := make([]checkoutLine, 0)
	var total int64
	var orderSizeBaseUnits int64
	for _, rawLine := range cartLines {
		line := checkoutLine{id: rawLine.id, offerID: rawLine.offerID, variantID: rawLine.variantID, quantity: rawLine.quantity, modifiers: rawLine.modifiers}
		if line.variantID == "" {
			return OrderRecord{}, false, ErrCheckoutEvidenceStale
		}
		line.offer, err = readCustomerVisibleOfferTx(ctx, tx, input.StoreID, line.offerID)
		if errors.Is(err, sql.ErrNoRows) {
			return OrderRecord{}, false, ErrCartOfferUnavailable
		}
		if err != nil || line.offer.VariantID != line.variantID {
			if err != nil {
				return OrderRecord{}, false, err
			}
			return OrderRecord{}, false, ErrCheckoutEvidenceStale
		}
		if err = validateCatalogOfferQuantity(line.offer, line.quantity); err != nil {
			return OrderRecord{}, false, err
		}
		var modifierDelta int64
		line.modifierOptions, modifierDelta, err = ValidateCatalogModifierSelection(ctx, tx, line.offer.ID, line.modifiers)
		if err != nil {
			return OrderRecord{}, false, err
		}
		line.modifierAmount, err = CalculateCatalogModifierAmount(modifierDelta, line.quantity)
		if err != nil {
			return OrderRecord{}, false, err
		}
		baseAmount, err := CalculateCatalogLineAmount(line.offer.PriceMinor, line.quantity, line.offer.PricingBasis, line.offer.PricingUnitBaseUnits)
		if err != nil {
			return OrderRecord{}, false, err
		}
		line.amount, err = AddCatalogModifierAmount(baseAmount, modifierDelta, line.quantity)
		if err != nil {
			return OrderRecord{}, false, err
		}
		line.inventoryReserved, err = reserveCatalogOfferInventoryTx(ctx, tx, line.offer.ID, line.quantity)
		if err != nil {
			return OrderRecord{}, false, err
		}
		combined := new(big.Int).Add(big.NewInt(total), big.NewInt(line.amount))
		if !combined.IsInt64() {
			return OrderRecord{}, false, ErrCheckoutEvidenceStale
		}
		total = combined.Int64()
		combinedSize := new(big.Int).Add(big.NewInt(orderSizeBaseUnits), big.NewInt(line.quantity))
		if !combinedSize.IsInt64() {
			return OrderRecord{}, false, ErrCheckoutEvidenceStale
		}
		orderSizeBaseUnits = combinedSize.Int64()
		lines = append(lines, line)
	}
	if len(lines) == 0 || total <= 0 {
		return OrderRecord{}, false, ErrCartEmpty
	}
	promotionCode := strings.ToUpper(strings.TrimSpace(input.PromotionCode))
	var promotion PromotionRecord
	var discountMinor int64
	if promotionCode != "" {
		promotion, discountMinor, err = EvaluatePromotion(ctx, tx, promotionCode, input.StoreID, input.ClientActorID, total, true)
		if err != nil {
			return OrderRecord{}, false, err
		}
	}
	requiresDeliveryFee := input.FulfillmentMode == FulfillmentModeBthwaniCaptain
	if orderSizeBaseUnits <= 0 || (requiresDeliveryFee && input.DeliveryFeeResolver == nil) {
		return OrderRecord{}, false, ErrDeliveryFeeUnavailable
	}
	feeQuote := DeliveryFeeQuote{FeeMinor: 0, PolicyVersion: "NOT_APPLICABLE"}
	if requiresDeliveryFee {
		feeQuote, err = input.DeliveryFeeResolver(ctx, DeliveryFeeQuoteInput{ServiceCityID: input.Evidence.ServiceCityID, OriginLatitude: input.Evidence.StoreOriginLatitude, OriginLongitude: input.Evidence.StoreOriginLongitude, DestinationLatitude: input.Evidence.AddressLatitude, DestinationLongitude: input.Evidence.AddressLongitude, OrderSizeBaseUnits: orderSizeBaseUnits})
		if err != nil || feeQuote.FeeMinor < 0 || strings.TrimSpace(feeQuote.PolicyVersion) == "" {
			return OrderRecord{}, false, ErrDeliveryFeeUnavailable
		}
	}
	chargeableSubtotal := new(big.Int).Sub(big.NewInt(total), big.NewInt(discountMinor))
	orderTotal := new(big.Int).Add(chargeableSubtotal, big.NewInt(feeQuote.FeeMinor))
	if !orderTotal.IsInt64() || orderTotal.Int64() <= 0 {
		return OrderRecord{}, false, ErrDeliveryFeeUnavailable
	}
	totalWithDelivery := orderTotal.Int64()
	newOrderID := stableCheckoutOrderID(input.ClientActorID, input.CartID, input.IdempotencyKey)
	deliveryProofCode, err := newDeliveryProofCode()
	if err != nil {
		return OrderRecord{}, false, err
	}
	proofKeyID, proofCiphertext, err := input.DeliveryProofKeyring.Encrypt(newOrderID, deliveryProofCode)
	if err != nil {
		return OrderRecord{}, false, err
	}
	proofVerifier, err := input.DeliveryProofKeyring.ProofVerifier(newOrderID, proofKeyID, deliveryProofCode)
	if err != nil {
		return OrderRecord{}, false, err
	}
	payment, err := input.PaymentProvisioner(ctx, newOrderID, input.PaymentExternalReference, input.ClientActorID, total, discountMinor, feeQuote.FeeMinor, feeQuote.PolicyVersion, totalWithDelivery, input.PaymentIdempotencyKey, input.CorrelationID)
	if err != nil {
		return OrderRecord{}, false, fmt.Errorf("%w: %w", ErrPaymentProvisioning, err)
	}
	paymentIntentID = strings.TrimSpace(payment.IntentID)
	if paymentIntentID == "" {
		return OrderRecord{}, false, fmt.Errorf("%w: %w", ErrExternalOutcomeUnknown, ErrPaymentProvisioning)
	}
	if payment.State != "REQUIRES_COLLECTION" {
		return OrderRecord{}, false, ErrPaymentProvisioning
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,fulfillment_mode,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,subtotal_amount_minor,discount_minor,promotion_id,promotion_code,total_amount_minor,payment_intent_id,payment_method,payment_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'CREATED',$16,$17,NULLIF($18,''),NULLIF($19,''),$20,$21,$22,$23)`, newOrderID, input.ClientActorID, input.StoreID, input.CartID, input.FulfillmentMode, orderAddressID, orderAddressVersion, orderAddressText, orderAddressLatitude, orderAddressLongitude, input.Evidence.ServiceCityID, serviceabilityPolicy, serviceabilityStatus, storeVersion, serviceabilityAddressVersion, total, discountMinor, promotion.ID, promotion.Code, totalWithDelivery, payment.IntentID, input.PaymentMethod, payment.State); err != nil {
		return OrderRecord{}, false, err
	}
	if promotion.ID != "" {
		if err := RedeemPromotion(ctx, tx, promotion, input.ClientActorID, newOrderID, discountMinor); err != nil {
			return OrderRecord{}, false, err
		}
	}
	proofType := "DELIVERY"
	if pickup {
		proofType = "STORE_PICKUP"
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_delivery_proofs(order_id,client_actor_id,code_ciphertext,code_verifier,code_key_id,proof_type) VALUES($1,$2,$3,$4,$5,$6)`, newOrderID, input.ClientActorID, proofCiphertext, proofVerifier, proofKeyID, proofType); err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_payment_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,payment_intent_id,from_state,to_state,amount_minor) VALUES('payment_intent_linked',$1,$2,$3,$4,$5,'NOT_LINKED',$6,$7)`, input.IdempotencyKey, input.CorrelationID, input.ActingActorID, newOrderID, payment.IntentID, payment.State, totalWithDelivery); err != nil {
		return OrderRecord{}, false, err
	}
	for _, line := range lines {
		lineID, idErr := newID("orderline")
		if idErr != nil {
			return OrderRecord{}, false, idErr
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_lines(id,order_id,store_offer_id,variant_id,product_id,product_name,variant_title,measurement_kind,base_unit,pricing_basis,quantity_policy,quantity_min_base_units,quantity_max_base_units,quantity_step_base_units,pricing_unit_base_units,requested_quantity_base_units,final_quantity_base_units,inventory_reserved_base_units,unit_price_minor,line_amount_minor,currency,selected_modifier_option_ids,modifier_amount_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`, lineID, newOrderID, line.offer.ID, line.offer.VariantID, line.offer.Product.ID, line.offer.Product.CanonicalName, line.offer.Variant.Title, line.offer.Variant.MeasurementKind, line.offer.Variant.BaseUnit, line.offer.PricingBasis, line.offer.QuantityPolicy, quantityValue(line.offer.QuantityMinBaseUnits), quantityValue(line.offer.QuantityMaxBaseUnits), quantityValue(line.offer.QuantityStepBaseUnits), line.offer.PricingUnitBaseUnits, line.quantity, line.quantity, line.inventoryReserved, line.offer.PriceMinor, line.amount, line.offer.Currency, pq.Array(line.modifiers), line.modifierAmount); err != nil {
			return OrderRecord{}, false, err
		}
		for _, option := range line.modifierOptions {
			if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_line_modifier_snapshots(order_line_id,option_id,option_name_ar,price_delta_minor) VALUES($1,$2,$3,$4)`, lineID, option.ID, option.NameAr, option.PriceDeltaMinor); err != nil {
				return OrderRecord{}, false, err
			}
		}
		attributes := make(map[string]CatalogAttributeValueRecord, len(line.offer.Product.Attributes)+len(line.offer.Variant.Attributes))
		for _, attribute := range line.offer.Product.Attributes {
			attributes[attribute.AttributeID] = attribute
		}
		for _, attribute := range line.offer.Variant.Attributes {
			attributes[attribute.AttributeID] = attribute
		}
		for _, attribute := range attributes {
			if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_line_attribute_snapshots(order_line_id,attribute_id,attribute_code,value_kind,text_value,integer_value,decimal_value,boolean_value,enum_value,date_value,measurement_unit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, lineID, attribute.AttributeID, attribute.Code, attribute.ValueKind, attribute.TextValue, attribute.IntegerValue, attribute.DecimalValue, attribute.BooleanValue, attribute.EnumValue, attribute.DateValue, attribute.MeasurementUnit); err != nil {
				return OrderRecord{}, false, err
			}
		}
	}
	cartUpdateResult, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_carts SET state='checked_out',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='open' AND version=$2", input.CartID, input.ExpectedCartVersion)
	if err != nil {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	if rowsAffected, err := cartUpdateResult.RowsAffected(); err != nil || rowsAffected != 1 {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_order_checkout_idempotency(idempotency_key,request_hash,cart_id,order_id,result_version) VALUES($1,$2,$3,$4,1)", input.IdempotencyKey, input.RequestHash, input.CartID, newOrderID); err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash) VALUES('order_created',$1,$2,$3,$4,NULL,'CREATED',NULL,1,$5)`, input.IdempotencyKey, input.CorrelationID, input.ActingActorID, newOrderID, input.RequestHash); err != nil {
		return OrderRecord{}, false, err
	}
	commitAttempted = true
	if err := tx.Commit(); err != nil {
		return OrderRecord{}, false, fmt.Errorf("%w: %w", ErrExternalOutcomeUnknown, err)
	}
	order, err = ReadOrder(ctx, db, newOrderID)
	if err != nil {
		return OrderRecord{}, false, fmt.Errorf("%w: %w", ErrExternalOutcomeUnknown, err)
	}
	return order, false, nil
}

func TransitionOrder(ctx context.Context, db *sql.DB, orderID, requestedState, paymentState string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (OrderRecord, bool, error) {
	if strings.TrimSpace(paymentState) != "" {
		return OrderRecord{}, false, ErrPaymentStateConflict
	}
	return transitionOrder(ctx, db, orderID, requestedState, expectedVersion, idempotencyKey, requestHash, actingActorID, correlationID, "")
}

func TransitionOrderWithPaymentCancellation(ctx context.Context, db *sql.DB, orderID, requestedState string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID, cancellationReason string) (OrderRecord, bool, error) {
	return transitionOrder(ctx, db, orderID, requestedState, expectedVersion, idempotencyKey, requestHash, actingActorID, correlationID, strings.TrimSpace(cancellationReason))
}

func transitionOrder(ctx context.Context, db *sql.DB, orderID, requestedState string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID, cancellationReason string) (OrderRecord, bool, error) {
	if db == nil || strings.TrimSpace(orderID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(correlationID) == "" {
		return OrderRecord{}, false, ErrOrderTransitionInvalid
	}
	if cancellationReason != "" && requestedState != "REJECTED" && requestedState != "CANCELLED" {
		return OrderRecord{}, false, ErrPaymentStateConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OrderRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:order-transition:"+idempotencyKey); err != nil {
		return OrderRecord{}, false, err
	}
	var storedHash, storedOrderID, storedState string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,order_id,requested_state FROM dsh.commerce_order_transition_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedOrderID, &storedState)
	if err == nil {
		if storedHash != requestHash || storedOrderID != orderID || storedState != requestedState {
			return OrderRecord{}, false, ErrOrderTransitionConflict
		}
		order, readErr := readOrder(ctx, tx, "o.id=$1", orderID)
		if readErr != nil {
			return OrderRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return OrderRecord{}, false, err
		}
		return order, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, err
	}
	current, err := scanOrder(tx.QueryRowContext(ctx, "SELECT "+orderSelectColumns+" FROM dsh.commerce_orders o WHERE o.id=$1 FOR UPDATE OF o", orderID))
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, ErrOrderNotFound
	}
	if err != nil {
		return OrderRecord{}, false, err
	}
	if current.Version != expectedVersion {
		return OrderRecord{}, false, ErrOrderVersionConflict
	}
	pickupNoShow := cancellationReason == CancellationReasonPickupCustomerNoShow && requestedState == "CANCELLED" && isPickupNoShowCandidate(current)
	if !validOrderTransition(current.State, requestedState) && !pickupNoShow {
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	if (current.FulfillmentMode == FulfillmentModeCustomerPickup && requestedState == "READY_FOR_DISPATCH") || (current.FulfillmentMode != FulfillmentModeCustomerPickup && requestedState == "READY_FOR_PICKUP") {
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	if cancellationReason != "" {
		if current.PaymentIntentID == nil || current.PaymentState != "REQUIRES_COLLECTION" {
			return OrderRecord{}, false, ErrPaymentStateConflict
		}
		if cancellationReason == CancellationReasonPickupCustomerNoShow && !pickupNoShow {
			return OrderRecord{}, false, ErrOrderStateConflict
		}
	}
	if requestedState == "REJECTED" || requestedState == "CANCELLED" {
		if err := releaseOrderInventoryTx(ctx, tx, orderID); err != nil {
			return OrderRecord{}, false, err
		}
	}
	result, err := scanOrder(tx.QueryRowContext(ctx, "UPDATE dsh.commerce_orders AS o SET state=$2,version=version+1,updated_at=clock_timestamp() WHERE o.id=$1 AND o.version=$3 RETURNING "+orderSelectColumns, orderID, requestedState, expectedVersion))
	if err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_order_transition_idempotency(idempotency_key,request_hash,order_id,requested_state,expected_version,result_version) VALUES($1,$2,$3,$4,$5,$6)", idempotencyKey, requestHash, orderID, requestedState, expectedVersion, result.Version); err != nil {
		return OrderRecord{}, false, err
	}
	eventType := "order_" + strings.ToLower(requestedState)
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_order_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", eventType, idempotencyKey, correlationID, actingActorID, orderID, current.State, requestedState, expectedVersion, result.Version, requestHash); err != nil {
		return OrderRecord{}, false, err
	}
	if cancellationReason != "" {
		if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "PAYMENT_CANCEL", SourceRef: idempotencyKey, OrderID: orderID, PaymentIntentID: *current.PaymentIntentID, AmountMinor: current.TotalAmountMinor, Reason: cancellationReason, IdempotencyKey: idempotencyKey, CorrelationID: correlationID, ActingActorID: actingActorID}); err != nil {
			return OrderRecord{}, false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return OrderRecord{}, false, err
	}
	order, err := ReadOrder(ctx, db, orderID)
	return order, false, err
}

func HashStorePickupCompletion(orderID, code string, expectedVersion int) string {
	return hashFacts(strings.TrimSpace(orderID), HashDeliveryProofCode(orderID, code), strconv.Itoa(expectedVersion), "PICKED_UP")
}

func CompleteStorePickup(ctx context.Context, db *sql.DB, orderID, code string, expectedVersion int, idempotencyKey, actingPartnerActorID, correlationID string, keys *DeliveryProofKeyring) (OrderRecord, bool, error) {
	orderID = strings.TrimSpace(orderID)
	code = strings.TrimSpace(code)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	actingPartnerActorID = strings.TrimSpace(actingPartnerActorID)
	correlationID = strings.TrimSpace(correlationID)
	if db == nil || keys == nil || orderID == "" || !validDeliveryProofCode(code) || expectedVersion < 1 || idempotencyKey == "" || actingPartnerActorID == "" || correlationID == "" {
		return OrderRecord{}, false, ErrOrderTransitionInvalid
	}
	requestHash, err := keys.ActiveIdempotencyHash("store-pickup-completion", orderID, code, strconv.Itoa(expectedVersion), "PICKED_UP")
	if err != nil {
		return OrderRecord{}, false, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OrderRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:order-transition:"+idempotencyKey); err != nil {
		return OrderRecord{}, false, err
	}
	var storedHash, storedOrderID, storedState string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,order_id,requested_state FROM dsh.commerce_order_transition_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedOrderID, &storedState)
	if err == nil {
		if !keys.VerifyIdempotencyHash(storedHash, "store-pickup-completion", orderID, code, strconv.Itoa(expectedVersion), "PICKED_UP") || storedOrderID != orderID || storedState != "PICKED_UP" {
			return OrderRecord{}, false, ErrOrderTransitionConflict
		}
		order, readErr := readOrder(ctx, tx, "o.id=$1", orderID)
		if readErr != nil {
			return OrderRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return OrderRecord{}, false, err
		}
		return order, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, err
	}
	current, err := scanOrder(tx.QueryRowContext(ctx, "SELECT "+orderSelectColumns+" FROM dsh.commerce_orders o WHERE o.id=$1 FOR UPDATE OF o", orderID))
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, ErrOrderNotFound
	}
	if err != nil {
		return OrderRecord{}, false, err
	}
	if current.Version != expectedVersion {
		return OrderRecord{}, false, ErrOrderVersionConflict
	}
	if current.FulfillmentMode != FulfillmentModeCustomerPickup || current.State != "READY_FOR_PICKUP" || current.PaymentMethod != "CASH_AT_STORE" || current.PaymentIntentID == nil || current.PaymentState != "REQUIRES_COLLECTION" {
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	var storePartnerActorID string
	if err := tx.QueryRowContext(ctx, "SELECT partner_actor_id FROM dsh.stores WHERE id=$1 FOR SHARE", current.StoreID).Scan(&storePartnerActorID); err != nil {
		return OrderRecord{}, false, err
	}
	if storePartnerActorID != actingPartnerActorID {
		return OrderRecord{}, false, ErrOrderNotFound
	}
	var proofHash, proofState, proofType, proofKeyID string
	if err := tx.QueryRowContext(ctx, `SELECT code_verifier,state,proof_type,code_key_id FROM dsh.commerce_order_delivery_proofs WHERE order_id=$1 AND client_actor_id=$2 FOR UPDATE`, orderID, current.ClientActorID).Scan(&proofHash, &proofState, &proofType, &proofKeyID); err != nil {
		return OrderRecord{}, false, err
	}
	if proofType != "STORE_PICKUP" || proofState != "PENDING" {
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	if !keys.VerifyProof(orderID, proofKeyID, proofHash, code) {
		return OrderRecord{}, false, ErrStorePickupProofInvalid
	}
	if err := consumeOrderInventoryTx(ctx, tx, orderID); err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_order_delivery_proofs SET state='VERIFIED',code_ciphertext=NULL,code_verifier=NULL,code_key_id=NULL,verified_by=$2,verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE order_id=$1 AND state='PENDING'`, orderID, actingPartnerActorID); err != nil {
		return OrderRecord{}, false, err
	}
	result, err := scanOrder(tx.QueryRowContext(ctx, "UPDATE dsh.commerce_orders AS o SET state='PICKED_UP',version=version+1,updated_at=clock_timestamp() WHERE o.id=$1 AND o.version=$2 RETURNING "+orderSelectColumns, orderID, expectedVersion))
	if err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_transition_idempotency(idempotency_key,request_hash,order_id,requested_state,expected_version,result_version) VALUES($1,$2,$3,'PICKED_UP',$4,$5)`, idempotencyKey, requestHash, orderID, expectedVersion, result.Version); err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash) VALUES('order_picked_up',$1,$2,$3,$4,$5,'PICKED_UP',$6,$7,$8)`, idempotencyKey, correlationID, actingPartnerActorID, orderID, current.State, expectedVersion, result.Version, requestHash); err != nil {
		return OrderRecord{}, false, err
	}
	if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "STORE_PICKUP_COLLECTION", SourceRef: idempotencyKey, OrderID: orderID, PaymentIntentID: *current.PaymentIntentID, PartnerActorID: actingPartnerActorID, AmountMinor: current.TotalAmountMinor, IdempotencyKey: idempotencyKey, CorrelationID: correlationID, ActingActorID: actingPartnerActorID}); err != nil {
		return OrderRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return OrderRecord{}, false, err
	}
	order, err := ReadOrder(ctx, db, orderID)
	return order, false, err
}

func ConfirmStoreCaptainCashHandoff(ctx context.Context, db *sql.DB, storeID, orderID, actingPartnerActorID string, expectedVersion int, idempotencyKey, correlationID string) (OrderRecord, bool, error) {
	storeID, orderID, actingPartnerActorID = strings.TrimSpace(storeID), strings.TrimSpace(orderID), strings.TrimSpace(actingPartnerActorID)
	idempotencyKey, correlationID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if db == nil || storeID == "" || orderID == "" || actingPartnerActorID == "" || expectedVersion < 1 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || len(correlationID) < 8 || len(correlationID) > 128 {
		return OrderRecord{}, false, ErrOrderTransitionInvalid
	}
	requestHash := hashFacts("store-captain-cash-handoff-confirm", storeID, orderID, actingPartnerActorID, strconv.Itoa(expectedVersion))
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OrderRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:store-captain-cash-handoff:"+idempotencyKey); err != nil {
		return OrderRecord{}, false, err
	}
	var storedHash, storedOrderID string
	err = tx.QueryRowContext(ctx, `SELECT confirmation_request_hash,order_id FROM dsh.commerce_order_store_cash_handoffs WHERE confirmation_idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedOrderID)
	if err == nil {
		if storedHash != requestHash || storedOrderID != orderID {
			return OrderRecord{}, false, ErrOrderTransitionConflict
		}
		order, readErr := readOrder(ctx, tx, "o.id=$1 AND o.store_id=$2", orderID, storeID)
		if readErr != nil {
			return OrderRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return OrderRecord{}, false, err
		}
		return order, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, err
	}
	current, err := scanOrderWithStore(tx.QueryRowContext(ctx, "SELECT "+orderSelectColumnsWithStore+" FROM dsh.commerce_orders o JOIN dsh.stores s ON s.id=o.store_id WHERE o.id=$1 AND o.store_id=$2 FOR UPDATE OF o", orderID, storeID))
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, ErrOrderNotFound
	}
	if err != nil {
		return OrderRecord{}, false, err
	}
	if current.Version != expectedVersion {
		return OrderRecord{}, false, ErrOrderVersionConflict
	}
	if current.FulfillmentMode != FulfillmentModePartnerCaptain || current.State != "DELIVERED" || current.PaymentMethod != "CASH_AT_STORE" || current.PaymentState != "REQUIRES_COLLECTION" || current.PaymentIntentID == nil || current.TotalAmountMinor < 1 {
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	var state, assignmentID, captainActorID, partnerActorID string
	var amountMinor int64
	if err := tx.QueryRowContext(ctx, `SELECT state,assignment_id,captain_actor_id,partner_actor_id,amount_minor FROM dsh.commerce_order_store_cash_handoffs WHERE order_id=$1 FOR UPDATE`, orderID).Scan(&state, &assignmentID, &captainActorID, &partnerActorID, &amountMinor); errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, ErrOrderStateConflict
	} else if err != nil {
		return OrderRecord{}, false, err
	}
	if state != "AWAITING_STORE_HANDOFF" || partnerActorID != actingPartnerActorID || amountMinor != current.TotalAmountMinor {
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	result, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_order_store_cash_handoffs
		SET state='STORE_CONFIRMED',store_confirmed_by=$2,store_confirmed_at=clock_timestamp(),confirmation_idempotency_key=$3,confirmation_request_hash=$4,version=version+1,updated_at=clock_timestamp()
		WHERE order_id=$1 AND state='AWAITING_STORE_HANDOFF' AND version=1`, orderID, actingPartnerActorID, idempotencyKey, requestHash)
	if err != nil {
		return OrderRecord{}, false, err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		if err != nil {
			return OrderRecord{}, false, err
		}
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "PARTNER_CAPTAIN_STORE_CASH_COLLECTION", SourceRef: assignmentID, OrderID: orderID, PaymentIntentID: *current.PaymentIntentID, CaptainActorID: captainActorID, PartnerActorID: actingPartnerActorID, AmountMinor: amountMinor, IdempotencyKey: idempotencyKey, CorrelationID: correlationID, ActingActorID: actingPartnerActorID}); err != nil {
		return OrderRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return OrderRecord{}, false, err
	}
	order, err := ReadOrder(ctx, db, orderID)
	return order, false, err
}

func validOrderTransition(from, to string) bool {
	switch from {
	case "CREATED":
		return to == "PARTNER_ACCEPTED" || to == "REJECTED" || to == "CANCELLED"
	case "PARTNER_ACCEPTED":
		return to == "PREPARING"
	case "PREPARING":
		return to == "READY_FOR_DISPATCH" || to == "READY_FOR_PICKUP"
	default:
		return false
	}
}

func isPickupNoShowCandidate(order OrderRecord) bool {
	return order.State == "READY_FOR_PICKUP" && order.FulfillmentMode == FulfillmentModeCustomerPickup && order.PaymentMethod == "CASH_AT_STORE" && order.PaymentIntentID != nil && order.PaymentState == "REQUIRES_COLLECTION"
}

func quantityValue(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}
