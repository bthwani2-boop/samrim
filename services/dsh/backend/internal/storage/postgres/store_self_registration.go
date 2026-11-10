package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/lib/pq"
)

var (
	ErrSelfStoreExists      = errors.New("partner already has a first Store")
	ErrSelfStoreInput       = errors.New("first Store setup is invalid")
	ErrSelfStoreIdempotency = errors.New("first Store idempotency key belongs to different request or actor")
)

type SelfStoreInput struct {
	RelationModel    string
	Name             string
	ServiceCityID    string
	VerticalID       string
	CommercialTypeID string
	Address          string
	Latitude         float64
	Longitude        float64
	FulfillmentModes []string
}

// CreateFirstStoreForPartner owns the first Store without a JoiningCase or
// Operator approval. The Store starts UNPUBLISHED; publication, agreement,
// logo/cover, catalog, and WLT readiness remain with their existing owners.
// A deterministic fact-derived ID makes identical retries safe and prevents
// different facts from silently modifying an existing Store.
func CreateFirstStoreForPartner(ctx context.Context, db *sql.DB, actorID string, input SelfStoreInput, idempotencyKey string) (StoreRecord, bool, error) {
	return createStoreForPartner(ctx, db, actorID, input, idempotencyKey, true, "", "")
}

// Both Partner and authorized Operator entry points invoke this same Store writer.
// The first-Store endpoint retains its original deterministic ID and replay rule.
func CreateAdditionalStoreForPartner(ctx context.Context, db *sql.DB, actorID string, input SelfStoreInput, idempotencyKey string) (StoreRecord, bool, error) {
	return createStoreForPartner(ctx, db, actorID, input, idempotencyKey, false, "", "")
}

// Operator-assisted creation shares the same transaction with an attributable
// acting Operator; never accept a purported owner or Operator from Store facts.
func CreateAdditionalStoreForOperator(ctx context.Context, db *sql.DB, actorID, operatorActorID, correlationID string, input SelfStoreInput, idempotencyKey string) (StoreRecord, bool, error) {
	return createStoreForPartner(ctx, db, actorID, input, idempotencyKey, false, operatorActorID, correlationID)
}

