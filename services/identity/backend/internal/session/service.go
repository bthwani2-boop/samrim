package session

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
)

type Service struct {
	db  *sql.DB
	now func() time.Time
}

const refreshRaceGrace = 5 * time.Second

func New(db *sql.DB) *Service { return &Service{db: db, now: time.Now} }

func (s *Service) CreateTx(ctx context.Context, tx *sql.Tx, actorID, role, deviceFingerprint string) (domain.TokenPair, error) {
	device, err := identitysecurity.NormalizeDeviceFingerprint(deviceFingerprint)
	if err != nil {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}
	if _, ok := domain.SurfaceForRole(role); !ok {
		return domain.TokenPair{}, domain.ErrForbidden
	}
	var enabled, securityEnabled bool
	if err := tx.QueryRowContext(ctx, `SELECT r.enabled,a.security_enabled FROM identity_actor_roles r JOIN identity_actors a ON a.id=r.actor_id WHERE r.actor_id=$1 AND r.role=$2 FOR UPDATE OF r,a`, actorID, role).Scan(&enabled, &securityEnabled); err != nil || !enabled || !securityEnabled {
		return domain.TokenPair{}, domain.ErrUnauthenticated
	}
	return s.createTx(ctx, tx, actorID, role, device)
}

func (s *Service) createTx(ctx context.Context, tx *sql.Tx, actorID, role, device string) (domain.TokenPair, error) {
	sessionID, err := identitysecurity.RandomToken(18)
	if err != nil {
		return domain.TokenPair{}, err
	}
	access, err := identitysecurity.RandomToken(32)
	if err != nil {
		return domain.TokenPair{}, err
	}
	refreshRandom, err := identitysecurity.RandomToken(48)
	if err != nil {
		return domain.TokenPair{}, err
	}
	now := s.now().UTC()
	absoluteExpiry := now.Add(sessionAbsoluteLifetime(role))
	accessExpiry := calculateAccessExpiry(now, absoluteExpiry)
	refreshExpiry := calculateRefreshExpiry(now, absoluteExpiry)
	if _, err := tx.ExecContext(ctx, "INSERT INTO identity_sessions(id,actor_id,role,access_token_hash,refresh_token_hash,device_fingerprint_hash,access_expires_at,refresh_expires_at,absolute_expires_at,last_used_at,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1)", sessionID, actorID, role, identitysecurity.SHA256Hex(access), identitysecurity.SHA256Hex(refreshRandom), identitysecurity.SHA256Hex(device), accessExpiry, refreshExpiry, absoluteExpiry, now); err != nil {
		return domain.TokenPair{}, err
	}
	return domain.TokenPair{AccessToken: access, RefreshToken: sessionID + "." + refreshRandom, AccessExpiry: accessExpiry, Identity: identityOf(actorID, sessionID, role, accessExpiry)}, nil
}

func (s *Service) ResolveAccessToken(ctx context.Context, accessToken string) (domain.ActorIdentity, error) {
	accessToken = strings.TrimSpace(accessToken)
	if accessToken == "" {
		return domain.ActorIdentity{}, domain.ErrUnauthenticated
	}
	var actorID, sessionID, role string
	var expires time.Time
	err := s.db.QueryRowContext(ctx, `SELECT s.actor_id,s.id,s.role,s.access_expires_at FROM identity_sessions s
JOIN identity_actor_roles r ON r.actor_id=s.actor_id AND r.role=s.role JOIN identity_actors a ON a.id=s.actor_id
	WHERE s.access_token_hash=$1 AND s.revoked_at IS NULL AND s.access_expires_at>clock_timestamp() AND s.absolute_expires_at>clock_timestamp() AND s.last_used_at>clock_timestamp()-CASE WHEN s.role IN ('operator','platform_owner') THEN INTERVAL '1 hour' ELSE INTERVAL '24 hours' END AND r.enabled=true AND a.security_enabled=true`, identitysecurity.SHA256Hex(accessToken)).Scan(&actorID, &sessionID, &role, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ActorIdentity{}, domain.ErrUnauthenticated
	}
	if err != nil {
		return domain.ActorIdentity{}, err
	}
	if _, err := s.db.ExecContext(ctx, "UPDATE identity_sessions SET last_used_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL", sessionID); err != nil {
		return domain.ActorIdentity{}, err
	}
	return identityOf(actorID, sessionID, role, expires), nil
}

