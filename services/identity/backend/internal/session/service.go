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

func New(db *sql.DB) *Service {
	return &Service{db: db, now: time.Now}
}

func (s *Service) Login(ctx context.Context, input domain.LoginRequest, ipHash string) (domain.TokenPair, error) {
	username, err := identitysecurity.NormalizeUsername(input.Username)
	if err != nil {
		return domain.TokenPair{}, domain.ErrUnauthenticated
	}
	device, err := identitysecurity.NormalizeDeviceFingerprint(input.DeviceFingerprint)
	if err != nil {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}
	ipHash = strings.TrimSpace(ipHash)
	if len(ipHash) != 64 {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}

	var accountFailures, sourceFailures int
	if err := s.db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM identity_login_attempts WHERE username=$1 AND succeeded=false AND created_at>clock_timestamp()-interval '15 minutes'",
		username).Scan(&accountFailures); err != nil {
		return domain.TokenPair{}, err
	}
	if err := s.db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM identity_login_attempts WHERE ip_hash=$1 AND succeeded=false AND created_at>clock_timestamp()-interval '15 minutes'",
		ipHash).Scan(&sourceFailures); err != nil {
		return domain.TokenPair{}, err
	}
	a, err := operatorByUsername(ctx, s.db, username)
	if errors.Is(err, sql.ErrNoRows) {
		_, _ = s.db.ExecContext(ctx, "INSERT INTO identity_login_attempts(username,ip_hash,succeeded) VALUES($1,$2,false)", username, ipHash)
		if accountFailures >= 5 || sourceFailures >= 29 {
			return domain.TokenPair{}, domain.ErrRateLimited
		}
		return domain.TokenPair{}, domain.ErrUnauthenticated
	}
	if err != nil {
		return domain.TokenPair{}, err
	}
	if !identitysecurity.VerifyPassword(a.PasswordHash, input.Password) {
		_, _ = s.db.ExecContext(ctx, "INSERT INTO identity_login_attempts(username,ip_hash,succeeded) VALUES($1,$2,false)", username, ipHash)
		if accountFailures >= 5 || sourceFailures >= 29 {
			return domain.TokenPair{}, domain.ErrRateLimited
		}
		return domain.TokenPair{}, domain.ErrUnauthenticated
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.TokenPair{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "DELETE FROM identity_login_attempts WHERE username=$1 AND succeeded=false", username); err != nil {
		return domain.TokenPair{}, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO identity_login_attempts(username,ip_hash,succeeded) VALUES($1,$2,true)", username, ipHash); err != nil {
		return domain.TokenPair{}, err
	}
	pair, err := s.createTx(ctx, tx, a.ID, "operator", device)
	if err != nil {
		return domain.TokenPair{}, err
	}
	if err := auditTx(ctx, tx, "session.login", a.ID, a.ID, "success", "", map[string]any{"role": "operator"}); err != nil {
		return domain.TokenPair{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.TokenPair{}, err
	}
	return pair, nil
}

func (s *Service) CreateForActivationTx(ctx context.Context, tx *sql.Tx, actorID, role, deviceFingerprint string) (domain.TokenPair, error) {
	device, err := identitysecurity.NormalizeDeviceFingerprint(deviceFingerprint)
	if err != nil {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}
	if _, ok := domain.SurfaceForRole(role); !ok {
		return domain.TokenPair{}, domain.ErrForbidden
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
	accessExpiry := now.Add(15 * time.Minute)
	refreshExpiry := now.Add(7 * 24 * time.Hour)
	if _, err := tx.ExecContext(ctx,
		"INSERT INTO identity_sessions(id,actor_id,role,access_token_hash,refresh_token_hash,device_fingerprint_hash,access_expires_at,refresh_expires_at,last_used_at,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1)",
		sessionID, actorID, role, identitysecurity.SHA256Hex(access), identitysecurity.SHA256Hex(refreshRandom),
		identitysecurity.SHA256Hex(device), accessExpiry, refreshExpiry, now); err != nil {
		return domain.TokenPair{}, err
	}
	return domain.TokenPair{
		AccessToken: access,
		RefreshToken: sessionID + "." + refreshRandom,
		AccessExpiry: accessExpiry,
		Identity: identityOf(actorID, sessionID, role, accessExpiry),
	}, nil
}

func (s *Service) ResolveAccessToken(ctx context.Context, accessToken string) (domain.ActorIdentity, error) {
	accessToken = strings.TrimSpace(accessToken)
	if accessToken == "" {
		return domain.ActorIdentity{}, domain.ErrUnauthenticated
	}
	var actorID, sessionID, role string
	var expires time.Time
	err := s.db.QueryRowContext(ctx,
		"SELECT s.actor_id,s.id,s.role,s.access_expires_at FROM identity_sessions s JOIN identity_actor_roles r ON r.actor_id=s.actor_id AND r.role=s.role JOIN identity_actors a ON a.id=s.actor_id WHERE s.access_token_hash=$1 AND s.revoked_at IS NULL AND s.access_expires_at>clock_timestamp() AND r.enabled=true AND a.security_enabled=true",
		identitysecurity.SHA256Hex(accessToken)).Scan(&actorID, &sessionID, &role, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ActorIdentity{}, domain.ErrUnauthenticated
	}
	if err != nil {
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

	var actorID, role, currentHash, deviceHash string
	var refreshExpiry time.Time
	err = tx.QueryRowContext(ctx,
		"SELECT actor_id,role,refresh_token_hash,device_fingerprint_hash,refresh_expires_at FROM identity_sessions WHERE id=$1 AND revoked_at IS NULL FOR UPDATE",
		sessionID).Scan(&actorID, &role, &currentHash, &deviceHash, &refreshExpiry)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}
	if err != nil {
		return domain.TokenPair{}, err
	}
	if !refreshExpiry.After(s.now()) {
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}
	var securityEnabled bool
	if err := tx.QueryRowContext(ctx,
		"SELECT security_enabled FROM identity_actors WHERE id=$1 FOR UPDATE",
		actorID).Scan(&securityEnabled); err != nil || !securityEnabled {
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}
	if !identitysecurity.ConstantTimeHexEqual(deviceHash, identitysecurity.SHA256Hex(device)) {
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}

	if !identitysecurity.ConstantTimeHexEqual(currentHash, presentedHash) {
		var exists bool
		if err := tx.QueryRowContext(ctx,
			"SELECT EXISTS(SELECT 1 FROM identity_refresh_token_history WHERE session_id=$1 AND token_hash=$2)",
			sessionID, presentedHash).Scan(&exists); err != nil {
			return domain.TokenPair{}, err
		}
		if !exists {
			return domain.TokenPair{}, domain.ErrInvalidRefresh
		}
		if _, err := tx.ExecContext(ctx,
			"UPDATE identity_sessions SET revoked_at=clock_timestamp(),compromised_at=clock_timestamp(),version=version+1 WHERE id=$1",
			sessionID); err != nil {
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

	var enabled bool
	if err := tx.QueryRowContext(ctx,
		"SELECT enabled FROM identity_actor_roles WHERE actor_id=$1 AND role=$2 FOR UPDATE",
		actorID, role).Scan(&enabled); err != nil || !enabled {
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
	now := s.now().UTC()
	accessExpiry := now.Add(15 * time.Minute)
	nextRefreshExpiry := now.Add(7 * 24 * time.Hour)
	if _, err := tx.ExecContext(ctx,
		"INSERT INTO identity_refresh_token_history(session_id,token_hash) VALUES($1,$2) ON CONFLICT DO NOTHING",
		sessionID, currentHash); err != nil {
		return domain.TokenPair{}, err
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE identity_sessions SET access_token_hash=$1,refresh_token_hash=$2,access_expires_at=$3,refresh_expires_at=$4,last_used_at=$5,version=version+1 WHERE id=$6",
		identitysecurity.SHA256Hex(access), identitysecurity.SHA256Hex(nextRefresh), accessExpiry, nextRefreshExpiry, now, sessionID); err != nil {
		return domain.TokenPair{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.TokenPair{}, err
	}
	return domain.TokenPair{
		AccessToken: access,
		RefreshToken: sessionID + "." + nextRefresh,
		AccessExpiry: accessExpiry,
		Identity: identityOf(actorID, sessionID, role, accessExpiry),
	}, nil
}

func (s *Service) Logout(ctx context.Context, accessToken string) error {
	hash := identitysecurity.SHA256Hex(strings.TrimSpace(accessToken))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var sessionID, actorID, role string
	err = tx.QueryRowContext(ctx,
		"SELECT id,actor_id,role FROM identity_sessions WHERE access_token_hash=$1 AND revoked_at IS NULL FOR UPDATE",
		hash).Scan(&sessionID, &actorID, &role)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrUnauthenticated
	}
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE identity_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1",
		sessionID); err != nil {
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
	rows, err := s.db.QueryContext(ctx,
		"SELECT id,role,version,created_at,refresh_expires_at,last_used_at,compromised_at FROM identity_sessions WHERE actor_id=$1 AND role=$2 AND revoked_at IS NULL ORDER BY created_at DESC",
		strings.TrimSpace(actorID), role)
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
	result, err := tx.ExecContext(ctx,
		"UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE id=$1 AND actor_id=$2 AND role=$3",
		strings.TrimSpace(sessionID), strings.TrimSpace(actorID), strings.ToLower(strings.TrimSpace(role)))
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
	if _, err := tx.ExecContext(ctx,
		"UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE actor_id=$1 AND role=$2 AND revoked_at IS NULL",
		strings.TrimSpace(actorID), role); err != nil {
		return err
	}
	if err := auditTx(ctx, tx, "session.revoked_role", actorID, principal, "success", correlationID, map[string]any{"role": role}); err != nil {
		return err
	}
	return tx.Commit()
}

func identityOf(actorID, sessionID, role string, expires time.Time) domain.ActorIdentity {
	surface, _ := domain.SurfaceForRole(role)
	return domain.ActorIdentity{
		Subject: actorID,
		SessionID: sessionID,
		Role: role,
		Surface: surface,
		ExpiresAt: expires,
	}
}

func operatorByUsername(ctx context.Context, db *sql.DB, username string) (domain.Actor, error) {
	var a domain.Actor
	err := db.QueryRowContext(ctx,
		"SELECT a.id,a.phone_e164,COALESCE(a.username,''),COALESCE(a.password_hash,''),a.security_enabled,a.version FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id WHERE lower(a.username)=lower($1) AND r.role='operator' AND r.enabled=true AND a.security_enabled=true",
		username).Scan(&a.ID, &a.PhoneE164, &a.Username, &a.PasswordHash, &a.SecurityEnabled, &a.Version)
	return a, err
}

func auditTx(ctx context.Context, tx *sql.Tx, eventType, actorID, principal, outcome, correlationID string, metadata map[string]any) error {
	if metadata == nil {
		metadata = map[string]any{}
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx,
		"INSERT INTO identity_security_audit(event_type,subject_actor_id,principal,outcome,correlation_id,metadata) VALUES($1,NULLIF($2,''),$3,$4,NULLIF($5,''),$6::jsonb)",
		eventType, actorID, principal, outcome, correlationID, string(raw))
	return err
}