func createStoreForPartner(ctx context.Context, db *sql.DB, actorID string, input SelfStoreInput, idempotencyKey string, firstOnly bool, operatorActorID, correlationID string) (StoreRecord, bool, error) {
	actorID = strings.TrimSpace(actorID)
	operatorActorID = strings.TrimSpace(operatorActorID)
	correlationID = strings.TrimSpace(correlationID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if (operatorActorID == "") != (correlationID == "") ||
		len(operatorActorID) > 128 || (correlationID != "" && (len(correlationID) < 8 || len(correlationID) > 128)) ||
		(firstOnly && operatorActorID != "") {
		return StoreRecord{}, false, ErrSelfStoreInput
	}
	input.Name = strings.TrimSpace(input.Name)
	input.ServiceCityID = strings.TrimSpace(input.ServiceCityID)
	input.VerticalID = strings.TrimSpace(input.VerticalID)
	input.CommercialTypeID = strings.TrimSpace(input.CommercialTypeID)
	input.Address = strings.TrimSpace(input.Address)
	input.RelationModel = strings.TrimSpace(input.RelationModel)
	if input.RelationModel == "" {
		// Older Partner clients are the admitted marketplace path.
		input.RelationModel = StoreRelationBThwaniPartner
	}
	if input.RelationModel != StoreRelationBThwaniPartner && input.RelationModel != StoreRelationIndependent {
		return StoreRecord{}, false, ErrSelfStoreInput
	}
	if db == nil || actorID == "" || len(actorID) > 128 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 ||
		utf8.RuneCountInString(input.Name) < 2 || utf8.RuneCountInString(input.Name) > 160 ||
		utf8.RuneCountInString(input.Address) < 4 || utf8.RuneCountInString(input.Address) > 500 ||
		input.ServiceCityID == "" || input.VerticalID == "" || input.CommercialTypeID == "" {
		return StoreRecord{}, false, ErrSelfStoreInput
	}
	modes, err := NormalizeStoreFulfillmentModes(input.FulfillmentModes)
	if err != nil {
		return StoreRecord{}, false, ErrSelfStoreInput
	}
	input.FulfillmentModes = modes
	if input.RelationModel == StoreRelationIndependent {
		for _, mode := range modes {
			if mode == "BTHWANI_CAPTAIN" {
				// A merchant-direct Store cannot request BThwani dispatch.
				return StoreRecord{}, false, ErrSelfStoreInput
			}
		}
	}
	lat, lon, err := normalizeLocation(input.Latitude, input.Longitude)
	if err != nil {
		return StoreRecord{}, false, ErrSelfStoreInput
	}
	input.Latitude, input.Longitude = lat, lon
	storeID, err := firstStoreDeterministicID(actorID, input)
	if err != nil {
		return StoreRecord{}, false, err
	}
	keySum := sha256.Sum256([]byte(idempotencyKey))
	keyHash := hex.EncodeToString(keySum[:])
	requestMaterial := []byte(storeID) // Keep legacy first-Store replay hashes byte-for-byte.
	if !firstOnly {
		// Each new intent has its own Store ID; exact key replays cannot mutate facts.
		idSum := sha256.Sum256([]byte("dsh:additional-store:" + actorID + ":" + keyHash))
		storeID = "store_" + hex.EncodeToString(idSum[:16])
		requestMaterial, err = json.Marshal(input)
		if err != nil {
			return StoreRecord{}, false, err
		}
	}
	requestSum := sha256.Sum256(requestMaterial)
	requestHash := hex.EncodeToString(requestSum[:])
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	// Serialize globally by key before the actor lock to prevent cross-actor replays.
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:first-store-key:"+keyHash); err != nil {
		return StoreRecord{}, false, err
	}
	if err := lockFirstStoreOwnerTx(ctx, tx, actorID); err != nil {
		return StoreRecord{}, false, err
	}
	var usedActor, usedRequest, usedStore string
	var usedOperator, usedCorrelation sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT partner_actor_id,request_hash,store_id,operator_actor_id,correlation_id FROM dsh.store_create_idempotency WHERE key_hash=$1`, keyHash).
		Scan(&usedActor, &usedRequest, &usedStore, &usedOperator, &usedCorrelation)
	if err == nil {
		if usedActor != actorID || usedRequest != requestHash || usedStore != storeID ||
			usedOperator.String != operatorActorID || usedCorrelation.String != correlationID {
			return StoreRecord{}, false, ErrSelfStoreIdempotency
		}
		if err := tx.Commit(); err != nil {
			return StoreRecord{}, false, err
		}
		record, err := ReadStoreOwnedByPartner(ctx, db, storeID, actorID)
		return record, true, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return StoreRecord{}, false, err
	}
	if firstOnly {
		var existing string
		err = tx.QueryRowContext(ctx, "SELECT id FROM dsh.stores WHERE partner_actor_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1", actorID).Scan(&existing)
		if err == nil {
			if existing != storeID {
				return StoreRecord{}, false, ErrSelfStoreExists
			}
			if err := recordStoreCreationAttemptTx(ctx, tx, keyHash, requestHash, actorID, storeID, operatorActorID, correlationID); err != nil {
				return StoreRecord{}, false, err
			}
			if err := tx.Commit(); err != nil {
				return StoreRecord{}, false, err
			}
			record, err := ReadStoreOwnedByPartner(ctx, db, storeID, actorID)
			return record, true, err
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return StoreRecord{}, false, err
		}
	}
	if err := createStoreTx(ctx, tx, storeID, actorID, input, nil, json.RawMessage("[]"), actorID); err != nil {
		return StoreRecord{}, false, err
	}
	if err := recordStoreCreationAttemptTx(ctx, tx, keyHash, requestHash, actorID, storeID, operatorActorID, correlationID); err != nil {
		return StoreRecord{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StoreRecord{}, false, err
	}
	record, err := ReadStoreOwnedByPartner(ctx, db, storeID, actorID)
	return record, false, err
}

func lockFirstStoreOwnerTx(ctx context.Context, tx *sql.Tx, owner string) error {
	_, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:first-store:"+owner)
	return err
}

// createStoreTx is the Store writer shared by self-setup and case approval.
// Callers resolve replays before invoking it. The policy lock orders new
// Store creation with policy changes for the same relation.
func createStoreTx(ctx context.Context, tx *sql.Tx, storeID, owner string, input SelfStoreInput, workingHours, weeklySchedule json.RawMessage, scheduleActor string) error {
	var enrollmentEnabled bool
	if err := tx.QueryRowContext(ctx, `SELECT enrollment_enabled FROM dsh.store_joining_policies
		WHERE relation_model=$1 FOR SHARE`, input.RelationModel).Scan(&enrollmentEnabled); err != nil {
		return fmt.Errorf("read Store joining policy: %w", err)
	}
	if !enrollmentEnabled {
		return ErrStoreJoiningClosed
	}
	if err := requireActiveJoiningCaseOptionsTx(ctx, tx, input.ServiceCityID, input.VerticalID, input.CommercialTypeID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.stores
	(id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,address_text,business_working_hours,
	delivery_origin_latitude,delivery_origin_longitude,delivery_origin_version,delivery_origin_updated_at,fulfillment_modes,relation_model)
	VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,''),NULLIF($8,'')::jsonb,$9,$10,1,clock_timestamp(),$11,$12)`,
		storeID, owner, input.Name, input.ServiceCityID, input.VerticalID, input.CommercialTypeID,
		input.Address, string(workingHours), input.Latitude, input.Longitude, pq.Array(input.FulfillmentModes), input.RelationModel); err != nil {
		return fmt.Errorf("create Store: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_operational_availability
	(store_id,schedule_mode,schedule_timezone,weekly_schedule,paused,unavailable_fulfillment_modes,version,updated_by_actor_id)
	VALUES($1,'WEEKLY',$2,$3::jsonb,false,ARRAY[]::text[],1,$4)`,
		storeID, StoreScheduleTimezone, string(weeklySchedule), scheduleActor); err != nil {
		return fmt.Errorf("initialize Store availability: %w", err)
	}
	return nil
}

func recordStoreCreationAttemptTx(ctx context.Context, tx *sql.Tx, keyHash, requestHash, actorID, storeID, operatorActorID, correlationID string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_create_idempotency
		(key_hash,request_hash,partner_actor_id,store_id,operator_actor_id,correlation_id)
		VALUES($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''))`, keyHash, requestHash, actorID, storeID, operatorActorID, correlationID)
	return err
}

// firstStoreDeterministicID preserves the byte-for-byte legacy marketplace
// Store IDs for callers created before relation_model existed. A newly chosen
// independent Store includes its relationship in the hash, never aliasing a
// marketplace Store with the same owner and facts.
func firstStoreDeterministicID(actorID string, input SelfStoreInput) (string, error) {
	legacy := struct {
		Name             string
		ServiceCityID    string
		VerticalID       string
		CommercialTypeID string
		Address          string
		Latitude         float64
		Longitude        float64
		FulfillmentModes []string
	}{
		input.Name, input.ServiceCityID, input.VerticalID, input.CommercialTypeID,
		input.Address, input.Latitude, input.Longitude, input.FulfillmentModes,
	}
	var hashFacts any = legacy
	if input.RelationModel == StoreRelationIndependent {
		hashFacts = input
	}
	canonical, err := json.Marshal(struct {
		Owner string
		Input any
	}{actorID, hashFacts})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canonical)
	return "store_" + hex.EncodeToString(sum[:16]), nil
}
