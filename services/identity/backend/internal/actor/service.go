package actor

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
	"github.com/lib/pq"
)

type Service struct{ db *sql.DB }

func New(db *sql.DB) *Service { return &Service{db: db} }

func fingerprint(parts ...string) string {
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:])
}

func clientIdentity(operatorContextID, phone string) (string, string) {
	sum := sha256.Sum256([]byte(operatorContextID + "\x00" + phone))
	suffix := hex.EncodeToString(sum[:10])
	return "client-" + suffix, "client-" + suffix
}

func (s *Service) ProvisionTrusted(ctx context.Context, caller, operatorContextID string, input domain.ProvisionActorInput) (domain.ActorView, error) {
	caller = strings.ToLower(strings.TrimSpace(caller))
	operatorContextID = strings.TrimSpace(operatorContextID)
	role := strings.ToLower(strings.TrimSpace(input.Role))
	if operatorContextID == "" || !domain.RoleAllowedForCaller(caller, role) {
		return domain.ActorView{}, domain.ErrForbidden
	}
	username, err := identitysecurity.NormalizeUsername(input.Username)
	if err != nil {
		return domain.ActorView{}, domain.ErrInvalidInput
	}
	phone, err := identitysecurity.NormalizePhoneE164(input.PhoneE164)
	if err != nil {
		return domain.ActorView{}, domain.ErrInvalidInput
	}
	requestedID, err := identitysecurity.NormalizeActorID(input.ActorID, role)
	if err != nil {
		return domain.ActorView{}, domain.ErrInvalidInput
	}
	passwordHash := ""
	if role == "operator" {
		passwordHash, err = identitysecurity.HashPassword(input.Password)
		if err != nil {
			return domain.ActorView{}, domain.ErrInvalidInput
		}
	} else if strings.TrimSpace(input.Password) != "" {
		return domain.ActorView{}, domain.ErrInvalidInput
	}
	fp := fingerprint(caller, operatorContextID, role, username, phone, requestedID)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil { return domain.ActorView{}, err }
	defer func(){ _ = tx.Rollback() }()

	for _, key := range []string{"identity:phone:"+phone, "identity:username:"+username} {
		if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", key); err != nil {
			return domain.ActorView{}, err
		}
	}
	existing, err := byPhoneOrUsernameTx(ctx, tx, phone, username)
	if err == nil {
		if existing.OperatorContextID != operatorContextID || existing.Username != username ||
			existing.PhoneE164 != phone || !domain.ActorHasRole(existing, role) ||
			existing.CreatedByService != caller || existing.ProvisioningFingerprint != fp ||
			(requestedID != "" && existing.ID != requestedID) {
			return domain.ActorView{}, domain.ErrConflict
		}
		if role == "operator" && !identitysecurity.VerifyPassword(existing.PasswordHash, input.Password) {
			return domain.ActorView{}, domain.ErrConflict
		}
		if err := tx.Commit(); err != nil { return domain.ActorView{}, err }
		view := viewOf(existing)
		view.Created = false
		return view, nil
	}
	if !errors.Is(err, sql.ErrNoRows) { return domain.ActorView{}, err }

	actorID := requestedID
	if actorID == "" {
		token, err := identitysecurity.RandomToken(18)
		if err != nil { return domain.ActorView{}, err }
		actorID = role + "-" + strings.ToLower(token[:20])
	}
	_, err = tx.ExecContext(ctx,
		"INSERT INTO identity_actors (id,username,phone_e164,operator_context_id,roles,permissions,password_hash,status,version,provisioning_fingerprint,created_by_service) VALUES ($1,$2,$3,$4,ARRAY[$5]::text[],'[]'::jsonb,$6,$7,1,$8,$9)",
		actorID, username, phone, operatorContextID, role, passwordHash, string(domain.ActorStatusProvisioned), fp, caller)
	if err != nil {
		if isUniqueViolation(err) { return domain.ActorView{}, domain.ErrConflict }
		return domain.ActorView{}, err
	}
	if err := auditTx(ctx, tx, "actor.provisioned", actorID, caller, "success", "", map[string]any{"role": role}); err != nil {
		return domain.ActorView{}, err
	}
	if err := tx.Commit(); err != nil { return domain.ActorView{}, err }
	return domain.ActorView{
		ActorID: actorID, Username: username, PhoneE164: phone, OperatorContextID: operatorContextID,
		Roles: []string{role}, Status: domain.ActorStatusProvisioned, Version: 1, Created: true,
	}, nil
}

