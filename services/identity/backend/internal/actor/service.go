package actor

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
	"github.com/lib/pq"
)

type Service struct {
	db                         *sql.DB
	developmentOperatorActorID string
}

type rowQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type InitialOperatorBootstrapStatus struct {
	ActorID   string
	CanCreate bool
}

type InitialOperatorPhoneUpdateStatus struct {
	ActorID                              string
	PhoneMatchesRequested                bool
	PendingChallengesForOtherPhone       int
	PendingEnrollmentTokensForOtherPhone int
}

func New(db *sql.DB, developmentOperatorActorID string) *Service {
	return &Service{db: db, developmentOperatorActorID: strings.TrimSpace(developmentOperatorActorID)}
}

// ReadInitialOperatorActorID returns the canonical, persisted bootstrap actor.
// A bootstrap row with a missing actor, Operator role, or permission registry is
// incomplete and must not be repaired implicitly by development login.
func ReadInitialOperatorActorID(ctx context.Context, source rowQueryer) (string, error) {
	var actorID sql.NullString
	err := source.QueryRowContext(ctx, `SELECT initial_operator_actor_id FROM identity_bootstrap_state WHERE id=1`).Scan(&actorID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", domain.ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if !actorID.Valid || strings.TrimSpace(actorID.String) == "" {
		return "", domain.ErrConflict
	}
	canonicalActorID := strings.TrimSpace(actorID.String)
	var exists bool
	if err := source.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM identity_actors a
		JOIN identity_actor_roles r ON r.actor_id=a.id AND r.role='operator'
		WHERE a.id=$1
	)`, canonicalActorID).Scan(&exists); err != nil {
		return "", err
	}
	if !exists {
		return "", domain.ErrConflict
	}
	var permissionCount int
	if err := source.QueryRowContext(ctx, `SELECT count(DISTINCT permission)
		FROM identity_operator_permissions WHERE actor_id=$1 AND role='operator'`, canonicalActorID).Scan(&permissionCount); err != nil {
		return "", err
	}
	if permissionCount != len(domain.OperatorPermissions()) {
		return "", domain.ErrConflict
	}
	return canonicalActorID, nil
}

// ReadInitialOperatorBootstrapStatus reports whether the canonical operator
// exists or the Identity database is still empty enough for first creation.
func ReadInitialOperatorBootstrapStatus(ctx context.Context, source rowQueryer) (InitialOperatorBootstrapStatus, error) {
	actorID, err := ReadInitialOperatorActorID(ctx, source)
	if err == nil {
		return InitialOperatorBootstrapStatus{ActorID: actorID}, nil
	}
	if !errors.Is(err, domain.ErrNotFound) {
		return InitialOperatorBootstrapStatus{}, err
	}
	var occupied bool
	if err := source.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM identity_actors)
		OR EXISTS(SELECT 1 FROM identity_actor_roles)
		OR EXISTS(SELECT 1 FROM identity_password_credentials)
		OR EXISTS(SELECT 1 FROM identity_challenges)
		OR EXISTS(SELECT 1 FROM identity_challenge_deliveries)
		OR EXISTS(SELECT 1 FROM identity_sessions)
		OR EXISTS(SELECT 1 FROM identity_refresh_token_history)
		OR EXISTS(SELECT 1 FROM identity_password_attempts)
		OR EXISTS(SELECT 1 FROM identity_security_audit)
		OR EXISTS(SELECT 1 FROM identity_bootstrap_state)
		OR EXISTS(SELECT 1 FROM identity_operator_permissions)
		OR EXISTS(SELECT 1 FROM identity_actor_legal_name_versions)
		OR EXISTS(SELECT 1 FROM identity_actor_legal_names)
		OR EXISTS(SELECT 1 FROM identity_actor_legal_name_events)
		OR EXISTS(SELECT 1 FROM identity_webauthn_users)
		OR EXISTS(SELECT 1 FROM identity_webauthn_credentials)
		OR EXISTS(SELECT 1 FROM identity_webauthn_ceremonies)
		OR EXISTS(SELECT 1 FROM identity_operator_recovery_credentials)
		OR EXISTS(SELECT 1 FROM identity_operator_enrollment_tokens)
		OR EXISTS(SELECT 1 FROM identity_operator_profiles)
		OR EXISTS(SELECT 1 FROM identity_operator_profile_events)`).Scan(&occupied); err != nil {
		return InitialOperatorBootstrapStatus{}, err
	}
	if occupied {
		return InitialOperatorBootstrapStatus{}, domain.ErrConflict
	}
	return InitialOperatorBootstrapStatus{CanCreate: true}, nil
}

// ReadInitialOperatorPhoneUpdateStatus reads only whether the requested local
// phone matches the canonical actor and how many pending phone-bound proofs
// remain attached to a different phone. Phone values are never returned.
func ReadInitialOperatorPhoneUpdateStatus(ctx context.Context, source rowQueryer, phoneInput string) (InitialOperatorPhoneUpdateStatus, error) {
	phone, err := identitysecurity.NormalizePhoneE164(phoneInput)
	if err != nil {
		return InitialOperatorPhoneUpdateStatus{}, domain.ErrInvalidInput
	}
	actorID, err := ReadInitialOperatorActorID(ctx, source)
	if err != nil {
		return InitialOperatorPhoneUpdateStatus{}, err
	}
	var currentPhone string
	if err := source.QueryRowContext(ctx, `SELECT phone_e164 FROM identity_actors WHERE id=$1`, actorID).Scan(&currentPhone); errors.Is(err, sql.ErrNoRows) {
		return InitialOperatorPhoneUpdateStatus{}, domain.ErrConflict
	} else if err != nil {
		return InitialOperatorPhoneUpdateStatus{}, err
	}
	status := InitialOperatorPhoneUpdateStatus{ActorID: actorID, PhoneMatchesRequested: currentPhone == phone}
	if err := source.QueryRowContext(ctx, `SELECT count(*) FROM identity_challenges
		WHERE actor_id=$1 AND phone_e164<>$2 AND status='pending'`, actorID, phone).Scan(&status.PendingChallengesForOtherPhone); err != nil {
		return InitialOperatorPhoneUpdateStatus{}, err
	}
	if err := source.QueryRowContext(ctx, `SELECT count(*) FROM identity_operator_enrollment_tokens
		WHERE actor_id=$1 AND phone_e164<>$2 AND status='pending'`, actorID, phone).Scan(&status.PendingEnrollmentTokensForOtherPhone); err != nil {
		return InitialOperatorPhoneUpdateStatus{}, err
	}
	return status, nil
}

func readInitialOperatorRoleView(ctx context.Context, source rowQueryer) (domain.ActorRoleView, error) {
	actorID, err := ReadInitialOperatorActorID(ctx, source)
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	var view domain.ActorRoleView
	var activatedAt sql.NullTime
	err = source.QueryRowContext(ctx, `SELECT a.id,a.phone_e164,a.security_enabled,a.version,r.enabled,r.activated_at,r.created_at,r.version
		FROM identity_actors a
		JOIN identity_actor_roles r ON r.actor_id=a.id AND r.role='operator'
		WHERE a.id=$1`, actorID).Scan(&view.ActorID, &view.PhoneE164, &view.SecurityEnabled, &view.ActorVersion, &view.Enabled, &activatedAt, &view.CreatedAt, &view.RoleVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ActorRoleView{}, domain.ErrConflict
	}
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	if activatedAt.Valid {
		value := activatedAt.Time
		view.ActivatedAt = &value
	}
	return view, nil
}

