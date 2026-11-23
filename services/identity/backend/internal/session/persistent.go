package session

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"time"
)

// Persistent login is owned by Identity. Access and refresh secrets are independent
// 256-bit values; only their SHA-256 digests reach the database.
type PersistentGrant struct {
	RefreshToken     string    `json:"refreshToken"`
	RefreshExpiresAt time.Time `json:"refreshExpiresAt"`
}
type PersistentRotation struct {
	AccessToken      string    `json:"accessToken"`
	SessionExpiresAt time.Time `json:"sessionExpiresAt"`
	RefreshToken     string    `json:"refreshToken"`
	RefreshExpiresAt time.Time `json:"refreshExpiresAt"`
}
type PersistentOwner interface {
	StartPersistent(context.Context, [32]byte) (PersistentGrant, error)
	RotatePersistent(context.Context, [32]byte) (PersistentRotation, error)
	EndPersistent(context.Context, [32]byte) error
}

var ErrPersistenceExists = errors.New("persistent session already registered")
var ErrRecentRefreshConflict = errors.New("refresh credential was just consumed")

// Reject a racing duplicate without revoking a legitimate successful rotation.
// A later reuse remains evidence of credential replay and revokes the family.
const refreshReplayGrace = time.Minute

func randomPersistentToken() (string, [32]byte, error) {
	var secret [32]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return "", [32]byte{}, err
	}
	digest := sha256.Sum256(secret[:])
	return base64.RawURLEncoding.EncodeToString(secret[:]), digest, nil
}
func persistentLifetime(role string) (int, int) {
	if role == "operator" {
		return 8 * 60, 12 * 60
	} // minutes: privileged Operator 8h idle / 12h absolute
	return 30 * 24 * 60, 90 * 24 * 60 // minutes: Customer/Merchant/Captain 30d idle / 90d absolute
}
func (r *PostgresReader) StartPersistent(ctx context.Context, digest [32]byte) (PersistentGrant, error) {
	tx, err := r.begin(ctx, false)
	if err != nil {
		return PersistentGrant{}, err
	}
	defer tx.Rollback()
	var actor, role, status, roleStatus string
	var actorVersion, roleVersion int64
	var issued, expires, now time.Time
	err = tx.QueryRowContext(ctx, `SELECT s.actor_id,s.role,s.actor_version,s.role_version,s.issued_at,s.expires_at,
      a.status,ar.status FROM auth_sessions s
      JOIN actors a ON a.id=s.actor_id JOIN actor_roles ar ON ar.actor_id=s.actor_id AND ar.role=s.role
      WHERE s.token_digest=$1 AND s.revoked_at IS NULL AND
        s.actor_version=a.auth_version AND s.role_version=ar.version
      FOR UPDATE OF s,a,ar`, digest[:]).Scan(&actor, &role, &actorVersion, &roleVersion, &issued, &expires, &status, &roleStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return PersistentGrant{}, ErrUnauthorized
	}
	if err != nil {
		return PersistentGrant{}, err
	}
	if err = tx.QueryRowContext(ctx, "SELECT clock_timestamp()").Scan(&now); err != nil {
		return PersistentGrant{}, err
	}
	idleMinutes, absoluteMinutes := persistentLifetime(role)
	if status != "ACTIVE" || roleStatus != "ACTIVE" || idleMinutes == 0 || now.Before(issued) || !now.Before(expires) {
		return PersistentGrant{}, ErrUnauthorized
	}
	var exists bool
	err = tx.QueryRowContext(ctx, "SELECT true FROM auth_session_families WHERE first_access_digest=$1", digest[:]).Scan(&exists)
	if err == nil {
		return PersistentGrant{}, ErrPersistenceExists
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return PersistentGrant{}, err
	}
	token, refreshDigest, err := randomPersistentToken()
	if err != nil {
		return PersistentGrant{}, err
	}
	var familyID string
	var refreshExpiry time.Time
	err = tx.QueryRowContext(ctx, `INSERT INTO auth_session_families
      (first_access_digest,current_access_digest,actor_id,role,actor_version,role_version,
       created_at,idle_expires_at,absolute_expires_at)
      VALUES($1,$1,$2,$3,$4,$5,clock_timestamp(),
        clock_timestamp()+make_interval(mins=>$6),clock_timestamp()+make_interval(mins=>$7))
      RETURNING id::text,LEAST(idle_expires_at,absolute_expires_at)`,
		digest[:], actor, role, actorVersion, roleVersion, idleMinutes, absoluteMinutes).Scan(&familyID, &refreshExpiry)
	if err != nil {
		return PersistentGrant{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO auth_refresh_tokens(token_digest,family_id)
      VALUES($1,$2::uuid)`, refreshDigest[:], familyID)
	if err != nil {
		return PersistentGrant{}, err
	}
	if err = tx.Commit(); err != nil {
		return PersistentGrant{}, err
	}
	return PersistentGrant{token, refreshExpiry}, nil
}

func (r *PostgresReader) RotatePersistent(ctx context.Context, digest [32]byte) (PersistentRotation, error) {
	tx, err := r.begin(ctx, false)
	if err != nil {
		return PersistentRotation{}, err
	}
	defer tx.Rollback()
	// Lock the access session before the family. Canonical logout and permission
	// revocation lock auth_sessions first and the revoke trigger locks families
	// second; reversing that order here would deadlock.
	var observedAccess []byte
	err = tx.QueryRowContext(ctx, `SELECT f.current_access_digest
      FROM auth_refresh_tokens t JOIN auth_session_families f ON f.id=t.family_id
      WHERE t.token_digest=$1`, digest[:]).Scan(&observedAccess)
	if errors.Is(err, sql.ErrNoRows) {
		return PersistentRotation{}, ErrUnauthorized
	}
	if err != nil {
		return PersistentRotation{}, err
	}
	var lockedAccess []byte
	err = tx.QueryRowContext(ctx, `SELECT token_digest FROM auth_sessions
      WHERE token_digest=$1 FOR UPDATE`, observedAccess).Scan(&lockedAccess)
	if errors.Is(err, sql.ErrNoRows) {
		return PersistentRotation{}, ErrUnauthorized
	}
	if err != nil {
		return PersistentRotation{}, err
	}
	var familyID string
	var actor, role, actorStatus, roleStatus string
	var currentAccess []byte
	var actorVersion, roleVersion, currentActorVersion, currentRoleVersion int64
	var idleExpiry, absoluteExpiry, now time.Time
	var familyRevoked, consumed sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT f.id::text,f.actor_id,f.role,f.actor_version,f.role_version,
      f.current_access_digest,f.idle_expires_at,f.absolute_expires_at,f.revoked_at,t.consumed_at
      FROM auth_refresh_tokens t JOIN auth_session_families f ON f.id=t.family_id
      WHERE t.token_digest=$1 FOR UPDATE OF f,t`, digest[:]).
		Scan(&familyID, &actor, &role, &actorVersion, &roleVersion, &currentAccess,
			&idleExpiry, &absoluteExpiry, &familyRevoked, &consumed)
	if errors.Is(err, sql.ErrNoRows) {
		return PersistentRotation{}, ErrUnauthorized
	}
	if err != nil {
		return PersistentRotation{}, err
	}
	if err = tx.QueryRowContext(ctx, "SELECT clock_timestamp()").Scan(&now); err != nil {
		return PersistentRotation{}, err
	}
	// Family could have been rotated while the old access lock was contested.
	// The consumed-token path below revokes that family upon confirmed replay.
	if !bytes.Equal(currentAccess, observedAccess) && !consumed.Valid {
		return PersistentRotation{}, ErrUnauthorized
	}
	// A consumed refresh token is a confirmed replay. Revoke the whole family
	// including the replacement access token; do not expose the new credential.
	if consumed.Valid && !familyRevoked.Valid {
		if !now.Before(consumed.Time) && now.Sub(consumed.Time) < refreshReplayGrace {
			return PersistentRotation{}, ErrRecentRefreshConflict
		}
		if _, err = tx.ExecContext(ctx, `UPDATE auth_session_families SET revoked_at=clock_timestamp()
        WHERE id=$1::uuid AND revoked_at IS NULL`, familyID); err != nil {
			return PersistentRotation{}, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at=clock_timestamp()
        WHERE token_digest=$1 AND revoked_at IS NULL`, currentAccess); err != nil {
			return PersistentRotation{}, err
		}
		if err = tx.Commit(); err != nil {
			return PersistentRotation{}, err
		}
		return PersistentRotation{}, ErrUnauthorized
	}
	if consumed.Valid || familyRevoked.Valid || !now.Before(idleExpiry) || !now.Before(absoluteExpiry) {
		return PersistentRotation{}, ErrUnauthorized
	}
	err = tx.QueryRowContext(ctx, `SELECT a.status,ar.status,a.auth_version,ar.version
      FROM actors a JOIN actor_roles ar ON ar.actor_id=a.id AND ar.role=$2
      WHERE a.id=$1`, actor, role).
		Scan(&actorStatus, &roleStatus, &currentActorVersion, &currentRoleVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return PersistentRotation{}, ErrUnauthorized
	}
	if err != nil {
		return PersistentRotation{}, err
	}
	if actorStatus != "ACTIVE" || roleStatus != "ACTIVE" ||
		currentActorVersion != actorVersion || currentRoleVersion != roleVersion {
		return PersistentRotation{}, ErrUnauthorized
	}
	access, accessDigest, err := randomPersistentToken()
	if err != nil {
		return PersistentRotation{}, err
	}
	refresh, refreshDigest, err := randomPersistentToken()
	if err != nil {
		return PersistentRotation{}, err
	}
	idleMinutes, _ := persistentLifetime(role)
	if idleMinutes <= 0 {
		return PersistentRotation{}, ErrUnauthorized
	}
	var accessExpiry, refreshExpiry time.Time
	err = tx.QueryRowContext(ctx, `INSERT INTO auth_sessions
      (token_digest,actor_id,role,actor_version,role_version,issued_at,expires_at)
      VALUES($1,$2,$3,$4,$5,clock_timestamp(),clock_timestamp()+CASE WHEN $3='operator' THEN interval '5 minutes' ELSE interval '15 minutes' END)
      RETURNING expires_at`, accessDigest[:], actor, role, actorVersion, roleVersion).Scan(&accessExpiry)
	if err != nil {
		return PersistentRotation{}, err
	}
	err = tx.QueryRowContext(ctx, `UPDATE auth_session_families
      SET current_access_digest=$2,
          idle_expires_at=LEAST(absolute_expires_at,clock_timestamp()+make_interval(mins=>$3))
      WHERE id=$1::uuid AND revoked_at IS NULL
      RETURNING LEAST(idle_expires_at,absolute_expires_at)`, familyID, accessDigest[:], idleMinutes).Scan(&refreshExpiry)
	if err != nil {
		return PersistentRotation{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE auth_refresh_tokens SET consumed_at=clock_timestamp()
      WHERE token_digest=$1 AND consumed_at IS NULL`, digest[:]); err != nil {
		return PersistentRotation{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO auth_refresh_tokens(token_digest,family_id)
      VALUES($1,$2::uuid)`, refreshDigest[:], familyID); err != nil {
		return PersistentRotation{}, err
	}
	// Trigger in migration 010 will NOT revoke the family: it already points at
	// the newly issued access digest in this same atomic transaction.
	if _, err = tx.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at=clock_timestamp()
      WHERE token_digest=$1 AND revoked_at IS NULL`, currentAccess); err != nil {
		return PersistentRotation{}, err
	}
	if err = tx.Commit(); err != nil {
		return PersistentRotation{}, err
	}
	return PersistentRotation{access, accessExpiry, refresh, refreshExpiry}, nil
}

func (r *PostgresReader) EndPersistent(ctx context.Context, digest [32]byte) error {
	tx, err := r.begin(ctx, false)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Consistent lock order with canonical Revoke: access then family.
	var observedAccess []byte
	err = tx.QueryRowContext(ctx, `SELECT f.current_access_digest
      FROM auth_refresh_tokens t JOIN auth_session_families f ON f.id=t.family_id
      WHERE t.token_digest=$1`, digest[:]).Scan(&observedAccess)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrUnauthorized
	}
	if err != nil {
		return err
	}
	var lockedAccess []byte
	err = tx.QueryRowContext(ctx, `SELECT token_digest FROM auth_sessions
      WHERE token_digest=$1 FOR UPDATE`, observedAccess).Scan(&lockedAccess)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrUnauthorized
	}
	if err != nil {
		return err
	}
	var familyID string
	var currentAccess []byte
	var revoked, consumed sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT f.id::text,f.current_access_digest,f.revoked_at,t.consumed_at
      FROM auth_refresh_tokens t JOIN auth_session_families f ON f.id=t.family_id
      WHERE t.token_digest=$1 FOR UPDATE OF f,t`, digest[:]).Scan(&familyID, &currentAccess, &revoked, &consumed)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrUnauthorized
	}
	if err != nil {
		return err
	}
	if revoked.Valid || !bytes.Equal(currentAccess, observedAccess) {
		return ErrUnauthorized
	}
	if consumed.Valid {
		var now time.Time
		if err = tx.QueryRowContext(ctx, "SELECT clock_timestamp()").Scan(&now); err != nil {
			return err
		}
		if now.Before(consumed.Time) || now.Sub(consumed.Time) >= refreshReplayGrace {
			return ErrUnauthorized
		}
	}
	// A caller holding the just-consumed refresh token can still explicitly
	// sign out the family after a response was lost during rotation.
	if _, err = tx.ExecContext(ctx, `UPDATE auth_session_families SET revoked_at=clock_timestamp()
      WHERE id=$1::uuid AND revoked_at IS NULL`, familyID); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE auth_sessions SET revoked_at=clock_timestamp()
      WHERE token_digest=$1 AND revoked_at IS NULL`, currentAccess); err != nil {
		return err
	}
	return tx.Commit()
}
