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
	ErrSelfStoreExists = errors.New("partner already has a first Store")
	ErrSelfStoreInput  = errors.New("first Store setup is invalid")
)

type SelfStoreInput struct {
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
func CreateFirstStoreForPartner(ctx context.Context, db *sql.DB, actorID string, input SelfStoreInput) (StoreRecord, bool, error) {
	actorID = strings.TrimSpace(actorID)
	input.Name = strings.TrimSpace(input.Name)
	input.ServiceCityID = strings.TrimSpace(input.ServiceCityID)
	input.VerticalID = strings.TrimSpace(input.VerticalID)
	input.CommercialTypeID = strings.TrimSpace(input.CommercialTypeID)
	input.Address = strings.TrimSpace(input.Address)
	if db == nil || actorID == "" || len(actorID) > 128 ||
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
	lat, lon, err := normalizeLocation(input.Latitude, input.Longitude)
	if err != nil {
		return StoreRecord{}, false, ErrSelfStoreInput
	}
	input.Latitude, input.Longitude = lat, lon
	canonical, err := json.Marshal(struct {
		Owner string
		Input SelfStoreInput
	}{actorID, input})
	if err != nil {
		return StoreRecord{}, false, err
	}
	sum := sha256.Sum256(canonical)
	storeID := "store_" + hex.EncodeToString(sum[:16])
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:first-store:"+actorID); err != nil {
		return StoreRecord{}, false, err
	}
	var existing string
	err = tx.QueryRowContext(ctx, "SELECT id FROM dsh.stores WHERE partner_actor_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1", actorID).Scan(&existing)
	if err == nil {
		if existing != storeID {
			return StoreRecord{}, false, ErrSelfStoreExists
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
	if err := requireActiveJoiningCaseOptionsTx(ctx, tx, input.ServiceCityID, input.VerticalID, input.CommercialTypeID); err != nil {
		return StoreRecord{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.stores
	(id,partner_actor_id,name,service_city_id,primary_vertical_id,commercial_store_type_id,address_text,
	delivery_origin_latitude,delivery_origin_longitude,delivery_origin_version,delivery_origin_updated_at,fulfillment_modes)
	VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,clock_timestamp(),$10)`,
		storeID, actorID, input.Name, input.ServiceCityID, input.VerticalID, input.CommercialTypeID,
		input.Address, lat, lon, pq.Array(input.FulfillmentModes)); err != nil {
		return StoreRecord{}, false, fmt.Errorf("create self-service Store: %w", err)
	}
	// No invented opening hours. Store readiness and orderability remain false
	// until its owner explicitly configures a real schedule and publication.
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_operational_availability
	(store_id,schedule_mode,schedule_timezone,weekly_schedule,paused,unavailable_fulfillment_modes,version,updated_by_actor_id)
	VALUES($1,'WEEKLY',$2,'[]'::jsonb,false,ARRAY[]::text[],1,$3)`,
		storeID, StoreScheduleTimezone, actorID); err != nil {
		return StoreRecord{}, false, fmt.Errorf("initialize unpublished Store availability: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return StoreRecord{}, false, err
	}
	record, err := ReadStoreOwnedByPartner(ctx, db, storeID, actorID)
	return record, false, err
}
