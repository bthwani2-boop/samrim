package session

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"time"
)

var (
	ErrMerchantAlreadyProvisioned = errors.New("merchant role is already provisioned")
	ErrVerificationRequired       = errors.New("current customer has no verified Identity proof")
)

// MerchantAdmission is returned once by the canonical Identity owner. The
// bearer is never stored raw, never logged, and never put in a URL or cookie.
type MerchantAdmission struct {
	AccessToken      string    `json:"accessToken"`
	SessionExpiresAt time.Time `json:"sessionExpiresAt"`
}

// MerchantAdmitter is implemented only by the Identity owner. The source
// session digest is not a user ID: the owner resolves and locks that actor.
type MerchantAdmitter interface {
	AdmitMerchant(context.Context, [32]byte) (MerchantAdmission, error)
}

// MerchantSessionResumer lets an already verified Customer obtain a fresh
// Merchant credential only when the same actor already has ACTIVE standing.
type MerchantSessionResumer interface {
	ResumeMerchant(context.Context, [32]byte) (MerchantAdmission, error)
}

var ErrMerchantNotActive = errors.New("active merchant role unavailable")

func (v *Verifier) ResumeMerchant(ctx context.Context, authorization string) (MerchantAdmission, error) {
	digest, err := bearerDigest(authorization)
	if err != nil {
		return MerchantAdmission{}, err
	}
	if v == nil || v.reader == nil {
		return MerchantAdmission{}, errors.New("identity merchant session owner unavailable")
	}
	owner, ok := v.reader.(MerchantSessionResumer)
	if !ok {
		return MerchantAdmission{}, errors.New("identity merchant session writer unavailable")
	}
	return owner.ResumeMerchant(ctx, digest)
}

func (v *Verifier) AdmitMerchant(ctx context.Context, authorization string) (MerchantAdmission, error) {
	digest, err := bearerDigest(authorization)
	if err != nil {
		return MerchantAdmission{}, err
	}
	if v == nil || v.reader == nil {
		return MerchantAdmission{}, errors.New("identity admission owner unavailable")
	}
	owner, ok := v.reader.(MerchantAdmitter)
	if !ok {
		return MerchantAdmission{}, errors.New("identity merchant admission owner unavailable")
	}
	return owner.AdmitMerchant(ctx, digest)
}

// AdmitMerchant is an isolated Identity owner command, never DSH Store
// registration. A current, verified Customer bearer is mandatory. Locking
// the actor and source session plus a unique role key permits one admission
// under contention and prevents disabled roles from self-reactivating.
func (r *PostgresReader) AdmitMerchant(ctx context.Context, sourceDigest [32]byte) (MerchantAdmission, error) {
	tx, err := r.begin(ctx, false)
	if err != nil {
		return MerchantAdmission{}, err
	}
	defer tx.Rollback()

	actorID, actorVersion, err := lockVerifiedCustomer(ctx, tx, sourceDigest)
	if err != nil {
		return MerchantAdmission{}, err
	}
	var merchantRoleVersion int64
	err = tx.QueryRowContext(ctx, `INSERT INTO actor_roles(actor_id,role,status)
        VALUES ($1,'merchant','ACTIVE')
        ON CONFLICT (actor_id,role) DO NOTHING
        RETURNING version`, actorID).Scan(&merchantRoleVersion)
	if errors.Is(err, sql.ErrNoRows) {
		// Existing ACTIVE, SUSPENDED or DISABLED roles all require managed
		// recovery. Ordinary registration may never silently reactivate one.
		return MerchantAdmission{}, ErrMerchantAlreadyProvisioned
	}
	if err != nil {
		return MerchantAdmission{}, err
	}

	return issueMerchantSessionTx(ctx, tx, actorID, actorVersion, merchantRoleVersion)
}

// ResumeMerchant serializes all session rotation for one verified actor.
// A disabled/suspended/absent role cannot self-reactivate; the previous
// Merchant bearer is revoked atomically with issuance of its replacement.
// The original Customer credential and all non-Merchant roles stay untouched.
func (r *PostgresReader) ResumeMerchant(ctx context.Context, sourceDigest [32]byte) (MerchantAdmission, error) {
	tx, err := r.begin(ctx, false)
	if err != nil {
		return MerchantAdmission{}, err
	}
	defer tx.Rollback()
	actorID, actorVersion, err := lockVerifiedCustomer(ctx, tx, sourceDigest)
	if err != nil {
		return MerchantAdmission{}, err
	}
	var merchantRoleVersion int64
	err = tx.QueryRowContext(ctx, `SELECT version FROM actor_roles
        WHERE actor_id=$1 AND role='merchant' AND status='ACTIVE'
        FOR UPDATE`, actorID).Scan(&merchantRoleVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return MerchantAdmission{}, ErrMerchantNotActive
	}
	if err != nil {
		return MerchantAdmission{}, err
	}
	_, err = tx.ExecContext(ctx, `UPDATE auth_sessions
        SET revoked_at=clock_timestamp()
        WHERE actor_id=$1 AND role='merchant' AND revoked_at IS NULL`, actorID)
	if err != nil {
		return MerchantAdmission{}, err
	}
	return issueMerchantSessionTx(ctx, tx, actorID, actorVersion, merchantRoleVersion)
}

