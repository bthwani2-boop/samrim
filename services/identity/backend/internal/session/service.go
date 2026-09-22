package session

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
)

type Service struct {
	db                  *sql.DB
	now                 func() time.Time
	refreshSecret       []byte
	development         bool
	developmentActorIDs map[string]string
}

const refreshRaceGrace = 5 * time.Second

const minimumAccessLifetime = time.Second

func New(db *sql.DB, refreshSecret []byte, development bool, developmentActorIDs map[string]string) *Service {
	normalizedActorIDs := make(map[string]string, len(developmentActorIDs))
	for role, actorID := range developmentActorIDs {
		role = strings.ToLower(strings.TrimSpace(role))
		actorID = strings.TrimSpace(actorID)
		if role == "" || actorID == "" {
			continue
		}
		normalizedActorIDs[role] = actorID
	}
	return &Service{db: db, now: time.Now, refreshSecret: append([]byte(nil), refreshSecret...), development: development, developmentActorIDs: normalizedActorIDs}
}

func (s *Service) CreateDevelopment(ctx context.Context, role, clientInstanceId string) (domain.TokenPair, error) {
	if !s.development {
		return domain.TokenPair{}, domain.ErrForbidden
	}
	role = strings.ToLower(strings.TrimSpace(role))
	if _, ok := domain.SurfaceForRole(role); !ok {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}
	device, err := identitysecurity.NormalizeClientInstanceId(clientInstanceId)
	if err != nil {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}
	actorID := strings.TrimSpace(s.developmentActorIDs[role])
	if actorID == "" {
		return domain.TokenPair{}, domain.ErrNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.TokenPair{}, err
	}
	defer func() { _ = tx.Rollback() }()

	readiness, err := readRoleSessionReadinessTx(ctx, tx, actorID, role)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.TokenPair{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.TokenPair{}, err
	}
	if !roleSessionReady(role, readiness) {
		return domain.TokenPair{}, domain.ErrConflict
	}
	pair, err := s.createTx(ctx, tx, actorID, role, device)
	if err != nil {
		return domain.TokenPair{}, err
	}
	if err := auditTx(ctx, tx, "session.development_created", actorID, "development-local", "success", "", map[string]any{"sessionId": pair.Identity.SessionID, "role": role, "configuredActorId": actorID}); err != nil {
		return domain.TokenPair{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.TokenPair{}, err
	}
	return pair, nil
}

type roleSessionReadiness struct {
	enabled            bool
	securityEnabled    bool
	activated          bool
	passwordCredential bool
	passkeyCredential  bool
}

func roleSessionReady(role string, readiness roleSessionReadiness) bool {
	if !readiness.enabled || !readiness.securityEnabled {
		return false
	}
	switch role {
	case "client":
		return readiness.passwordCredential
	case "partner", "captain", "field":
		return readiness.activated && readiness.passwordCredential
	case "operator":
		return readiness.activated && readiness.passkeyCredential
	default:
		return false
	}
}

func readRoleSessionReadinessTx(ctx context.Context, tx *sql.Tx, actorID, role string) (roleSessionReadiness, error) {
	var readiness roleSessionReadiness
	err := tx.QueryRowContext(ctx, `SELECT r.enabled,
a.security_enabled,
(r.activated_at IS NOT NULL),
EXISTS(SELECT 1 FROM identity_password_credentials c WHERE c.actor_id=r.actor_id AND c.role=r.role),
EXISTS(SELECT 1 FROM identity_webauthn_credentials w WHERE w.actor_id=r.actor_id AND w.revoked_at IS NULL)
FROM identity_actor_roles r
JOIN identity_actors a ON a.id=r.actor_id
WHERE r.actor_id=$1 AND r.role=$2
FOR UPDATE OF r,a`, actorID, role).Scan(&readiness.enabled, &readiness.securityEnabled, &readiness.activated, &readiness.passwordCredential, &readiness.passkeyCredential)
	return readiness, err
}

func (s *Service) CreateTx(ctx context.Context, tx *sql.Tx, actorID, role, clientInstanceId string) (domain.TokenPair, error) {
	device, err := identitysecurity.NormalizeClientInstanceId(clientInstanceId)
	if err != nil {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}
	if _, ok := domain.SurfaceForRole(role); !ok {
		return domain.TokenPair{}, domain.ErrForbidden
	}
	readiness, err := readRoleSessionReadinessTx(ctx, tx, actorID, role)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.TokenPair{}, domain.ErrUnauthenticated
	}
	if err != nil {
		return domain.TokenPair{}, err
	}
	if !roleSessionReady(role, readiness) {
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
	absoluteExpiry := now.Add(sessionAbsoluteLifetime(role, s.development))
	accessExpiry, refreshExpiry, ok := calculateSessionExpiries(role, now, absoluteExpiry, s.development)
	if !ok {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO identity_sessions(id,actor_id,role,access_token_hash,refresh_token_hash,client_instance_id_hash,access_expires_at,refresh_expires_at,absolute_expires_at,last_used_at,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1)", sessionID, actorID, role, identitysecurity.SHA256Hex(access), identitysecurity.SHA256Hex(refreshRandom), identitysecurity.SHA256Hex(device), accessExpiry, refreshExpiry, absoluteExpiry, now); err != nil {
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
	WHERE s.access_token_hash=$1 AND s.revoked_at IS NULL AND s.access_expires_at>clock_timestamp() AND s.absolute_expires_at>clock_timestamp() AND r.enabled=true AND a.security_enabled=true`, identitysecurity.SHA256Hex(accessToken)).Scan(&actorID, &sessionID, &role, &expires)
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
	device, err := identitysecurity.NormalizeClientInstanceId(input.ClientInstanceId)
	if err != nil {
		return domain.TokenPair{}, domain.ErrInvalidInput
	}
	requestID, err := identitysecurity.NormalizeRefreshRequestId(input.RefreshRequestId)
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
	var currentAccessHash, currentHash, deviceHash string
	var createdAt, accessExpiry, refreshExpiry, absoluteExpiry time.Time
	var version int
	err = tx.QueryRowContext(ctx, "SELECT access_token_hash,refresh_token_hash,client_instance_id_hash,created_at,access_expires_at,refresh_expires_at,absolute_expires_at,version FROM identity_sessions WHERE id=$1 AND actor_id=$2 AND role=$3 AND revoked_at IS NULL FOR UPDATE", sessionID, actorID, role).Scan(&currentAccessHash, &currentHash, &deviceHash, &createdAt, &accessExpiry, &refreshExpiry, &absoluteExpiry, &version)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}
	if err != nil {
		return domain.TokenPair{}, err
	}
	now := s.now().UTC()
	if !identitysecurity.ConstantTimeHexEqual(deviceHash, identitysecurity.SHA256Hex(device)) {
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}
	currentTokenMatches := identitysecurity.ConstantTimeHexEqual(currentHash, presentedHash)
	if currentTokenMatches && shouldCutOverLegacyDevelopmentOperatorSession(role, createdAt, refreshExpiry, absoluteExpiry, s.development) {
		absoluteExpiry = createdAt.Add(sessionAbsoluteLifetime(role, true))
		refreshExpiry = calculateRefreshExpiry(role, now, absoluteExpiry, true)
		if !refreshExpiry.After(now) || !absoluteExpiry.After(now) {
			return domain.TokenPair{}, domain.ErrInvalidRefresh
		}
		if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET refresh_expires_at=$1,absolute_expires_at=$2 WHERE id=$3", refreshExpiry, absoluteExpiry, sessionID); err != nil {
			return domain.TokenPair{}, err
		}
		if err := auditTx(ctx, tx, "session.development_policy_cutover", actorID, actorID, "success", "", map[string]any{"sessionId": sessionID, "role": role}); err != nil {
			return domain.TokenPair{}, err
		}
	}
	if !refreshExpiry.After(now) || !absoluteExpiry.After(now) {
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}
	if !currentTokenMatches {
		var rotatedAt time.Time
		var historicalRequestID sql.NullString
		err := tx.QueryRowContext(ctx, "SELECT rotated_at,refresh_request_id FROM identity_refresh_token_history WHERE session_id=$1 AND token_hash=$2", sessionID, presentedHash).Scan(&rotatedAt, &historicalRequestID)
		if errors.Is(err, sql.ErrNoRows) {
			return domain.TokenPair{}, domain.ErrInvalidRefresh
		}
		if err != nil {
			return domain.TokenPair{}, err
		}
		if historicalRequestID.Valid && historicalRequestID.String == requestID {
			pair := s.derivedRefreshPair(sessionID, actorID, role, deviceHash, version, accessExpiry)
			if !identitysecurity.ConstantTimeHexEqual(currentAccessHash, identitysecurity.SHA256Hex(pair.AccessToken)) {
				return domain.TokenPair{}, domain.ErrInvalidRefresh
			}
			if err := auditTx(ctx, tx, "session.refresh_reconciled", actorID, actorID, "success", "", map[string]any{"sessionId": sessionID, "role": role, "version": version}); err != nil {
				return domain.TokenPair{}, err
			}
			if err := tx.Commit(); err != nil {
				return domain.TokenPair{}, err
			}
			return pair, nil
		}
		if withinRefreshRaceGrace(now, rotatedAt) {
			if err := auditTx(ctx, tx, "session.refresh_stale", actorID, actorID, "stale", "", map[string]any{"sessionId": sessionID, "role": role}); err != nil {
				return domain.TokenPair{}, err
			}
			if err := tx.Commit(); err != nil {
				return domain.TokenPair{}, err
			}
			return domain.TokenPair{}, domain.ErrRefreshStale
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
	now = s.now().UTC()
	nextAccessExpiry, nextRefreshExpiry, ok := calculateSessionExpiries(role, now, absoluteExpiry, s.development)
	if !ok {
		return domain.TokenPair{}, domain.ErrInvalidRefresh
	}
	nextVersion := version + 1
	pair := s.derivedRefreshPair(sessionID, actorID, role, deviceHash, nextVersion, nextAccessExpiry)
	if _, err := tx.ExecContext(ctx, "INSERT INTO identity_refresh_token_history(session_id,token_hash,refresh_request_id) VALUES($1,$2,$3)", sessionID, currentHash, requestID); err != nil {
		return domain.TokenPair{}, err
	}
	refreshPart := strings.SplitN(pair.RefreshToken, ".", 2)[1]
	if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET access_token_hash=$1,refresh_token_hash=$2,access_expires_at=$3,refresh_expires_at=$4,last_used_at=$5,version=$6 WHERE id=$7", identitysecurity.SHA256Hex(pair.AccessToken), identitysecurity.SHA256Hex(refreshPart), nextAccessExpiry, nextRefreshExpiry, now, nextVersion, sessionID); err != nil {
		return domain.TokenPair{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.TokenPair{}, err
	}
	return pair, nil
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

func (s *Service) RevokeRoleSession(ctx context.Context, actorID, role, sessionID, principal, correlationID, operatorActorID string) error {
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
	auditPrincipal := principal
	meta := map[string]any{"sessionId": sessionID, "role": role, "workload": principal}
	operatorActorID = strings.TrimSpace(operatorActorID)
	if operatorActorID != "" {
		auditPrincipal = principal + ":" + operatorActorID
		meta["operatorActorId"] = operatorActorID
	}
	if err := auditTx(ctx, tx, "session.revoked", actorID, auditPrincipal, "success", correlationID, meta); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) RevokeRoleAll(ctx context.Context, actorID, role, principal, correlationID, operatorActorID string) error {
	role = strings.ToLower(strings.TrimSpace(role))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE actor_id=$1 AND role=$2 AND revoked_at IS NULL", strings.TrimSpace(actorID), role); err != nil {
		return err
	}
	auditPrincipal := principal
	meta := map[string]any{"role": role, "workload": principal}
	operatorActorID = strings.TrimSpace(operatorActorID)
	if operatorActorID != "" {
		auditPrincipal = principal + ":" + operatorActorID
		meta["operatorActorId"] = operatorActorID
	}
	if err := auditTx(ctx, tx, "session.revoked_role", actorID, auditPrincipal, "success", correlationID, meta); err != nil {
		return err
	}
	return tx.Commit()
}

func identityOf(actorID, sessionID, role string, expires time.Time) domain.ActorIdentity {
	surface, _ := domain.SurfaceForRole(role)
	return domain.ActorIdentity{Subject: actorID, SessionID: sessionID, Role: role, Surface: surface, ExpiresAt: expires}
}

func (s *Service) derivedRefreshPair(sessionID, actorID, role, deviceHash string, version int, accessExpiry time.Time) domain.TokenPair {
	versionValue := strconv.Itoa(version)
	access := identitysecurity.HMAC256Hex(s.refreshSecret, "identity-session-access-v1", sessionID, versionValue, deviceHash)
	refresh := identitysecurity.HMAC256Hex(s.refreshSecret, "identity-session-refresh-v1", sessionID, versionValue, deviceHash)
	return domain.TokenPair{AccessToken: access, RefreshToken: sessionID + "." + refresh, AccessExpiry: accessExpiry, Identity: identityOf(actorID, sessionID, role, accessExpiry)}
}
func shouldCutOverLegacyDevelopmentOperatorSession(role string, createdAt, refreshExpiry, absoluteExpiry time.Time, development bool) bool {
	if !development || role != "operator" {
		return false
	}
	const clockTolerance = 5 * time.Minute
	return !refreshExpiry.After(createdAt.Add(time.Hour+clockTolerance)) &&
		!absoluteExpiry.After(createdAt.Add(24*time.Hour+clockTolerance))
}

func sessionAbsoluteLifetime(role string, development bool) time.Duration {
	if development {
		return 365 * 24 * time.Hour
	}
	if role == "operator" {
		return 24 * time.Hour
	}
	return 365 * 24 * time.Hour
}
func calculateRefreshExpiry(role string, now, absolute time.Time, development bool) time.Time {
	candidate := now.Add(30 * 24 * time.Hour)
	if role == "operator" && !development {
		candidate = now.Add(time.Hour)
	}
	limit := absolute.Add(-time.Second)
	if candidate.After(limit) {
		return limit
	}
	return candidate
}

func calculateSessionExpiries(role string, now, absolute time.Time, development bool) (access, refresh time.Time, ok bool) {
	refresh = calculateRefreshExpiry(role, now, absolute, development)
	if !refresh.After(now.Add(minimumAccessLifetime)) || !absolute.After(refresh) {
		return time.Time{}, time.Time{}, false
	}
	candidate := now.Add(15 * time.Minute)
	limit := refresh.Add(-time.Second)
	if candidate.After(limit) {
		candidate = limit
	}
	if !candidate.After(now) || !refresh.After(candidate) {
		return time.Time{}, time.Time{}, false
	}
	return candidate, refresh, true
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
