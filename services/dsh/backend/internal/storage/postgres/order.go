package postgres

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
)

var (
	ErrOrderNotFound               = errors.New("order was not found")
	ErrCheckoutEvidenceStale       = errors.New("checkout evidence is stale or invalid")
	ErrCheckoutIdempotencyConflict = errors.New("checkout idempotency key was already used with different facts")
	ErrOrderStateConflict          = errors.New("order state does not allow this transition")
	ErrOrderVersionConflict        = errors.New("order version is stale")
	ErrOrderTransitionConflict     = errors.New("order transition idempotency key was already used with different facts")
	ErrOrderTransitionInvalid      = errors.New("order transition is invalid")
	ErrPaymentProvisioning         = errors.New("payment intent could not be provisioned")
	ErrPaymentStateConflict        = errors.New("order payment state is stale or invalid")
)

type CheckoutEvidence struct {
	ServiceCityID  string
	PolicyVersion  string
	Status         string
	StoreVersion   int
	AddressVersion int
}

type ProvisionedPayment struct {
	IntentID string
	State    string
}

type PaymentIntentProvisioner func(ctx context.Context, orderID, externalReference, payerActorID string, amountMinor int64, idempotencyKey, correlationID string) (ProvisionedPayment, error)

type PaymentIntentCanceller func(ctx context.Context, intentID, reason, idempotencyKey, correlationID string) error

type CheckoutInput struct {
	ClientActorID            string
	CartID                   string
	StoreID                  string
	AddressID                string
	ExpectedCartVersion      int
	Evidence                 CheckoutEvidence
	IdempotencyKey           string
	RequestHash              string
	ActingActorID            string
	CorrelationID            string
	PaymentExternalReference string
	PaymentIdempotencyKey    string
	PaymentCancellationKey   string
	PaymentProvisioner       PaymentIntentProvisioner
	PaymentCanceller         PaymentIntentCanceller
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
	CartID                       string
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
	TotalAmountMinor             int64
	Currency                     string
	PaymentIntentID              *string
	PaymentMethod                string
	PaymentState                 string
	Version                      int
	Lines                        []OrderLineRecord
	CreatedAt                    time.Time
	UpdatedAt                    time.Time
}

