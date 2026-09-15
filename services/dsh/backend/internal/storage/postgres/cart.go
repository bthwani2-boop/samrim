package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/lib/pq"
)

var (
	ErrCartNotFound            = errors.New("cart was not found")
	ErrCartVersionConflict     = errors.New("cart version is stale")
	ErrCartIdempotencyConflict = errors.New("cart idempotency key was already used with different facts")
	ErrCartOfferUnavailable    = errors.New("StoreOffer is not customer-visible")
	ErrCartEmpty               = errors.New("cart has no lines")
	ErrCartQuantityInvalid     = errors.New("cart quantity is invalid")
	ErrCartModifierInvalid     = errors.New("modifier selection is not admitted")
	ErrCartStateConflict       = errors.New("cart state does not allow this operation")
)

type CartLineRecord struct {
	ID                        string
	CartID                    string
	StoreOfferID              string
	VariantID                 string
	ProductID                 string
	ProductName               string
	VariantTitle              string
	MeasurementKind           string
	BaseUnit                  string
	PricingBasis              string
	QuantityPolicy            string
	QuantityMinBaseUnits      int64
	QuantityMaxBaseUnits      int64
	QuantityStepBaseUnits     int64
	PricingUnitBaseUnits      int64
	QuantityBaseUnits         int64
	SelectedModifierOptionIDs []string
	UnitPriceMinor            int64
	ModifierAmountMinor       int64
	LineAmountMinor           int64
	Currency                  string
	OfferVersion              int
	CreatedAt                 time.Time
	UpdatedAt                 time.Time
}

type CartRecord struct {
	ID        string
	StoreID   string
	State     string
	Version   int
	Lines     []CartLineRecord
	CreatedAt time.Time
	UpdatedAt time.Time
}

func HashCartLineMutation(operation, storeID, offerID string, quantity int64, modifierIDs []string, expectedVersion int) string {
	return hashFacts(operation, strings.TrimSpace(storeID), strings.TrimSpace(offerID), strconv.FormatInt(quantity, 10), strings.Join(modifierIDs, ","), strconv.Itoa(expectedVersion))
}

func CalculateCatalogLineAmount(priceMinor, quantity int64, pricingBasis string, pricingUnitBaseUnits int64) (int64, error) {
	if priceMinor <= 0 || quantity <= 0 {
		return 0, ErrCartQuantityInvalid
	}
	if pricingUnitBaseUnits <= 0 || (pricingBasis != "PER_UNIT" && pricingBasis != "PER_MEASURE") {
		return 0, ErrCartQuantityInvalid
	}
	if pricingBasis == "PER_UNIT" && pricingUnitBaseUnits != 1 {
		return 0, ErrCartQuantityInvalid
	}
	value := new(big.Int).Mul(big.NewInt(priceMinor), big.NewInt(quantity))
	if pricingBasis == "PER_MEASURE" {
		quotient, remainder := new(big.Int), new(big.Int)
		quotient.QuoRem(value, big.NewInt(pricingUnitBaseUnits), remainder)
		if remainder.Sign() != 0 {
			return 0, ErrCartQuantityInvalid
		}
		value = quotient
	}
	if !value.IsInt64() || value.Sign() <= 0 {
		return 0, ErrCartQuantityInvalid
	}
	return value.Int64(), nil
}

func ReadOpenCart(ctx context.Context, db *sql.DB, clientActorID, storeID string) (CartRecord, error) {
	return readCart(ctx, db, clientActorID, storeID, true)
}

func readCart(ctx context.Context, db *sql.DB, clientActorID, storeID string, openOnly bool) (CartRecord, error) {
	where := "client_actor_id=$1 AND store_id=$2"
	args := []any{strings.TrimSpace(clientActorID), strings.TrimSpace(storeID)}
	if openOnly {
		where += " AND state='open'"
	}
	return readCartByQuery(ctx, db, "SELECT id,store_id,state,version,created_at,updated_at FROM dsh.commerce_carts WHERE "+where, args...)
}

