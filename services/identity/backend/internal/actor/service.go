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

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
	"github.com/lib/pq"
)

type Service struct {
	db *sql.DB
}

func New(db *sql.DB) *Service {
	return &Service{db: db}
}

func (s *Service) ProvisionTrusted(ctx context.Context, caller string, input domain.ProvisionActorRoleInput) (domain.ActorRoleView, error) {
	caller = strings.ToLower(strings.TrimSpace(caller))
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if !domain.RoleAllowedForCaller(caller, role) {
		return domain.ActorRoleView{}, domain.ErrForbidden
	}
	phone, err := identitysecurity.NormalizePhoneE164(input.PhoneE164)
	if err != nil {
		return domain.ActorRoleView{}, domain.ErrInvalidInput
	}

	username := ""
	passwordHash := ""
	if role == "operator" {
		username, err = identitysecurity.NormalizeUsername(input.Username)
		if err != nil {
			return domain.ActorRoleView{}, domain.ErrInvalidInput
		}
		passwordHash, err = identitysecurity.HashPassword(input.Password)
		if err != nil {
			return domain.ActorRoleView{}, domain.ErrInvalidInput
		}
	} else if strings.TrimSpace(input.Username) != "" || input.Password != "" {
		return domain.ActorRoleView{}, domain.ErrInvalidInput
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.ActorRoleView{}, err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:phone:"+phone); err != nil {
		return domain.ActorRoleView{}, err
	}
	if username != "" {
		if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:username:"+username); err != nil {
			return domain.ActorRoleView{}, err
		}
	}

	a, err := actorByPhoneTx(ctx, tx, phone)
	actorCreated := false
	if errors.Is(err, sql.ErrNoRows) {
		actorID, err := newActorID()
		if err != nil {
			return domain.ActorRoleView{}, err
		}
		if username != "" {
			var used bool
			if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM identity_actors WHERE lower(username)=lower($1))", username).Scan(&used); err != nil {
				return domain.ActorRoleView{}, err
			}
			if used {
				return domain.ActorRoleView{}, domain.ErrConflict
			}
		}
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO identity_actors(id,phone_e164,username,password_hash,version) VALUES($1,$2,NULLIF($3,''),NULLIF($4,''),1)",
			actorID, phone, username, passwordHash); err != nil {
			if isUniqueViolation(err) {
				return domain.ActorRoleView{}, domain.ErrConflict
			}
			return domain.ActorRoleView{}, err
		}
		a = domain.Actor{ID: actorID, PhoneE164: phone, Username: username, PasswordHash: passwordHash, Version: 1}
		actorCreated = true
		if err := auditTx(ctx, tx, "actor.created", actorID, caller, "success", "", nil); err != nil {
			return domain.ActorRoleView{}, err
		}
	} else if err != nil {
		return domain.ActorRoleView{}, err
	}

	if role == "operator" {
		switch {
		case a.Username == "":
			var used bool
			if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM identity_actors WHERE id<>$1 AND lower(username)=lower($2))", a.ID, username).Scan(&used); err != nil {
				return domain.ActorRoleView{}, err
			}
			if used {
				return domain.ActorRoleView{}, domain.ErrConflict
			}
			if _, err := tx.ExecContext(ctx,
				"UPDATE identity_actors SET username=$1,password_hash=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$3",
				username, passwordHash, a.ID); err != nil {
				return domain.ActorRoleView{}, err
			}
			a.Username = username
			a.PasswordHash = passwordHash
			a.Version++
		case a.Username != username || !identitysecurity.VerifyPassword(a.PasswordHash, input.Password):
			return domain.ActorRoleView{}, domain.ErrConflict
		}
	}

	var enabled bool
	var roleVersion int
	err = tx.QueryRowContext(ctx,
		"SELECT enabled,version FROM identity_actor_roles WHERE actor_id=$1 AND role=$2 FOR UPDATE",
		a.ID, role).Scan(&enabled, &roleVersion)
	roleCreated := false
	if errors.Is(err, sql.ErrNoRows) {
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO identity_actor_roles(actor_id,role,enabled,version) VALUES($1,$2,true,1)",
			a.ID, role); err != nil {
			return domain.ActorRoleView{}, err
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

	if err := tx.Commit(); err != nil {
		return domain.ActorRoleView{}, err
	}
	return domain.ActorRoleView{
		ActorID: a.ID, PhoneE164: a.PhoneE164, Username: a.Username, Role: role, Enabled: enabled,
		ActorVersion: a.Version, RoleVersion: roleVersion, ActorCreated: actorCreated, RoleCreated: roleCreated,
	}, nil
}