type DeliveryProofRecord struct {
	OrderID    string
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

func ReadClientDeliveryProof(ctx context.Context, db *sql.DB, orderID, clientActorID string) (DeliveryProofRecord, error) {
	if db == nil || strings.TrimSpace(orderID) == "" || strings.TrimSpace(clientActorID) == "" {
		return DeliveryProofRecord{}, ErrOrderNotFound
	}
	var proof DeliveryProofRecord
	if err := db.QueryRowContext(ctx, `SELECT p.order_id,p.state,CASE WHEN p.state='PENDING' THEN p.code ELSE '' END,p.verified_at FROM dsh.commerce_order_delivery_proofs p WHERE p.order_id=$1 AND p.client_actor_id=$2`, strings.TrimSpace(orderID), strings.TrimSpace(clientActorID)).Scan(&proof.OrderID, &proof.State, &proof.Code, &proof.VerifiedAt); errors.Is(err, sql.ErrNoRows) {
		return DeliveryProofRecord{}, ErrOrderNotFound
	} else if err != nil {
		return DeliveryProofRecord{}, err
	}
	return proof, nil
}

type OperatorOperationRecord struct {
	Order      OrderRecord
	StoreName  string
	Assignment *CaptainAssignment
}

type OperatorOperationsResult struct {
	Operations []OperatorOperationRecord
	NextCursor string
}

func HashCheckoutRequest(input CheckoutInput) string {
	return hashFacts(strings.TrimSpace(input.ClientActorID), strings.TrimSpace(input.CartID), strings.TrimSpace(input.StoreID), strings.TrimSpace(input.AddressID), strconv.Itoa(input.ExpectedCartVersion), input.Evidence.ServiceCityID, input.Evidence.PolicyVersion, input.Evidence.Status, strconv.Itoa(input.Evidence.StoreVersion), strconv.Itoa(input.Evidence.AddressVersion))
}

func HashOrderTransition(orderID, state string, expectedVersion int) string {
	return hashFacts(strings.TrimSpace(orderID), strings.TrimSpace(state), strconv.Itoa(expectedVersion))
}

func ReadOrder(ctx context.Context, db *sql.DB, orderID string) (OrderRecord, error) {
	return readOrder(ctx, db, "id=$1", strings.TrimSpace(orderID))
}

func ReadOrderForClient(ctx context.Context, db *sql.DB, orderID, clientActorID string) (OrderRecord, error) {
	return readOrder(ctx, db, "id=$1 AND client_actor_id=$2", strings.TrimSpace(orderID), strings.TrimSpace(clientActorID))
}

func ListOrdersForClient(ctx context.Context, db *sql.DB, clientActorID, state string, limit int) ([]OrderRecord, error) {
	return listOrders(ctx, db, "client_actor_id=$1", []any{strings.TrimSpace(clientActorID)}, state, limit)
}

func ListOrdersForStore(ctx context.Context, db *sql.DB, storeID, state string, limit int) ([]OrderRecord, error) {
	return listOrders(ctx, db, "store_id=$1", []any{strings.TrimSpace(storeID)}, state, limit)
}

var (
	ErrOperatorOperationInvalidCursor = errors.New("operator operation cursor is invalid")
	ErrOperatorOperationInvalidLimit  = errors.New("operator operation limit is invalid")
)

type operatorOperationsCursor struct {
	UpdatedAt time.Time `json:"updatedAt"`
	ID        string    `json:"id"`
	State     string    `json:"state"`
}

func ListOrdersForOperator(ctx context.Context, db *sql.DB, state string, limit int, cursor string) (OperatorOperationsResult, error) {
	if db == nil || limit < 1 || limit > 100 {
		return OperatorOperationsResult{}, ErrOperatorOperationInvalidLimit
	}
	state = strings.TrimSpace(state)
	args := []any{}
	where := "TRUE"
	if state != "" {
		args = append(args, state)
		where += " AND state=$" + strconv.Itoa(len(args))
	}
	if strings.TrimSpace(cursor) != "" {
		decoded, err := decodeOperatorOperationsCursor(cursor, state)
		if err != nil {
			return OperatorOperationsResult{}, err
		}
		args = append(args, decoded.UpdatedAt, decoded.ID)
		where += " AND (updated_at,id)<($" + strconv.Itoa(len(args)-1) + ",$" + strconv.Itoa(len(args)) + ")"
	}
	args = append(args, limit+1)
	rows, err := db.QueryContext(ctx, "SELECT id FROM dsh.commerce_orders WHERE "+where+" ORDER BY updated_at DESC,id DESC LIMIT $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		return OperatorOperationsResult{}, err
	}
	defer rows.Close()
	orderIDs := make([]string, 0, limit+1)
	for rows.Next() {
		var orderID string
		if err := rows.Scan(&orderID); err != nil {
			return OperatorOperationsResult{}, err
		}
		orderIDs = append(orderIDs, orderID)
	}
	if err := rows.Err(); err != nil {
		return OperatorOperationsResult{}, err
	}
	if err := rows.Close(); err != nil {
		return OperatorOperationsResult{}, err
	}

	operations := make([]OperatorOperationRecord, 0, len(orderIDs))
	for _, orderID := range orderIDs {
		operation, err := ReadOperatorOperation(ctx, db, orderID)
		if err != nil {
			return OperatorOperationsResult{}, err
		}
		operations = append(operations, operation)
	}
	result := OperatorOperationsResult{Operations: operations}
	if len(operations) > limit {
		last := operations[limit-1]
		result.Operations = operations[:limit]
		result.NextCursor = encodeOperatorOperationsCursor(operatorOperationsCursor{UpdatedAt: last.Order.UpdatedAt, ID: last.Order.ID, State: state})
	}
	return result, nil
}

func ReadOperatorOperation(ctx context.Context, db *sql.DB, orderID string) (OperatorOperationRecord, error) {
	order, err := ReadOrder(ctx, db, orderID)
	if err != nil {
		return OperatorOperationRecord{}, err
	}
	var storeName string
	if err := db.QueryRowContext(ctx, "SELECT name FROM dsh.stores WHERE id=$1", order.StoreID).Scan(&storeName); err != nil {
		return OperatorOperationRecord{}, err
	}
	operation := OperatorOperationRecord{Order: order, StoreName: storeName}
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

func decodeOperatorOperationsCursor(raw, state string) (operatorOperationsCursor, error) {
	value, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return operatorOperationsCursor{}, ErrOperatorOperationInvalidCursor
	}
	var cursor operatorOperationsCursor
	if err := json.Unmarshal(value, &cursor); err != nil || cursor.ID == "" || cursor.UpdatedAt.IsZero() || cursor.State != strings.TrimSpace(state) {
		return operatorOperationsCursor{}, ErrOperatorOperationInvalidCursor
	}
	return cursor, nil
}

const orderSelectColumns = `id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,currency,payment_intent_id,payment_method,payment_state,version,created_at,updated_at`

func scanOrder(row rowScanner) (OrderRecord, error) {
	var order OrderRecord
	var paymentIntentID sql.NullString
	if err := row.Scan(
		&order.ID, &order.ClientActorID, &order.StoreID, &order.CartID, &order.AddressID, &order.AddressVersion, &order.AddressText,
		&order.AddressLatitude, &order.AddressLongitude, &order.ServiceCityID, &order.ServiceabilityPolicyVersion, &order.ServiceabilityStatus,
		&order.ServiceabilityStoreVersion, &order.ServiceabilityAddressVersion, &order.State, &order.TotalAmountMinor, &order.Currency,
		&paymentIntentID, &order.PaymentMethod, &order.PaymentState, &order.Version, &order.CreatedAt, &order.UpdatedAt,
	); err != nil {
		return OrderRecord{}, err
	}
	if paymentIntentID.Valid {
		value := paymentIntentID.String
		order.PaymentIntentID = &value
	}
	return order, nil
}

func readOrder(ctx context.Context, source rowQueryer, where string, args ...any) (OrderRecord, error) {
	order, err := scanOrder(source.QueryRowContext(ctx, "SELECT "+orderSelectColumns+" FROM dsh.commerce_orders WHERE "+where, args...))
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
		where += " AND state=$" + strconv.Itoa(len(args))
	}
	args = append(args, limit)
	rows, err := db.QueryContext(ctx, "SELECT "+orderSelectColumns+" FROM dsh.commerce_orders WHERE "+where+" ORDER BY created_at DESC,id DESC LIMIT $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	items := make([]OrderRecord, 0)
	for rows.Next() {
		order, scanErr := scanOrder(rows)
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

func CreateOrderFromCart(ctx context.Context, db *sql.DB, input CheckoutInput) (result OrderRecord, replayed bool, returnErr error) {
	if strings.TrimSpace(input.ClientActorID) == "" || strings.TrimSpace(input.CartID) == "" || strings.TrimSpace(input.StoreID) == "" || strings.TrimSpace(input.AddressID) == "" || input.ExpectedCartVersion < 1 || input.Evidence.Status != "SERVICEABLE" || strings.TrimSpace(input.Evidence.PolicyVersion) == "" || input.Evidence.StoreVersion < 1 || input.Evidence.AddressVersion < 1 || strings.TrimSpace(input.IdempotencyKey) == "" || strings.TrimSpace(input.RequestHash) == "" || strings.TrimSpace(input.CorrelationID) == "" || strings.TrimSpace(input.PaymentExternalReference) == "" || strings.TrimSpace(input.PaymentIdempotencyKey) == "" || strings.TrimSpace(input.PaymentCancellationKey) == "" || input.PaymentProvisioner == nil || input.PaymentCanceller == nil {
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
			if returnErr == nil {
				returnErr = fmt.Errorf("%w: payment compensation failed: %v", ErrPaymentProvisioning, compensationErr)
			} else {
				returnErr = fmt.Errorf("%w; payment compensation failed: %v", returnErr, compensationErr)
			}
		}
	}()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:checkout:"+input.IdempotencyKey); err != nil {
		return OrderRecord{}, false, err
	}
	var storedHash, cartID, orderID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,cart_id,order_id FROM dsh.commerce_order_checkout_idempotency WHERE idempotency_key=$1 FOR UPDATE", input.IdempotencyKey).Scan(&storedHash, &cartID, &orderID)
	if err == nil {
		if storedHash != input.RequestHash || cartID != input.CartID {
			return OrderRecord{}, false, ErrCheckoutIdempotencyConflict
		}
		order, readErr := readOrder(ctx, tx, "id=$1", orderID)
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
	var storeCityID, addressCityID, addressText string
	var storeVersion, addressVersion int
	var latitude, longitude float64
	err = tx.QueryRowContext(ctx, `SELECT s.service_city_id,s.version,a.service_city_id,a.version,a.address_text,a.latitude,a.longitude
FROM dsh.stores s JOIN dsh.service_cities c ON c.id=s.service_city_id AND c.active=true
JOIN dsh.delivery_addresses a ON a.id=$2 AND a.client_actor_id=$3
WHERE s.id=$1 AND s.publication_state='published'`, input.StoreID, input.AddressID, input.ClientActorID).Scan(&storeCityID, &storeVersion, &addressCityID, &addressVersion, &addressText, &latitude, &longitude)
	if errors.Is(err, sql.ErrNoRows) || storeCityID != input.Evidence.ServiceCityID || addressCityID != input.Evidence.ServiceCityID || storeVersion != input.Evidence.StoreVersion || addressVersion != input.Evidence.AddressVersion {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
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
		lines = append(lines, line)
	}
	if len(lines) == 0 || total <= 0 {
		return OrderRecord{}, false, ErrCartEmpty
	}
	newOrderID, err := newID("order")
	if err != nil {
		return OrderRecord{}, false, err
	}
	deliveryProofCode, err := newDeliveryProofCode()
	if err != nil {
		return OrderRecord{}, false, err
	}
	payment, err := input.PaymentProvisioner(ctx, newOrderID, input.PaymentExternalReference, input.ClientActorID, total, input.PaymentIdempotencyKey, input.CorrelationID)
	if err != nil || strings.TrimSpace(payment.IntentID) == "" || payment.State != "REQUIRES_COLLECTION" {
		if err != nil {
			return OrderRecord{}, false, fmt.Errorf("%w: %v", ErrPaymentProvisioning, err)
		}
		return OrderRecord{}, false, ErrPaymentProvisioning
	}
	paymentIntentID = strings.TrimSpace(payment.IntentID)
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,payment_intent_id,payment_method,payment_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'CREATED',$15,$16,'CASH_ON_DELIVERY',$17)`, newOrderID, input.ClientActorID, input.StoreID, input.CartID, input.AddressID, addressVersion, addressText, latitude, longitude, input.Evidence.ServiceCityID, input.Evidence.PolicyVersion, input.Evidence.Status, storeVersion, addressVersion, total, payment.IntentID, payment.State); err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_delivery_proofs(order_id,client_actor_id,code,code_hash) VALUES($1,$2,$3,$4)`, newOrderID, input.ClientActorID, deliveryProofCode, HashDeliveryProofCode(newOrderID, deliveryProofCode)); err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_payment_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,payment_intent_id,from_state,to_state,amount_minor) VALUES('payment_intent_linked',$1,$2,$3,$4,$5,'NOT_LINKED',$6,$7)`, input.IdempotencyKey, input.CorrelationID, input.ActingActorID, newOrderID, payment.IntentID, payment.State, total); err != nil {
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
		return OrderRecord{}, false, err
	}
	order, err := ReadOrder(ctx, db, newOrderID)
	return order, false, err
}

type TransitionPreparation func(context.Context, OrderRecord) (string, error)

func TransitionOrder(ctx context.Context, db *sql.DB, orderID, requestedState, paymentState string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (OrderRecord, bool, error) {
	return TransitionOrderWithPreparation(ctx, db, orderID, requestedState, paymentState, expectedVersion, idempotencyKey, requestHash, actingActorID, correlationID, nil)
}

func TransitionOrderWithPreparation(ctx context.Context, db *sql.DB, orderID, requestedState, paymentState string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string, prepare TransitionPreparation) (OrderRecord, bool, error) {
	if strings.TrimSpace(orderID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(correlationID) == "" {
		return OrderRecord{}, false, ErrOrderTransitionInvalid
	}
	paymentState = strings.TrimSpace(paymentState)
	if paymentState != "" && ((requestedState != "REJECTED" && requestedState != "CANCELLED") || paymentState != "CANCELLED") {
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
		order, readErr := readOrder(ctx, tx, "id=$1", orderID)
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
	current, err := scanOrder(tx.QueryRowContext(ctx, "SELECT "+orderSelectColumns+" FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE", orderID))
	if errors.Is(err, sql.ErrNoRows) {
		return OrderRecord{}, false, ErrOrderNotFound
	}
	if err != nil {
		return OrderRecord{}, false, err
	}
	if current.Version != expectedVersion {
		return OrderRecord{}, false, ErrOrderVersionConflict
	}
	if !validOrderTransition(current.State, requestedState) {
		return OrderRecord{}, false, ErrOrderStateConflict
	}
	if prepare != nil {
		paymentState, err = prepare(ctx, current)
		if err != nil {
			return OrderRecord{}, false, err
		}
	}
	if paymentState != "" && ((requestedState != "REJECTED" && requestedState != "CANCELLED") || paymentState != "CANCELLED") {
		return OrderRecord{}, false, ErrPaymentStateConflict
	}
	if requestedState == "REJECTED" || requestedState == "CANCELLED" {
		if err := releaseOrderInventoryTx(ctx, tx, orderID); err != nil {
			return OrderRecord{}, false, err
		}
	}
	result, err := scanOrder(tx.QueryRowContext(ctx, "UPDATE dsh.commerce_orders SET state=$2,payment_state=CASE WHEN $4='' THEN payment_state ELSE $4 END,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$3 RETURNING "+orderSelectColumns, orderID, requestedState, expectedVersion, paymentState))
	if err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_order_transition_idempotency(idempotency_key,request_hash,order_id,requested_state,expected_version,result_version) VALUES($1,$2,$3,$4,$5,$6)", idempotencyKey, requestHash, orderID, requestedState, expectedVersion, result.Version); err != nil {
		return OrderRecord{}, false, err
	}
	eventType := "order_" + strings.ToLower(strings.ReplaceAll(requestedState, "_", "_"))
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_order_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", eventType, idempotencyKey, correlationID, actingActorID, orderID, current.State, requestedState, expectedVersion, result.Version, requestHash); err != nil {
		return OrderRecord{}, false, err
	}
	if paymentState != "" {
		if current.PaymentIntentID == nil {
			return OrderRecord{}, false, ErrPaymentStateConflict
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_payment_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,payment_intent_id,from_state,to_state,amount_minor) VALUES('payment_cancelled',$1,$2,$3,$4,$5,$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, orderID, *current.PaymentIntentID, current.PaymentState, paymentState, current.TotalAmountMinor); err != nil {
			return OrderRecord{}, false, err
		}
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
		return to == "READY_FOR_DISPATCH"
	default:
		return false
	}
}

func quantityValue(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}
