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
	"github.com/lib/pq"
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

	var recentFailures int
	if err := s.db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM identity_login_attempts WHERE username=$1 AND succeeded=false AND created_at>clock_timestamp()-interval '15 minutes'",
		username).Scan(&recentFailures); err != nil {
		return domain.TokenPair{}, err
	}
	if recentFailures >= 5 {
		return domain.TokenPair{}, domain.ErrRateLimited
	}

	actor, err := actorByUsername(ctx, s.db, username)
	if err != nil || actor.Status != domain.ActorStatusActive || !identitysecurity.VerifyPassword(actor.PasswordHash, input.Password) {
		_, _ = s.db.ExecContext(ctx, "INSERT INTO identity_login_attempts(username,ip_hash,succeeded) VALUES($1,$2,false)", username, ipHash)
		return domain.TokenPair{}, domain.ErrUnauthenticated
	}
	_, _ = s.db.ExecContext(ctx, "INSERT INTO identity_login_attempts(username,ip_hash,succeeded) VALUES($1,$2,true)", username, ipHash)

	surface, err := onlySurface(actor)
	if err != nil {
		return domain.TokenPair{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.TokenPair{}, err
	}
	defer func() { _ = tx.Rollback() }()
	pair, err := s.createTx(ctx, tx, actor, surface, device)
	if err != nil {
		return domain.TokenPair{}, err
	}
	if err := auditTx(ctx, tx, "session.login", actor.ID, actor.ID, "success", "", map[string]any{"surface": surface}); err != nil {
		return domain.TokenPair{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.TokenPair{}, err
	}
	return pair, nil
}

func (s *Service) CreateForActivationTx(ctx context.Context, tx *sql.Tx, actor domain.Actor, surface, deviceFingerprint string) (domain.TokenPair, error) {
	device, err := identitysecurity.NormalizeDeviceFingerprint(deviceFingerprint)
	if err != nil {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}
	if !domain.SurfaceAccess(actor)[surface] {
		return domain.TokenPair{}, domain.ErrForbidden
	}
	return s.createTx(ctx, tx, actor, surface, device)
}

func (s *Service) createTx(ctx context.Context, tx *sql.Tx, actor domain.Actor, surface, device string) (domain.TokenPair, error) {
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
	_, err = tx.ExecContext(ctx,
		"INSERT INTO identity_sessions(id,actor_id,surface,access_token_hash,refresh_token_hash,device_fingerprint_hash,access_expires_at,refresh_expires_at,last_used_at,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1)",
		sessionID, actor.ID, surface, identitysecurity.SHA256Hex(access), identitysecurity.SHA256Hex(refreshRandom),
		identitysecurity.SHA256Hex(device), accessExpiry, refreshExpiry, now)
	if err != nil {
		return domain.TokenPair{}, err
	}
	return domain.TokenPair{
		AccessToken: access,
		RefreshToken: sessionID + "." + refreshRandom,
		AccessExpiry: accessExpiry,
		Identity: identityOf(actor, sessionID, surface, accessExpiry),
	}, nil
}

func (s *Service) ResolveAccessToken(ctx context.Context, accessToken string) (domain.ActorIdentity, error) {
	accessToken = strings.TrimSpace(accessToken)
	if accessToken == "" {
		return domain.ActorIdentity{}, domain.ErrUnauthenticated
	}
	var a domain.Actor
	var roles pq.StringArray
	var rawPermissions []byte
	var status, sessionID, surface string
	var expires time.Time
	err := s.db.QueryRowContext(ctx,
		"SELECT a.id,a.username,a.phone_e164,a.operator_context_id,a.roles,a.permissions,a.password_hash,a.status,a.version,a.provisioning_fingerprint,a.created_by_service,s.id,s.surface,s.access_expires_at FROM identity_sessions s JOIN identity_actors a ON a.id=s.actor_id WHERE s.access_token_hash=$1 AND s.revoked_at IS NULL AND s.access_expires_at>clock_timestamp() AND a.status='ACTIVE'",
		identitysecurity.SHA256Hex(accessToken)).Scan(
		&a.ID, &a.Username, &a.PhoneE164, &a.OperatorContextID, &roles, &rawPermissions, &a.PasswordHash,
		&status, &a.Version, &a.ProvisioningFingerprint, &a.CreatedByService, &sessionID, &surface, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ActorIdentity{}, domain.ErrUnauthenticated
	}
	if err != nil {
		return domain.ActorIdentity{}, err
	}
	a.Roles, a.Status = []string(roles), domain.ActorStatus(status)
	if err := json.Unmarshal(rawPermissions, &a.Permissions); err != nil {
		return domain.ActorIdentity{}, err
	}
	return identityOf(a, sessionID, surface, expires), nil
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

	var actorID, surface, currentHash, deviceHash string
	var refreshExpiry time.Time
	err = tx.QueryRowContext(ctx,
		"SELECT actor_id,surface,refresh_token_hash,device_fingerprint_hash,refresh_expires_at FROM identity_sessions WHERE id=$1 AND revoked_at IS NULL FOR UPDATE",
		sessionID).Scan(&actorID, &surface, &currentHash, &deviceHash, &refreshExpiry)
	if errors.Is(err, sql.ErrNoRows) || refreshExpiry.Before(s.now()) {
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}
	if err != nil {
		return domain.TokenPair{}, err
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
		if err := auditTx(ctx, tx, "session.refresh_reuse", actorID, actorID, "compromised", "", map[string]any{"sessionId": sessionID}); err != nil {
			return domain.TokenPair{}, err
		}
		if err := tx.Commit(); err != nil {
			return domain.TokenPair{}, err
		}
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}

	actor, err := actorByIDTx(ctx, tx, actorID)
	if err != nil || actor.Status != domain.ActorStatusActive {
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
		"UPDATE identity_sessions SET previous_refresh_token_hash=$1,access_token_hash=$2,refresh_token_hash=$3,access_expires_at=$4,refresh_expires_at=$5,last_used_at=$6,version=version+1 WHERE id=$7",
		currentHash, identitysecurity.SHA256Hex(access), identitysecurity.SHA256Hex(nextRefresh), accessExpiry, nextRefreshExpiry, now, sessionID); err != nil {
		return domain.TokenPair{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.TokenPair{}, err
	}
	return domain.TokenPair{
		AccessToken: access,
		RefreshToken: sessionID + "." + nextRefresh,
		AccessExpiry: accessExpiry,
		Identity: identityOf(actor, sessionID, surface, accessExpiry),
	}, nil
}

func (s *Service) Logout(ctx context.Context, accessToken string) error {
	hash := identitysecurity.SHA256Hex(strings.TrimSpace(accessToken))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var sessionID, actorID string
	err = tx.QueryRowContext(ctx,
		"SELECT id,actor_id FROM identity_sessions WHERE access_token_hash=$1 AND revoked_at IS NULL FOR UPDATE", hash).Scan(&sessionID, &actorID)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrUnauthenticated
	}
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE identity_sessions SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1", sessionID); err != nil {
		return err
	}
	if err := auditTx(ctx, tx, "session.logout", actorID, actorID, "success", "", map[string]any{"sessionId": sessionID}); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) List(ctx context.Context, actorID string) ([]domain.SessionInfo, error) {
	rows, err := s.db.QueryContext(ctx,
		"SELECT id,surface,version,created_at,refresh_expires_at,last_used_at,compromised_at FROM identity_sessions WHERE actor_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC",
		strings.TrimSpace(actorID))
	if err != nil {
		return nil, err
	}
	defer func(){ _ = rows.Close() }()
	result := []domain.SessionInfo{}
	for rows.Next() {
		var item domain.SessionInfo
		if err := rows.Scan(&item.SessionID,&item.Surface,&item.Version,&item.CreatedAt,&item.ExpiresAt,&item.LastUsedAt,&item.CompromisedAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Service) Revoke(ctx context.Context, actorID, sessionID, principal, correlationID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil { return err }
	defer func(){ _ = tx.Rollback() }()
	result, err := tx.ExecContext(ctx,
		"UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE id=$1 AND actor_id=$2",
		strings.TrimSpace(sessionID), strings.TrimSpace(actorID))
	if err != nil { return err }
	count, _ := result.RowsAffected()
	if count == 0 { return domain.ErrNotFound }
	if err := auditTx(ctx, tx, "session.revoked", actorID, principal, "success", correlationID, map[string]any{"sessionId":sessionID}); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) RevokeAll(ctx context.Context, actorID, principal, correlationID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil { return err }
	defer func(){ _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx,
		"UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE actor_id=$1 AND revoked_at IS NULL",
		strings.TrimSpace(actorID)); err != nil {
		return err
	}
	if err := auditTx(ctx, tx, "session.revoked_all", actorID, principal, "success", correlationID, nil); err != nil {
		return err
	}
	return tx.Commit()
}

func onlySurface(actor domain.Actor) (string, error) {
	access := domain.SurfaceAccess(actor)
	if len(access) != 1 {
		return "", domain.ErrForbidden
	}
	for surface := range access {
		return surface, nil
	}
	return "", domain.ErrForbidden
}

func identityOf(actor domain.Actor, sessionID, surface string, expires time.Time) domain.ActorIdentity {
	return domain.ActorIdentity{
		Subject:actor.ID,SessionID:sessionID,OperatorContextID:actor.OperatorContextID,PhoneE164:actor.PhoneE164,
		Roles:actor.Roles,Permissions:actor.Permissions,AuthState:"ACTIVE",SurfaceAccess:domain.SurfaceAccess(actor),
		SessionSurface:surface,ExpiresAt:expires,
	}
}

func actorByUsername(ctx context.Context, db *sql.DB, username string) (domain.Actor, error) {
	return scanActor(func(dest ...any) error {
		return db.QueryRowContext(ctx,
			"SELECT id,username,phone_e164,operator_context_id,roles,permissions,password_hash,status,version,provisioning_fingerprint,created_by_service FROM identity_actors WHERE lower(username)=lower($1)",
			username).Scan(dest...)
	})
}

func actorByIDTx(ctx context.Context, tx *sql.Tx, actorID string) (domain.Actor, error) {
	return scanActor(func(dest ...any) error {
		return tx.QueryRowContext(ctx,
			"SELECT id,username,phone_e164,operator_context_id,roles,permissions,password_hash,status,version,provisioning_fingerprint,created_by_service FROM identity_actors WHERE id=$1 FOR UPDATE",
			actorID).Scan(dest...)
	})
}

type scanner func(dest ...any) error

func scanActor(scan scanner) (domain.Actor, error) {
	var a domain.Actor
	var roles pq.StringArray
	var raw []byte
	var status string
	if err := scan(&a.ID,&a.Username,&a.PhoneE164,&a.OperatorContextID,&roles,&raw,&a.PasswordHash,&status,&a.Version,&a.ProvisioningFingerprint,&a.CreatedByService); err != nil {
		return domain.Actor{}, err
	}
	a.Roles,a.Status=[]string(roles),domain.ActorStatus(status)
	if err := json.Unmarshal(raw,&a.Permissions); err != nil { return domain.Actor{}, err }
	if a.Permissions == nil { a.Permissions=[]domain.Permission{} }
	return a,nil
}

func auditTx(ctx context.Context, tx *sql.Tx, eventType, actorID, principal, outcome, correlationID string, metadata map[string]any) error {
	if metadata == nil { metadata=map[string]any{} }
	raw, err := json.Marshal(metadata)
	if err != nil { return err }
	_, err = tx.ExecContext(ctx,
		"INSERT INTO identity_security_audit(event_type,subject_actor_id,principal,outcome,correlation_id,metadata) VALUES($1,NULLIF($2,''),$3,$4,NULLIF($5,''),$6::jsonb)",
		eventType,actorID,principal,outcome,correlationID,string(raw))
	return err
}
