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

	var actorID string
	var actorVersion int64
	var verified bool
	err = tx.QueryRowContext(ctx, `SELECT a.id,a.auth_version,a.verified_at IS NOT NULL AND a.verified_at<=CURRENT_TIMESTAMP
        FROM auth_sessions AS s
        JOIN actors AS a ON a.id=s.actor_id
        JOIN actor_roles AS ar ON ar.actor_id=s.actor_id AND ar.role=s.role
        WHERE s.token_digest=$1 AND s.role='customer'
          AND s.revoked_at IS NULL
          AND s.issued_at<=CURRENT_TIMESTAMP AND s.expires_at>CURRENT_TIMESTAMP
          AND a.status='ACTIVE' AND ar.status='ACTIVE'
          AND s.actor_version=a.auth_version AND s.role_version=ar.version
        FOR UPDATE OF a, ar, s`, sourceDigest[:]).Scan(&actorID, &actorVersion, &verified)
	if errors.Is(err, sql.ErrNoRows) {
		return MerchantAdmission{}, ErrUnauthorized
	}
	if err != nil {
		return MerchantAdmission{}, err
	}
	if !verified {
		return MerchantAdmission{}, ErrVerificationRequired
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

	var secret [32]byte
	if _, err = rand.Read(secret[:]); err != nil {
		return MerchantAdmission{}, err
	}
	digest := sha256.Sum256(secret[:])
	var expiry time.Time
	err = tx.QueryRowContext(ctx, `INSERT INTO auth_sessions
        (token_digest,actor_id,role,actor_version,role_version,issued_at,expires_at)
        VALUES ($1,$2,'merchant',$3,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+interval '30 minutes')
        RETURNING expires_at`, digest[:], actorID, actorVersion, merchantRoleVersion).
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