func readCartByID(ctx context.Context, source rowQueryer, clientActorID, cartID string) (CartRecord, error) {
	return readCartByQuery(ctx, source, "SELECT id,store_id,state,version,created_at,updated_at FROM dsh.commerce_carts WHERE client_actor_id=$1 AND id=$2", strings.TrimSpace(clientActorID), strings.TrimSpace(cartID))
}

func readCartByQuery(ctx context.Context, source rowQueryer, query string, args ...any) (CartRecord, error) {
	var cart CartRecord
	if err := source.QueryRowContext(ctx, query, args...).Scan(&cart.ID, &cart.StoreID, &cart.State, &cart.Version, &cart.CreatedAt, &cart.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return CartRecord{}, ErrCartNotFound
		}
		return CartRecord{}, err
	}
	lines, err := listCartLines(ctx, source, cart.ID)
	if err != nil {
		return CartRecord{}, err
	}
	cart.Lines = lines
	return cart, nil
}

func listCartLines(ctx context.Context, source queryer, cartID string) ([]CartLineRecord, error) {
	rows, err := source.QueryContext(ctx, `SELECT l.id,l.cart_id,l.store_offer_id,l.variant_id,v.product_id,p.canonical_name,v.title,v.measurement_kind,v.base_unit,o.pricing_basis,o.quantity_policy,COALESCE(o.quantity_min_base_units,0),COALESCE(o.quantity_max_base_units,0),COALESCE(o.quantity_step_base_units,0),o.pricing_unit_base_units,l.quantity_base_units,l.selected_modifier_option_ids,o.price_minor,o.currency,o.version,l.created_at,l.updated_at
FROM dsh.commerce_cart_lines l
JOIN dsh.catalog_store_offers o ON o.id=l.store_offer_id
JOIN dsh.catalog_product_variants v ON v.id=l.variant_id
JOIN dsh.catalog_products p ON p.id=v.product_id
WHERE l.cart_id=$1 AND l.removed_at IS NULL ORDER BY l.created_at,l.id`, cartID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	lines := make([]CartLineRecord, 0)
	for rows.Next() {
		var line CartLineRecord
		if err := rows.Scan(&line.ID, &line.CartID, &line.StoreOfferID, &line.VariantID, &line.ProductID, &line.ProductName, &line.VariantTitle, &line.MeasurementKind, &line.BaseUnit, &line.PricingBasis, &line.QuantityPolicy, &line.QuantityMinBaseUnits, &line.QuantityMaxBaseUnits, &line.QuantityStepBaseUnits, &line.PricingUnitBaseUnits, &line.QuantityBaseUnits, pq.Array(&line.SelectedModifierOptionIDs), &line.UnitPriceMinor, &line.Currency, &line.OfferVersion, &line.CreatedAt, &line.UpdatedAt); err != nil {
			return nil, err
		}
		lines = append(lines, line)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for index := range lines {
		line := &lines[index]
		_, delta, err := ValidateCatalogModifierSelection(ctx, source, line.StoreOfferID, line.SelectedModifierOptionIDs)
		if err != nil {
			return nil, err
		}
		line.ModifierAmountMinor, err = CalculateCatalogModifierAmount(delta, line.QuantityBaseUnits)
		if err != nil {
			return nil, err
		}
		baseAmount, err := CalculateCatalogLineAmount(line.UnitPriceMinor, line.QuantityBaseUnits, line.PricingBasis, line.PricingUnitBaseUnits)
		if err != nil {
			return nil, err
		}
		line.LineAmountMinor, err = AddCatalogModifierAmount(baseAmount, delta, line.QuantityBaseUnits)
		if err != nil {
			return nil, err
		}
	}
	return lines, nil
}

func UpsertCartLine(ctx context.Context, db *sql.DB, clientActorID, storeID, offerID string, quantity int64, modifierIDs []string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CartRecord, bool, error) {
	if strings.TrimSpace(clientActorID) == "" || strings.TrimSpace(storeID) == "" || strings.TrimSpace(offerID) == "" || expectedVersion < 0 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(correlationID) == "" {
		return CartRecord{}, false, errors.New("cart line mutation facts are invalid")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CartRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:cart:"+clientActorID+":"+storeID); err != nil {
		return CartRecord{}, false, err
	}
	var storedHash, cartID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,cart_id,operation FROM dsh.commerce_cart_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &cartID, &operation)
	if err == nil {
		if storedHash != requestHash || operation != "line_upsert" {
			return CartRecord{}, false, ErrCartIdempotencyConflict
		}
		cart, readErr := readCartByID(ctx, tx, clientActorID, cartID)
		if readErr != nil {
			return CartRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CartRecord{}, false, err
		}
		return cart, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CartRecord{}, false, err
	}
	offer, err := readCustomerVisibleOfferTx(ctx, tx, storeID, offerID)
	if errors.Is(err, sql.ErrNoRows) {
		return CartRecord{}, false, ErrCartOfferUnavailable
	}
	if err != nil {
		return CartRecord{}, false, err
	}
	if err := validateCatalogOfferQuantity(offer, quantity); err != nil {
		return CartRecord{}, false, err
	}
	_, modifierDelta, err := ValidateCatalogModifierSelection(ctx, tx, offer.ID, modifierIDs)
	if err != nil {
		return CartRecord{}, false, err
	}
	baseAmount, err := CalculateCatalogLineAmount(offer.PriceMinor, quantity, offer.PricingBasis, offer.PricingUnitBaseUnits)
	if err != nil {
		return CartRecord{}, false, err
	}
	if _, err := AddCatalogModifierAmount(baseAmount, modifierDelta, quantity); err != nil {
		return CartRecord{}, false, err
	}
	var cart CartRecord
	err = tx.QueryRowContext(ctx, "SELECT id,store_id,state,version,created_at,updated_at FROM dsh.commerce_carts WHERE client_actor_id=$1 AND store_id=$2 AND state='open' FOR UPDATE", clientActorID, storeID).Scan(&cart.ID, &cart.StoreID, &cart.State, &cart.Version, &cart.CreatedAt, &cart.UpdatedAt)
	newCart := errors.Is(err, sql.ErrNoRows)
	if err != nil && !newCart {
		return CartRecord{}, false, err
	}
	fromVersion := 0
	if newCart {
		if expectedVersion != 0 {
			return CartRecord{}, false, ErrCartVersionConflict
		}
		cart.ID, err = newID("cart")
		if err != nil {
			return CartRecord{}, false, err
		}
		cart.StoreID, cart.State, cart.Version = storeID, "open", 1
		if err := tx.QueryRowContext(ctx, `INSERT INTO dsh.commerce_carts(id,client_actor_id,store_id,state,version) VALUES($1,$2,$3,'open',1) RETURNING created_at,updated_at`, cart.ID, clientActorID, storeID).Scan(&cart.CreatedAt, &cart.UpdatedAt); err != nil {
			return CartRecord{}, false, err
		}
	} else {
		if cart.Version != expectedVersion || cart.State != "open" {
			return CartRecord{}, false, ErrCartVersionConflict
		}
		fromVersion = cart.Version
		if err := tx.QueryRowContext(ctx, `UPDATE dsh.commerce_carts SET version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING version,updated_at`, cart.ID).Scan(&cart.Version, &cart.UpdatedAt); err != nil {
			return CartRecord{}, false, err
		}
	}
	var lineID string
	lineEvent := "cart_line_added"
	err = tx.QueryRowContext(ctx, "SELECT id FROM dsh.commerce_cart_lines WHERE cart_id=$1 AND store_offer_id=$2 AND removed_at IS NULL FOR UPDATE", cart.ID, offerID).Scan(&lineID)
	if errors.Is(err, sql.ErrNoRows) {
		lineID, err = newID("cartline")
		if err != nil {
			return CartRecord{}, false, err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_cart_lines(id,cart_id,store_offer_id,variant_id,quantity_base_units,selected_modifier_option_ids) VALUES($1,$2,$3,$4,$5,$6)", lineID, cart.ID, offer.ID, offer.VariantID, quantity, pq.Array(modifierIDs)); err != nil {
			return CartRecord{}, false, err
		}
	} else if err != nil {
		return CartRecord{}, false, err
	} else {
		lineEvent = "cart_line_updated"
		if _, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_cart_lines SET variant_id=$2,quantity_base_units=$3,selected_modifier_option_ids=$4,updated_at=clock_timestamp() WHERE id=$1", lineID, offer.VariantID, quantity, pq.Array(modifierIDs)); err != nil {
			return CartRecord{}, false, err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_cart_mutation_idempotency(idempotency_key,request_hash,cart_id,line_id,operation,expected_cart_version,result_cart_version) VALUES($1,$2,$3,$4,'line_upsert',$5,$6)`, idempotencyKey, requestHash, cart.ID, lineID, expectedVersion, cart.Version); err != nil {
		return CartRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_cart_audit(event_type,idempotency_key,correlation_id,acting_actor_id,cart_id,line_id,store_offer_id,from_version,result_version,request_hash,quantity_base_units) VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,0),$9,$10,$11)`, lineEvent, idempotencyKey, correlationID, actingActorID, cart.ID, lineID, offer.ID, fromVersion, cart.Version, requestHash, quantity); err != nil {
		return CartRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CartRecord{}, false, err
	}
	result, err := ReadOpenCart(ctx, db, clientActorID, storeID)
	return result, false, err
}

func UpdateCartLine(ctx context.Context, db *sql.DB, clientActorID, lineID string, quantity int64, modifierIDs []string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CartRecord, bool, error) {
	if strings.TrimSpace(clientActorID) == "" || strings.TrimSpace(lineID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(correlationID) == "" {
		return CartRecord{}, false, errors.New("cart line update facts are invalid")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CartRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:cart-line:"+lineID); err != nil {
		return CartRecord{}, false, err
	}
	var storedHash, cartID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,cart_id,operation FROM dsh.commerce_cart_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &cartID, &operation)
	if err == nil {
		if storedHash != requestHash || operation != "line_upsert" {
			return CartRecord{}, false, ErrCartIdempotencyConflict
		}
		cart, readErr := readCartByID(ctx, tx, clientActorID, cartID)
		if readErr != nil {
			return CartRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CartRecord{}, false, err
		}
		return cart, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CartRecord{}, false, err
	}
	var storeID, offerID string
	var cart CartRecord
	err = tx.QueryRowContext(ctx, `SELECT c.id,c.store_id,c.state,c.version,c.created_at,c.updated_at,l.store_offer_id FROM dsh.commerce_cart_lines l JOIN dsh.commerce_carts c ON c.id=l.cart_id WHERE l.id=$1 AND c.client_actor_id=$2 FOR UPDATE OF c,l`, lineID, clientActorID).Scan(&cart.ID, &storeID, &cart.State, &cart.Version, &cart.CreatedAt, &cart.UpdatedAt, &offerID)
	if errors.Is(err, sql.ErrNoRows) {
		return CartRecord{}, false, ErrCartNotFound
	}
	if err != nil {
		return CartRecord{}, false, err
	}
	if cart.State != "open" {
		return CartRecord{}, false, ErrCartStateConflict
	}
	if cart.Version != expectedVersion {
		return CartRecord{}, false, ErrCartVersionConflict
	}
	offer, err := readCustomerVisibleOfferTx(ctx, tx, storeID, offerID)
	if errors.Is(err, sql.ErrNoRows) {
		return CartRecord{}, false, ErrCartOfferUnavailable
	}
	if err != nil {
		return CartRecord{}, false, err
	}
	if err := validateCatalogOfferQuantity(offer, quantity); err != nil {
		return CartRecord{}, false, err
	}
	_, modifierDelta, err := ValidateCatalogModifierSelection(ctx, tx, offer.ID, modifierIDs)
	if err != nil {
		return CartRecord{}, false, err
	}
	baseAmount, err := CalculateCatalogLineAmount(offer.PriceMinor, quantity, offer.PricingBasis, offer.PricingUnitBaseUnits)
	if err != nil {
		return CartRecord{}, false, err
	}
	if _, err := AddCatalogModifierAmount(baseAmount, modifierDelta, quantity); err != nil {
		return CartRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_cart_lines SET quantity_base_units=$2,selected_modifier_option_ids=$3,updated_at=clock_timestamp() WHERE id=$1", lineID, quantity, pq.Array(modifierIDs)); err != nil {
		return CartRecord{}, false, err
	}
	if err := tx.QueryRowContext(ctx, "UPDATE dsh.commerce_carts SET version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING version,updated_at", cart.ID).Scan(&cart.Version, &cart.UpdatedAt); err != nil {
		return CartRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_cart_mutation_idempotency(idempotency_key,request_hash,cart_id,line_id,operation,expected_cart_version,result_cart_version) VALUES($1,$2,$3,$4,'line_upsert',$5,$6)`, idempotencyKey, requestHash, cart.ID, lineID, expectedVersion, cart.Version); err != nil {
		return CartRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_cart_audit(event_type,idempotency_key,correlation_id,acting_actor_id,cart_id,line_id,store_offer_id,from_version,result_version,request_hash,quantity_base_units) VALUES('cart_line_updated',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, idempotencyKey, correlationID, actingActorID, cart.ID, lineID, offer.ID, expectedVersion, cart.Version, requestHash, quantity); err != nil {
		return CartRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CartRecord{}, false, err
	}
	result, err := ReadOpenCart(ctx, db, clientActorID, storeID)
	return result, false, err
}

func RemoveCartLine(ctx context.Context, db *sql.DB, clientActorID, lineID string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CartRecord, bool, error) {
	if strings.TrimSpace(clientActorID) == "" || strings.TrimSpace(lineID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(correlationID) == "" {
		return CartRecord{}, false, errors.New("cart line removal facts are invalid")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CartRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:cart-line:"+lineID); err != nil {
		return CartRecord{}, false, err
	}
	var storedHash, cartID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,cart_id,operation FROM dsh.commerce_cart_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &cartID, &operation)
	if err == nil {
		if storedHash != requestHash || operation != "line_remove" {
			return CartRecord{}, false, ErrCartIdempotencyConflict
		}
		cart, readErr := readCartByID(ctx, tx, clientActorID, cartID)
		if readErr != nil {
			return CartRecord{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CartRecord{}, false, err
		}
		return cart, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CartRecord{}, false, err
	}
	var storeID string
	var cart CartRecord
	err = tx.QueryRowContext(ctx, `SELECT c.id,c.store_id,c.state,c.version,c.created_at,c.updated_at FROM dsh.commerce_cart_lines l JOIN dsh.commerce_carts c ON c.id=l.cart_id WHERE l.id=$1 AND c.client_actor_id=$2 FOR UPDATE OF c,l`, lineID, clientActorID).Scan(&cart.ID, &storeID, &cart.State, &cart.Version, &cart.CreatedAt, &cart.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CartRecord{}, false, ErrCartNotFound
	}
	if err != nil {
		return CartRecord{}, false, err
	}
	if cart.State != "open" {
		return CartRecord{}, false, ErrCartStateConflict
	}
	if cart.Version != expectedVersion {
		return CartRecord{}, false, ErrCartVersionConflict
	}
	if _, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_cart_lines SET removed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1", lineID); err != nil {
		return CartRecord{}, false, err
	}
	if err := tx.QueryRowContext(ctx, "UPDATE dsh.commerce_carts SET version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING version,updated_at", cart.ID).Scan(&cart.Version, &cart.UpdatedAt); err != nil {
		return CartRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_cart_mutation_idempotency(idempotency_key,request_hash,cart_id,line_id,operation,expected_cart_version,result_cart_version) VALUES($1,$2,$3,$4,'line_remove',$5,$6)`, idempotencyKey, requestHash, cart.ID, lineID, expectedVersion, cart.Version); err != nil {
		return CartRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_cart_audit(event_type,idempotency_key,correlation_id,acting_actor_id,cart_id,line_id,from_version,result_version,request_hash) VALUES('cart_line_removed',$1,$2,$3,$4,$5,$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, cart.ID, lineID, expectedVersion, cart.Version, requestHash); err != nil {
		return CartRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CartRecord{}, false, err
	}
	result, err := ReadOpenCart(ctx, db, clientActorID, storeID)
	return result, false, err
}

func (c CartRecord) String() string {
	return fmt.Sprintf("Cart(%s,v%d,%s)", c.ID, c.Version, c.State)
}
