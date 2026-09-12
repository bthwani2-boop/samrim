package postgres

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrAlreadyBootstrapped = errors.New("partner is already bootstrapped")
	ErrIdempotencyConflict = errors.New("idempotency key was already used with a different request")
	ErrBootstrapNotFound   = errors.New("partner bootstrap was not found")
)

type StoreRecord struct {
	ID             string
	PartnerActorID string
	Name           string
	Version        int
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type BootstrapRecord struct {
	PartnerActorID string
	Store          StoreRecord
	Replayed       bool
}

func HashBootstrapRequest(partnerActorID, storeName string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(partnerActorID) + "\x00" + strings.TrimSpace(storeName)))
	return hex.EncodeToString(digest[:])
}

func CreatePartnerBootstrap(ctx context.Context, db *sql.DB, idempotencyKey, requestHash, actingActorID, correlationID, partnerActorID, storeName string) (BootstrapRecord, error) {
	if db == nil {
		return BootstrapRecord{}, errors.New("DSH database is nil")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return BootstrapRecord{}, fmt.Errorf("begin partner bootstrap: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "dsh:partner-bootstrap:idempotency:"+idempotencyKey); err != nil {
		return BootstrapRecord{}, fmt.Errorf("lock partner bootstrap idempotency: %w", err)
	}

	var storedHash, storedPartnerActorID, storedStoreID string
	err = tx.QueryRowContext(ctx, `SELECT request_hash, partner_actor_id, store_id
		FROM dsh.partner_bootstrap_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedPartnerActorID, &storedStoreID)
	if err == nil {
		if storedHash != requestHash || storedPartnerActorID != partnerActorID {
			return BootstrapRecord{}, ErrIdempotencyConflict
		}
		if err := tx.Commit(); err != nil {
			return BootstrapRecord{}, fmt.Errorf("commit idempotent partner bootstrap: %w", err)
		}
		record, err := ReadPartnerBootstrap(ctx, db, partnerActorID)
		if err != nil {
			return BootstrapRecord{}, err
		}
		record.Replayed = true
		if record.PartnerActorID != storedPartnerActorID || record.Store.ID != storedStoreID {
			return BootstrapRecord{}, errors.New("idempotency readback does not match canonical records")
		}
		return record, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return BootstrapRecord{}, fmt.Errorf("read partner bootstrap idempotency: %w", err)
	}

	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "dsh:partner-bootstrap:partner:"+partnerActorID); err != nil {
		return BootstrapRecord{}, fmt.Errorf("lock partner bootstrap partner: %w", err)
	}
	var existingStoreID string
	err = tx.QueryRowContext(ctx, "SELECT id FROM dsh.stores WHERE partner_actor_id=$1 ORDER BY created_at ASC LIMIT 1", partnerActorID).Scan(&existingStoreID)
	if err == nil {
		return BootstrapRecord{}, ErrAlreadyBootstrapped
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return BootstrapRecord{}, fmt.Errorf("read partner first store: %w", err)
	}

	storeID, err := newID("store")
	if err != nil {
		return BootstrapRecord{}, err
	}
	var store StoreRecord
	if err := tx.QueryRowContext(ctx, `INSERT INTO dsh.stores(id, partner_actor_id, name)
		VALUES($1,$2,$3) RETURNING id, partner_actor_id, name, version, created_at, updated_at`, storeID, partnerActorID, storeName).
		Scan(&store.ID, &store.PartnerActorID, &store.Name, &store.Version, &store.CreatedAt, &store.UpdatedAt); err != nil {
		return BootstrapRecord{}, fmt.Errorf("create first store: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.partner_bootstrap_idempotency
		(idempotency_key, request_hash, partner_actor_id, store_id)
		VALUES($1,$2,$3,$4)`, idempotencyKey, requestHash, partnerActorID, store.ID); err != nil {
		return BootstrapRecord{}, fmt.Errorf("record partner bootstrap idempotency: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.partner_bootstrap_audit
		(event_type, idempotency_key, correlation_id, acting_actor_id, partner_actor_id, store_id, request_hash)
		VALUES('partner_bootstrap_created',$1,$2,$3,$4,$5,$6)`, idempotencyKey, correlationID, actingActorID, partnerActorID, store.ID, requestHash); err != nil {
		return BootstrapRecord{}, fmt.Errorf("record partner bootstrap audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return BootstrapRecord{}, fmt.Errorf("commit partner bootstrap: %w", err)
	}
	canonical, err := ReadPartnerBootstrap(ctx, db, partnerActorID)
	if err != nil {
		return BootstrapRecord{}, err
	}
	canonical.Replayed = false
	return canonical, nil
}

func ReadPartnerBootstrap(ctx context.Context, db *sql.DB, partnerActorID string) (BootstrapRecord, error) {
	if db == nil {
		return BootstrapRecord{}, errors.New("DSH database is nil")
	}
	var record BootstrapRecord
	err := db.QueryRowContext(ctx, `SELECT partner_actor_id, id, name, version, created_at, updated_at
		FROM dsh.stores WHERE partner_actor_id=$1 ORDER BY created_at ASC LIMIT 1`, partnerActorID).Scan(
		&record.PartnerActorID, &record.Store.ID, &record.Store.Name, &record.Store.Version,
		&record.Store.CreatedAt, &record.Store.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return BootstrapRecord{}, ErrBootstrapNotFound
	}
	if err != nil {
		return BootstrapRecord{}, fmt.Errorf("read canonical partner bootstrap: %w", err)
	}
	record.Store.PartnerActorID = record.PartnerActorID
	return record, nil
}

func newID(prefix string) (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("generate DSH identifier: %w", err)
	}
	return prefix + "_" + hex.EncodeToString(raw[:]), nil
}
