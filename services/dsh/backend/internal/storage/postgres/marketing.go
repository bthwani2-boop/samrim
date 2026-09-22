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
	ID               string
	Code             string
	NameAr           string
	DescriptionAr    string
	Kind             string
	ValueMinor       int64
	MaxDiscountMinor *int64
	FundingSource    string
	StoreID          string
	ServiceCityID    string
	State            string
	StartsAt         time.Time
	EndsAt           *time.Time
	RedemptionLimit  *int64
	RedeemedCount    int64
	Version          int
	CreatedByActorID string
	CreatedAt        time.Time
	UpdatedAt        time.Time
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
	ID               string
	Code             string
	NameAr           string
	DescriptionAr    string
	Kind             string
	ValueMinor       int64
	MaxDiscountMinor *int64
	FundingSource    string
	StoreID          string
	ServiceCityID    string
	StartsAt         time.Time
	EndsAt           *time.Time
	RedemptionLimit  *int64
	CreatedByActorID string
}

type DiscoveryContentInput struct {
	ID               string
	Kind             string
	TitleAr          string
	BodyAr           string
	MediaURI         string
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
	if input.ID == "" || input.Code == "" || len(input.Code) < 3 || len(input.Code) > 64 || input.NameAr == "" || len(input.NameAr) > 160 || input.StartsAt.IsZero() || input.ValueMinor <= 0 || input.FundingSource != "MERCHANT" {
		return ErrPromotionInvalid
	}
	if input.Kind != "PERCENTAGE" && input.Kind != "FIXED" {
		return ErrPromotionInvalid
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
	var maxDiscount, redemptionLimit sql.NullInt64
	var storeValue, cityValue sql.NullString
	var endValue sql.NullTime
	err := row.Scan(&item.ID, &item.Code, &item.NameAr, &item.DescriptionAr, &item.Kind, &item.ValueMinor, &maxDiscount, &item.FundingSource, &storeValue, &cityValue, &item.State, &item.StartsAt, &endValue, &redemptionLimit, &item.RedeemedCount, &item.Version, &item.CreatedByActorID, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return PromotionRecord{}, err
	}
	if maxDiscount.Valid {
		value := maxDiscount.Int64
		item.MaxDiscountMinor = &value
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

const promotionSelect = `id,code,name_ar,description_ar,kind,value_minor,max_discount_minor,funding_source,store_id,service_city_id,state,starts_at,ends_at,redemption_limit,redeemed_count,version,created_by_actor_id,created_at,updated_at`

func ReadPromotion(ctx context.Context, db *sql.DB, id string) (PromotionRecord, error) {
	item, err := scanPromotion(db.QueryRowContext(ctx, "SELECT "+promotionSelect+" FROM dsh.commerce_promotions WHERE id=$1", strings.TrimSpace(id)))
	if errors.Is(err, sql.ErrNoRows) {
		return PromotionRecord{}, ErrPromotionNotFound
	}
	return item, err
}

func ListPromotions(ctx context.Context, db *sql.DB, public bool, serviceCityID, storeID string) ([]PromotionRecord, error) {
	args := []any{}
	where := "1=1"
	if public {
		where += " AND state='PUBLISHED' AND starts_at <= clock_timestamp() AND (ends_at IS NULL OR ends_at > clock_timestamp())"
		if strings.TrimSpace(serviceCityID) == "" {
			return nil, ErrPromotionInvalid
		}
		args = append(args, strings.TrimSpace(serviceCityID))
		where += " AND (service_city_id IS NULL OR service_city_id=$" + itoa(len(args)) + ")"
		if strings.TrimSpace(storeID) != "" {
			args = append(args, strings.TrimSpace(storeID))
			where += " AND (store_id IS NULL OR store_id=$" + itoa(len(args)) + ")"
		}
	}
	rows, err := db.QueryContext(ctx, "SELECT "+promotionSelect+" FROM dsh.commerce_promotions WHERE "+where+" ORDER BY starts_at DESC,id DESC", args...)
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
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.commerce_promotions(id,code,name_ar,description_ar,kind,value_minor,max_discount_minor,funding_source,store_id,service_city_id,starts_at,ends_at,redemption_limit,created_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,''),NULLIF($10,''),$11,$12,$13,$14)`, input.ID, input.Code, input.NameAr, input.DescriptionAr, input.Kind, input.ValueMinor, input.MaxDiscountMinor, input.FundingSource, input.StoreID, input.ServiceCityID, input.StartsAt, input.EndsAt, input.RedemptionLimit, input.CreatedByActorID); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "commerce_promotions_code_uq") {
			return PromotionRecord{}, false, ErrPromotionCodeConflict
		}
		return PromotionRecord{}, false, err
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
	if state != "PUBLISHED" && state != "PAUSED" || strings.TrimSpace(id) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" {
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
	if state == "PUBLISHED" {
		var startsAt time.Time
		if err := tx.QueryRowContext(ctx, "SELECT starts_at FROM dsh.commerce_promotions WHERE id=$1 AND state IN ('DRAFT','PAUSED')", id).Scan(&startsAt); errors.Is(err, sql.ErrNoRows) {
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

func EvaluatePromotion(ctx context.Context, source rowQueryer, code, storeID, clientActorID string, subtotalMinor int64, lock bool) (PromotionRecord, int64, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	storeID = strings.TrimSpace(storeID)
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
	if item.State != "PUBLISHED" || now.Before(item.StartsAt) || item.EndsAt != nil && !now.Before(*item.EndsAt) || item.StoreID != "" && item.StoreID != storeID {
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
	discount := item.ValueMinor
	if item.Kind == "PERCENTAGE" {
		value := new(big.Int).Mul(big.NewInt(subtotalMinor), big.NewInt(item.ValueMinor))
		discount = new(big.Int).Quo(value, big.NewInt(100)).Int64()
	}
	if item.MaxDiscountMinor != nil && discount > *item.MaxDiscountMinor {
		discount = *item.MaxDiscountMinor
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

const discoveryContentSelect = `id,kind,title_ar,body_ar,media_uri,target_type,target_id,service_city_id,state,starts_at,ends_at,ordinal,version,created_by_actor_id,created_at,updated_at`

func CreateDiscoveryContent(ctx context.Context, db *sql.DB, input DiscoveryContentInput, idempotencyKey, requestHash string) (DiscoveryContentRecord, bool, error) {
	input.ID = strings.TrimSpace(input.ID)
	input.Kind = strings.ToUpper(strings.TrimSpace(input.Kind))
	input.TitleAr = strings.TrimSpace(input.TitleAr)
	input.BodyAr = strings.TrimSpace(input.BodyAr)
	input.MediaURI = strings.TrimSpace(input.MediaURI)
	input.TargetType = strings.ToUpper(strings.TrimSpace(input.TargetType))
	input.TargetID = strings.TrimSpace(input.TargetID)
	input.ServiceCityID = strings.TrimSpace(input.ServiceCityID)
	input.CreatedByActorID = strings.TrimSpace(input.CreatedByActorID)
	if input.ID == "" || input.TitleAr == "" || len(input.TitleAr) > 160 || input.StartsAt.IsZero() || input.Ordinal < 0 || (input.TargetType == "INFO" && input.TargetID != "") || (input.TargetType != "INFO" && input.TargetID == "") || (input.Kind != "BANNER" && input.Kind != "CAROUSEL" && input.Kind != "SHORT_FORM") || (input.TargetType != "STORE" && input.TargetType != "PRODUCT" && input.TargetType != "CATEGORY" && input.TargetType != "PROMOTION" && input.TargetType != "INFO") || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" {
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
		item, readErr := scanDiscoveryContent(tx.QueryRowContext(ctx, "SELECT "+discoveryContentSelect+" FROM dsh.discovery_content WHERE id=$1", input.ID))
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
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.discovery_content(id,kind,title_ar,body_ar,media_uri,target_type,target_id,service_city_id,starts_at,ends_at,ordinal,created_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,''),NULLIF($8,''),$9,$10,$11,$12)`, input.ID, input.Kind, input.TitleAr, input.BodyAr, input.MediaURI, input.TargetType, input.TargetID, input.ServiceCityID, input.StartsAt, input.EndsAt, input.Ordinal, input.CreatedByActorID); err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.commerce_marketing_mutation_idempotency(idempotency_key,request_hash,resource_type,resource_id,operation) VALUES($1,$2,'DISCOVERY_CONTENT',$3,'CREATE')", idempotencyKey, requestHash, input.ID); err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	item, err := scanDiscoveryContent(tx.QueryRowContext(ctx, "SELECT "+discoveryContentSelect+" FROM dsh.discovery_content WHERE id=$1", input.ID))
	if err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	return item, false, nil
}

func ReadDiscoveryContent(ctx context.Context, db *sql.DB, id string) (DiscoveryContentRecord, error) {
	item, err := scanDiscoveryContent(db.QueryRowContext(ctx, "SELECT "+discoveryContentSelect+" FROM dsh.discovery_content WHERE id=$1", strings.TrimSpace(id)))
	if errors.Is(err, sql.ErrNoRows) {
		return DiscoveryContentRecord{}, ErrDiscoveryContentNotFound
	}
	return item, err
}

func ListDiscoveryContent(ctx context.Context, db *sql.DB, public bool, serviceCityID string) ([]DiscoveryContentRecord, error) {
	where := "1=1"
	args := []any{}
	if public {
		if strings.TrimSpace(serviceCityID) == "" {
			return nil, ErrDiscoveryContentInvalid
		}
		args = append(args, strings.TrimSpace(serviceCityID))
		where += " AND state='PUBLISHED' AND starts_at <= clock_timestamp() AND (ends_at IS NULL OR ends_at > clock_timestamp()) AND (service_city_id IS NULL OR service_city_id=$1)"
		where += ` AND (
            target_type='INFO'
            OR (target_type='STORE' AND EXISTS (SELECT 1 FROM dsh.stores s WHERE s.id=discovery_content.target_id AND s.publication_state='published' AND s.service_city_id=$1))
            OR (target_type='PRODUCT' AND EXISTS (SELECT 1 FROM dsh.catalog_products p WHERE p.id=discovery_content.target_id AND p.active=true))
            OR (target_type='CATEGORY' AND EXISTS (SELECT 1 FROM dsh.catalog_categories c WHERE c.id=discovery_content.target_id AND c.active=true))
            OR (target_type='PROMOTION' AND EXISTS (SELECT 1 FROM dsh.commerce_promotions p WHERE p.id=discovery_content.target_id AND p.state='PUBLISHED' AND p.starts_at <= clock_timestamp() AND (p.ends_at IS NULL OR p.ends_at > clock_timestamp())))
        )`
	}
	rows, err := db.QueryContext(ctx, "SELECT "+discoveryContentSelect+" FROM dsh.discovery_content WHERE "+where+" ORDER BY ordinal ASC,starts_at DESC,id DESC", args...)
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
	return items, rows.Err()
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
		item, readErr := scanDiscoveryContent(tx.QueryRowContext(ctx, "SELECT "+discoveryContentSelect+" FROM dsh.discovery_content WHERE id=$1", id))
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
		var targetType, targetID string
		if err := tx.QueryRowContext(ctx, "SELECT target_type,COALESCE(target_id,'') FROM dsh.discovery_content WHERE id=$1", id).Scan(&targetType, &targetID); errors.Is(err, sql.ErrNoRows) {
			return DiscoveryContentRecord{}, false, ErrDiscoveryContentNotFound
		} else if err != nil {
			return DiscoveryContentRecord{}, false, err
		} else if !validDiscoveryTarget(ctx, tx, targetType, targetID) {
			return DiscoveryContentRecord{}, false, ErrDiscoveryContentTargetInvalid
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
	item, err := scanDiscoveryContent(tx.QueryRowContext(ctx, "SELECT "+discoveryContentSelect+" FROM dsh.discovery_content WHERE id=$1", id))
	if err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	return item, false, nil
}

func validDiscoveryTarget(ctx context.Context, tx *sql.Tx, targetType, targetID string) bool {
	var exists bool
	switch targetType {
	case "INFO":
		return targetID == ""
	case "STORE":
		return tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM dsh.stores WHERE id=$1)", targetID).Scan(&exists) == nil && exists
	case "PRODUCT":
		return tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM dsh.catalog_products WHERE id=$1)", targetID).Scan(&exists) == nil && exists
	case "CATEGORY":
		return tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM dsh.catalog_categories WHERE id=$1)", targetID).Scan(&exists) == nil && exists
	case "PROMOTION":
		return tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM dsh.commerce_promotions WHERE id=$1)", targetID).Scan(&exists) == nil && exists
	default:
		return false
	}
}

func itoa(value int) string {
	return strconv.Itoa(value)
}