func (s *Service) Refresh(ctx context.Context, input domain.RefreshRequest) (domain.TokenPair, error) {
	parts := strings.SplitN(strings.TrimSpace(input.RefreshToken), ".", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}
	device, err := identitysecurity.NormalizeDeviceFingerprint(input.DeviceFingerprint)
	if err != nil {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}
	sessionID, presented := parts[0], parts[1]
	presentedHash := identitysecurity.SHA256Hex(presented)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.TokenPair{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var actorID, role string
	if err := tx.QueryRowContext(ctx, "SELECT actor_id,role FROM identity_sessions WHERE id=$1", sessionID).Scan(&actorID, &role); err != nil {
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}
	var securityEnabled bool
	if err := tx.QueryRowContext(ctx, "SELECT security_enabled FROM identity_actors WHERE id=$1 FOR UPDATE", actorID).Scan(&securityEnabled); err != nil || !securityEnabled {
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}
	var roleEnabled bool
	if err := tx.QueryRowContext(ctx, "SELECT enabled FROM identity_actor_roles WHERE actor_id=$1 AND role=$2 FOR UPDATE", actorID, role).Scan(&roleEnabled); err != nil || !roleEnabled {
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}
	var currentHash, deviceHash string
	var refreshExpiry, absoluteExpiry, lastUsedAt time.Time
	err = tx.QueryRowContext(ctx, "SELECT refresh_token_hash,device_fingerprint_hash,refresh_expires_at,absolute_expires_at,last_used_at FROM identity_sessions WHERE id=$1 AND actor_id=$2 AND role=$3 AND revoked_at IS NULL FOR UPDATE", sessionID, actorID, role).Scan(&currentHash, &deviceHash, &refreshExpiry, &absoluteExpiry, &lastUsedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}
	if err != nil {
		return domain.TokenPair{}, err
	}
	now := s.now().UTC()
	if !refreshExpiry.After(now) || !absoluteExpiry.After(now) || now.Sub(lastUsedAt) > sessionIdleLifetime(role) || !identitysecurity.ConstantTimeHexEqual(deviceHash, identitysecurity.SHA256Hex(device)) {
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}
	if !identitysecurity.ConstantTimeHexEqual(currentHash, presentedHash) {
		var rotatedAt time.Time
		err := tx.QueryRowContext(ctx, "SELECT rotated_at FROM identity_refresh_token_history WHERE session_id=$1 AND token_hash=$2", sessionID, presentedHash).Scan(&rotatedAt)
		if errors.Is(err, sql.ErrNoRows) {
			return domain.TokenPair{}, domain.ErrInvalidRefresh
		}
		if err != nil {
			return domain.TokenPair{}, err
		}
		if withinRefreshRaceGrace(now, rotatedAt) {
			if err := auditTx(ctx, tx, "session.refresh_stale", actorID, actorID, "stale", "", map[string]any{"sessionId": sessionID, "role": role}); err != nil {
				return domain.TokenPair{}, err
			}
			if err := tx.Commit(); err != nil {
				return domain.TokenPair{}, err
			}
			return domain.TokenPair{}, domain.ErrInvalidRefresh
		}
		if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET revoked_at=clock_timestamp(),compromised_at=clock_timestamp(),version=version+1 WHERE id=$1", sessionID); err != nil {
			return domain.TokenPair{}, err
		}
		if err := auditTx(ctx, tx, "session.refresh_reuse", actorID, actorID, "compromised", "", map[string]any{"sessionId": sessionID, "role": role}); err != nil {
			return domain.TokenPair{}, err
		}
		if err := tx.Commit(); err != nil {
			return domain.TokenPair{}, err
		}
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}
	access, err := identitysecurity.RandomToken(32)
	if err != nil {
		return domain.TokenPair{}, err
	}
	nextRefresh, err := identitysecurity.RandomToken(48)
	if err != nil {
		return domain.TokenPair{}, err
	}
	now = s.now().UTC()
	accessExpiry := calculateAccessExpiry(now, absoluteExpiry)
	nextRefreshExpiry := calculateRefreshExpiry(now, absoluteExpiry)
	if !nextRefreshExpiry.After(now) {
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO identity_refresh_token_history(session_id,token_hash) VALUES($1,$2) ON CONFLICT DO NOTHING", sessionID, currentHash); err != nil {
		return domain.TokenPair{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET access_token_hash=$1,refresh_token_hash=$2,access_expires_at=$3,refresh_expires_at=$4,last_used_at=$5,version=version+1 WHERE id=$6", identitysecurity.SHA256Hex(access), identitysecurity.SHA256Hex(nextRefresh), accessExpiry, nextRefreshExpiry, now, sessionID); err != nil {
		return domain.TokenPair{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.TokenPair{}, err
	}
	return domain.TokenPair{AccessToken: access, RefreshToken: sessionID + "." + nextRefresh, AccessExpiry: accessExpiry, Identity: identityOf(actorID, sessionID, role, accessExpiry)}, nil
}

func (s *Service) Logout(ctx context.Context, accessToken string) error {
	hash := identitysecurity.SHA256Hex(strings.TrimSpace(accessToken))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var sessionID, actorID, role string
	err = tx.QueryRowContext(ctx, "SELECT id,actor_id,role FROM identity_sessions WHERE access_token_hash=$1 AND revoked_at IS NULL FOR UPDATE", hash).Scan(&sessionID, &actorID, &role)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrUnauthenticated
	}
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1", sessionID); err != nil {
		return err
	}
	if err := auditTx(ctx, tx, "session.logout", actorID, actorID, "success", "", map[string]any{"sessionId": sessionID, "role": role}); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) ListRole(ctx context.Context, actorID, role string) ([]domain.SessionInfo, error) {
	role = strings.ToLower(strings.TrimSpace(role))
	surface, ok := domain.SurfaceForRole(role)
	if !ok {
		return nil, domain.ErrInvalidInput
	}
	rows, err := s.db.QueryContext(ctx, "SELECT id,role,version,created_at,refresh_expires_at,last_used_at,compromised_at FROM identity_sessions WHERE actor_id=$1 AND role=$2 AND revoked_at IS NULL AND refresh_expires_at>clock_timestamp() AND absolute_expires_at>clock_timestamp() ORDER BY created_at DESC", strings.TrimSpace(actorID), role)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	result := []domain.SessionInfo{}
	for rows.Next() {
		var item domain.SessionInfo
		if err := rows.Scan(&item.SessionID, &item.Role, &item.Version, &item.CreatedAt, &item.ExpiresAt, &item.LastUsedAt, &item.CompromisedAt); err != nil {
			return nil, err
		}
		item.Surface = surface
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Service) RevokeRoleSession(ctx context.Context, actorID, role, sessionID, principal, correlationID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE id=$1 AND actor_id=$2 AND role=$3", strings.TrimSpace(sessionID), strings.TrimSpace(actorID), strings.ToLower(strings.TrimSpace(role)))
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return domain.ErrNotFound
	}
	if err := auditTx(ctx, tx, "session.revoked", actorID, principal, "success", correlationID, map[string]any{"sessionId": sessionID, "role": role}); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) RevokeRoleAll(ctx context.Context, actorID, role, principal, correlationID string) error {
	role = strings.ToLower(strings.TrimSpace(role))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE actor_id=$1 AND role=$2 AND revoked_at IS NULL", strings.TrimSpace(actorID), role); err != nil {
		return err
	}
	if err := auditTx(ctx, tx, "session.revoked_role", actorID, principal, "success", correlationID, map[string]any{"role": role}); err != nil {
		return err
	}
	return tx.Commit()
}