func (s *Service) ProvisionTrustedWithContext(ctx context.Context, caller string, input domain.ProvisionActorRoleInput, actingActorID string) (domain.ActorRoleView, error) {
	return s.provisionTrusted(ctx, caller, input, false, actingActorID)
}

func (s *Service) ProvisionFirstOperatorBootstrap(ctx context.Context, caller string, input domain.ProvisionActorRoleInput) (domain.ActorRoleView, error) {
	if !domain.CanBootstrapFirstOperator(caller) {
		return domain.ActorRoleView{}, domain.ErrForbidden
	}
	input.Role = "operator"
	return s.provisionTrusted(ctx, caller, input, true, "")
}

// UpdateInitialOperatorPhoneForLocal changes only the persisted initial
// Operator's local development phone. The caller is available only through
// the local Docker bootstrap command; ordinary bootstrap remains idempotent.
func (s *Service) UpdateInitialOperatorPhoneForLocal(ctx context.Context, caller, phoneInput string) (domain.ActorRoleView, error) {
	if !domain.CanBootstrapFirstOperator(caller) {
		return domain.ActorRoleView{}, domain.ErrForbidden
	}
	phone, err := identitysecurity.NormalizePhoneE164(phoneInput)
	if err != nil {
		return domain.ActorRoleView{}, domain.ErrInvalidInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:bootstrap:first-operator"); err != nil {
		return domain.ActorRoleView{}, err
	}
	actorID, err := ReadInitialOperatorActorID(ctx, tx)
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:phone:"+phone); err != nil {
		return domain.ActorRoleView{}, err
	}
	var currentPhone string
	var actorVersion int
	if err := tx.QueryRowContext(ctx, "SELECT phone_e164,version FROM identity_actors WHERE id=$1 FOR UPDATE", actorID).Scan(&currentPhone, &actorVersion); err != nil {
		return domain.ActorRoleView{}, err
	}
	phoneChanged := currentPhone != phone
	sessionsRevoked := int64(0)
	if phoneChanged {
		var occupied bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM identity_actors WHERE phone_e164=$1 AND id<>$2)
			OR EXISTS(SELECT 1 FROM identity_operator_profiles WHERE phone_e164=$1)`, phone, actorID).Scan(&occupied); err != nil {
			return domain.ActorRoleView{}, err
		}
		if occupied {
			return domain.ActorRoleView{}, domain.ErrConflict
		}
		result, err := tx.ExecContext(ctx, "UPDATE identity_actors SET phone_e164=$1,version=version+1,updated_at=clock_timestamp() WHERE id=$2 AND version=$3", phone, actorID, actorVersion)
		if err != nil {
			if isUniqueViolation(err) {
				return domain.ActorRoleView{}, domain.ErrConflict
			}
			return domain.ActorRoleView{}, err
		}
		if count, _ := result.RowsAffected(); count != 1 {
			return domain.ActorRoleView{}, domain.ErrConflict
		}
		sessionsResult, err := tx.ExecContext(ctx, `UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1
			WHERE actor_id=$1 AND revoked_at IS NULL`, actorID)
		if err != nil {
			return domain.ActorRoleView{}, err
		}
		sessionsRevoked, err = sessionsResult.RowsAffected()
		if err != nil {
			return domain.ActorRoleView{}, err
		}
	}
	deliveriesResult, err := tx.ExecContext(ctx, `UPDATE identity_challenge_deliveries d
		SET status='suppressed',finished_at=COALESCE(finished_at,clock_timestamp()),updated_at=clock_timestamp()
		FROM identity_challenges c
		WHERE d.challenge_id=c.id AND c.actor_id=$1 AND c.phone_e164<>$2 AND c.status='pending' AND d.status='pending'`, actorID, phone)
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	staleDeliveriesSuppressed, err := deliveriesResult.RowsAffected()
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	challengesResult, err := tx.ExecContext(ctx, `UPDATE identity_challenges SET status='revoked',updated_at=clock_timestamp()
		WHERE actor_id=$1 AND phone_e164<>$2 AND status='pending'`, actorID, phone)
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	staleChallengesRevoked, err := challengesResult.RowsAffected()
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	tokensResult, err := tx.ExecContext(ctx, `UPDATE identity_operator_enrollment_tokens SET status='revoked',updated_at=clock_timestamp()
		WHERE actor_id=$1 AND phone_e164<>$2 AND status='pending'`, actorID, phone)
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	staleTokensRevoked, err := tokensResult.RowsAffected()
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	if !phoneChanged && sessionsRevoked == 0 && staleDeliveriesSuppressed == 0 && staleChallengesRevoked == 0 && staleTokensRevoked == 0 {
		view, err := readInitialOperatorRoleView(ctx, tx)
		if err != nil {
			return domain.ActorRoleView{}, err
		}
		if err := tx.Commit(); err != nil {
			return domain.ActorRoleView{}, err
		}
		return view, nil
	}
	metadata := map[string]any{
		"oldPhone":                     identitysecurity.MaskPhone(currentPhone),
		"newPhone":                     identitysecurity.MaskPhone(phone),
		"workload":                     "local-operator-phone-update",
		"reason":                       "user-authorized local development update",
		"sessionsRevoked":              sessionsRevoked,
		"staleDeliveriesSuppressed":    staleDeliveriesSuppressed,
		"staleChallengesRevoked":       staleChallengesRevoked,
		"staleEnrollmentTokensRevoked": staleTokensRevoked,
	}
	eventType := "actor.phone_changed"
	if !phoneChanged {
		eventType = "actor.phone_change_proofs_revoked"
	}
	if err := auditTx(ctx, tx, eventType, actorID, caller, "success", "", metadata); err != nil {
		return domain.ActorRoleView{}, err
	}
	view, err := readInitialOperatorRoleView(ctx, tx)
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.ActorRoleView{}, err
	}
	return view, nil
}

func (s *Service) provisionTrusted(ctx context.Context, caller string, input domain.ProvisionActorRoleInput, bootstrapOnly bool, actingActorID string) (domain.ActorRoleView, error) {
	caller = strings.ToLower(strings.TrimSpace(caller))
	actingActorID = strings.TrimSpace(actingActorID)
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if bootstrapOnly {
		if !domain.CanBootstrapFirstOperator(caller) || role != "operator" {
			return domain.ActorRoleView{}, domain.ErrForbidden
		}
	} else {
		if !domain.CanProvisionRole(caller, role) {
			return domain.ActorRoleView{}, domain.ErrForbidden
		}
		if (caller == "control-panel" || caller == "dsh") && actingActorID == "" {
			return domain.ActorRoleView{}, domain.ErrInvalidInput
		}
	}
	phoneInput := strings.TrimSpace(input.PhoneE164)
	var phone string
	var err error
	if !bootstrapOnly {
		phone, err = identitysecurity.NormalizePhoneE164(phoneInput)
		if err != nil {
			return domain.ActorRoleView{}, domain.ErrInvalidInput
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	defer func() { _ = tx.Rollback() }()
	lockKey := "identity:phone:" + phone
	if bootstrapOnly {
		lockKey = "identity:bootstrap:first-operator"
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", lockKey); err != nil {
		return domain.ActorRoleView{}, err
	}
	if bootstrapOnly {
		if _, err := tx.ExecContext(ctx, "LOCK TABLE identity_actors IN SHARE ROW EXCLUSIVE MODE"); err != nil {
			return domain.ActorRoleView{}, err
		}
		view, err := readInitialOperatorRoleView(ctx, tx)
		if err == nil {
			if err := tx.Commit(); err != nil {
				return domain.ActorRoleView{}, err
			}
			return view, nil
		}
		if !errors.Is(err, domain.ErrNotFound) {
			return domain.ActorRoleView{}, err
		}
		status, err := ReadInitialOperatorBootstrapStatus(ctx, tx)
		if err != nil {
			return domain.ActorRoleView{}, err
		}
		if !status.CanCreate {
			return domain.ActorRoleView{}, domain.ErrConflict
		}
		phone, err = identitysecurity.NormalizePhoneE164(phoneInput)
		if err != nil {
			return domain.ActorRoleView{}, domain.ErrInvalidInput
		}
	}

	a, err := actorByPhoneTx(ctx, tx, phone)
	actorCreated := false
	if errors.Is(err, sql.ErrNoRows) {
		actorID, err := newActorID()
		if err != nil {
			return domain.ActorRoleView{}, err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO identity_actors(id,phone_e164,version) VALUES($1,$2,1)", actorID, phone); err != nil {
			if isUniqueViolation(err) {
				return domain.ActorRoleView{}, domain.ErrConflict
			}
			return domain.ActorRoleView{}, err
		}
		a = domain.Actor{ID: actorID, PhoneE164: phone, SecurityEnabled: true, Version: 1}
		actorCreated = true
		actorAuditPrincipal := caller
		actorMeta := map[string]any{"workload": caller}
		if strings.TrimSpace(actingActorID) != "" {
			actorAuditPrincipal = caller + ":" + strings.TrimSpace(actingActorID)
			actorMeta["actingActorId"] = strings.TrimSpace(actingActorID)
		}
		if err := auditTx(ctx, tx, "actor.created", actorID, actorAuditPrincipal, "success", "", actorMeta); err != nil {
			return domain.ActorRoleView{}, err
		}
	} else if err != nil {
		return domain.ActorRoleView{}, err
	}

	var enabled bool
	var activatedAt sql.NullTime
	var roleCreatedAt time.Time
	var roleVersion int
	err = tx.QueryRowContext(ctx, "SELECT enabled,activated_at,created_at,version FROM identity_actor_roles WHERE actor_id=$1 AND role=$2 FOR UPDATE", a.ID, role).Scan(&enabled, &activatedAt, &roleCreatedAt, &roleVersion)
	roleCreated := false
	if errors.Is(err, sql.ErrNoRows) {
		if err := tx.QueryRowContext(ctx, "INSERT INTO identity_actor_roles(actor_id,role,enabled,activated_at,version) VALUES($1,$2,true,NULL,1) RETURNING created_at", a.ID, role).Scan(&roleCreatedAt); err != nil {
			return domain.ActorRoleView{}, err
		}
		if bootstrapOnly {
			if _, err := tx.ExecContext(ctx, "INSERT INTO identity_bootstrap_state(id,initial_operator_actor_id) VALUES(1,$1)", a.ID); err != nil {
				return domain.ActorRoleView{}, err
			}
		}
		enabled, roleVersion, roleCreated = true, 1, true
		roleAuditPrincipal := caller
		roleMeta := map[string]any{"role": role, "workload": caller}
		if strings.TrimSpace(actingActorID) != "" {
			roleAuditPrincipal = caller + ":" + strings.TrimSpace(actingActorID)
			roleMeta["actingActorId"] = strings.TrimSpace(actingActorID)
		}
		if err := auditTx(ctx, tx, "actor_role.provisioned", a.ID, roleAuditPrincipal, "success", "", roleMeta); err != nil {
			return domain.ActorRoleView{}, err
		}
	} else if err != nil {
		return domain.ActorRoleView{}, err
	} else if !enabled {
		return domain.ActorRoleView{}, domain.ErrConflict
	} else if bootstrapOnly {
		return domain.ActorRoleView{}, domain.ErrConflict
	}

	if bootstrapOnly {
		if err := tx.QueryRowContext(ctx, "SELECT enabled,activated_at,created_at,version FROM identity_actor_roles WHERE actor_id=$1 AND role=$2", a.ID, role).Scan(&enabled, &activatedAt, &roleCreatedAt, &roleVersion); err != nil {
			return domain.ActorRoleView{}, err
		}
	}
	if role == "operator" {
		for _, permission := range domain.OperatorPermissions() {
			reason := permission + " permission not granted"
			var changedBy any
			if bootstrapOnly {
				reason = "initial operator bootstrap"
				changedBy = a.ID
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO identity_operator_permissions(actor_id,permission,enabled,version,changed_by_actor_id,reason)
				VALUES($1,$2,$3,1,$4,$5) ON CONFLICT(actor_id,permission) DO NOTHING`, a.ID, permission, bootstrapOnly, changedBy, reason); err != nil {
				return domain.ActorRoleView{}, err
			}
			if bootstrapOnly {
				event := "operator.permission_granted"
				if permission == domain.OperatorPermissionFinance {
					event = "operator.finance_permission_granted"
				}
				if err := auditTx(ctx, tx, event, a.ID, caller, "success", "", map[string]any{"permission": permission, "reason": reason, "workload": caller}); err != nil {
					return domain.ActorRoleView{}, err
				}
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return domain.ActorRoleView{}, err
	}
	var activated *time.Time
	if activatedAt.Valid {
		value := activatedAt.Time
		activated = &value
	}
	credVersion := 0
	return domain.ActorRoleView{ActorID: a.ID, PhoneE164: a.PhoneE164, Role: role, Enabled: enabled, ActivatedAt: activated, CreatedAt: roleCreatedAt, SecurityEnabled: a.SecurityEnabled, ActorVersion: a.Version, RoleVersion: roleVersion, CredentialVersion: credVersion, ActorCreated: actorCreated, RoleCreated: roleCreated}, nil
}