func (s *Service) EnsurePublicClientTx(ctx context.Context, tx *sql.Tx, rawPhone string) (domain.Actor, error) {
	phone, err := identitysecurity.NormalizePhoneE164(rawPhone)
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
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO identity_actors(id,phone_e164,version) VALUES($1,$2,1)",
			actorID, phone); err != nil {
			return domain.Actor{}, err
		}
		a = domain.Actor{ID: actorID, PhoneE164: phone, Version: 1}
		if err := auditTx(ctx, tx, "actor.created", actorID, "public-client", "success", "", nil); err != nil {
			return domain.Actor{}, err
		}
	} else if err != nil {
		return domain.Actor{}, err
	}

	var enabled bool
	err = tx.QueryRowContext(ctx,
		"SELECT enabled FROM identity_actor_roles WHERE actor_id=$1 AND role='client' FOR UPDATE",
		a.ID).Scan(&enabled)
	if errors.Is(err, sql.ErrNoRows) {
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO identity_actor_roles(actor_id,role,enabled,version) VALUES($1,'client',true,1)",
			a.ID); err != nil {
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
	return a, nil
}

func (s *Service) FindEnabledByPhoneRole(ctx context.Context, rawPhone, rawRole string) (domain.Actor, error) {
	phone, err := identitysecurity.NormalizePhoneE164(rawPhone)
	if err != nil {
		return domain.Actor{}, domain.ErrInvalidInput
	}
	role := strings.ToLower(strings.TrimSpace(rawRole))
	if _, ok := domain.SurfaceForRole(role); !ok {
		return domain.Actor{}, domain.ErrInvalidInput
	}
	a, err := scanActor(func(dest ...any) error {
		return s.db.QueryRowContext(ctx,
			"SELECT a.id,a.phone_e164,COALESCE(a.username,''),COALESCE(a.password_hash,''),a.version FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id WHERE a.phone_e164=$1 AND r.role=$2 AND r.enabled=true",
			phone, role).Scan(dest...)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Actor{}, domain.ErrNotFound
	}
	return a, err
}

func (s *Service) GetRole(ctx context.Context, caller, actorID, role string) (domain.ActorRoleView, error) {
	caller = strings.ToLower(strings.TrimSpace(caller))
	role = strings.ToLower(strings.TrimSpace(role))
	actorID = strings.TrimSpace(actorID)
	if actorID == "" || !domain.RoleAllowedForCaller(caller, role) {
		return domain.ActorRoleView{}, domain.ErrForbidden
	}
	view, err := scanRoleView(func(dest ...any) error {
		return s.db.QueryRowContext(ctx,
			"SELECT a.id,a.phone_e164,COALESCE(a.username,''),r.role,r.enabled,a.version,r.version FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id WHERE a.id=$1 AND r.role=$2",
			actorID, role).Scan(dest...)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ActorRoleView{}, domain.ErrNotFound
	}
	return view, err
}

func (s *Service) Search(ctx context.Context, caller string, input domain.ActorSearchInput) (domain.ActorSearchPage, error) {
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if !domain.RoleAllowedForCaller(caller, role) {
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
		clauses = append(clauses, fmt.Sprintf("(position(lower($%d) in lower(COALESCE(a.username,'')))>0 OR position($%d in a.phone_e164)>0)", len(args), len(args)))
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
	query := "SELECT a.id,a.phone_e164,COALESCE(a.username,''),r.role,r.enabled,a.version,r.version FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id WHERE " +
		strings.Join(clauses, " AND ") + cursorClause + " ORDER BY a.phone_e164,a.id LIMIT $" + strconv.Itoa(len(args))
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
	caller = strings.ToLower(strings.TrimSpace(caller))
	actorID = strings.TrimSpace(actorID)
	role = strings.ToLower(strings.TrimSpace(role))
	if actorID == "" || !domain.RoleAllowedForCaller(caller, role) {
		return domain.ErrForbidden
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var current bool
	err = tx.QueryRowContext(ctx,
		"SELECT enabled FROM identity_actor_roles WHERE actor_id=$1 AND role=$2 FOR UPDATE",
		actorID, role).Scan(&current)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ErrNotFound
	}
	if err != nil {
		return err
	}
	if current == enabled {
		return tx.Commit()
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE identity_actor_roles SET enabled=$1,version=version+1,updated_at=clock_timestamp() WHERE actor_id=$2 AND role=$3",
		enabled, actorID, role); err != nil {
		return err
	}
	if !enabled {
		if _, err := tx.ExecContext(ctx,
			"UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE actor_id=$1 AND role=$2 AND revoked_at IS NULL",
			actorID, role); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			"UPDATE identity_activation_challenges SET status='revoked',updated_at=clock_timestamp() WHERE actor_id=$1 AND role=$2 AND status='pending'",
			actorID, role); err != nil {
			return err
		}
	}
	if err := auditTx(ctx, tx, "actor_role.enabled_changed", actorID, caller, "success", correlationID, map[string]any{"role": role, "enabled": enabled}); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) ResetOperatorPassword(ctx context.Context, caller, actorID, password, correlationID string) error {
	caller = strings.ToLower(strings.TrimSpace(caller))
	actorID = strings.TrimSpace(actorID)
	if actorID == "" || !domain.RoleAllowedForCaller(caller, "operator") {
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

	var exists bool
	if err := tx.QueryRowContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM identity_actor_roles WHERE actor_id=$1 AND role='operator')",
		actorID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return domain.ErrNotFound
	}
	result, err := tx.ExecContext(ctx,
		"UPDATE identity_actors SET password_hash=$1,version=version+1,updated_at=clock_timestamp() WHERE id=$2",
		hash, actorID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		return domain.ErrNotFound
	}
	if _, err := tx.ExecContext(ctx,
		"UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE actor_id=$1 AND role='operator' AND revoked_at IS NULL",
		actorID); err != nil {
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

func scanActor(scan scanner) (domain.Actor, error) {
	var a domain.Actor
	if err := scan(&a.ID, &a.PhoneE164, &a.Username, &a.PasswordHash, &a.Version); err != nil {
		return domain.Actor{}, err
	}
	return a, nil
}

func scanRoleView(scan scanner) (domain.ActorRoleView, error) {
	var view domain.ActorRoleView
	if err := scan(&view.ActorID, &view.PhoneE164, &view.Username, &view.Role, &view.Enabled, &view.ActorVersion, &view.RoleVersion); err != nil {
		return domain.ActorRoleView{}, err
	}
	return view, nil
}

func actorByPhoneTx(ctx context.Context, tx *sql.Tx, phone string) (domain.Actor, error) {
	return scanActor(func(dest ...any) error {
		return tx.QueryRowContext(ctx,
			"SELECT id,phone_e164,COALESCE(username,''),COALESCE(password_hash,''),version FROM identity_actors WHERE phone_e164=$1 FOR UPDATE",
			phone).Scan(dest...)
	})
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

func isUniqueViolation(err error) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && string(pqErr.Code) == "23505"
}
