package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/lib/pq"
)

var (
	ErrStorePublicContactForbidden = errors.New("store public contact is forbidden")
	ErrStorePublicContactNotFound = errors.New("published store not found")
	ErrStorePublicContactInput = errors.New("store public contact input is invalid")
	ErrStorePublicContactVersion = errors.New("store public contact version conflict")
	ErrStorePublicContactIdempotency = errors.New("store public contact idempotency conflict")
)

var storePublicPhonePattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

type StorePublicContact struct {
	StoreID string `json:"storeId"`
	PhoneE164 string `json:"phoneE164"`
	Email string `json:"email"`
	WhatsAppPhoneE164 string `json:"whatsappPhoneE164"`
	WhatsAppEnabled bool `json:"whatsappEnabled"`
	Version int `json:"version"`
	UpdatedAt *time.Time `json:"updatedAt,omitempty"`
}

type StorePublicContactInput struct {
	PhoneE164 string `json:"phoneE164"`
	Email string `json:"email"`
	WhatsAppPhoneE164 string `json:"whatsappPhoneE164"`
	WhatsAppEnabled bool `json:"whatsappEnabled"`
	ExpectedVersion int `json:"expectedVersion"`
}

// ValidateStorePublicContactInput validates only business-provided public
// contact facts. The joining-case owner's private number is never a default.
func ValidateStorePublicContactInput(input StorePublicContactInput) (StorePublicContactInput, error) {
	input.PhoneE164 = strings.TrimSpace(input.PhoneE164)
	input.Email = strings.TrimSpace(input.Email)
	input.WhatsAppPhoneE164 = strings.TrimSpace(input.WhatsAppPhoneE164)
	if input.ExpectedVersion < 0 || len(input.PhoneE164) > 16 || len(input.WhatsAppPhoneE164) > 16 ||
		len(input.Email) > 254 || (input.PhoneE164 != "" && !storePublicPhonePattern.MatchString(input.PhoneE164)) ||
		(input.WhatsAppPhoneE164 != "" && !storePublicPhonePattern.MatchString(input.WhatsAppPhoneE164)) ||
		(input.WhatsAppEnabled && input.WhatsAppPhoneE164 == "") {
		return StorePublicContactInput{}, ErrStorePublicContactInput
	}
	if input.Email != "" {
		address, err := mail.ParseAddress(input.Email)
		if err != nil || address.Address != input.Email || address.Name != "" ||
			strings.ContainsAny(input.Email, "\r\n\t <>") {
			return StorePublicContactInput{}, ErrStorePublicContactInput
		}
	}
	return input, nil
}

func ReadStorePublicContactForOwner(ctx context.Context, db *sql.DB, storeID, ownerID string) (StorePublicContact, error) {
	var exists bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.stores WHERE id=$1 AND partner_actor_id=$2 AND deleted_at IS NULL)`, storeID, ownerID).Scan(&exists); err != nil {
		return StorePublicContact{}, err
	}
	if !exists { return StorePublicContact{}, ErrStorePublicContactForbidden }
	return readStorePublicContact(ctx, db, storeID)
}

func ReadStorePublicContactForOperator(ctx context.Context, db *sql.DB, storeID string) (StorePublicContact, error) {
	var exists bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.stores WHERE id=$1)`, storeID).Scan(&exists); err != nil {
		return StorePublicContact{}, err
	}
	if !exists { return StorePublicContact{}, ErrStorePublicContactNotFound }
	return readStorePublicContact(ctx, db, storeID)
}

func readStorePublicContact(ctx context.Context, db *sql.DB, storeID string) (StorePublicContact, error) {
	record := StorePublicContact{StoreID: storeID}
	err := db.QueryRowContext(ctx, `SELECT phone_e164, email, whatsapp_phone_e164, whatsapp_enabled, version, updated_at
		FROM dsh.store_public_contacts WHERE store_id=$1`, storeID).
		Scan(&record.PhoneE164, &record.Email, &record.WhatsAppPhoneE164, &record.WhatsAppEnabled, &record.Version, &record.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) { return record, nil }
	return record, err
}

// The public endpoint reads opt-in business contact only for a published Store.
// It must never fall back to Identity or joining-case owner contact.
func ReadPublishedStorePublicContact(ctx context.Context, db *sql.DB, storeID string) (StorePublicContact, error) {
	var state string
	err := db.QueryRowContext(ctx, `SELECT s.publication_state FROM dsh.stores s JOIN dsh.service_cities sc ON sc.id=s.service_city_id WHERE s.id=$1 AND s.deleted_at IS NULL AND sc.active=true AND s.publication_changed_at IS NOT NULL`, storeID).Scan(&state)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && state != "published") {
		return StorePublicContact{}, ErrStorePublicContactNotFound
	}
	if err != nil { return StorePublicContact{}, err }
	record, err := readStorePublicContact(ctx, db, storeID)
	if err != nil { return StorePublicContact{}, err }
	record.Version = 0
	record.UpdatedAt = nil
	if !record.WhatsAppEnabled { record.WhatsAppPhoneE164 = "" }
	return record, nil
}