func (s *Service) RegisterClientTx(ctx context.Context, tx *sql.Tx, rawPhone, password string) (domain.Actor, error) {
	phone, err := identitysecurity.NormalizePhoneE164(rawPhone)
	if err != nil {
		return domain.Actor{}, domain.ErrInvalidInput
	}
	hash, err := identitysecurity.HashPassword(password)
	if err != nil {
		return domain.Actor{}, domain.ErrInvalidInput
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:phone:"+phone); err != nil {
		return domain.Actor{}, err
	}
	a, err := actorByPhoneTx(ctx, tx, phone)
	if errors.Is(err, sql.ErrNoRows) {
		actorID, err := newActorID()
		if err != nil {
			return domain.Actor{}, err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO identity_actors(id,phone_e164,version) VALUES($1,$2,1)", actorID, phone); err != nil {
			return domain.Actor{}, err
		}
		a = domain.Actor{ID: actorID, PhoneE164: phone, SecurityEnabled: true, Version: 1}
		if err := auditTx(ctx, tx, "actor.created", actorID, "public-client", "success", "", nil); err != nil {
			return domain.Actor{}, err
		}
	} else if err != nil {
		return domain.Actor{}, err
	}
	if !a.SecurityEnabled {
		return domain.Actor{}, domain.ErrActorBlocked
	}
	var enabled bool
	err = tx.QueryRowContext(ctx, "SELECT enabled FROM identity_actor_roles WHERE actor_id=$1 AND role='client' FOR UPDATE", a.ID).Scan(&enabled)
	if errors.Is(err, sql.ErrNoRows) {
		if _, err := tx.ExecContext(ctx, "INSERT INTO identity_actor_roles(actor_id,role,enabled,version) VALUES($1,'client',true,1)", a.ID); err != nil {
			return domain.Actor{}, err
		}
		if err := auditTx(ctx, tx, "actor_role.provisioned", a.ID, "public-client", "success", "", map[string]any{"role": "client"}); err != nil {
			return domain.Actor{}, err
		}
	} else if err != nil {
		return domain.Actor{}, err
	} else if !enabled {
		return domain.Actor{}, domain.ErrActorBlocked
	}
	var exists bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM identity_password_credentials WHERE actor_id=$1 AND role='client')", a.ID).Scan(&exists); err != nil {
		return domain.Actor{}, err
	}
	if exists {
		return domain.Actor{}, domain.ErrConflict
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO identity_password_credentials(actor_id,role,password_hash,version) VALUES($1,'client',$2,1)", a.ID, hash); err != nil {
		return domain.Actor{}, err
	}
	if err := auditTx(ctx, tx, "credential.password_created", a.ID, a.ID, "success", "", map[string]any{"role": "client"}); err != nil {
		return domain.Actor{}, err
	}
	return a, nil
}

