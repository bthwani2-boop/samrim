package postgres

import (
	"context"
	"database/sql"
	"errors"
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
)

type CheckoutEvidence struct {
	ServiceCityID  string
	PolicyVersion  string
	Status         string
	StoreVersion   int
	AddressVersion int
}

type CheckoutInput struct {
	ClientActorID       string
	CartID              string
	StoreID             string
	AddressID           string
	ExpectedCartVersion int
	Evidence            CheckoutEvidence
	IdempotencyKey      string
	RequestHash         string
	ActingActorID       string
	CorrelationID       string
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
	Version                      int
	Lines                        []OrderLineRecord
	CreatedAt                    time.Time
	UpdatedAt                    time.Time
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

func readOrder(ctx context.Context, source rowQueryer, where string, args ...any) (OrderRecord, error) {
	var order OrderRecord
	err := source.QueryRowContext(ctx, `SELECT id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,currency,version,created_at,updated_at FROM dsh.commerce_orders WHERE `+where, args...).Scan(
		&order.ID, &order.ClientActorID, &order.StoreID, &order.CartID, &order.AddressID, &order.AddressVersion, &order.AddressText, &order.AddressLatitude, &order.AddressLongitude, &order.ServiceCityID, &order.ServiceabilityPolicyVersion, &order.ServiceabilityStatus, &order.ServiceabilityStoreVersion, &order.ServiceabilityAddressVersion, &order.State, &order.TotalAmountMinor, &order.Currency, &order.Version, &order.CreatedAt, &order.UpdatedAt)
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
	rows, err := db.QueryContext(ctx, "SELECT id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,currency,version,created_at,updated_at FROM dsh.commerce_orders WHERE "+where+" ORDER BY created_at DESC,id DESC LIMIT $"+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	items := make([]OrderRecord, 0)
	for rows.Next() {
		var order OrderRecord
		if err := rows.Scan(&order.ID, &order.ClientActorID, &order.StoreID, &order.CartID, &order.AddressID, &order.AddressVersion, &order.AddressText, &order.AddressLatitude, &order.AddressLongitude, &order.ServiceCityID, &order.ServiceabilityPolicyVersion, &order.ServiceabilityStatus, &order.ServiceabilityStoreVersion, &order.ServiceabilityAddressVersion, &order.State, &order.TotalAmountMinor, &order.Currency, &order.Version, &order.CreatedAt, &order.UpdatedAt); err != nil {
			_ = rows.Close()
			return nil, err
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

func CreateOrderFromCart(ctx context.Context, db *sql.DB, input CheckoutInput) (OrderRecord, bool, error) {
	if strings.TrimSpace(input.ClientActorID) == "" || strings.TrimSpace(input.CartID) == "" || strings.TrimSpace(input.StoreID) == "" || strings.TrimSpace(input.AddressID) == "" || input.ExpectedCartVersion < 1 || input.Evidence.Status != "SERVICEABLE" || strings.TrimSpace(input.Evidence.PolicyVersion) == "" || input.Evidence.StoreVersion < 1 || input.Evidence.AddressVersion < 1 || strings.TrimSpace(input.IdempotencyKey) == "" || strings.TrimSpace(input.RequestHash) == "" || strings.TrimSpace(input.CorrelationID) == "" {
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
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_orders(id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'CREATED',$15)`, newOrderID, input.ClientActorID, input.StoreID, input.CartID, input.AddressID, addressVersion, addressText, latitude, longitude, input.Evidence.ServiceCityID, input.Evidence.PolicyVersion, input.Evidence.Status, storeVersion, addressVersion, total); err != nil {
		return OrderRecord{}, false, err
	}
	for _, line := range lines {
		lineID, idErr := newID("orderline")
		if idErr != nil {
			return OrderRecord{}, false, idErr
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_lines(id,order_id,store_offer_id,variant_id,product_id,product_name,variant_title,measurement_kind,base_unit,pricing_basis,quantity_policy,quantity_min_base_units,quantity_max_base_units,quantity_step_base_units,pricing_unit_base_units,requested_quantity_base_units,final_quantity_base_units,unit_price_minor,line_amount_minor,currency,selected_modifier_option_ids,modifier_amount_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`, lineID, newOrderID, line.offer.ID, line.offer.VariantID, line.offer.Product.ID, line.offer.Product.CanonicalName, line.offer.Variant.Title, line.offer.Variant.MeasurementKind, line.offer.Variant.BaseUnit, line.offer.PricingBasis, line.offer.QuantityPolicy, quantityValue(line.offer.QuantityMinBaseUnits), quantityValue(line.offer.QuantityMaxBaseUnits), quantityValue(line.offer.QuantityStepBaseUnits), line.offer.PricingUnitBaseUnits, line.quantity, line.quantity, line.offer.PriceMinor, line.amount, line.offer.Currency, pq.Array(line.modifiers), line.modifierAmount); err != nil {
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
	result, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_carts SET state='checked_out',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='open' AND version=$2", input.CartID, input.ExpectedCartVersion)
	if err != nil {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	if rowsAffected, err := result.RowsAffected(); err != nil || rowsAffected != 1 {
		return OrderRecord{}, false, ErrCheckoutEvidenceStale
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_order_checkout_idempotency(idempotency_key,request_hash,cart_id,order_id,result_version) VALUES($1,$2,$3,$4,1)", input.IdempotencyKey, input.RequestHash, input.CartID, newOrderID); err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_order_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash) VALUES('order_created',$1,$2,$3,$4,NULL,'CREATED',NULL,1,$5)`, input.IdempotencyKey, input.CorrelationID, input.ActingActorID, newOrderID, input.RequestHash); err != nil {
		return OrderRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return OrderRecord{}, false, err
	}
	order, err := ReadOrder(ctx, db, newOrderID)
	return order, false, err
}

func TransitionOrder(ctx context.Context, db *sql.DB, orderID, requestedState string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (OrderRecord, bool, error) {
	if strings.TrimSpace(orderID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(correlationID) == "" {
		return OrderRecord{}, false, ErrOrderTransitionInvalid
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
	var current OrderRecord
	err = tx.QueryRowContext(ctx, "SELECT id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,currency,version,created_at,updated_at FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE", orderID).Scan(&current.ID, &current.ClientActorID, &current.StoreID, &current.CartID, &current.AddressID, &current.AddressVersion, &current.AddressText, &current.AddressLatitude, &current.AddressLongitude, &current.ServiceCityID, &current.ServiceabilityPolicyVersion, &current.ServiceabilityStatus, &current.ServiceabilityStoreVersion, &current.ServiceabilityAddressVersion, &current.State, &current.TotalAmountMinor, &current.Currency, &current.Version, &current.CreatedAt, &current.UpdatedAt)
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
	var result OrderRecord
	if err := tx.QueryRowContext(ctx, "UPDATE dsh.commerce_orders SET state=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$3 RETURNING id,client_actor_id,store_id,cart_id,address_id,address_version,address_text,address_latitude,address_longitude,service_city_id,serviceability_policy_version,serviceability_status,serviceability_store_version,serviceability_address_version,state,total_amount_minor,currency,version,created_at,updated_at", orderID, requestedState, expectedVersion).Scan(&result.ID, &result.ClientActorID, &result.StoreID, &result.CartID, &result.AddressID, &result.AddressVersion, &result.AddressText, &result.AddressLatitude, &result.AddressLongitude, &result.ServiceCityID, &result.ServiceabilityPolicyVersion, &result.ServiceabilityStatus, &result.ServiceabilityStoreVersion, &result.ServiceabilityAddressVersion, &result.State, &result.TotalAmountMinor, &result.Currency, &result.Version, &result.CreatedAt, &result.UpdatedAt); err != nil {
		return OrderRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_order_transition_idempotency(idempotency_key,request_hash,order_id,requested_state,expected_version,result_version) VALUES($1,$2,$3,$4,$5,$6)", idempotencyKey, requestHash, orderID, requestedState, expectedVersion, result.Version); err != nil {
		return OrderRecord{}, false, err
	}
	eventType := "order_" + strings.ToLower(strings.ReplaceAll(requestedState, "_", "_"))
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_order_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,from_state,to_state,from_version,result_version,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", eventType, idempotencyKey, correlationID, actingActorID, orderID, current.State, requestedState, expectedVersion, result.Version, requestHash); err != nil {
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
		return to == "PARTNER_ACCEPTED" || to == "REJECTED"
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