func identityOf(actorID, sessionID, role string, expires time.Time) domain.ActorIdentity {
	surface, _ := domain.SurfaceForRole(role)
	return domain.ActorIdentity{Subject: actorID, SessionID: sessionID, Role: role, Surface: surface, ExpiresAt: expires}
}
func sessionAbsoluteLifetime(role string) time.Duration {
	if role == "operator" || role == "platform_owner" {
		return 24 * time.Hour
	}
	return 30 * 24 * time.Hour
}
func sessionIdleLifetime(role string) time.Duration {
	if role == "operator" || role == "platform_owner" {
		return time.Hour
	}
	return 24 * time.Hour
}
func calculateRefreshExpiry(now, absolute time.Time) time.Time {
	candidate := now.Add(7 * 24 * time.Hour)
	limit := absolute.Add(-time.Second)
	if candidate.After(limit) {
		return limit
	}
	return candidate
}
func calculateAccessExpiry(now, absolute time.Time) time.Time {
	candidate := now.Add(15 * time.Minute)
	limit := absolute.Add(-time.Second)
	if candidate.After(limit) {
		return limit
	}
	return candidate
}

func withinRefreshRaceGrace(now, rotatedAt time.Time) bool {
	age := now.Sub(rotatedAt)
	return age >= 0 && age <= refreshRaceGrace
}

func auditTx(ctx context.Context, tx *sql.Tx, eventType, actorID, principal, outcome, correlationID string, metadata map[string]any) error {
	if metadata == nil {
		metadata = map[string]any{}
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO identity_security_audit(event_type,subject_actor_id,principal,outcome,correlation_id,metadata) VALUES($1,NULLIF($2,''),$3,$4,NULLIF($5,''),$6::jsonb)", eventType, actorID, principal, outcome, correlationID, string(raw))
	return err
}