func (s *Service) PasswordCredential(ctx context.Context, rawPhone, role string) (domain.Actor, string, int, error) {
	phone, err := identitysecurity.NormalizePhoneE164(rawPhone)
	if err != nil {
		return domain.Actor{}, "", 0, domain.ErrUnauthenticated
	}
	role = strings.ToLower(strings.TrimSpace(role))
	var a domain.Actor
	var hash string
	var credentialVersion int
	err = s.db.QueryRowContext(ctx, `SELECT a.id,a.phone_e164,a.security_enabled,a.version,c.password_hash,c.version
FROM identity_actors a
JOIN identity_actor_roles r ON r.actor_id=a.id
JOIN identity_password_credentials c ON c.actor_id=a.id AND c.role=r.role
WHERE a.phone_e164=$1 AND r.role=$2 AND r.enabled=true AND a.security_enabled=true AND (r.role='client' OR r.activated_at IS NOT NULL)`, phone, role).Scan(&a.ID, &a.PhoneE164, &a.SecurityEnabled, &a.Version, &hash, &credentialVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Actor{}, "", 0, domain.ErrNotFound
	}
	return a, hash, credentialVersion, err
}

func (s *Service) ManagedActivationCandidate(ctx context.Context, rawPhone, role string) (domain.Actor, domain.ActorRole, error) {
	phone, err := identitysecurity.NormalizePhoneE164(rawPhone)
	if err != nil {
		return domain.Actor{}, domain.ActorRole{}, domain.ErrInvalidInput
	}
	role = strings.ToLower(strings.TrimSpace(role))
	if !domain.IsManagedActivationRole(role) {
		return domain.Actor{}, domain.ActorRole{}, domain.ErrInvalidInput
	}
	var a domain.Actor
	var r domain.ActorRole
	var activated sql.NullTime
	err = s.db.QueryRowContext(ctx, `SELECT a.id,a.phone_e164,a.security_enabled,a.version,r.enabled,r.activated_at,r.version
FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id
WHERE a.phone_e164=$1 AND r.role=$2 AND r.enabled=true AND a.security_enabled=true`, phone, role).Scan(&a.ID, &a.PhoneE164, &a.SecurityEnabled, &a.Version, &r.Enabled, &activated, &r.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Actor{}, domain.ActorRole{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Actor{}, domain.ActorRole{}, err
	}
	r.ActorID = a.ID
	r.Role = role
	if activated.Valid {
		value := activated.Time
		r.ActivatedAt = &value
	}
	return a, r, nil
}

func (s *Service) MarkManagedActivatedTx(ctx context.Context, tx *sql.Tx, actorID, role string) error {
	role = strings.ToLower(strings.TrimSpace(role))
	if !domain.IsManagedActivationRole(role) {
		return domain.ErrForbidden
	}
	var enabled, securityEnabled bool
	var activated sql.NullTime
	err := tx.QueryRowContext(ctx, `SELECT r.enabled,a.security_enabled,r.activated_at FROM identity_actor_roles r JOIN identity_actors a ON a.id=r.actor_id
WHERE r.actor_id=$1 AND r.role=$2 FOR UPDATE OF r,a`, actorID, role).Scan(&enabled, &securityEnabled, &activated)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrInvalidActivation
	}
	if err != nil {
		return err
	}
	if !enabled || !securityEnabled || activated.Valid {
		return domain.ErrInvalidActivation
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_actor_roles SET activated_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE actor_id=$1 AND role=$2", actorID, role); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_operator_enrollment_tokens SET status='revoked',updated_at=clock_timestamp() WHERE actor_id=$1 AND role=$2 AND status='pending'", actorID, role); err != nil {
		return err
	}
	return auditTx(ctx, tx, "actor_role.activated", actorID, actorID, "success", "", map[string]any{"role": role})
}

