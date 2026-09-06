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

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
	"github.com/lib/pq"
)

type Service struct{ db *sql.DB }

func New(db *sql.DB) *Service { return &Service{db: db} }

func (s *Service) ProvisionTrusted(ctx context.Context, caller string, input domain.ProvisionActorRoleInput) (domain.ActorRoleView, error) {
	return s.provisionTrusted(ctx, caller, input, false)
}

func (s *Service) ProvisionPlatformOwnerBootstrap(ctx context.Context, caller string, input domain.ProvisionActorRoleInput) (domain.ActorRoleView, error) {
	if !domain.CanBootstrapPlatformOwner(caller) {
		return domain.ActorRoleView{}, domain.ErrForbidden
	}
	input.Role = "platform_owner"
	return s.provisionTrusted(ctx, caller, input, true)
}

func (s *Service) provisionTrusted(ctx context.Context, caller string, input domain.ProvisionActorRoleInput, bootstrapOnly bool) (domain.ActorRoleView, error) {
	caller = strings.ToLower(strings.TrimSpace(caller))
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if bootstrapOnly {
		if !domain.CanBootstrapPlatformOwner(caller) || role != "platform_owner" {
			return domain.ActorRoleView{}, domain.ErrForbidden
		}
	} else if !domain.CanProvisionRole(caller, role) {
		return domain.ActorRoleView{}, domain.ErrForbidden
	}
	phone, err := identitysecurity.NormalizePhoneE164(input.PhoneE164)
	if err != nil {
		return domain.ActorRoleView{}, domain.ErrInvalidInput
	}

	passwordHash := ""
	if role == "platform_owner" {
		passwordHash, err = identitysecurity.HashPassword(input.Password)
		if err != nil {
			return domain.ActorRoleView{}, domain.ErrInvalidInput
		}
	} else if input.Password != "" {
		return domain.ActorRoleView{}, domain.ErrInvalidInput
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	defer func() { _ = tx.Rollback() }()
	lockKey := "identity:phone:" + phone
	if role == "platform_owner" {
		lockKey = "identity:bootstrap:platform-owner"
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", lockKey); err != nil {
		return domain.ActorRoleView{}, err
	}
	if role == "platform_owner" {
		var exists bool
		if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM identity_actor_roles WHERE role='platform_owner')").Scan(&exists); err != nil {
			return domain.ActorRoleView{}, err
		}
		if !exists {
			if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM identity_bootstrap_state)").Scan(&exists); err != nil {
				return domain.ActorRoleView{}, err
			}
		}
		if exists {
			return domain.ActorRoleView{}, domain.ErrConflict
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
		if err := auditTx(ctx, tx, "actor.created", actorID, caller, "success", "", nil); err != nil {
			return domain.ActorRoleView{}, err
		}
	} else if err != nil {
		return domain.ActorRoleView{}, err
	}

	var enabled bool
	var activatedAt sql.NullTime
	var roleVersion int
	err = tx.QueryRowContext(ctx, "SELECT enabled,activated_at,version FROM identity_actor_roles WHERE actor_id=$1 AND role=$2 FOR UPDATE", a.ID, role).Scan(&enabled, &activatedAt, &roleVersion)
	roleCreated := false
	if errors.Is(err, sql.ErrNoRows) {
		activatedAtValue := "NULL"
		if role == "platform_owner" {
			activatedAtValue = "clock_timestamp()"
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO identity_actor_roles(actor_id,role,enabled,activated_at,version) VALUES($1,$2,true,"+activatedAtValue+",1)", a.ID, role); err != nil {
			return domain.ActorRoleView{}, err
		}
		if role == "platform_owner" {
			if _, err := tx.ExecContext(ctx, "INSERT INTO identity_bootstrap_state(id,platform_owner_actor_id) VALUES(1,$1)", a.ID); err != nil {
				return domain.ActorRoleView{}, err
			}
		}
		enabled, roleVersion, roleCreated = true, 1, true
		if err := auditTx(ctx, tx, "actor_role.provisioned", a.ID, caller, "success", "", map[string]any{"role": role}); err != nil {
			return domain.ActorRoleView{}, err
		}
	} else if err != nil {
		return domain.ActorRoleView{}, err
	} else if !enabled {
		return domain.ActorRoleView{}, domain.ErrConflict
	}
	if role == "platform_owner" && !activatedAt.Valid {
		if _, err := tx.ExecContext(ctx, "UPDATE identity_actor_roles SET activated_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE actor_id=$1 AND role=$2", a.ID, role); err != nil {
			return domain.ActorRoleView{}, err
		}
	}
	if role == "platform_owner" {
		if err := tx.QueryRowContext(ctx, "SELECT enabled,activated_at,version FROM identity_actor_roles WHERE actor_id=$1 AND role=$2", a.ID, role).Scan(&enabled, &activatedAt, &roleVersion); err != nil {
			return domain.ActorRoleView{}, err
		}
	}

	if role == "platform_owner" {
		var currentHash string
		err := tx.QueryRowContext(ctx, "SELECT password_hash FROM identity_password_credentials WHERE actor_id=$1 AND role=$2 FOR UPDATE", a.ID, role).Scan(&currentHash)
		if errors.Is(err, sql.ErrNoRows) {
			if _, err := tx.ExecContext(ctx, "INSERT INTO identity_password_credentials(actor_id,role,password_hash,version) VALUES($1,$2,$3,1)", a.ID, role, passwordHash); err != nil {
				return domain.ActorRoleView{}, err
			}
			if err := auditTx(ctx, tx, "credential.password_created", a.ID, caller, "success", "", map[string]any{"role": role}); err != nil {
				return domain.ActorRoleView{}, err
			}
		} else if err != nil {
			return domain.ActorRoleView{}, err
		} else if !identitysecurity.VerifyPassword(currentHash, input.Password) {
			return domain.ActorRoleView{}, domain.ErrConflict
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
	return domain.ActorRoleView{ActorID: a.ID, PhoneE164: a.PhoneE164, Role: role, Enabled: enabled, ActivatedAt: activated, SecurityEnabled: a.SecurityEnabled, ActorVersion: a.Version, RoleVersion: roleVersion, ActorCreated: actorCreated, RoleCreated: roleCreated}, nil
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
		return s.db.QueryRowContext(ctx, "SELECT a.id,a.phone_e164,r.role,r.enabled,r.activated_at,a.security_enabled,a.version,r.version FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id WHERE a.id=$1 AND r.role=$2", actorID, role).Scan(dest...)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ActorRoleView{}, domain.ErrNotFound
	}
	return view, err
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
	if len(q) > 100 {
		return domain.ActorSearchPage{}, domain.ErrInvalidInput
	}
	args := []any{role}
	clauses := []string{"r.role=$1"}
	if input.Enabled != nil {
		args = append(args, *input.Enabled)
		clauses = append(clauses, fmt.Sprintf("r.enabled=$%d", len(args)))
	}
	if q != "" {
		if phone, err := identitysecurity.NormalizePhoneE164(q); err == nil {
			q = phone
		}
		args = append(args, q)
		clauses = append(clauses, fmt.Sprintf("position($%d in a.phone_e164)>0", len(args)))
	}
	cursorClause := ""
	if input.Cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(input.Cursor)
		if err != nil {
			return domain.ActorSearchPage{}, domain.ErrInvalidInput
		}
		parts := strings.SplitN(string(raw), "|", 2)
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			return domain.ActorSearchPage{}, domain.ErrInvalidInput
		}
		args = append(args, parts[0], parts[1])
		phoneArg, idArg := len(args)-1, len(args)
		cursorClause = fmt.Sprintf(" AND (a.phone_e164>$%d OR (a.phone_e164=$%d AND a.id>$%d))", phoneArg, phoneArg, idArg)
	}
	args = append(args, limit+1)
	query := "SELECT a.id,a.phone_e164,r.role,r.enabled,r.activated_at,a.security_enabled,a.version,r.version FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id WHERE " + strings.Join(clauses, " AND ") + cursorClause + " ORDER BY a.phone_e164,a.id LIMIT $" + strconv.Itoa(len(args))
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return domain.ActorSearchPage{}, err
	}
	defer func() { _ = rows.Close() }()
	items := []domain.ActorRoleView{}
	for rows.Next() {
		view, err := scanRoleView(rows.Scan)
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
		page.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(last.PhoneE164 + "|" + last.ActorID))
	}
	return page, nil
}

