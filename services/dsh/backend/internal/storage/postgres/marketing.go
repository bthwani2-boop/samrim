package postgres

import (
	"context"
	"database/sql"
	"errors"
	"math/big"
	"strconv"
	"strings"
	"time"
)

var (
	ErrPromotionNotFound             = errors.New("promotion was not found")
	ErrPromotionCodeConflict         = errors.New("promotion code already exists")
	ErrPromotionIdempotencyConflict  = errors.New("promotion idempotency key was already used with different facts")
	ErrPromotionVersionConflict      = errors.New("promotion version is stale")
	ErrPromotionInvalid              = errors.New("promotion input is invalid")
	ErrPromotionUnavailable          = errors.New("promotion is not currently eligible")
	ErrPromotionAlreadyRedeemed      = errors.New("promotion was already redeemed by this client")
	ErrPromotionLimitReached         = errors.New("promotion redemption limit has been reached")
	ErrDiscoveryContentNotFound      = errors.New("discovery content was not found")
	ErrDiscoveryContentIdempotency   = errors.New("discovery content idempotency key was already used with different facts")
	ErrDiscoveryContentVersion       = errors.New("discovery content version is stale")
	ErrDiscoveryContentInvalid       = errors.New("discovery content input is invalid")
	ErrDiscoveryContentTargetInvalid = errors.New("discovery content target is invalid")
)

func HashMarketingFacts(values ...string) string {
	return hashFacts(values...)
}

type PromotionRecord struct {
	ID                         string
	Code                       string
	NameAr                     string
	DescriptionAr              string
	Kind                       string
	ValueMinor                 int64
	MaxDiscountMinor           *int64
	FundingSource              string
	FundingSharePartnerPercent *int
	StoreID                    string
	ServiceCityID              string
	State                      string
	StartsAt                   time.Time
	EndsAt                     *time.Time
	RequiresPartnerOptIn       bool
	MinOrderSubtotalMinor      *int64
	RedemptionLimit            *int64
	RedeemedCount              int64
	Version                    int
	CreatedByActorID           string
	CreatedAt                  time.Time
	UpdatedAt                  time.Time
}