func (s *Service) SetManagedPasswordTx(ctx context.Context, tx *sql.Tx, actorID, role, password string) error {
	role = strings.ToLower(strings.TrimSpace(role))
	if !domain.IsManagedActivationRole(role) {
		return domain.ErrForbidden
	}
	hash, err := identitysecurity.HashPassword(password)
	if err != nil {
		return domain.ErrInvalidInput
	}
	var enabled, securityEnabled bool
	var activated sql.NullTime
	if err := tx.QueryRowContext(ctx, `SELECT r.enabled,a.security_enabled,r.activated_at
FROM identity_actor_roles r JOIN identity_actors a ON a.id=r.actor_id
WHERE r.actor_id=$1 AND r.role=$2 FOR UPDATE OF r,a`, actorID, role).Scan(&enabled, &securityEnabled, &activated); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.ErrInvalidActivation
		}
		return err
	}
	if !enabled || !securityEnabled || !activated.Valid {
		return domain.ErrInvalidActivation
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO identity_password_credentials(actor_id,role,password_hash,version)
VALUES($1,$2,$3,1)
ON CONFLICT (actor_id,role) DO UPDATE SET password_hash=EXCLUDED.password_hash,version=identity_password_credentials.version+1,updated_at=clock_timestamp()`, actorID, role, hash); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE actor_id=$1 AND role=$2 AND revoked_at IS NULL", actorID, role); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_challenges SET status='revoked',updated_at=clock_timestamp() WHERE actor_id=$1 AND role=$2 AND status='pending'", actorID, role); err != nil {
		return err
	}
	return auditTx(ctx, tx, "credential.password_set", actorID, actorID, "success", "", map[string]any{"role": role})
}

func (s *Service) ResetClientPasswordTx(ctx context.Context, tx *sql.Tx, actorID, password string) error {
	hash, err := identitysecurity.HashPassword(password)
	if err != nil {
		return domain.ErrInvalidInput
	}
	result, err := tx.ExecContext(ctx, "UPDATE identity_password_credentials SET password_hash=$1,version=version+1,updated_at=clock_timestamp() WHERE actor_id=$2 AND role='client'", hash, actorID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		return domain.ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE actor_id=$1 AND role='client' AND revoked_at IS NULL", actorID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_challenges SET status='revoked',updated_at=clock_timestamp() WHERE actor_id=$1 AND role='client' AND status='pending'", actorID); err != nil {
		return err
	}
	return auditTx(ctx, tx, "credential.password_reset", actorID, actorID, "success", "", map[string]any{"role": "client"})
}

func (s *Service) ResetManagedPasswordTx(ctx context.Context, tx *sql.Tx, actorID, role, password string) error {
	role = strings.ToLower(strings.TrimSpace(role))
	if !domain.IsManagedActivationRole(role) {
		return domain.ErrForbidden
	}
	hash, err := identitysecurity.HashPassword(password)
	if err != nil {
		return domain.ErrInvalidInput
	}
	var enabled, securityEnabled bool
	var activated sql.NullTime
	if err := tx.QueryRowContext(ctx, `SELECT r.enabled,a.security_enabled,r.activated_at
FROM identity_actor_roles r JOIN identity_actors a ON a.id=r.actor_id
WHERE r.actor_id=$1 AND r.role=$2 FOR UPDATE OF r,a`, actorID, role).Scan(&enabled, &securityEnabled, &activated); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.ErrInvalidChallenge
		}
		return err
	}
	if !enabled || !securityEnabled || !activated.Valid {
		return domain.ErrInvalidChallenge
	}
	result, err := tx.ExecContext(ctx, `UPDATE identity_password_credentials
SET password_hash=$1,version=version+1,updated_at=clock_timestamp()
WHERE actor_id=$2 AND role=$3`, hash, actorID, role)
	if err != nil {
		return err
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if updated != 1 {
		return domain.ErrInvalidChallenge
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE actor_id=$1 AND role=$2 AND revoked_at IS NULL", actorID, role); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_challenges SET status='revoked',updated_at=clock_timestamp() WHERE actor_id=$1 AND role=$2 AND status='pending'", actorID, role); err != nil {
		return err
	}
	return auditTx(ctx, tx, "credential.password_reset", actorID, actorID, "success", "", map[string]any{"role": role})
}

func (s *Service) GetRole(ctx context.Context, caller, actorID, role string) (domain.ActorRoleView, error) {
	caller = strings.ToLower(strings.TrimSpace(caller))
	role = strings.ToLower(strings.TrimSpace(role))
	actorID = strings.TrimSpace(actorID)
	if actorID == "" || !domain.CanReadRole(caller, role) {
		return domain.ActorRoleView{}, domain.ErrForbidden
	}
	view, err := scanRoleView(func(dest ...any) error {
		return s.db.QueryRowContext(ctx, `SELECT a.id,a.phone_e164,
			(SELECT p.full_name_ar FROM identity_operator_profiles p WHERE p.actor_id=a.id ORDER BY p.updated_at DESC,p.id DESC LIMIT 1),
			r.job_title,r.department,
			r.role,r.enabled,r.activated_at,r.created_at,
			CASE WHEN r.role='operator' THEN (SELECT s.created_at FROM identity_sessions s WHERE s.actor_id=a.id AND s.role=r.role ORDER BY s.created_at DESC LIMIT 1) END,
			r.last_app_opened_at,a.security_enabled,a.version,r.version,c.version
			FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id LEFT JOIN identity_password_credentials c ON c.actor_id=r.actor_id AND c.role=r.role WHERE a.id=$1 AND r.role=$2`, actorID, role).Scan(dest...)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ActorRoleView{}, domain.ErrNotFound
	}
	return view, err
}

func (s *Service) ReadCanonicalActor(ctx context.Context, caller, actorID string) (domain.CanonicalActorResolution, error) {
	caller = strings.ToLower(strings.TrimSpace(caller))
	actorID = strings.TrimSpace(actorID)
	if caller != "dsh" {
		return domain.CanonicalActorResolution{}, domain.ErrForbidden
	}
	if actorID == "" || len(actorID) > 128 {
		return domain.CanonicalActorResolution{}, domain.ErrInvalidInput
	}
	var result domain.CanonicalActorResolution
	err := s.db.QueryRowContext(ctx, `SELECT id,security_enabled,version FROM identity_actors WHERE id=$1`, actorID).Scan(&result.ActorID, &result.SecurityEnabled, &result.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.CanonicalActorResolution{}, domain.ErrNotFound
	}
	return result, err
}

func (s *Service) ReadRoles(ctx context.Context, caller, role string, actorIDs []string) ([]domain.ActorRoleView, error) {
	caller = strings.ToLower(strings.TrimSpace(caller))
	role = strings.ToLower(strings.TrimSpace(role))
	if !domain.CanReadRole(caller, role) || len(actorIDs) < 1 || len(actorIDs) > 100 {
		if !domain.CanReadRole(caller, role) {
			return nil, domain.ErrForbidden
		}
		return nil, domain.ErrInvalidInput
	}

	ids := make([]string, 0, len(actorIDs))
	seen := make(map[string]struct{}, len(actorIDs))
	for _, actorID := range actorIDs {
		actorID = strings.TrimSpace(actorID)
		if actorID == "" || len(actorID) > 128 || !utf8.ValidString(actorID) {
			return nil, domain.ErrInvalidInput
		}
		if _, exists := seen[actorID]; exists {
			return nil, domain.ErrInvalidInput
		}
		seen[actorID] = struct{}{}
		ids = append(ids, actorID)
	}

	rows, err := s.db.QueryContext(ctx, `SELECT a.id,a.phone_e164,
		(SELECT p.full_name_ar FROM identity_operator_profiles p WHERE p.actor_id=a.id ORDER BY p.updated_at DESC,p.id DESC LIMIT 1),
		r.job_title,r.department,
		r.role,r.enabled,r.activated_at,r.created_at,
		CASE WHEN r.role='operator' THEN (SELECT s.created_at FROM identity_sessions s WHERE s.actor_id=a.id AND s.role=r.role ORDER BY s.created_at DESC LIMIT 1) END,
		r.last_app_opened_at,a.security_enabled,a.version,r.version,c.version
		FROM identity_actors a
		JOIN identity_actor_roles r ON r.actor_id=a.id
		LEFT JOIN identity_password_credentials c ON c.actor_id=r.actor_id AND c.role=r.role
		WHERE r.role=$1 AND a.id=ANY($2::text[])
		ORDER BY a.id`, role, pq.Array(ids))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.ActorRoleView, 0, len(ids))
	for rows.Next() {
		item, scanErr := scanRoleView(rows.Scan)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Service) Search(ctx context.Context, caller string, input domain.ActorSearchInput) (domain.ActorSearchPage, error) {
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if !domain.CanReadRole(caller, role) {
		return domain.ActorSearchPage{}, domain.ErrForbidden
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 25
	}
	if limit > 100 {
		return domain.ActorSearchPage{}, domain.ErrInvalidInput
	}
	q := strings.TrimSpace(input.Query)
	if utf8.RuneCountInString(q) > 100 {
		return domain.ActorSearchPage{}, domain.ErrInvalidInput
	}
	sort := strings.TrimSpace(input.Sort)
	if sort == "" {
		sort = "phone_asc"
	}
	if sort != "phone_asc" && sort != "phone_desc" {
		return domain.ActorSearchPage{}, domain.ErrInvalidInput
	}
	permissionCoverage := strings.TrimSpace(input.PermissionCoverage)
	if permissionCoverage != "" {
		if role != "operator" || (permissionCoverage != "none" && permissionCoverage != "some" && permissionCoverage != "complete") {
			return domain.ActorSearchPage{}, domain.ErrInvalidInput
		}
	}
	args := []any{role}
	clauses := []string{"r.role=$1"}
	queryArg := 0
	if input.Enabled != nil {
		args = append(args, *input.Enabled)
		clauses = append(clauses, fmt.Sprintf("r.enabled=$%d", len(args)))
	}
	if q != "" {
		if phone, err := identitysecurity.NormalizePhoneE164(q); err == nil {
			q = phone
		}
		args = append(args, q)
		queryArg = len(args)
		clauses = append(clauses, fmt.Sprintf("position($%d in a.phone_e164)>0", queryArg))
	}
	cursorClause := ""
	if input.Cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(input.Cursor)
		if err != nil {
			return domain.ActorSearchPage{}, domain.ErrInvalidInput
		}
		parts := strings.SplitN(string(raw), "|", 3)
		afterPhone, afterID := "", ""
		if len(parts) == 2 && sort == "phone_asc" {
			afterPhone, afterID = parts[0], parts[1]
		} else if len(parts) == 3 && parts[0] == sort {
			afterPhone, afterID = parts[1], parts[2]
		} else {
			return domain.ActorSearchPage{}, domain.ErrInvalidInput
		}
		if afterPhone == "" || afterID == "" {
			return domain.ActorSearchPage{}, domain.ErrInvalidInput
		}
		args = append(args, afterPhone, afterID)
		phoneArg, idArg := len(args)-1, len(args)
		comparison := ">"
		if sort == "phone_desc" {
			comparison = "<"
		}
		cursorClause = fmt.Sprintf(" AND (a.phone_e164%s$%d OR (a.phone_e164=$%d AND a.id%s$%d))", comparison, phoneArg, phoneArg, comparison, idArg)
	}
	order := "ASC"
	if sort == "phone_desc" {
		order = "DESC"
	}
	if q != "" && role == "operator" {
		clauses[len(clauses)-1] = fmt.Sprintf("(position($%d in a.phone_e164)>0 OR position(lower($%d) in lower(r.job_title))>0 OR position(lower($%d) in lower(r.department))>0 OR EXISTS (SELECT 1 FROM identity_operator_profiles p WHERE p.actor_id=a.id AND position(lower($%d) in lower(p.full_name_ar))>0))", queryArg, queryArg, queryArg, queryArg)
	}
	permissionSummaryJoin := ""
	permissionSummaryColumn := ""
	if role == "operator" {
		permissionSummaryJoin = ` LEFT JOIN LATERAL (
			SELECT count(*) FILTER (WHERE p.enabled) AS enabled_count
			FROM identity_operator_permissions p
			WHERE p.actor_id=a.id AND p.role=r.role
		) permission_summary ON true`
		permissionSummaryColumn = ",permission_summary.enabled_count"
	}
	if permissionCoverage != "" {
		permissionCount := "permission_summary.enabled_count"
		switch permissionCoverage {
		case "none":
			clauses = append(clauses, permissionCount+"=0")
		case "some":
			args = append(args, len(domain.OperatorPermissions()))
			clauses = append(clauses, fmt.Sprintf("%s>0 AND %s<$%d", permissionCount, permissionCount, len(args)))
		case "complete":
			args = append(args, len(domain.OperatorPermissions()))
			clauses = append(clauses, fmt.Sprintf("%s=$%d", permissionCount, len(args)))
		}
	}
	args = append(args, limit+1)
	query := "SELECT a.id,a.phone_e164,(SELECT p.full_name_ar FROM identity_operator_profiles p WHERE p.actor_id=a.id ORDER BY p.updated_at DESC,p.id DESC LIMIT 1),r.job_title,r.department,r.role,r.enabled,r.activated_at,r.created_at,CASE WHEN r.role='operator' THEN (SELECT s.created_at FROM identity_sessions s WHERE s.actor_id=a.id AND s.role=r.role ORDER BY s.created_at DESC LIMIT 1) END,r.last_app_opened_at,a.security_enabled,a.version,r.version,c.version" + permissionSummaryColumn + " FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id LEFT JOIN identity_password_credentials c ON c.actor_id=r.actor_id AND c.role=r.role" + permissionSummaryJoin + " WHERE " + strings.Join(clauses, " AND ") + cursorClause + " ORDER BY a.phone_e164 " + order + ",a.id " + order + " LIMIT $" + strconv.Itoa(len(args))
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return domain.ActorSearchPage{}, err
	}
	defer func() { _ = rows.Close() }()
	items := []domain.ActorRoleView{}
	for rows.Next() {
		var view domain.ActorRoleView
		var enabledPermissionCount int
		var err error
		if role == "operator" {
			view, err = scanRoleView(rows.Scan, &enabledPermissionCount)
			view.OperatorEnabledPermissionCount = &enabledPermissionCount
		} else {
			view, err = scanRoleView(rows.Scan)
		}
		if err != nil {
			return domain.ActorSearchPage{}, err
		}
		items = append(items, view)
	}
	if err := rows.Err(); err != nil {
		return domain.ActorSearchPage{}, err
	}
	page := domain.ActorSearchPage{Items: items, Limit: limit}
	if len(items) > limit {
		last := items[limit-1]
		page.Items = items[:limit]
		page.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(sort + "|" + last.PhoneE164 + "|" + last.ActorID))
	}
	return page, nil
}

func (s *Service) ReadOperatorPermission(ctx context.Context, caller, actorID, actingActorID, permission string) (domain.OperatorPermissionAccess, error) {
	caller = strings.ToLower(strings.TrimSpace(caller))
	actorID = strings.TrimSpace(actorID)
	actingActorID = strings.TrimSpace(actingActorID)
	permission = strings.ToLower(strings.TrimSpace(permission))
	if actorID == "" || !domain.IsOperatorPermission(permission) {
		return domain.OperatorPermissionAccess{}, domain.ErrInvalidInput
	}
	switch caller {
	case "control-panel":
		if actingActorID == "" {
			return domain.OperatorPermissionAccess{}, domain.ErrInvalidInput
		}
		if err := s.requireOperatorPermissionAdministrator(ctx, s.db, actingActorID); err != nil {
			return domain.OperatorPermissionAccess{}, err
		}
	case "dsh":
		if actingActorID != "" {
			return domain.OperatorPermissionAccess{}, domain.ErrInvalidInput
		}
	default:
		return domain.OperatorPermissionAccess{}, domain.ErrForbidden
	}
	return readOperatorPermission(ctx, s.db, actorID, permission)
}

func (s *Service) SetOperatorPermission(ctx context.Context, caller, actorID, actingActorID, permission string, enabled bool, correlationID, reason string, expectedVersion int) (domain.OperatorPermissionAccess, error) {
	caller = strings.ToLower(strings.TrimSpace(caller))
	actorID = strings.TrimSpace(actorID)
	actingActorID = strings.TrimSpace(actingActorID)
	permission = strings.ToLower(strings.TrimSpace(permission))
	reason = strings.TrimSpace(reason)
	if caller != "control-panel" {
		return domain.OperatorPermissionAccess{}, domain.ErrForbidden
	}
	if actorID == "" || actingActorID == "" || !domain.IsOperatorPermission(permission) || expectedVersion < 1 || utf8.RuneCountInString(reason) < 5 || utf8.RuneCountInString(reason) > 500 {
		return domain.OperatorPermissionAccess{}, domain.ErrInvalidInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.OperatorPermissionAccess{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := s.requireOperatorPermissionAdministrator(ctx, tx, actingActorID); err != nil {
		return domain.OperatorPermissionAccess{}, err
	}
	var roleEnabled, currentEnabled bool
	var currentVersion int
	err = tx.QueryRowContext(ctx, `SELECT r.enabled,p.enabled,p.version
		FROM identity_actor_roles r
		JOIN identity_operator_permissions p ON p.actor_id=r.actor_id AND p.permission=$2
		WHERE r.actor_id=$1 AND r.role='operator'
		FOR UPDATE OF r,p`, actorID, permission).Scan(&roleEnabled, &currentEnabled, &currentVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.OperatorPermissionAccess{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.OperatorPermissionAccess{}, err
	}
	if actorID == actingActorID || !roleEnabled || currentVersion != expectedVersion {
		return domain.OperatorPermissionAccess{}, domain.ErrConflict
	}
	if currentEnabled == enabled {
		view, err := readOperatorPermission(ctx, tx, actorID, permission)
		if err != nil {
			return domain.OperatorPermissionAccess{}, err
		}
		if err := tx.Commit(); err != nil {
			return domain.OperatorPermissionAccess{}, err
		}
		return view, nil
	}
	result, err := tx.ExecContext(ctx, `UPDATE identity_operator_permissions
		SET enabled=$1,version=version+1,changed_by_actor_id=$2,reason=$3,updated_at=clock_timestamp()
		WHERE actor_id=$4 AND permission=$5 AND version=$6`, enabled, actingActorID, reason, actorID, permission, expectedVersion)
	if err != nil {
		return domain.OperatorPermissionAccess{}, err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return domain.OperatorPermissionAccess{}, domain.ErrConflict
	}
	if _, err := tx.ExecContext(ctx, `UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1
		WHERE actor_id=$1 AND role='operator' AND revoked_at IS NULL`, actorID); err != nil {
		return domain.OperatorPermissionAccess{}, err
	}
	meta := map[string]any{"permission": permission, "enabled": enabled, "reason": reason, "expectedVersion": expectedVersion, "operatorActorId": actingActorID, "workload": caller}
	if err := auditTx(ctx, tx, "operator.permission_changed", actorID, caller+":"+actingActorID, "success", strings.TrimSpace(correlationID), meta); err != nil {
		return domain.OperatorPermissionAccess{}, err
	}
	view, err := readOperatorPermission(ctx, tx, actorID, permission)
	if err != nil {
		return domain.OperatorPermissionAccess{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.OperatorPermissionAccess{}, err
	}
	return view, nil
}

type financeAccessQueryer = rowQueryer

func IsOperatorPermissionAdministrator(ctx context.Context, source rowQueryer, actorID, developmentOperatorActorID string) (bool, error) {
	actorID = strings.TrimSpace(actorID)
	developmentOperatorActorID = strings.TrimSpace(developmentOperatorActorID)
	if actorID == "" {
		return false, nil
	}
	canonicalActorID, err := ReadInitialOperatorActorID(ctx, source)
	if errors.Is(err, domain.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return actorID == canonicalActorID && (developmentOperatorActorID == "" || developmentOperatorActorID == canonicalActorID), nil
}

func (s *Service) requireOperatorPermissionAdministrator(ctx context.Context, source financeAccessQueryer, actorID string) error {
	authorized, err := IsOperatorPermissionAdministrator(ctx, source, actorID, s.developmentOperatorActorID)
	if err != nil {
		return err
	}
	if !authorized {
		return domain.ErrForbidden
	}
	return nil
}

func readOperatorPermission(ctx context.Context, source financeAccessQueryer, actorID, permission string) (domain.OperatorPermissionAccess, error) {
	var view domain.OperatorPermissionAccess
	var changedBy sql.NullString
	err := source.QueryRowContext(ctx, `SELECT p.actor_id,p.permission,p.enabled,p.version,p.changed_by_actor_id,p.reason,p.updated_at
		FROM identity_operator_permissions p
		JOIN identity_actor_roles r ON r.actor_id=p.actor_id AND r.role=p.role
		WHERE p.actor_id=$1 AND p.permission=$2`, actorID, permission).Scan(&view.ActorID, &view.Permission, &view.Enabled, &view.Version, &changedBy, &view.Reason, &view.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.OperatorPermissionAccess{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.OperatorPermissionAccess{}, err
	}
	if changedBy.Valid {
		value := changedBy.String
		view.ChangedByActorID = &value
	}
	return view, nil
}

func (s *Service) SetRoleEnabledWithContext(ctx context.Context, caller, actorID, role string, enabled bool, correlationID, reason string, expectedVersion int, operatorActorID string) error {
	caller = strings.ToLower(strings.TrimSpace(caller))
	actorID = strings.TrimSpace(actorID)
	role = strings.ToLower(strings.TrimSpace(role))
	operatorActorID = strings.TrimSpace(operatorActorID)
	if actorID == "" || !domain.CanSetRoleEnabled(caller, role) || len(strings.TrimSpace(reason)) > 500 {
		return domain.ErrForbidden
	}
	if (caller == "control-panel" || caller == "dsh") && operatorActorID == "" {
		return domain.ErrInvalidInput
	}
	if (caller == "control-panel" || caller == "dsh") && expectedVersion < 1 {
		return domain.ErrInvalidInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var current bool
	var currentVersion int
	err = tx.QueryRowContext(ctx, "SELECT enabled, version FROM identity_actor_roles WHERE actor_id=$1 AND role=$2 FOR UPDATE", actorID, role).Scan(&current, &currentVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrNotFound
	}
	if err != nil {
		return err
	}
	if expectedVersion > 0 && currentVersion != expectedVersion {
		return domain.ErrConflict
	}
	if current == enabled {
		return tx.Commit()
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_actor_roles SET enabled=$1,version=version+1,updated_at=clock_timestamp() WHERE actor_id=$2 AND role=$3", enabled, actorID, role); err != nil {
		return err
	}
	if !enabled {
		if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE actor_id=$1 AND role=$2 AND revoked_at IS NULL", actorID, role); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE identity_challenges SET status='revoked',updated_at=clock_timestamp() WHERE actor_id=$1 AND role=$2 AND status='pending'", actorID, role); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE identity_operator_enrollment_tokens SET status='revoked',updated_at=clock_timestamp() WHERE actor_id=$1 AND role=$2 AND status='pending'", actorID, role); err != nil {
			return err
		}
	}
	auditPrincipal := caller
	meta := map[string]any{"role": role, "enabled": enabled, "reason": strings.TrimSpace(reason), "workload": caller}
	if operatorActorID != "" {
		auditPrincipal = caller + ":" + operatorActorID
		meta["operatorActorId"] = operatorActorID
	}
	if err := auditTx(ctx, tx, "actor_role.enabled_changed", actorID, auditPrincipal, "success", correlationID, meta); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) AuthorizeReenrollmentWithContext(ctx context.Context, caller, actorID, role, correlationID, operatorActorID, reason string, expectedActorVersion, expectedRoleVersion int) error {
	caller = strings.ToLower(strings.TrimSpace(caller))
	actorID = strings.TrimSpace(actorID)
	role = strings.ToLower(strings.TrimSpace(role))
	operatorActorID = strings.TrimSpace(operatorActorID)
	reason = strings.TrimSpace(reason)
	if actorID == "" || !domain.CanAuthorizeReenrollment(caller, role) {
		return domain.ErrForbidden
	}
	if operatorActorID == "" || expectedActorVersion < 1 || expectedRoleVersion < 1 || utf8.RuneCountInString(reason) < 5 || utf8.RuneCountInString(reason) > 500 {
		return domain.ErrInvalidInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var actorVersion, roleVersion int
	var enabled, securityEnabled bool
	var activatedAt sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT a.version,a.security_enabled,r.enabled,r.activated_at,r.version
FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id
WHERE a.id=$1 AND r.role=$2 FOR UPDATE OF a,r`, actorID, role).Scan(&actorVersion, &securityEnabled, &enabled, &activatedAt, &roleVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrNotFound
	}
	if err != nil {
		return err
	}
	if actorVersion != expectedActorVersion || roleVersion != expectedRoleVersion || !enabled || !securityEnabled || !activatedAt.Valid {
		return domain.ErrConflict
	}
	result, err := tx.ExecContext(ctx, `UPDATE identity_actor_roles SET activated_at=NULL,version=version+1,updated_at=clock_timestamp()
WHERE actor_id=$1 AND role=$2 AND version=$3 AND activated_at IS NOT NULL`, actorID, role, expectedRoleVersion)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count != 1 {
		return domain.ErrConflict
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE actor_id=$1 AND role=$2 AND revoked_at IS NULL", actorID, role); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_challenges SET status='revoked',updated_at=clock_timestamp() WHERE actor_id=$1 AND role=$2 AND status='pending'", actorID, role); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_operator_enrollment_tokens SET status='revoked',updated_at=clock_timestamp() WHERE actor_id=$1 AND role=$2 AND status='pending'", actorID, role); err != nil {
		return err
	}
	meta := map[string]any{"role": role, "workload": caller, "operatorActorId": operatorActorID, "reason": reason, "actorVersion": actorVersion, "roleVersion": roleVersion}
	auditPrincipal := caller + ":" + operatorActorID
	if err := auditTx(ctx, tx, "actor_role.reenrollment_authorized", actorID, auditPrincipal, "success", correlationID, meta); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) SetSecurityEnabledWithContext(ctx context.Context, caller, actorID string, enabled bool, correlationID, reason string, expectedVersion int, operatorActorID string) error {
	caller = strings.ToLower(strings.TrimSpace(caller))
	actorID = strings.TrimSpace(actorID)
	operatorActorID = strings.TrimSpace(operatorActorID)
	if caller != "control-panel" || actorID == "" || len(strings.TrimSpace(reason)) > 500 {
		return domain.ErrForbidden
	}
	if operatorActorID == "" || expectedVersion < 1 {
		return domain.ErrInvalidInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var current bool
	var currentVersion int
	err = tx.QueryRowContext(ctx, "SELECT security_enabled, version FROM identity_actors WHERE id=$1 FOR UPDATE", actorID).Scan(&current, &currentVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrNotFound
	}
	if err != nil {
		return err
	}
	if currentVersion != expectedVersion {
		return domain.ErrConflict
	}
	if current == enabled {
		return tx.Commit()
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_actors SET security_enabled=$1,version=version+1,updated_at=clock_timestamp() WHERE id=$2", enabled, actorID); err != nil {
		return err
	}
	if !enabled {
		if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE actor_id=$1 AND revoked_at IS NULL", actorID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE identity_challenges SET status='revoked',updated_at=clock_timestamp() WHERE actor_id=$1 AND status='pending'", actorID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE identity_operator_enrollment_tokens SET status='revoked',updated_at=clock_timestamp() WHERE actor_id=$1 AND status='pending'", actorID); err != nil {
			return err
		}
	}
	auditPrincipal := caller
	meta := map[string]any{"securityEnabled": enabled, "reason": strings.TrimSpace(reason), "workload": caller}
	if operatorActorID != "" {
		auditPrincipal = caller + ":" + operatorActorID
		meta["operatorActorId"] = operatorActorID
	}
	if err := auditTx(ctx, tx, "actor.security_enabled_changed", actorID, auditPrincipal, "success", correlationID, meta); err != nil {
		return err
	}
	return tx.Commit()
}

