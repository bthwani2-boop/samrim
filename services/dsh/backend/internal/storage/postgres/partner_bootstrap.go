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

type OrganizationRecord struct {
	ID           string
	OwnerActorID string
	Version      int
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type StoreRecord struct {
	ID                    string
	PartnerOrganizationID string
	Name                  string
	Version               int
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

type BootstrapRecord struct {
	Organization OrganizationRecord
	Store        StoreRecord
	Replayed     bool
}

func HashBootstrapRequest(ownerActorID, storeName string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(ownerActorID) + "\x00" + strings.TrimSpace(storeName)))
	return hex.EncodeToString(digest[:])
}

func CreatePartnerBootstrap(ctx context.Context, db *sql.DB, idempotencyKey, requestHash, actingActorID, correlationID, ownerActorID, storeName string) (BootstrapRecord, error) {
	if db == nil {
		return BootstrapRecord{}, errors.New("DSH database is nil")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return BootstrapRecord{}, fmt.Errorf("begin partner bootstrap: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "dsh:partner-bootstrap:"+idempotencyKey); err != nil {
		return BootstrapRecord{}, fmt.Errorf("lock partner bootstrap: %w", err)
	}

	var storedHash, storedOwner string
	var storedOrganizationID, storedStoreID string
	err = tx.QueryRowContext(ctx, `SELECT request_hash, owner_actor_id, partner_organization_id, store_id
		FROM dsh.partner_bootstrap_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedOwner, &storedOrganizationID, &storedStoreID)
	if err == nil {
		if storedHash != requestHash || storedOwner != ownerActorID {
			return BootstrapRecord{}, ErrIdempotencyConflict
		}
		if err := tx.Commit(); err != nil {
			return BootstrapRecord{}, fmt.Errorf("commit idempotent partner bootstrap: %w", err)
		}
		record, err := ReadPartnerBootstrap(ctx, db, ownerActorID)
		if err != nil {
			return BootstrapRecord{}, err
		}
		record.Replayed = true
		if record.Organization.ID != storedOrganizationID || record.Store.ID != storedStoreID {
			return BootstrapRecord{}, errors.New("idempotency readback does not match canonical records")
		}
		return record, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return BootstrapRecord{}, fmt.Errorf("read partner bootstrap idempotency: %w", err)
	}

	var existingID string
	err = tx.QueryRowContext(ctx, "SELECT id FROM dsh.partner_organizations WHERE owner_actor_id=$1 FOR UPDATE", ownerActorID).Scan(&existingID)
	if err == nil {
		return BootstrapRecord{}, ErrAlreadyBootstrapped
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return BootstrapRecord{}, fmt.Errorf("read partner organization owner: %w", err)
	}

	organizationID, err := newID("org")
	if err != nil {
		return BootstrapRecord{}, err
	}
	storeID, err := newID("store")
	if err != nil {
		return BootstrapRecord{}, err
	}
	var organization OrganizationRecord
	if err := tx.QueryRowContext(ctx, `INSERT INTO dsh.partner_organizations(id, owner_actor_id)
		VALUES($1,$2) RETURNING id, owner_actor_id, version, created_at, updated_at`, organizationID, ownerActorID).
		Scan(&organization.ID, &organization.OwnerActorID, &organization.Version, &organization.CreatedAt, &organization.UpdatedAt); err != nil {
		return BootstrapRecord{}, fmt.Errorf("create partner organization: %w", err)
	}
	var store StoreRecord
	if err := tx.QueryRowContext(ctx, `INSERT INTO dsh.stores(id, partner_organization_id, name)
		VALUES($1,$2,$3) RETURNING id, partner_organization_id, name, version, created_at, updated_at`, storeID, organization.ID, storeName).
		Scan(&store.ID, &store.PartnerOrganizationID, &store.Name, &store.Version, &store.CreatedAt, &store.UpdatedAt); err != nil {
		return BootstrapRecord{}, fmt.Errorf("create first store: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.partner_bootstrap_idempotency
		(idempotency_key, request_hash, owner_actor_id, partner_organization_id, store_id)
		VALUES($1,$2,$3,$4,$5)`, idempotencyKey, requestHash, ownerActorID, organization.ID, store.ID); err != nil {
		return BootstrapRecord{}, fmt.Errorf("record partner bootstrap idempotency: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.partner_bootstrap_audit
		(event_type, idempotency_key, correlation_id, acting_actor_id, owner_actor_id, partner_organization_id, store_id, request_hash)
		VALUES('partner_bootstrap_created',$1,$2,$3,$4,$5,$6,$7)`, idempotencyKey, correlationID, actingActorID, ownerActorID, organization.ID, store.ID, requestHash); err != nil {
		return BootstrapRecord{}, fmt.Errorf("record partner bootstrap audit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return BootstrapRecord{}, fmt.Errorf("commit partner bootstrap: %w", err)
	}
	canonical, err := ReadPartnerBootstrap(ctx, db, ownerActorID)
	if err != nil {
		return BootstrapRecord{}, err
	}
	canonical.Replayed = false
	return canonical, nil
}

func ReadPartnerBootstrap(ctx context.Context, db *sql.DB, ownerActorID string) (BootstrapRecord, error) {
	if db == nil {
		return BootstrapRecord{}, errors.New("DSH database is nil")
	}
	var record BootstrapRecord
	err := db.QueryRowContext(ctx, `SELECT o.id, o.owner_actor_id, o.version, o.created_at, o.updated_at,
		s.id, s.partner_organization_id, s.name, s.version, s.created_at, s.updated_at
		FROM dsh.partner_organizations o JOIN dsh.stores s ON s.partner_organization_id=o.id
		WHERE o.owner_actor_id=$1 ORDER BY s.created_at ASC LIMIT 1`, ownerActorID).Scan(
		&record.Organization.ID, &record.Organization.OwnerActorID, &record.Organization.Version,
		&record.Organization.CreatedAt, &record.Organization.UpdatedAt, &record.Store.ID,
		&record.Store.PartnerOrganizationID, &record.Store.Name, &record.Store.Version,
		&record.Store.CreatedAt, &record.Store.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return BootstrapRecord{}, ErrBootstrapNotFound
	}
	if err != nil {
		return BootstrapRecord{}, fmt.Errorf("read canonical partner bootstrap: %w", err)
	}
	return record, nil
}

func newID(prefix string) (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("generate DSH identifier: %w", err)
	}
	return prefix + "_" + hex.EncodeToString(raw[:]), nil
}