func (s *Service) EnsurePublicClient(ctx context.Context, operatorContextID, rawPhone string) (domain.Actor, error) {
	operatorContextID = strings.TrimSpace(operatorContextID)
	if operatorContextID == "" { return domain.Actor{}, domain.ErrUnavailable }
	phone, err := identitysecurity.NormalizePhoneE164(rawPhone)
	if err != nil { return domain.Actor{}, domain.ErrInvalidInput }
	actorID, username := clientIdentity(operatorContextID, phone)
	fp := fingerprint("public-client", operatorContextID, "client", phone)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil { return domain.Actor{}, err }
	defer func(){ _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:phone:"+phone); err != nil {
		return domain.Actor{}, err
	}
	existing, err := byPhoneTx(ctx, tx, phone)
	if err == nil {
		if existing.OperatorContextID != operatorContextID || !domain.ActorHasRole(existing, "client") ||
			existing.ProvisioningFingerprint != fp || existing.CreatedByService != "public-client" {
			return domain.Actor{}, domain.ErrConflict
		}
		if err := tx.Commit(); err != nil { return domain.Actor{}, err }
		return existing, nil
	}
	if !errors.Is(err, sql.ErrNoRows) { return domain.Actor{}, err }

	_, err = tx.ExecContext(ctx,
		"INSERT INTO identity_actors (id,username,phone_e164,operator_context_id,roles,permissions,password_hash,status,version,provisioning_fingerprint,created_by_service) VALUES ($1,$2,$3,$4,ARRAY['client']::text[],'[]'::jsonb,'',$5,1,$6,'public-client')",
		actorID, username, phone, operatorContextID, string(domain.ActorStatusPendingActivation), fp)
	if err != nil {
		if isUniqueViolation(err) { return domain.Actor{}, domain.ErrConflict }
		return domain.Actor{}, err
	}
	if err := auditTx(ctx, tx, "actor.public_client_created", actorID, "public-client", "success", "", nil); err != nil {
		return domain.Actor{}, err
	}
	if err := tx.Commit(); err != nil { return domain.Actor{}, err }
	return domain.Actor{
		ID: actorID, Username: username, PhoneE164: phone, OperatorContextID: operatorContextID,
		Roles: []string{"client"}, Permissions: []domain.Permission{}, Status: domain.ActorStatusPendingActivation,
		Version: 1, ProvisioningFingerprint: fp, CreatedByService: "public-client",
	}, nil
}

func (s *Service) Get(ctx context.Context, operatorContextID, actorID string) (domain.ActorView, error) {
	actor, err := byIDScoped(ctx, s.db, strings.TrimSpace(operatorContextID), strings.TrimSpace(actorID))
	if errors.Is(err, sql.ErrNoRows) { return domain.ActorView{}, domain.ErrNotFound }
	if err != nil { return domain.ActorView{}, err }
	return viewOf(actor), nil
}