// lockVerifiedCustomer validates the source credential after the database
// actor, role and session locks are held. Transaction-start CURRENT_TIMESTAMP
// is not sufficient: a token can expire while a writer waits on a lock.
// Use the canonical PostgreSQL clock AFTER the wait, not the application clock.
func lockVerifiedCustomer(ctx context.Context, tx *sql.Tx, sourceDigest [32]byte) (string, int64, error) {
	var actorID string
	var actorVersion int64
	var verification sql.NullTime
	var issuedAt, expiresAt, currentDBTime time.Time
	err := tx.QueryRowContext(ctx, `SELECT a.id,a.auth_version,a.verified_at,s.issued_at,s.expires_at
        FROM auth_sessions AS s
        JOIN actors AS a ON a.id=s.actor_id
        JOIN actor_roles AS ar ON ar.actor_id=s.actor_id AND ar.role=s.role
        WHERE s.token_digest=$1 AND s.role='customer'
          AND s.revoked_at IS NULL
          AND a.status='ACTIVE' AND ar.status='ACTIVE'
          AND s.actor_version=a.auth_version AND s.role_version=ar.version
        FOR UPDATE OF a, ar, s`, sourceDigest[:]).
		Scan(&actorID, &actorVersion, &verification, &issuedAt, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return "", 0, ErrUnauthorized
	}
	if err != nil {
		return "", 0, err
	}
	if err = tx.QueryRowContext(ctx, "SELECT clock_timestamp()").Scan(&currentDBTime); err != nil {
		return "", 0, err
	}
	if err := validateVerifiedCustomerAt(verification, issuedAt, expiresAt, currentDBTime); err != nil {
		return "", 0, err
	}
	return actorID, actorVersion, nil
}

// validateVerifiedCustomerAt compares trusted timestamps, never a caller's
// clock. An expired or not-yet-issued source credential cannot mint a role
// session, even if the SQL transaction began before a row-lock wait.
func validateVerifiedCustomerAt(verification sql.NullTime, issuedAt, expiresAt, dbNow time.Time) error {
	if dbNow.Before(issuedAt) || !dbNow.Before(expiresAt) {
		return ErrUnauthorized
	}
	if !verification.Valid || verification.Time.After(dbNow) {
		return ErrVerificationRequired
	}
	return nil
}

// One writer shared by initial direct admission and existing role re-entry.
// The caller owns the transaction and actor/role locks. This routine commits
// only after the digest is persisted, and returns raw credentials only once.
func issueMerchantSessionTx(ctx context.Context, tx *sql.Tx, actorID string, actorVersion, merchantRoleVersion int64) (MerchantAdmission, error) {
	return issueRoleSessionTx(ctx, tx, actorID, "merchant", actorVersion, merchantRoleVersion)
}

func issueRoleSessionTx(ctx context.Context, tx *sql.Tx, actorID, role string, actorVersion, roleVersion int64) (MerchantAdmission, error) {
	var secret [32]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return MerchantAdmission{}, err
	}
	digest := sha256.Sum256(secret[:])
	var expiry time.Time
	err := tx.QueryRowContext(ctx, `INSERT INTO auth_sessions
        (token_digest,actor_id,role,actor_version,role_version,issued_at,expires_at)
        VALUES ($1,$2,$3,$4,$5,clock_timestamp(),clock_timestamp()+interval '30 minutes')
        RETURNING expires_at`, digest[:], actorID, role, actorVersion, roleVersion).
		Scan(&expiry)
	if err != nil {
		return MerchantAdmission{}, err
	}
	if err = tx.Commit(); err != nil {
		return MerchantAdmission{}, err
	}
	return MerchantAdmission{
		AccessToken:      base64.RawURLEncoding.EncodeToString(secret[:]),
		SessionExpiresAt: expiry,
	}, nil
}