func UpdateStorePublicContactForOwner(ctx context.Context, db *sql.DB, storeID, ownerID string, raw StorePublicContactInput, idempotencyKey, correlationID string) (StorePublicContact, bool, error) {
	input, err := ValidateStorePublicContactInput(raw)
	if err != nil { return StorePublicContact{}, false, err }
	if strings.TrimSpace(storeID) == "" || len(storeID) > 128 || strings.TrimSpace(ownerID) == "" ||
		len(ownerID) > 128 || len(idempotencyKey) < 8 || len(idempotencyKey) > 128 ||
		len(correlationID) < 8 || len(correlationID) > 128 {
		return StorePublicContact{}, false, ErrStorePublicContactInput
	}
	hashInput, _ := json.Marshal(struct{
		StoreID string `json:"storeId"`
		OwnerID string `json:"ownerId"`
		Input StorePublicContactInput `json:"input"`
	}{storeID, ownerID, input})
	hash := sha256.Sum256(hashInput)
	digest := hex.EncodeToString(hash[:])
	tx, err := db.BeginTx(ctx, nil)
	if err != nil { return StorePublicContact{}, false, err }
	defer tx.Rollback()
	var actualOwner string
	err = tx.QueryRowContext(ctx, `SELECT partner_actor_id FROM dsh.stores WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, storeID).Scan(&actualOwner)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && actualOwner != ownerID) {
		return StorePublicContact{}, false, ErrStorePublicContactForbidden
	}
	if err != nil { return StorePublicContact{}, false, err }
	var previousHash string
	var previousResult []byte
	err = tx.QueryRowContext(ctx, `SELECT request_hash, result FROM dsh.store_public_contact_idempotency WHERE idempotency_key=$1`, idempotencyKey).
		Scan(&previousHash, &previousResult)
	if err == nil {
		if previousHash != digest { return StorePublicContact{}, false, ErrStorePublicContactIdempotency }
		var record StorePublicContact
		if err := json.Unmarshal(previousResult, &record); err != nil { return StorePublicContact{}, false, err }
		return record, true, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) { return StorePublicContact{}, false, err }

	var currentVersion int
	err = tx.QueryRowContext(ctx, `SELECT version FROM dsh.store_public_contacts WHERE store_id=$1 FOR UPDATE`, storeID).Scan(&currentVersion)
	if err != nil && !errors.Is(err, sql.ErrNoRows) { return StorePublicContact{}, false, err }
	if currentVersion != input.ExpectedVersion { return StorePublicContact{}, false, ErrStorePublicContactVersion }
	record := StorePublicContact{StoreID: storeID, PhoneE164: input.PhoneE164, Email: input.Email,
		WhatsAppPhoneE164: input.WhatsAppPhoneE164, WhatsAppEnabled: input.WhatsAppEnabled}
	err = tx.QueryRowContext(ctx, `INSERT INTO dsh.store_public_contacts
		(store_id,phone_e164,email,whatsapp_phone_e164,whatsapp_enabled,version,updated_by_actor_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT(store_id) DO UPDATE SET
		phone_e164=EXCLUDED.phone_e164,email=EXCLUDED.email,whatsapp_phone_e164=EXCLUDED.whatsapp_phone_e164,
		whatsapp_enabled=EXCLUDED.whatsapp_enabled,version=EXCLUDED.version,
		updated_by_actor_id=EXCLUDED.updated_by_actor_id,updated_at=clock_timestamp()
		RETURNING version,updated_at`,
		storeID, input.PhoneE164, input.Email, input.WhatsAppPhoneE164, input.WhatsAppEnabled, currentVersion+1, ownerID).
		Scan(&record.Version, &record.UpdatedAt)
	if err != nil { return StorePublicContact{}, false, fmt.Errorf("persist store contact: %w", err) }
	result, err := json.Marshal(record)
	if err != nil { return StorePublicContact{}, false, err }
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.store_public_contact_idempotency(idempotency_key,store_id,request_hash,result)
		VALUES ($1,$2,$3,$4)`, idempotencyKey, storeID, digest, result)
	if err != nil {
		var unique *pq.Error
		if errors.As(err, &unique) && unique.Code == "23505" { return StorePublicContact{}, false, ErrStorePublicContactIdempotency }
		return StorePublicContact{}, false, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.store_public_contact_audit(store_id,actor_id,idempotency_key,correlation_id,result_version)
		VALUES ($1,$2,$3,$4,$5)`, storeID, ownerID, idempotencyKey, correlationID, record.Version)
	if err != nil { return StorePublicContact{}, false, err }
	if err := tx.Commit(); err != nil { return StorePublicContact{}, false, err }
	return record, false, nil
}