func (s *Service) Search(ctx context.Context, operatorContextID string, input domain.ActorSearchInput) (domain.ActorSearchPage, error) {
	operatorContextID = strings.TrimSpace(operatorContextID)
	if operatorContextID == "" { return domain.ActorSearchPage{}, domain.ErrInvalidInput }
	limit := input.Limit
	if limit <= 0 { limit = 25 }
	if limit > 100 { return domain.ActorSearchPage{}, domain.ErrInvalidInput }
	role := strings.ToLower(strings.TrimSpace(input.Role))
	q := strings.TrimSpace(input.Query)
	if len(q) > 100 { return domain.ActorSearchPage{}, domain.ErrInvalidInput }
	status := strings.ToUpper(strings.TrimSpace(string(input.Status)))
	switch status {
	case "", "PROVISIONED", "PENDING_ACTIVATION", "ACTIVE", "SUSPENDED", "DEACTIVATED":
	default:
		return domain.ActorSearchPage{}, domain.ErrInvalidInput
	}

	args := []any{operatorContextID}
	clauses := []string{"operator_context_id=$1"}
	if role != "" {
		args = append(args, role)
		clauses = append(clauses, fmt.Sprintf("$%d=ANY(roles)", len(args)))
	}
	if status != "" {
		args = append(args, status)
		clauses = append(clauses, fmt.Sprintf("status=$%d", len(args)))
	}
	if q != "" {
		if phone, err := identitysecurity.NormalizePhoneE164(q); err == nil { q = phone }
		args = append(args, q)
		clauses = append(clauses, fmt.Sprintf("(position(lower($%d) in lower(username))>0 OR position($%d in phone_e164)>0)", len(args), len(args)))
	}

	cursorClause := ""
	if input.Cursor != "" {
		raw, err := base64.RawURLEncoding.DecodeString(input.Cursor)
		if err != nil { return domain.ActorSearchPage{}, domain.ErrInvalidInput }
		parts := strings.SplitN(string(raw), "|", 2)
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" { return domain.ActorSearchPage{}, domain.ErrInvalidInput }
		args = append(args, parts[0], parts[1])
		u, id := len(args)-1, len(args)
		cursorClause = fmt.Sprintf(" AND (lower(username)>lower($%d) OR (lower(username)=lower($%d) AND id>$%d))", u, u, id)
	}
	args = append(args, limit+1)
	query := "SELECT id,username,phone_e164,operator_context_id,roles,permissions,password_hash,status,version,provisioning_fingerprint,created_by_service FROM identity_actors WHERE " +
		strings.Join(clauses, " AND ") + cursorClause + " ORDER BY lower(username),id LIMIT $" + strconv.Itoa(len(args))
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil { return domain.ActorSearchPage{}, err }
	defer func(){ _ = rows.Close() }()
	items := []domain.ActorView{}
	for rows.Next() {
		a, err := scanActor(rows.Scan)
		if err != nil { return domain.ActorSearchPage{}, err }
		items = append(items, viewOf(a))
	}
	if err := rows.Err(); err != nil { return domain.ActorSearchPage{}, err }
	page := domain.ActorSearchPage{Items: items, Limit: limit}
	if len(items) > limit {
		last := items[limit-1]
		page.Items = items[:limit]
		page.NextCursor = base64.RawURLEncoding.EncodeToString([]byte(last.Username+"|"+last.ActorID))
	}
	return page, nil
}