func newActorID() (string, error) {
	token, err := identitysecurity.RandomToken(18)
	if err != nil {
		return "", err
	}
	return "act_" + token, nil
}

type scanner func(dest ...any) error

func scanRoleView(scan scanner, extra ...any) (domain.ActorRoleView, error) {
	var view domain.ActorRoleView
	var fullNameAr sql.NullString
	var activated, lastAuthenticatedAt, lastAppOpenedAt sql.NullTime
	var credVersion sql.NullInt64
	destinations := []any{&view.ActorID, &view.PhoneE164, &fullNameAr, &view.JobTitle, &view.Department, &view.Role, &view.Enabled, &activated, &view.CreatedAt, &lastAuthenticatedAt, &lastAppOpenedAt, &view.SecurityEnabled, &view.ActorVersion, &view.RoleVersion, &credVersion}
	destinations = append(destinations, extra...)
	if err := scan(destinations...); err != nil {
		return domain.ActorRoleView{}, err
	}
	if fullNameAr.Valid {
		view.FullNameAr = fullNameAr.String
	}
	if activated.Valid {
		value := activated.Time
		view.ActivatedAt = &value
	}
	if lastAuthenticatedAt.Valid {
		value := lastAuthenticatedAt.Time
		view.LastAuthenticatedAt = &value
	}
	if lastAppOpenedAt.Valid {
		value := lastAppOpenedAt.Time
		view.LastAppOpenedAt = &value
	}
	if credVersion.Valid && credVersion.Int64 > 0 {
		view.CredentialVersion = int(credVersion.Int64)
	}
	return view, nil
}
func actorByPhoneTx(ctx context.Context, tx *sql.Tx, phone string) (domain.Actor, error) {
	var a domain.Actor
	err := tx.QueryRowContext(ctx, "SELECT id,phone_e164,security_enabled,version FROM identity_actors WHERE phone_e164=$1 FOR UPDATE", phone).Scan(&a.ID, &a.PhoneE164, &a.SecurityEnabled, &a.Version)
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
	_, err = tx.ExecContext(ctx, "INSERT INTO identity_security_audit(event_type,subject_actor_id,principal,outcome,correlation_id,metadata) VALUES($1,NULLIF($2,''),$3,$4,NULLIF($5,''),$6::jsonb)", eventType, actorID, principal, outcome, correlationID, string(raw))
	return err
}
func isUniqueViolation(err error) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && string(pqErr.Code) == "23505"
}