func (s *Service) SetRoleEnabled(ctx context.Context, caller, actorID, role string, enabled bool, correlationID string) error {
	return s.SetRoleEnabledWithReason(ctx, caller, actorID, role, enabled, correlationID, "")
}

func (s *Service) SetRoleEnabledWithReason(ctx context.Context, caller, actorID, role string, enabled bool, correlationID, reason string) error {
	return s.SetRoleEnabledWithContext(ctx, caller, actorID, role, enabled, correlationID, reason, 0, "")
}

func (s *Service) SetRoleEnabledWithContext(ctx context.Context, caller, actorID, role string, enabled bool, correlationID, reason string, expectedVersion int, operatorActorID string) error {
	caller = strings.ToLower(strings.TrimSpace(caller))
	actorID = strings.TrimSpace(actorID)
	role = strings.ToLower(strings.TrimSpace(role))
	operatorActorID = strings.TrimSpace(operatorActorID)
	if actorID == "" || !domain.CanSetRoleEnabled(caller, role) || len(strings.TrimSpace(reason)) > 500 {
		return domain.ErrForbidden
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

func (s *Service) AuthorizeReenrollment(ctx context.Context, caller, actorID, role, correlationID string) error {
	caller = strings.ToLower(strings.TrimSpace(caller))
	actorID = strings.TrimSpace(actorID)
	role = strings.ToLower(strings.TrimSpace(role))
	if actorID == "" || caller != "dsh" || !domain.IsManagedRole(role) {
		return domain.ErrForbidden
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var enabled bool
	err = tx.QueryRowContext(ctx, "SELECT enabled FROM identity_actor_roles WHERE actor_id=$1 AND role=$2 FOR UPDATE", actorID, role).Scan(&enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrNotFound
	}
	if err != nil {
		return err
	}
	if !enabled {
		return domain.ErrConflict
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_actor_roles SET activated_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE actor_id=$1 AND role=$2", actorID, role); err != nil {
		return err
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
	if err := auditTx(ctx, tx, "actor_role.reenrollment_authorized", actorID, caller, "success", correlationID, map[string]any{"role": role}); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) SetSecurityEnabled(ctx context.Context, caller, actorID string, enabled bool, correlationID string) error {
	return s.SetSecurityEnabledWithReason(ctx, caller, actorID, enabled, correlationID, "")
}

func (s *Service) SetSecurityEnabledWithReason(ctx context.Context, caller, actorID string, enabled bool, correlationID, reason string) error {
	return s.SetSecurityEnabledWithContext(ctx, caller, actorID, enabled, correlationID, reason, 0, "")
}

func (s *Service) SetSecurityEnabledWithContext(ctx context.Context, caller, actorID string, enabled bool, correlationID, reason string, expectedVersion int, operatorActorID string) error {
	caller = strings.ToLower(strings.TrimSpace(caller))
	actorID = strings.TrimSpace(actorID)
	operatorActorID = strings.TrimSpace(operatorActorID)
	if caller != "platform-control" || actorID == "" || len(strings.TrimSpace(reason)) > 500 {
		return domain.ErrForbidden
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var current, hasPlatformOwner bool
	var currentVersion int
	err = tx.QueryRowContext(ctx, `SELECT a.security_enabled, a.version, EXISTS(SELECT 1 FROM identity_actor_roles r WHERE r.actor_id=a.id AND r.role='platform_owner')
FROM identity_actors a WHERE a.id=$1 FOR UPDATE`, actorID).Scan(&current, &currentVersion, &hasPlatformOwner)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrNotFound
	}
	if err != nil {
		return err
	}
	if expectedVersion > 0 && currentVersion != expectedVersion {
		return domain.ErrConflict
	}
	if hasPlatformOwner && !enabled {
		return domain.ErrForbidden
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

func (s *Service) ResetOperatorPassword(ctx context.Context, caller, actorID, password, correlationID string) error {
	caller = strings.ToLower(strings.TrimSpace(caller))
	actorID = strings.TrimSpace(actorID)
	if actorID == "" || !domain.CanResetCredential(caller, "operator") {
		return domain.ErrForbidden
	}
	hash, err := identitysecurity.HashPassword(password)
	if err != nil {
		return domain.ErrInvalidInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.ExecContext(ctx, "UPDATE identity_password_credentials SET password_hash=$1,version=version+1,updated_at=clock_timestamp() WHERE actor_id=$2 AND role='operator'", hash, actorID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		return domain.ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE actor_id=$1 AND role='operator' AND revoked_at IS NULL", actorID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_challenges SET status='revoked',updated_at=clock_timestamp() WHERE actor_id=$1 AND role='operator' AND status='pending'", actorID); err != nil {
		return err
	}
	if err := auditTx(ctx, tx, "credential.password_reset", actorID, caller, "success", correlationID, map[string]any{"role": "operator"}); err != nil {
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

func scanRoleView(scan scanner) (domain.ActorRoleView, error) {
	var view domain.ActorRoleView
	var activated sql.NullTime
	if err := scan(&view.ActorID, &view.PhoneE164, &view.Role, &view.Enabled, &activated, &view.SecurityEnabled, &view.ActorVersion, &view.RoleVersion); err != nil {
		return domain.ActorRoleView{}, err
	}
	if activated.Valid {
		value := activated.Time
		view.ActivatedAt = &value
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