func (s *Service) SetStatus(ctx context.Context, operatorContextID, actorID string, status domain.ActorStatus, principal, correlationID string) error {
	operatorContextID, actorID, principal = strings.TrimSpace(operatorContextID), strings.TrimSpace(actorID), strings.TrimSpace(principal)
	if operatorContextID == "" || actorID == "" || principal == "" { return domain.ErrInvalidInput }
	if status != domain.ActorStatusSuspended && status != domain.ActorStatusActive && status != domain.ActorStatusDeactivated {
		return domain.ErrInvalidInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil { return err }
	defer func(){ _ = tx.Rollback() }()
	var current string
	err = tx.QueryRowContext(ctx, "SELECT status FROM identity_actors WHERE id=$1 AND operator_context_id=$2 FOR UPDATE", actorID, operatorContextID).Scan(&current)
	if errors.Is(err, sql.ErrNoRows) { return domain.ErrNotFound }
	if err != nil { return err }
	if current == string(domain.ActorStatusDeactivated) && status != domain.ActorStatusDeactivated { return domain.ErrConflict }
	if _, err := tx.ExecContext(ctx, "UPDATE identity_actors SET status=$1,version=version+1,updated_at=clock_timestamp() WHERE id=$2", string(status), actorID); err != nil {
		return err
	}
	if status != domain.ActorStatusActive {
		if _, err := tx.ExecContext(ctx, "UPDATE identity_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),version=version+1 WHERE actor_id=$1 AND revoked_at IS NULL", actorID); err != nil { return err }
		if _, err := tx.ExecContext(ctx, "UPDATE identity_activation_challenges SET status='revoked',updated_at=clock_timestamp() WHERE actor_id=$1 AND status='pending'", actorID); err != nil { return err }
	}
	if err := auditTx(ctx, tx, "actor.status_changed", actorID, principal, "success", correlationID, map[string]any{"from": current, "to": status}); err != nil {
		return err
	}
	return tx.Commit()
}

type scanner func(dest ...any) error

func scanActor(scan scanner) (domain.Actor, error) {
	var a domain.Actor
	var roles pq.StringArray
	var raw []byte
	var status string
	err := scan(&a.ID,&a.Username,&a.PhoneE164,&a.OperatorContextID,&roles,&raw,&a.PasswordHash,&status,&a.Version,&a.ProvisioningFingerprint,&a.CreatedByService)
	if err != nil { return domain.Actor{}, err }
	a.Roles, a.Status = []string(roles), domain.ActorStatus(status)
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &a.Permissions); err != nil { return domain.Actor{}, err }
	}
	if a.Permissions == nil { a.Permissions = []domain.Permission{} }
	return a, nil
}

func byPhoneOrUsernameTx(ctx context.Context, tx *sql.Tx, phone, username string) (domain.Actor, error) {
	return scanActor(func(dest ...any) error {
		return tx.QueryRowContext(ctx, "SELECT id,username,phone_e164,operator_context_id,roles,permissions,password_hash,status,version,provisioning_fingerprint,created_by_service FROM identity_actors WHERE phone_e164=$1 OR lower(username)=lower($2) ORDER BY CASE WHEN phone_e164=$1 THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE", phone, username).Scan(dest...)
	})
}

func byPhoneTx(ctx context.Context, tx *sql.Tx, phone string) (domain.Actor, error) {
	return scanActor(func(dest ...any) error {
		return tx.QueryRowContext(ctx, "SELECT id,username,phone_e164,operator_context_id,roles,permissions,password_hash,status,version,provisioning_fingerprint,created_by_service FROM identity_actors WHERE phone_e164=$1 FOR UPDATE", phone).Scan(dest...)
	})
}

func byIDScoped(ctx context.Context, db *sql.DB, operatorContextID, actorID string) (domain.Actor, error) {
	if operatorContextID == "" || actorID == "" { return domain.Actor{}, domain.ErrInvalidInput }
	return scanActor(func(dest ...any) error {
		return db.QueryRowContext(ctx, "SELECT id,username,phone_e164,operator_context_id,roles,permissions,password_hash,status,version,provisioning_fingerprint,created_by_service FROM identity_actors WHERE id=$1 AND operator_context_id=$2", actorID, operatorContextID).Scan(dest...)
	})
}

func viewOf(a domain.Actor) domain.ActorView {
	return domain.ActorView{ActorID:a.ID,Username:a.Username,PhoneE164:a.PhoneE164,OperatorContextID:a.OperatorContextID,Roles:a.Roles,Status:a.Status,Version:a.Version}
}

func auditTx(ctx context.Context, tx *sql.Tx, eventType, actorID, principal, outcome, correlationID string, metadata map[string]any) error {
	if metadata == nil { metadata = map[string]any{} }
	raw, err := json.Marshal(metadata)
	if err != nil { return err }
	_, err = tx.ExecContext(ctx, "INSERT INTO identity_security_audit(event_type,subject_actor_id,principal,outcome,correlation_id,metadata) VALUES($1,NULLIF($2,''),$3,$4,NULLIF($5,''),$6::jsonb)",
		eventType, actorID, principal, outcome, correlationID, string(raw))
	return err
}

func isUniqueViolation(err error) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && string(pqErr.Code) == "23505"
}
