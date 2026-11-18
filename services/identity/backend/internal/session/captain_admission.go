package session

import (
	"context"
	"database/sql"
	"errors"
)

// CaptainAdmission only issues Identity Captain credentials to the same
// verified Customer when DSH confirms current approved operational standing.
// A Store affiliation or client UI state is not an admission authority.
type CaptainAdmission struct {
	owner    *PostgresReader
	standing CaptainStandingVerifier
}

var (
	ErrCaptainRoleAlreadyProvisioned = errors.New("Captain role already provisioned")
	ErrCaptainRoleNotActive          = errors.New("Captain role not active")
)

func NewCaptainAdmission(owner *PostgresReader, standing CaptainStandingVerifier) *CaptainAdmission {
	return &CaptainAdmission{owner: owner, standing: standing}
}

func (a *CaptainAdmission) enter(ctx context.Context, bearer string, resume bool) (MerchantAdmission, error) {
	digest, err := bearerDigest(bearer)
	if err != nil {
		return MerchantAdmission{}, err
	}
	if a == nil || a.owner == nil || a.standing == nil {
		return MerchantAdmission{}, errors.New("Captain Identity and DSH owners required")
	}
	// Identify the currently verified Customer in a short owner transaction.
	// Never hold this connection or any actor/session FOR UPDATE locks while
	// contacting DSH: its independent check may need a second connection.
	preflight, err := a.owner.begin(ctx, false)
	if err != nil {
		return MerchantAdmission{}, err
	}
	checkedActorID, _, verifyErr := lockVerifiedCustomer(ctx, preflight, digest)
	rollbackErr := preflight.Rollback()
	if verifyErr != nil {
		return MerchantAdmission{}, verifyErr
	}
	if rollbackErr != nil {
		return MerchantAdmission{}, rollbackErr
	}
	// DSH checks the same actor and current operational standing, not a caller
	// claim. No Identity write transaction is open during this owner call.
	if err = a.standing.Approved(ctx, bearer[len("Bearer "):], checkedActorID); err != nil {
		return MerchantAdmission{}, err
	}
	// Re-lock and revalidate the credential after the external owner call.
	// A revoked, expired, cross-actor or suspended source cannot mint a role.
	tx, err := a.owner.begin(ctx, false)
	if err != nil {
		return MerchantAdmission{}, err
	}
	defer tx.Rollback()
	actorID, actorVersion, err := lockVerifiedCustomer(ctx, tx, digest)
	if err != nil {
		return MerchantAdmission{}, err
	}
	if actorID != checkedActorID {
		return MerchantAdmission{}, ErrUnauthorized
	}
	var roleVersion int64
	if resume {
		err = tx.QueryRowContext(ctx, `SELECT version FROM actor_roles
			WHERE actor_id=$1 AND role='captain' AND status='ACTIVE'
			FOR UPDATE`, actorID).Scan(&roleVersion)
		if errors.Is(err, sql.ErrNoRows) {
			return MerchantAdmission{}, ErrCaptainRoleNotActive
		}
		if err != nil {
			return MerchantAdmission{}, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at=clock_timestamp()
			WHERE actor_id=$1 AND role='captain' AND revoked_at IS NULL`, actorID)
		if err != nil {
			return MerchantAdmission{}, err
		}
	} else {
		err = tx.QueryRowContext(ctx, `INSERT INTO actor_roles(actor_id,role,status)
			VALUES($1,'captain','ACTIVE') ON CONFLICT(actor_id,role) DO NOTHING
			RETURNING version`, actorID).Scan(&roleVersion)
		if errors.Is(err, sql.ErrNoRows) {
			return MerchantAdmission{}, ErrCaptainRoleAlreadyProvisioned
		}
		if err != nil {
			return MerchantAdmission{}, err
		}
	}
	return issueRoleSessionTx(ctx, tx, actorID, "captain", actorVersion, roleVersion)
}

func (a *CaptainAdmission) Admit(ctx context.Context, bearer string) (MerchantAdmission, error) {
	return a.enter(ctx, bearer, false)
}

func (a *CaptainAdmission) Resume(ctx context.Context, bearer string) (MerchantAdmission, error) {
	return a.enter(ctx, bearer, true)
}