type DiscoveryContentRecord struct {
	ID               string
	Kind             string
	TitleAr          string
	BodyAr           string
	MediaURI         string
	TargetType       string
	TargetID         string
	ServiceCityID    string
	State            string
	StartsAt         time.Time
	EndsAt           *time.Time
	Ordinal          int
	Version          int
	CreatedByActorID string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type PromotionInput struct {
	ID                         string
	Code                       string
	NameAr                     string
	DescriptionAr              string
	Kind                       string
	ValueMinor                 int64
	MaxDiscountMinor           *int64
	FundingSource              string
	FundingSharePartnerPercent *int
	StoreID                    string
	ServiceCityID              string
	StartsAt                   time.Time
	EndsAt                     *time.Time
	RequiresPartnerOptIn       bool
	MinOrderSubtotalMinor      *int64
	Targets                    []PromotionTargetInput
	RedemptionLimit            *int64
	CreatedByActorID           string
}

// PromotionTargetInput scopes a promotion to specific products or categories;
// empty means the promotion applies store-wide.
type PromotionTargetInput struct {
	Kind string
	Ref  string
}

type DiscoveryContentInput struct {
	ID               string
	Kind             string
	TitleAr          string
	BodyAr           string
	MediaAssetID     string
	TargetType       string
	TargetID         string
	ServiceCityID    string
	StartsAt         time.Time
	EndsAt           *time.Time
	Ordinal          int
	CreatedByActorID string
}

func normalizePromotionInput(input PromotionInput) PromotionInput {
	input.ID = strings.TrimSpace(input.ID)
	input.Code = strings.ToUpper(strings.TrimSpace(input.Code))
	input.NameAr = strings.TrimSpace(input.NameAr)
	input.DescriptionAr = strings.TrimSpace(input.DescriptionAr)
	input.Kind = strings.ToUpper(strings.TrimSpace(input.Kind))
	input.FundingSource = strings.ToUpper(strings.TrimSpace(input.FundingSource))
	input.StoreID = strings.TrimSpace(input.StoreID)
	input.ServiceCityID = strings.TrimSpace(input.ServiceCityID)
	input.CreatedByActorID = strings.TrimSpace(input.CreatedByActorID)
	return input
}

func validatePromotionInput(input PromotionInput) error {
	input = normalizePromotionInput(input)
	if input.ID == "" || input.Code == "" || len(input.Code) < 3 || len(input.Code) > 64 || input.NameAr == "" || len(input.NameAr) > 160 || input.StartsAt.IsZero() || input.ValueMinor <= 0 {
		return ErrPromotionInvalid
	}
	if input.FundingSource != "PARTNER" && input.FundingSource != "BTHWANI" && input.FundingSource != "SHARED" {
		return ErrPromotionInvalid
	}
	if input.FundingSource == "SHARED" && (input.FundingSharePartnerPercent == nil || *input.FundingSharePartnerPercent < 1 || *input.FundingSharePartnerPercent > 99) {
		return ErrPromotionInvalid
	}
	if input.FundingSource != "SHARED" && input.FundingSharePartnerPercent != nil {
		return ErrPromotionInvalid
	}
	if input.Kind != "PERCENTAGE" && input.Kind != "FIXED" {
		return ErrPromotionInvalid
	}
	if input.MinOrderSubtotalMinor != nil && *input.MinOrderSubtotalMinor <= 0 {
		return ErrPromotionInvalid
	}
	// Opt-in applies only to platform-authored campaigns; a Store promotion is
	// always scoped to its own Store and never needs Partner opt-in.
	if input.RequiresPartnerOptIn && strings.TrimSpace(input.StoreID) != "" {
		return ErrPromotionInvalid
	}
	if len(input.Targets) > 0 {
		seenTargets := map[string]struct{}{}
		for _, target := range input.Targets {
			target.Ref = strings.TrimSpace(target.Ref)
			if (target.Kind != "PRODUCT" && target.Kind != "CATEGORY") || target.Ref == "" || len(target.Ref) > 128 {
				return ErrPromotionInvalid
			}
			key := target.Kind + ":" + target.Ref
			if _, duplicate := seenTargets[key]; duplicate {
				return ErrPromotionInvalid
			}
			seenTargets[key] = struct{}{}
		}
	}
	if input.Kind == "PERCENTAGE" && input.ValueMinor > 100 {
		return ErrPromotionInvalid
	}
	if input.MaxDiscountMinor != nil && *input.MaxDiscountMinor <= 0 {
		return ErrPromotionInvalid
	}
	if input.RedemptionLimit != nil && *input.RedemptionLimit <= 0 {
		return ErrPromotionInvalid
	}
	if input.EndsAt != nil && !input.EndsAt.After(input.StartsAt) {
		return ErrPromotionInvalid
	}
	return nil
}

func scanPromotion(row rowScanner) (PromotionRecord, error) {
	var item PromotionRecord
	var maxDiscount, redemptionLimit, fundingShare, threshold sql.NullInt64
	var storeValue, cityValue sql.NullString
	var endValue sql.NullTime
	err := row.Scan(&item.ID, &item.Code, &item.NameAr, &item.DescriptionAr, &item.Kind, &item.ValueMinor, &maxDiscount, &item.FundingSource, &fundingShare, &storeValue, &cityValue, &item.State, &item.StartsAt, &endValue, &item.RequiresPartnerOptIn, &threshold, &redemptionLimit, &item.RedeemedCount, &item.Version, &item.CreatedByActorID, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return PromotionRecord{}, err
	}
	if maxDiscount.Valid {
		value := maxDiscount.Int64
		item.MaxDiscountMinor = &value
	}
	if fundingShare.Valid {
		share := int(fundingShare.Int64)
		item.FundingSharePartnerPercent = &share
	}
	if threshold.Valid {
		value := threshold.Int64
		item.MinOrderSubtotalMinor = &value
	}
	if storeValue.Valid {
		item.StoreID = storeValue.String
	}
	if cityValue.Valid {
		item.ServiceCityID = cityValue.String
	}
	if endValue.Valid {
		value := endValue.Time
		item.EndsAt = &value
	}
	if redemptionLimit.Valid {
		value := redemptionLimit.Int64
		item.RedemptionLimit = &value
	}
	return item, nil
}

const promotionSelect = `id,code,name_ar,description_ar,kind,value_minor,max_discount_minor,funding_source,funding_share_partner_percent,store_id,service_city_id,state,starts_at,ends_at,requires_partner_opt_in,min_order_subtotal_minor,redemption_limit,redeemed_count,version,created_by_actor_id,created_at,updated_at`

// listPublicPromotionsQuery must stay character-identical to promotionSelect for
// its column list; TestPublicPromotionsListingKeepsCanonicalColumns fails when
// the two drift apart.
const listPublicPromotionsQuery = `SELECT id,code,name_ar,description_ar,kind,value_minor,max_discount_minor,funding_source,funding_share_partner_percent,store_id,service_city_id,state,starts_at,ends_at,requires_partner_opt_in,min_order_subtotal_minor,redemption_limit,redeemed_count,version,created_by_actor_id,created_at,updated_at
        FROM dsh.commerce_promotions
        WHERE (NOT $1 OR (state='PUBLISHED' AND starts_at <= clock_timestamp() AND (ends_at IS NULL OR ends_at > clock_timestamp())))
        AND (NOT $1 OR service_city_id IS NULL OR service_city_id=$2)
        AND (NOT $1 OR store_id IS NULL OR ($3<>'' AND store_id=$3))
        AND (NOT $1 OR requires_partner_opt_in = false OR EXISTS (SELECT 1 FROM dsh.commerce_promotion_store_opt_ins o WHERE o.promotion_id=dsh.commerce_promotions.id AND o.store_id=$3 AND o.state='OPTED_IN'))
        ORDER BY starts_at DESC,id DESC
        LIMIT CASE WHEN $1 THEN 4 ELSE NULL END`

// ListStorePromotions returns every promotion scoped to one Store across its whole
// lifecycle (draft, published, paused, ended) for the owner's workspace views.
func ListStorePromotions(ctx context.Context, db *sql.DB, storeID string, limit int) ([]PromotionRecord, error) {
	storeID = strings.TrimSpace(storeID)
	if db == nil || storeID == "" || len(storeID) > 128 || limit < 1 || limit > 100 {
		return nil, ErrPromotionInvalid
	}
	rows, err := db.QueryContext(ctx, "SELECT "+promotionSelect+" FROM dsh.commerce_promotions WHERE store_id=$1 ORDER BY starts_at DESC, id DESC LIMIT $2", storeID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]PromotionRecord, 0)
	for rows.Next() {
		item, scanErr := scanPromotion(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func ReadPromotion(ctx context.Context, db *sql.DB, id string) (PromotionRecord, error) {
	item, err := scanPromotion(db.QueryRowContext(ctx, "SELECT "+promotionSelect+" FROM dsh.commerce_promotions WHERE id=$1", strings.TrimSpace(id)))
	if errors.Is(err, sql.ErrNoRows) {
		return PromotionRecord{}, ErrPromotionNotFound
	}
	return item, err
}

func ListPromotions(ctx context.Context, db *sql.DB, public bool, serviceCityID, storeID string) ([]PromotionRecord, error) {
	serviceCityID = strings.TrimSpace(serviceCityID)
	storeID = strings.TrimSpace(storeID)
	if public {
		if serviceCityID == "" {
			return nil, ErrPromotionInvalid
		}
	}
	rows, err := db.QueryContext(ctx, listPublicPromotionsQuery, public, serviceCityID, storeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]PromotionRecord, 0)
	for rows.Next() {
		item, scanErr := scanPromotion(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func CreatePromotion(ctx context.Context, db *sql.DB, input PromotionInput, idempotencyKey, requestHash string) (PromotionRecord, bool, error) {
	input = normalizePromotionInput(input)
	if err := validatePromotionInput(input); err != nil {
		return PromotionRecord{}, false, err
	}
	if strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" {
		return PromotionRecord{}, false, ErrPromotionInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PromotionRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:marketing:idempotency:"+idempotencyKey); err != nil {
		return PromotionRecord{}, false, err
	}
	var resourceID, storedHash string
	err = tx.QueryRowContext(ctx, "SELECT resource_id,request_hash FROM dsh.commerce_marketing_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&resourceID, &storedHash)
	if err == nil {
		if storedHash != requestHash {
			return PromotionRecord{}, false, ErrPromotionIdempotencyConflict
		}
		item, readErr := scanPromotion(tx.QueryRowContext(ctx, "SELECT "+promotionSelect+" FROM dsh.commerce_promotions WHERE id=$1", resourceID))
		if readErr != nil {
			return PromotionRecord{}, false, readErr
		}
		if commitErr := tx.Commit(); commitErr != nil {
			return PromotionRecord{}, false, commitErr
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PromotionRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_promotions(id,code,name_ar,description_ar,kind,value_minor,max_discount_minor,funding_source,funding_share_partner_percent,store_id,service_city_id,starts_at,ends_at,requires_partner_opt_in,min_order_subtotal_minor,redemption_limit,created_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,''),NULLIF($11,''),$12,$13,$14,$15,$16,$17)`, input.ID, input.Code, input.NameAr, input.DescriptionAr, input.Kind, input.ValueMinor, input.MaxDiscountMinor, input.FundingSource, input.FundingSharePartnerPercent, input.StoreID, input.ServiceCityID, input.StartsAt, input.EndsAt, input.RequiresPartnerOptIn, input.MinOrderSubtotalMinor, input.RedemptionLimit, input.CreatedByActorID); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "commerce_promotions_code_uq") {
			return PromotionRecord{}, false, ErrPromotionCodeConflict
		}
		return PromotionRecord{}, false, err
	}
	for _, target := range input.Targets {
		target.Ref = strings.TrimSpace(target.Ref)
		if (target.Kind != "PRODUCT" && target.Kind != "CATEGORY") || target.Ref == "" || len(target.Ref) > 128 {
			return PromotionRecord{}, false, ErrPromotionInvalid
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_promotion_targets(promotion_id,target_kind,target_ref) VALUES($1,$2,$3)", input.ID, target.Kind, target.Ref); err != nil {
			return PromotionRecord{}, false, err
		}
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_marketing_mutation_idempotency(idempotency_key,request_hash,resource_type,resource_id,operation) VALUES($1,$2,'PROMOTION',$3,'CREATE')", idempotencyKey, requestHash, input.ID); err != nil {
		return PromotionRecord{}, false, err
	}
	item, err := scanPromotion(tx.QueryRowContext(ctx, "SELECT "+promotionSelect+" FROM dsh.commerce_promotions WHERE id=$1", input.ID))
	if err != nil {
		return PromotionRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return PromotionRecord{}, false, err
	}
	return item, false, nil
}

func SetPromotionState(ctx context.Context, db *sql.DB, id, state, idempotencyKey, requestHash string, expectedVersion int) (PromotionRecord, bool, error) {
	state = strings.ToUpper(strings.TrimSpace(state))
	if state != "PUBLISHED" && state != "PAUSED" && state != "ENDED" || strings.TrimSpace(id) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" {
		return PromotionRecord{}, false, ErrPromotionInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PromotionRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:marketing:idempotency:"+idempotencyKey); err != nil {
		return PromotionRecord{}, false, err
	}
	var resourceID, storedHash string
	err = tx.QueryRowContext(ctx, "SELECT resource_id,request_hash FROM dsh.commerce_marketing_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&resourceID, &storedHash)
	if err == nil {
		if storedHash != requestHash || resourceID != strings.TrimSpace(id) {
			return PromotionRecord{}, false, ErrPromotionIdempotencyConflict
		}
		item, readErr := scanPromotion(tx.QueryRowContext(ctx, "SELECT "+promotionSelect+" FROM dsh.commerce_promotions WHERE id=$1", id))
		if readErr != nil {
			return PromotionRecord{}, false, readErr
		}
		if commitErr := tx.Commit(); commitErr != nil {
			return PromotionRecord{}, false, commitErr
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PromotionRecord{}, false, err
	}
	var stateGuard int
	if state == "PUBLISHED" {
		if err := tx.QueryRowContext(ctx, "SELECT 1 FROM dsh.commerce_promotions WHERE id=$1 AND state IN ('DRAFT','PAUSED')", id).Scan(&stateGuard); errors.Is(err, sql.ErrNoRows) {
			return PromotionRecord{}, false, ErrPromotionNotFound
		} else if err != nil {
			return PromotionRecord{}, false, err
		}
	}
	if state == "ENDED" {
		if err := tx.QueryRowContext(ctx, "SELECT 1 FROM dsh.commerce_promotions WHERE id=$1 AND state IN ('PUBLISHED','PAUSED','DRAFT')", id).Scan(&stateGuard); errors.Is(err, sql.ErrNoRows) {
			return PromotionRecord{}, false, ErrPromotionNotFound
		} else if err != nil {
			return PromotionRecord{}, false, err
		}
	}
	result, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_promotions SET state=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$3", id, state, expectedVersion)
	if err != nil {
		return PromotionRecord{}, false, err
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		return PromotionRecord{}, false, ErrPromotionVersionConflict
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_marketing_mutation_idempotency(idempotency_key,request_hash,resource_type,resource_id,operation) VALUES($1,$2,'PROMOTION',$3,'PUBLISH')", idempotencyKey, requestHash, id); err != nil {
		return PromotionRecord{}, false, err
	}
	item, err := scanPromotion(tx.QueryRowContext(ctx, "SELECT "+promotionSelect+" FROM dsh.commerce_promotions WHERE id=$1", id))
	if err != nil {
		return PromotionRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return PromotionRecord{}, false, err
	}
	return item, false, nil
}

// PromotionEvalLine carries the per-line facts promotion targeting evaluates
// against: only eligible targeted lines are discounted.
type PromotionEvalLine struct {
	ProductID   string
	AmountMinor int64
}

// EvaluatePromotion is the server-owned promotion evaluation. It revalidates
// state/time, Store/city scope, campaign opt-in, order threshold, product and
// category targeting, and usage limits; every failure is fail-closed.
func EvaluatePromotion(ctx context.Context, source rowQueryer, code, storeID, storeServiceCityID, clientActorID string, subtotalMinor int64, lines []PromotionEvalLine, lock bool) (PromotionRecord, int64, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	storeID = strings.TrimSpace(storeID)
	storeServiceCityID = strings.TrimSpace(storeServiceCityID)
	clientActorID = strings.TrimSpace(clientActorID)
	if code == "" || storeID == "" || clientActorID == "" || subtotalMinor <= 0 {
		return PromotionRecord{}, 0, ErrPromotionUnavailable
	}
	query := "SELECT " + promotionSelect + " FROM dsh.commerce_promotions WHERE code=$1"
	if lock {
		query += " FOR UPDATE"
	}
	item, err := scanPromotion(source.QueryRowContext(ctx, query, code))
	if errors.Is(err, sql.ErrNoRows) {
		return PromotionRecord{}, 0, ErrPromotionUnavailable
	}
	if err != nil {
		return PromotionRecord{}, 0, err
	}
	now := time.Now().UTC()
	if item.State != "PUBLISHED" || now.Before(item.StartsAt) || item.EndsAt != nil && !now.Before(*item.EndsAt) || item.StoreID != "" && item.StoreID != storeID || item.ServiceCityID != "" && item.ServiceCityID != storeServiceCityID {
		return PromotionRecord{}, 0, ErrPromotionUnavailable
	}
	// A platform campaign applies to a Store only when the Store opted in where
	// opt-in is required.
	if item.StoreID == "" && item.RequiresPartnerOptIn {
		var opted bool
		if err := source.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM dsh.commerce_promotion_store_opt_ins WHERE promotion_id=$1 AND store_id=$2 AND state='OPTED_IN')", item.ID, storeID).Scan(&opted); err != nil {
			return PromotionRecord{}, 0, err
		}
		if !opted {
			return PromotionRecord{}, 0, ErrPromotionUnavailable
		}
	}
	if item.MinOrderSubtotalMinor != nil && subtotalMinor < *item.MinOrderSubtotalMinor {
		return PromotionRecord{}, 0, ErrPromotionUnavailable
	}
	if item.RedemptionLimit != nil && item.RedeemedCount >= *item.RedemptionLimit {
		return PromotionRecord{}, 0, ErrPromotionLimitReached
	}
	var used bool
	if err := source.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM dsh.commerce_promotion_redemptions WHERE promotion_id=$1 AND client_actor_id=$2)", item.ID, clientActorID).Scan(&used); err != nil {
		return PromotionRecord{}, 0, err
	}
	if used {
		return PromotionRecord{}, 0, ErrPromotionAlreadyRedeemed
	}
	// Targeted promotions discount only the eligible line amounts; the base
	// scope never widens to lines outside the declared product/category set.
	discountBase := subtotalMinor
	targetRows, err := source.QueryContext(ctx, "SELECT target_kind,target_ref FROM dsh.commerce_promotion_targets WHERE promotion_id=$1", item.ID)
	if err != nil {
		return PromotionRecord{}, 0, err
	}
	type promotionTarget struct{ kind, ref string }
	targets := make([]promotionTarget, 0, 2)
	for targetRows.Next() {
		var target promotionTarget
		if err := targetRows.Scan(&target.kind, &target.ref); err != nil {
			targetRows.Close()
			return PromotionRecord{}, 0, err
		}
		targets = append(targets, target)
	}
	targetRowsErr := targetRows.Err()
	targetRows.Close()
	if targetRowsErr != nil {
		return PromotionRecord{}, 0, targetRowsErr
	}
	if len(targets) > 0 {
		productRefs := make([]string, 0, len(targets))
		categoryRefs := make([]string, 0, len(targets))
		for _, target := range targets {
			if target.kind == "PRODUCT" {
				productRefs = append(productRefs, target.ref)
			} else {
				categoryRefs = append(categoryRefs, target.ref)
			}
		}
		matched := map[string]struct{}{}
		for _, line := range lines {
			for _, ref := range productRefs {
				if line.ProductID == ref {
					matched[line.ProductID] = struct{}{}
				}
			}
		}
		if len(categoryRefs) > 0 && len(lines) > 0 {
			lineProducts := make([]string, 0, len(lines))
			for _, line := range lines {
				lineProducts = append(lineProducts, line.ProductID)
			}
			categoryRows, err := source.QueryContext(ctx, "SELECT DISTINCT product_id FROM dsh.catalog_product_categories WHERE category_id = ANY($1) AND product_id = ANY($2)", categoryRefs, lineProducts)
			if err != nil {
				return PromotionRecord{}, 0, err
			}
			for categoryRows.Next() {
				var productID string
				if err := categoryRows.Scan(&productID); err != nil {
					categoryRows.Close()
					return PromotionRecord{}, 0, err
				}
				matched[productID] = struct{}{}
			}
			categoryRowsErr := categoryRows.Err()
			categoryRows.Close()
			if categoryRowsErr != nil {
				return PromotionRecord{}, 0, categoryRowsErr
			}
		}
		discountBase = 0
		for _, line := range lines {
			if _, ok := matched[line.ProductID]; ok {
				discountBase += line.AmountMinor
			}
		}
		if discountBase <= 0 {
			return PromotionRecord{}, 0, ErrPromotionUnavailable
		}
	}
	discount := item.ValueMinor
	if item.Kind == "PERCENTAGE" {
		value := new(big.Int).Mul(big.NewInt(discountBase), big.NewInt(item.ValueMinor))
		discount = new(big.Int).Quo(value, big.NewInt(100)).Int64()
	}
	if item.MaxDiscountMinor != nil && discount > *item.MaxDiscountMinor {
		discount = *item.MaxDiscountMinor
	}
	if discount > discountBase {
		discount = discountBase
	}
	if discount >= subtotalMinor {
		discount = subtotalMinor - 1
	}
	if discount <= 0 {
		return PromotionRecord{}, 0, ErrPromotionUnavailable
	}
	return item, discount, nil
}

func RedeemPromotion(ctx context.Context, tx *sql.Tx, promotion PromotionRecord, clientActorID, orderID string, discountMinor int64) error {
	if promotion.ID == "" || strings.TrimSpace(clientActorID) == "" || strings.TrimSpace(orderID) == "" || discountMinor <= 0 {
		return ErrPromotionUnavailable
	}
	result, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_promotions SET redeemed_count=redeemed_count+1,updated_at=clock_timestamp() WHERE id=$1 AND (redemption_limit IS NULL OR redeemed_count < redemption_limit)", promotion.ID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil || count != 1 {
		return ErrPromotionLimitReached
	}
	redemptionID, err := newID("promotion-redemption")
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_promotion_redemptions(id,promotion_id,client_actor_id,order_id,code,discount_minor) VALUES($1,$2,$3,$4,$5,$6)", redemptionID, promotion.ID, clientActorID, orderID, promotion.Code, discountMinor); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "promotion_redemptions_client_promotion_uq") {
			return ErrPromotionAlreadyRedeemed
		}
		return err
	}
	return nil
}

func releaseOrderPromotionRedemptionTx(ctx context.Context, tx *sql.Tx, orderID, promotionID string) error {
	if strings.TrimSpace(orderID) == "" || strings.TrimSpace(promotionID) == "" {
		return nil
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM dsh.commerce_promotion_redemptions WHERE order_id=$1 AND promotion_id=$2", orderID, promotionID); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_promotions SET redeemed_count=redeemed_count-1,updated_at=clock_timestamp() WHERE id=$1 AND redeemed_count>0", promotionID)
	return err
}

func scanDiscoveryContent(row rowScanner) (DiscoveryContentRecord, error) {
	var item DiscoveryContentRecord
	var targetID, cityID sql.NullString
	var endsAt sql.NullTime
	err := row.Scan(&item.ID, &item.Kind, &item.TitleAr, &item.BodyAr, &item.MediaURI, &item.TargetType, &targetID, &cityID, &item.State, &item.StartsAt, &endsAt, &item.Ordinal, &item.Version, &item.CreatedByActorID, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return DiscoveryContentRecord{}, err
	}
	if targetID.Valid {
		item.TargetID = targetID.String
	}
	if cityID.Valid {
		item.ServiceCityID = cityID.String
	}
	if endsAt.Valid {
		value := endsAt.Time
		item.EndsAt = &value
	}
	return item, nil
}

const discoveryContentSelect = `content.id,content.kind,content.title_ar,content.body_ar,COALESCE((SELECT asset.uri FROM dsh.discovery_content_media_assets asset WHERE asset.id=content.media_asset_id AND asset.state='active' AND asset.rights_attested_at IS NOT NULL),''),content.target_type,content.target_id,content.service_city_id,content.state,content.starts_at,content.ends_at,content.ordinal,content.version,content.created_by_actor_id,content.created_at,content.updated_at`

func CreateDiscoveryContent(ctx context.Context, db *sql.DB, input DiscoveryContentInput, idempotencyKey, requestHash string) (DiscoveryContentRecord, bool, error) {
	input.ID = strings.TrimSpace(input.ID)
	input.Kind = strings.ToUpper(strings.TrimSpace(input.Kind))
	input.TitleAr = strings.TrimSpace(input.TitleAr)
	input.BodyAr = strings.TrimSpace(input.BodyAr)
	input.MediaAssetID = strings.TrimSpace(input.MediaAssetID)
	input.TargetType = strings.ToUpper(strings.TrimSpace(input.TargetType))
	input.TargetID = strings.TrimSpace(input.TargetID)
	input.ServiceCityID = strings.TrimSpace(input.ServiceCityID)
	input.CreatedByActorID = strings.TrimSpace(input.CreatedByActorID)
	if input.ID == "" || input.TitleAr == "" || len(input.TitleAr) > 160 || input.MediaAssetID == "" || input.StartsAt.IsZero() || input.Ordinal < 0 || (input.TargetType == "INFO" && input.TargetID != "") || (input.TargetType != "INFO" && input.TargetID == "") || (input.Kind != "BANNER" && input.Kind != "CAROUSEL" && input.Kind != "SHORT_FORM") || (input.TargetType != "STORE" && input.TargetType != "PRODUCT" && input.TargetType != "CATEGORY" && input.TargetType != "PROMOTION" && input.TargetType != "INFO") || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" {
		return DiscoveryContentRecord{}, false, ErrDiscoveryContentInvalid
	}
	if input.EndsAt != nil && !input.EndsAt.After(input.StartsAt) {
		return DiscoveryContentRecord{}, false, ErrDiscoveryContentInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:marketing:idempotency:"+idempotencyKey); err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	var resourceID, storedHash string
	err = tx.QueryRowContext(ctx, "SELECT resource_id,request_hash FROM dsh.commerce_marketing_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&resourceID, &storedHash)
	if err == nil {
		if storedHash != requestHash || resourceID != input.ID {
			return DiscoveryContentRecord{}, false, ErrDiscoveryContentIdempotency
		}
		item, readErr := scanDiscoveryContent(tx.QueryRowContext(ctx, "SELECT "+discoveryContentSelect+" FROM dsh.discovery_content content WHERE id=$1", input.ID))
		if readErr != nil {
			return DiscoveryContentRecord{}, false, readErr
		}
		if commitErr := tx.Commit(); commitErr != nil {
			return DiscoveryContentRecord{}, false, commitErr
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return DiscoveryContentRecord{}, false, err
	}
	var mediaState string
	if err := tx.QueryRowContext(ctx, `SELECT state FROM dsh.discovery_content_media_assets WHERE id=$1 AND idempotency_key=$2 AND request_hash=$3 FOR UPDATE`, input.MediaAssetID, idempotencyKey, requestHash).Scan(&mediaState); err != nil || mediaState != "pending" {
		return DiscoveryContentRecord{}, false, ErrDiscoveryContentInvalid
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.discovery_content(id,kind,title_ar,body_ar,media_asset_id,target_type,target_id,service_city_id,starts_at,ends_at,ordinal,created_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,''),NULLIF($8,''),$9,$10,$11,$12)`, input.ID, input.Kind, input.TitleAr, input.BodyAr, input.MediaAssetID, input.TargetType, input.TargetID, input.ServiceCityID, input.StartsAt, input.EndsAt, input.Ordinal, input.CreatedByActorID); err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	if result, err := tx.ExecContext(ctx, `UPDATE dsh.discovery_content_media_assets SET state='active',last_cleanup_error=NULL WHERE id=$1 AND state='pending'`, input.MediaAssetID); err != nil {
		return DiscoveryContentRecord{}, false, err
	} else if affected, affectedErr := result.RowsAffected(); affectedErr != nil || affected != 1 {
		return DiscoveryContentRecord{}, false, ErrDiscoveryContentInvalid
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_marketing_mutation_idempotency(idempotency_key,request_hash,resource_type,resource_id,operation) VALUES($1,$2,'DISCOVERY_CONTENT',$3,'CREATE')", idempotencyKey, requestHash, input.ID); err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	item, err := scanDiscoveryContent(tx.QueryRowContext(ctx, "SELECT "+discoveryContentSelect+" FROM dsh.discovery_content content WHERE id=$1", input.ID))
	if err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	return item, false, nil
}

func ReadDiscoveryContent(ctx context.Context, db *sql.DB, id string) (DiscoveryContentRecord, error) {
	item, err := scanDiscoveryContent(db.QueryRowContext(ctx, "SELECT "+discoveryContentSelect+" FROM dsh.discovery_content content WHERE id=$1", strings.TrimSpace(id)))
	if errors.Is(err, sql.ErrNoRows) {
		return DiscoveryContentRecord{}, ErrDiscoveryContentNotFound
	}
	return item, err
}

func ListDiscoveryContent(ctx context.Context, db *sql.DB, public bool, serviceCityID string) ([]DiscoveryContentRecord, error) {
	where := "1=1"
	args := []any{}
	query := "SELECT " + discoveryContentSelect + " FROM dsh.discovery_content content WHERE " + where + " ORDER BY ordinal ASC,starts_at DESC,id DESC"
	if public {
		serviceCityID = strings.TrimSpace(serviceCityID)
		if serviceCityID == "" {
			return nil, ErrDiscoveryContentInvalid
		}
		args = append(args, serviceCityID)
		query = `WITH eligible AS (
                        SELECT content.id,
                               content.kind IN ('BANNER','CAROUSEL') AS media_group,
                               row_number() OVER (
                                       PARTITION BY content.kind IN ('BANNER','CAROUSEL')
                                       ORDER BY content.ordinal ASC,content.starts_at DESC,content.id DESC
                               ) AS priority_rank
                        FROM dsh.discovery_content content
                        WHERE content.state='PUBLISHED'
                          AND content.starts_at <= statement_timestamp()
                          AND (content.ends_at IS NULL OR content.ends_at > statement_timestamp())
                          AND (content.service_city_id IS NULL OR content.service_city_id=$1)
                          AND ` + discoveryContentTargetEligibilityPredicate("content", "$1", "statement_timestamp()") + `
                )
                SELECT ` + discoveryContentSelect + `
                FROM dsh.discovery_content content
                JOIN eligible ON eligible.id=content.id
                WHERE (eligible.media_group AND eligible.priority_rank<=8)
                   OR (NOT eligible.media_group AND eligible.priority_rank<=4)
                ORDER BY content.ordinal ASC,content.starts_at DESC,content.id DESC`
	}
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]DiscoveryContentRecord, 0)
	for rows.Next() {
		item, scanErr := scanDiscoveryContent(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	return items, nil
}
func SetDiscoveryContentState(ctx context.Context, db *sql.DB, id, state, idempotencyKey, requestHash string, expectedVersion int) (DiscoveryContentRecord, bool, error) {
	state = strings.ToUpper(strings.TrimSpace(state))
	if (state != "PUBLISHED" && state != "PAUSED") || strings.TrimSpace(id) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" {
		return DiscoveryContentRecord{}, false, ErrDiscoveryContentInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	var resourceID, storedHash string
	err = tx.QueryRowContext(ctx, "SELECT resource_id,request_hash FROM dsh.commerce_marketing_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&resourceID, &storedHash)
	if err == nil {
		if storedHash != requestHash || resourceID != id {
			return DiscoveryContentRecord{}, false, ErrDiscoveryContentIdempotency
		}
		item, readErr := scanDiscoveryContent(tx.QueryRowContext(ctx, "SELECT "+discoveryContentSelect+" FROM dsh.discovery_content content WHERE id=$1", id))
		if readErr != nil {
			return DiscoveryContentRecord{}, false, readErr
		}
		if commitErr := tx.Commit(); commitErr != nil {
			return DiscoveryContentRecord{}, false, commitErr
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return DiscoveryContentRecord{}, false, err
	}
	if state == "PUBLISHED" {
		if err := validateDiscoveryContentPublication(ctx, tx, id); err != nil {
			return DiscoveryContentRecord{}, false, err
		}
	}
	result, err := tx.ExecContext(ctx, "UPDATE dsh.discovery_content SET state=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$3", id, state, expectedVersion)
	if err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		return DiscoveryContentRecord{}, false, ErrDiscoveryContentVersion
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_marketing_mutation_idempotency(idempotency_key,request_hash,resource_type,resource_id,operation) VALUES($1,$2,'DISCOVERY_CONTENT',$3,'PUBLISH')", idempotencyKey, requestHash, id); err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	item, err := scanDiscoveryContent(tx.QueryRowContext(ctx, "SELECT "+discoveryContentSelect+" FROM dsh.discovery_content content WHERE id=$1", id))
	if err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	return item, false, nil
}

func validateDiscoveryContentPublication(ctx context.Context, tx *sql.Tx, id string) error {
	var targetType, targetID, contentCityID string
	var startsAt time.Time
	if err := tx.QueryRowContext(ctx, "SELECT target_type,COALESCE(target_id,''),COALESCE(service_city_id,''),starts_at FROM dsh.discovery_content content WHERE id=$1", id).Scan(&targetType, &targetID, &contentCityID, &startsAt); errors.Is(err, sql.ErrNoRows) {
		return ErrDiscoveryContentNotFound
	} else if err != nil {
		return err
	}
	eligibleAt := time.Now().UTC()
	if startsAt.After(eligibleAt) {
		eligibleAt = startsAt
	}
	if _, err := resolveDiscoveryContentTarget(ctx, tx, targetType, targetID, contentCityID, eligibleAt); err != nil {
		if errors.Is(err, ErrDiscoveryContentNotFound) || errors.Is(err, ErrDiscoveryContentTargetInvalid) {
			return ErrDiscoveryContentTargetInvalid
		}
		return err
	}
	return nil
}

func itoa(value int) string {
	return strconv.Itoa(value)
}

// PartnerCampaignRecord is a platform campaign with the opt-in state of one
// Partner Store, for the eligible-campaign partner readback.
type PartnerCampaignRecord struct {
	PromotionRecord
	StoreOptInState   string // "" = never decided, OPTED_IN, DECLINED
	StoreOptInVersion int
}

// ListPartnerEligibleCampaigns returns published platform campaigns eligible
// for the Store (city or platform scope) with the Store's opt-in state.
func ListPartnerEligibleCampaigns(ctx context.Context, db *sql.DB, storeID string) ([]PartnerCampaignRecord, error) {
	storeID = strings.TrimSpace(storeID)
	if db == nil || storeID == "" || len(storeID) > 128 {
		return nil, ErrPromotionInvalid
	}
	var storeCityID string
	if err := db.QueryRowContext(ctx, "SELECT COALESCE(service_city_id,'') FROM dsh.stores WHERE id=$1", storeID).Scan(&storeCityID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrPromotionNotFound
		}
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT `+promotionSelect+`,
                COALESCE((SELECT state FROM dsh.commerce_promotion_store_opt_ins o WHERE o.promotion_id=p.id AND o.store_id=$1), ''),
                COALESCE((SELECT version FROM dsh.commerce_promotion_store_opt_ins o WHERE o.promotion_id=p.id AND o.store_id=$1), 0)
                FROM dsh.commerce_promotions p
                WHERE p.state='PUBLISHED' AND p.store_id IS NULL AND p.starts_at <= clock_timestamp() AND (p.ends_at IS NULL OR p.ends_at > clock_timestamp())
                AND (p.service_city_id IS NULL OR p.service_city_id=$2)
                ORDER BY p.starts_at DESC, p.id DESC`, storeID, storeCityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]PartnerCampaignRecord, 0, 4)
	for rows.Next() {
		var record PartnerCampaignRecord
		var maxDiscount, threshold sql.NullInt64
		var storeValue, cityValue, optInState sql.NullString
		var optInVersion sql.NullInt64
		var endValue sql.NullTime
		var fundingShare sql.NullInt64
		if err := rows.Scan(&record.ID, &record.Code, &record.NameAr, &record.DescriptionAr, &record.Kind, &record.ValueMinor, &maxDiscount, &record.FundingSource, &fundingShare, &storeValue, &cityValue, &record.State, &record.StartsAt, &endValue, &record.RequiresPartnerOptIn, &threshold, &record.RedemptionLimit, &record.RedeemedCount, &record.Version, &record.CreatedByActorID, &record.CreatedAt, &record.UpdatedAt, &optInState, &optInVersion); err != nil {
			return nil, err
		}
		if optInVersion.Valid {
			record.StoreOptInVersion = int(optInVersion.Int64)
		}
		if maxDiscount.Valid {
			value := maxDiscount.Int64
			record.MaxDiscountMinor = &value
		}
		if threshold.Valid {
			value := threshold.Int64
			record.MinOrderSubtotalMinor = &value
		}
		if endValue.Valid {
			value := endValue.Time
			record.EndsAt = &value
		}
		record.StoreOptInState = optInState.String
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

// SetPartnerCampaignOptIn records the Store owner's or authorized delegate's
// opt-in decision for a platform campaign, versioned and idempotent.
func SetPartnerCampaignOptIn(ctx context.Context, db *sql.DB, promotionID, storeID, actorID, state string, expectedVersion int, idempotencyKey, correlationID string) (PartnerCampaignRecord, bool, error) {
	promotionID, storeID, actorID, state = strings.TrimSpace(promotionID), strings.TrimSpace(storeID), strings.TrimSpace(actorID), strings.ToUpper(strings.TrimSpace(state))
	if db == nil || promotionID == "" || storeID == "" || actorID == "" || (state != "OPTED_IN" && state != "DECLINED") || expectedVersion < 1 {
		return PartnerCampaignRecord{}, false, ErrPromotionInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return PartnerCampaignRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:marketing:optin:"+promotionID+":"+storeID); err != nil {
		return PartnerCampaignRecord{}, false, err
	}
	var currentVersion int
	var currentState string
	err = tx.QueryRowContext(ctx, "SELECT version,state FROM dsh.commerce_promotion_store_opt_ins WHERE promotion_id=$1 AND store_id=$2 FOR UPDATE", promotionID, storeID).Scan(&currentVersion, &currentState)
	replayed := err == nil && currentVersion == expectedVersion && currentState == state
	if errors.Is(err, sql.ErrNoRows) {
		if expectedVersion != 1 {
			return PartnerCampaignRecord{}, false, ErrPromotionVersionConflict
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_promotion_store_opt_ins(promotion_id,store_id,actor_id,state,version) VALUES($1,$2,$3,$4,1)", promotionID, storeID, actorID, state); err != nil {
			return PartnerCampaignRecord{}, false, err
		}
	} else if err != nil {
		return PartnerCampaignRecord{}, false, err
	} else if !replayed {
		if currentVersion != expectedVersion {
			return PartnerCampaignRecord{}, false, ErrPromotionVersionConflict
		}
		if _, err := tx.ExecContext(ctx, "UPDATE dsh.commerce_promotion_store_opt_ins SET state=$3,actor_id=$4,version=version+1,updated_at=clock_timestamp() WHERE promotion_id=$1 AND store_id=$2", promotionID, storeID, state, actorID); err != nil {
			return PartnerCampaignRecord{}, false, err
		}
	}
	var record PartnerCampaignRecord
	var maxDiscount, threshold sql.NullInt64
	var storeValue, cityValue, optInState sql.NullString
	var endValue sql.NullTime
	var fundingShare sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT `+promotionSelect+`,
                COALESCE((SELECT o.state FROM dsh.commerce_promotion_store_opt_ins o WHERE o.promotion_id=p.id AND o.store_id=$2), '')
                FROM dsh.commerce_promotions p WHERE p.id=$1 AND p.store_id IS NULL AND p.state='PUBLISHED'`, promotionID, storeID).Scan(
		&record.ID, &record.Code, &record.NameAr, &record.DescriptionAr, &record.Kind, &record.ValueMinor, &maxDiscount, &record.FundingSource, &fundingShare, &storeValue, &cityValue, &record.State, &record.StartsAt, &endValue, &record.RequiresPartnerOptIn, &threshold, &record.RedemptionLimit, &record.RedeemedCount, &record.Version, &record.CreatedByActorID, &record.CreatedAt, &record.UpdatedAt, &optInState); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return PartnerCampaignRecord{}, false, ErrPromotionNotFound
		}
		return PartnerCampaignRecord{}, false, err
	}
	if maxDiscount.Valid {
		value := maxDiscount.Int64
		record.MaxDiscountMinor = &value
	}
	if threshold.Valid {
		value := threshold.Int64
		record.MinOrderSubtotalMinor = &value
	}
	if endValue.Valid {
		value := endValue.Time
		record.EndsAt = &value
	}
	record.StoreOptInState = optInState.String
	if err := tx.QueryRowContext(ctx, "SELECT version FROM dsh.commerce_promotion_store_opt_ins WHERE promotion_id=$1 AND store_id=$2", promotionID, storeID).Scan(&record.StoreOptInVersion); err != nil {
		return PartnerCampaignRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return PartnerCampaignRecord{}, false, err
	}
	return record, replayed, nil
}
