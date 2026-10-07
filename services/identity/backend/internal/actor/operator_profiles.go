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
	"strings"
	"time"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
	identitysecurity "github.com/bthwani2-boop/samrim/services/identity/backend/internal/security"
)

type operatorProfileQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

type operatorProfileCursor struct {
	Version   int    `json:"v"`
	Query     string `json:"q"`
	State     string `json:"s"`
	Sort      string `json:"o"`
	CreatedAt string `json:"t"`
	ID        string `json:"i"`
}

func (s *Service) CreateOperatorProfile(ctx context.Context, caller, actingActorID, correlationID, idempotencyKey string, input domain.OperatorProfileCreateRequest) (domain.OperatorProfileResponse, error) {
	caller, actingActorID = strings.ToLower(strings.TrimSpace(caller)), strings.TrimSpace(actingActorID)
	input.FullNameAr = strings.TrimSpace(input.FullNameAr)
	if caller != "control-panel" || actingActorID == "" || !operatorProfileMutationValid(correlationID, idempotencyKey) || utf8.RuneCountInString(input.FullNameAr) < 2 || utf8.RuneCountInString(input.FullNameAr) > 120 {
		return domain.OperatorProfileResponse{}, domain.ErrInvalidInput
	}
	phone, err := identitysecurity.NormalizePhoneE164(input.PhoneE164)
	if err != nil {
		return domain.OperatorProfileResponse{}, domain.ErrInvalidInput
	}
	if err := s.requireOperatorPermissionAdministrator(ctx, s.db, actingActorID); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	hash := operatorProfileHash("create", input.FullNameAr, phone)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockOperatorProfileMutation(ctx, tx, idempotencyKey); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	if profile, replay, err := readOperatorProfileReplay(ctx, tx, idempotencyKey, hash); err != nil {
		return domain.OperatorProfileResponse{}, err
	} else if replay {
		if err := tx.Commit(); err != nil {
			return domain.OperatorProfileResponse{}, err
		}
		return domain.OperatorProfileResponse{Profile: profile, IdempotentReplay: true}, nil
	}
	if err := s.requireOperatorPermissionAdministrator(ctx, tx, actingActorID); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:phone:"+phone); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	var occupied bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM identity_operator_profiles WHERE phone_e164=$1) OR EXISTS(SELECT 1 FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id WHERE a.phone_e164=$1 AND r.role='operator')", phone).Scan(&occupied); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	if occupied {
		return domain.OperatorProfileResponse{}, domain.ErrConflict
	}
	token, err := identitysecurity.RandomToken(18)
	if err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	id := "oprof_" + token
	if _, err := tx.ExecContext(ctx, "INSERT INTO identity_operator_profiles(id,full_name_ar,phone_e164,state,version,created_by_actor_id) VALUES($1,$2,$3,'pending_review',1,$4)", id, input.FullNameAr, phone, actingActorID); err != nil {
		if isUniqueViolation(err) {
			return domain.OperatorProfileResponse{}, domain.ErrConflict
		}
		return domain.OperatorProfileResponse{}, err
	}
	if err := insertOperatorProfileEvent(ctx, tx, id, "created", actingActorID, idempotencyKey, hash, correlationID); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	profile, err := readOperatorProfile(ctx, tx, id)
	if err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	return domain.OperatorProfileResponse{Profile: profile}, nil
}

func (s *Service) UpdateOperatorProfile(ctx context.Context, caller, actingActorID, correlationID, idempotencyKey, profileID string, input domain.OperatorProfileUpdateRequest) (domain.OperatorProfileResponse, error) {
	caller, actingActorID = strings.ToLower(strings.TrimSpace(caller)), strings.TrimSpace(actingActorID)
	profileID = strings.TrimSpace(profileID)
	input.FullNameAr = strings.TrimSpace(input.FullNameAr)
	if caller != "control-panel" || actingActorID == "" || profileID == "" || input.ExpectedVersion < 1 || !operatorProfileMutationValid(correlationID, idempotencyKey) || utf8.RuneCountInString(input.FullNameAr) < 2 || utf8.RuneCountInString(input.FullNameAr) > 120 {
		return domain.OperatorProfileResponse{}, domain.ErrInvalidInput
	}
	phone, err := identitysecurity.NormalizePhoneE164(input.PhoneE164)
	if err != nil {
		return domain.OperatorProfileResponse{}, domain.ErrInvalidInput
	}
	if err := s.requireOperatorPermissionAdministrator(ctx, s.db, actingActorID); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	hash := operatorProfileHash("update", profileID, input.FullNameAr, phone, fmt.Sprint(input.ExpectedVersion))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockOperatorProfileMutation(ctx, tx, idempotencyKey); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	if profile, replay, err := readOperatorProfileReplay(ctx, tx, idempotencyKey, hash); err != nil {
		return domain.OperatorProfileResponse{}, err
	} else if replay {
		if err := tx.Commit(); err != nil {
			return domain.OperatorProfileResponse{}, err
		}
		return domain.OperatorProfileResponse{Profile: profile, IdempotentReplay: true}, nil
	}
	if err := s.requireOperatorPermissionAdministrator(ctx, tx, actingActorID); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	current, err := readOperatorProfile(ctx, tx, profileID+" FOR UPDATE")
	if err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	if current.State != "pending_review" || current.Version != input.ExpectedVersion {
		return domain.OperatorProfileResponse{}, domain.ErrConflict
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:phone:"+phone); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	var occupied bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM identity_operator_profiles WHERE phone_e164=$1 AND id<>$2) OR EXISTS(SELECT 1 FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id WHERE a.phone_e164=$1 AND r.role='operator')", phone, profileID).Scan(&occupied); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	if occupied {
		return domain.OperatorProfileResponse{}, domain.ErrConflict
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_operator_profiles SET full_name_ar=$1,phone_e164=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$3 AND version=$4", input.FullNameAr, phone, profileID, input.ExpectedVersion); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	if err := insertOperatorProfileEvent(ctx, tx, profileID, "profile_updated", actingActorID, idempotencyKey, hash, correlationID); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	updated, err := readOperatorProfile(ctx, tx, profileID)
	if err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	return domain.OperatorProfileResponse{Profile: updated}, nil
}

func (s *Service) ListOperatorProfiles(ctx context.Context, caller, actingActorID, query, state, sort string, limit int, cursor string) (domain.OperatorProfilePage, error) {
	caller, actingActorID = strings.ToLower(strings.TrimSpace(caller)), strings.TrimSpace(actingActorID)
	query, state, sort = strings.TrimSpace(query), strings.TrimSpace(state), strings.TrimSpace(sort)
	if caller != "control-panel" || actingActorID == "" || queryRuneCount(query) > 100 {
		return domain.OperatorProfilePage{}, domain.ErrInvalidInput
	}
	if limit == 0 {
		limit = 25
	}
	if limit < 1 || limit > 50 || (state != "" && state != "all" && state != "pending_review" && state != "approved" && state != "admitted") {
		return domain.OperatorProfilePage{}, domain.ErrInvalidInput
	}
	if sort == "" {
		sort = "created_desc"
	}
	if sort != "created_asc" && sort != "created_desc" {
		return domain.OperatorProfilePage{}, domain.ErrInvalidInput
	}
	if err := s.requireOperatorPermissionAdministrator(ctx, s.db, actingActorID); err != nil {
		return domain.OperatorProfilePage{}, err
	}
	state = strings.TrimSpace(state)
	searchPattern := ""
	if query != "" {
		searchPattern = "%" + strings.ToLower(query) + "%"
	}
	var cursorCreatedAt any
	var cursorID string
	if cursor != "" {
		decoded, err := decodeOperatorProfileCursor(cursor, query, state, sort)
		if err != nil {
			return domain.OperatorProfilePage{}, domain.ErrInvalidInput
		}
		cursorCreatedAt, cursorID = decoded.CreatedAt, decoded.ID
	}
	rows, err := s.db.QueryContext(ctx, `SELECT p.id,p.full_name_ar,coalesce(CASE WHEN p.state='admitted' THEN a.phone_e164 ELSE p.phone_e164 END,''),coalesce(p.actor_id,''),r.enabled,a.security_enabled,r.activated_at,p.state,p.version,p.created_at,p.updated_at
		FROM identity_operator_profiles p
		LEFT JOIN identity_actors a ON a.id=p.actor_id
		LEFT JOIN identity_actor_roles r ON r.actor_id=p.actor_id AND r.role='operator'
		WHERE ($1='' OR $1='all' OR p.state=$1)
		AND ($2='' OR lower(p.full_name_ar) LIKE $2 OR coalesce(CASE WHEN p.state='admitted' THEN a.phone_e164 ELSE p.phone_e164 END,'') LIKE $2)
		AND (NOT $3::boolean OR ($7='created_asc' AND (p.created_at,p.id)>($4::timestamptz,$5::text)) OR ($7='created_desc' AND (p.created_at,p.id)<($4::timestamptz,$5::text)))
		ORDER BY CASE WHEN $7='created_asc' THEN p.created_at END ASC,CASE WHEN $7='created_desc' THEN p.created_at END DESC,
		CASE WHEN $7='created_asc' THEN p.id END ASC,CASE WHEN $7='created_desc' THEN p.id END DESC
		LIMIT $6`, state, searchPattern, cursorCreatedAt != nil, cursorCreatedAt, cursorID, limit+1, sort)
	if err != nil {
		return domain.OperatorProfilePage{}, err
	}
	defer func() { _ = rows.Close() }()
	items := make([]domain.OperatorProfile, 0, limit+1)
	for rows.Next() {
		profile, err := scanOperatorProfile(rows.Scan)
		if err != nil {
			return domain.OperatorProfilePage{}, err
		}
		items = append(items, profile)
	}
	if err := rows.Err(); err != nil {
		return domain.OperatorProfilePage{}, err
	}
	page := domain.OperatorProfilePage{Items: items, Limit: limit}
	if len(items) > limit {
		page.Items = items[:limit]
		last := page.Items[len(page.Items)-1]
		encoded, err := json.Marshal(operatorProfileCursor{Version: 1, Query: query, State: state, Sort: sort, CreatedAt: last.CreatedAt.UTC().Format(time.RFC3339Nano), ID: last.ID})
		if err != nil {
			return domain.OperatorProfilePage{}, err
		}
		page.NextCursor = base64.RawURLEncoding.EncodeToString(encoded)
	}
	return page, nil
}

func (s *Service) ReadOperatorProfile(ctx context.Context, caller, actingActorID, profileID string) (domain.OperatorProfile, error) {
	if strings.ToLower(strings.TrimSpace(caller)) != "control-panel" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(profileID) == "" {
		return domain.OperatorProfile{}, domain.ErrInvalidInput
	}
	if err := s.requireOperatorPermissionAdministrator(ctx, s.db, actingActorID); err != nil {
		return domain.OperatorProfile{}, err
	}
	return readOperatorProfile(ctx, s.db, strings.TrimSpace(profileID))
}

func (s *Service) ReadOperatorProfileRole(ctx context.Context, caller, actingActorID, actorID string) (domain.ActorRoleView, error) {
	if strings.ToLower(strings.TrimSpace(caller)) != "control-panel" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(actorID) == "" {
		return domain.ActorRoleView{}, domain.ErrInvalidInput
	}
	if err := s.requireOperatorPermissionAdministrator(ctx, s.db, actingActorID); err != nil {
		return domain.ActorRoleView{}, err
	}
	return readOperatorProfileRole(ctx, s.db, actorID)
}

func (s *Service) ApproveOperatorProfile(ctx context.Context, caller, actingActorID, correlationID, idempotencyKey, profileID string, expectedVersion int) (domain.OperatorProfileResponse, error) {
	caller, actingActorID, profileID = strings.ToLower(strings.TrimSpace(caller)), strings.TrimSpace(actingActorID), strings.TrimSpace(profileID)
	if caller != "control-panel" || actingActorID == "" || profileID == "" || expectedVersion < 1 || !operatorProfileMutationValid(correlationID, idempotencyKey) {
		return domain.OperatorProfileResponse{}, domain.ErrInvalidInput
	}
	if err := s.requireOperatorPermissionAdministrator(ctx, s.db, actingActorID); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	hash := operatorProfileHash("approve", profileID, fmt.Sprint(expectedVersion))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockOperatorProfileMutation(ctx, tx, idempotencyKey); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	if profile, replay, err := readOperatorProfileReplay(ctx, tx, idempotencyKey, hash); err != nil {
		return domain.OperatorProfileResponse{}, err
	} else if replay {
		if err := tx.Commit(); err != nil {
			return domain.OperatorProfileResponse{}, err
		}
		return domain.OperatorProfileResponse{Profile: profile, IdempotentReplay: true}, nil
	}
	if err := s.requireOperatorPermissionAdministrator(ctx, tx, actingActorID); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	current, err := readOperatorProfile(ctx, tx, profileID+" FOR UPDATE")
	if err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	if current.State != "pending_review" || current.Version != expectedVersion {
		return domain.OperatorProfileResponse{}, domain.ErrConflict
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_operator_profiles SET state='approved',reviewed_by_actor_id=$1,reviewed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$2 AND version=$3", actingActorID, profileID, expectedVersion); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	if err := insertOperatorProfileEvent(ctx, tx, profileID, "approved", actingActorID, idempotencyKey, hash, correlationID); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	updated, err := readOperatorProfile(ctx, tx, profileID)
	if err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.OperatorProfileResponse{}, err
	}
	return domain.OperatorProfileResponse{Profile: updated}, nil
}

func (s *Service) GrantOperatorProfile(ctx context.Context, caller, actingActorID, correlationID, idempotencyKey, profileID string, expectedVersion int) (domain.OperatorProfileGrantResponse, error) {
	caller, actingActorID, profileID = strings.ToLower(strings.TrimSpace(caller)), strings.TrimSpace(actingActorID), strings.TrimSpace(profileID)
	if caller != "control-panel" || actingActorID == "" || profileID == "" || expectedVersion < 1 || !operatorProfileMutationValid(correlationID, idempotencyKey) {
		return domain.OperatorProfileGrantResponse{}, domain.ErrInvalidInput
	}
	if err := s.requireOperatorPermissionAdministrator(ctx, s.db, actingActorID); err != nil {
		return domain.OperatorProfileGrantResponse{}, err
	}
	hash := operatorProfileHash("grant", profileID, fmt.Sprint(expectedVersion))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.OperatorProfileGrantResponse{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockOperatorProfileMutation(ctx, tx, idempotencyKey); err != nil {
		return domain.OperatorProfileGrantResponse{}, err
	}
	if profile, replay, err := readOperatorProfileReplay(ctx, tx, idempotencyKey, hash); err != nil {
		return domain.OperatorProfileGrantResponse{}, err
	} else if replay {
		role, roleErr := readOperatorProfileRole(ctx, tx, profile.ActorID)
		if roleErr != nil {
			return domain.OperatorProfileGrantResponse{}, roleErr
		}
		if err := tx.Commit(); err != nil {
			return domain.OperatorProfileGrantResponse{}, err
		}
		return domain.OperatorProfileGrantResponse{Profile: profile, Role: role, IdempotentReplay: true}, nil
	}
	if err := s.requireOperatorPermissionAdministrator(ctx, tx, actingActorID); err != nil {
		return domain.OperatorProfileGrantResponse{}, err
	}
	profile, err := readOperatorProfile(ctx, tx, profileID+" FOR UPDATE")
	if err != nil {
		return domain.OperatorProfileGrantResponse{}, err
	}
	if profile.State == "admitted" {
		role, roleErr := readOperatorProfileRole(ctx, tx, profile.ActorID)
		if roleErr != nil {
			return domain.OperatorProfileGrantResponse{}, roleErr
		}
		if err := tx.Commit(); err != nil {
			return domain.OperatorProfileGrantResponse{}, err
		}
		return domain.OperatorProfileGrantResponse{Profile: profile, Role: role}, nil
	}
	if profile.State != "approved" || profile.Version != expectedVersion || profile.PhoneE164 == "" {
		return domain.OperatorProfileGrantResponse{}, domain.ErrConflict
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:phone:"+profile.PhoneE164); err != nil {
		return domain.OperatorProfileGrantResponse{}, err
	}
	actorRecord, err := actorByPhoneTx(ctx, tx, profile.PhoneE164)
	actorCreated := false
	if errors.Is(err, sql.ErrNoRows) {
		id, idErr := newActorID()
		if idErr != nil {
			return domain.OperatorProfileGrantResponse{}, idErr
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO identity_actors(id,phone_e164,version) VALUES($1,$2,1)", id, profile.PhoneE164); err != nil {
			if isUniqueViolation(err) {
				return domain.OperatorProfileGrantResponse{}, domain.ErrConflict
			}
			return domain.OperatorProfileGrantResponse{}, err
		}
		actorRecord = domain.Actor{ID: id, PhoneE164: profile.PhoneE164, SecurityEnabled: true, Version: 1}
		actorCreated = true
		if err := auditTx(ctx, tx, "actor.created", id, "control-panel:"+actingActorID, "success", correlationID, map[string]any{"actingActorId": actingActorID}); err != nil {
			return domain.OperatorProfileGrantResponse{}, err
		}
	} else if err != nil {
		return domain.OperatorProfileGrantResponse{}, err
	}
	if !actorRecord.SecurityEnabled {
		return domain.OperatorProfileGrantResponse{}, domain.ErrConflict
	}
	var roleVersion int
	err = tx.QueryRowContext(ctx, "SELECT version FROM identity_actor_roles WHERE actor_id=$1 AND role='operator' FOR UPDATE", actorRecord.ID).Scan(&roleVersion)
	if err == nil {
		return domain.OperatorProfileGrantResponse{}, domain.ErrConflict
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return domain.OperatorProfileGrantResponse{}, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO identity_actor_roles(actor_id,role,enabled,activated_at,version) VALUES($1,'operator',true,NULL,1)", actorRecord.ID); err != nil {
		return domain.OperatorProfileGrantResponse{}, err
	}
	roleVersion = 1
	roleCreated := true
	if err := auditTx(ctx, tx, "actor_role.provisioned", actorRecord.ID, "control-panel:"+actingActorID, "success", correlationID, map[string]any{"role": "operator", "actingActorId": actingActorID}); err != nil {
		return domain.OperatorProfileGrantResponse{}, err
	}
	for _, permission := range domain.OperatorPermissions() {
		if _, err := tx.ExecContext(ctx, `INSERT INTO identity_operator_permissions(actor_id,permission,enabled,version,changed_by_actor_id,reason)
			VALUES($1,$2,false,1,$3,'permission not granted') ON CONFLICT(actor_id,permission) DO NOTHING`, actorRecord.ID, permission, actingActorID); err != nil {
			return domain.OperatorProfileGrantResponse{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_operator_profiles SET state='admitted',phone_e164=NULL,actor_id=$1,version=version+1,updated_at=clock_timestamp() WHERE id=$2 AND state='approved' AND version=$3", actorRecord.ID, profile.ID, expectedVersion); err != nil {
		return domain.OperatorProfileGrantResponse{}, err
	}
	if err := insertOperatorProfileEvent(ctx, tx, profile.ID, "role_admitted", actingActorID, idempotencyKey, hash, correlationID); err != nil {
		return domain.OperatorProfileGrantResponse{}, err
	}
	profile, err = readOperatorProfile(ctx, tx, profile.ID)
	if err != nil {
		return domain.OperatorProfileGrantResponse{}, err
	}
	role := domain.ActorRoleView{ActorID: actorRecord.ID, PhoneE164: actorRecord.PhoneE164, Role: "operator", Enabled: true, ActorVersion: actorRecord.Version, RoleVersion: roleVersion, SecurityEnabled: actorRecord.SecurityEnabled}
	role.ActorCreated, role.RoleCreated = actorCreated, roleCreated
	if err := tx.Commit(); err != nil {
		return domain.OperatorProfileGrantResponse{}, err
	}
	return domain.OperatorProfileGrantResponse{Profile: profile, Role: role}, nil
}

func operatorProfileMutationValid(correlationID, idempotencyKey string) bool {
	return utf8.RuneCountInString(strings.TrimSpace(correlationID)) >= 8 && utf8.RuneCountInString(strings.TrimSpace(correlationID)) <= 128 && utf8.RuneCountInString(strings.TrimSpace(idempotencyKey)) >= 8 && utf8.RuneCountInString(strings.TrimSpace(idempotencyKey)) <= 128
}

func queryRuneCount(value string) int { return utf8.RuneCountInString(strings.TrimSpace(value)) }

func operatorProfileHash(values ...string) string {
	hash := sha256.Sum256([]byte(strings.Join(values, "\x00")))
	return hex.EncodeToString(hash[:])
}

func lockOperatorProfileMutation(ctx context.Context, tx *sql.Tx, key string) error {
	_, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "identity:operator-profile-idempotency:"+key)
	return err
}

func readOperatorProfileReplay(ctx context.Context, q operatorProfileQueryer, key, requestHash string) (domain.OperatorProfile, bool, error) {
	var profileID, existingHash string
	err := q.QueryRowContext(ctx, "SELECT profile_id,request_hash FROM identity_operator_profile_events WHERE idempotency_key=$1", key).Scan(&profileID, &existingHash)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.OperatorProfile{}, false, nil
	}
	if err != nil {
		return domain.OperatorProfile{}, false, err
	}
	if existingHash != requestHash {
		return domain.OperatorProfile{}, false, domain.ErrConflict
	}
	profile, err := readOperatorProfile(ctx, q, profileID)
	return profile, err == nil, err
}

func insertOperatorProfileEvent(ctx context.Context, tx *sql.Tx, profileID, eventType, actingActorID, idempotencyKey, requestHash, correlationID string) error {
	token, err := identitysecurity.RandomToken(18)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO identity_operator_profile_events(id,profile_id,event_type,acting_actor_id,idempotency_key,request_hash,correlation_id)
		VALUES($1,$2,$3,$4,$5,$6,$7)`, "opev_"+token, profileID, eventType, actingActorID, idempotencyKey, requestHash, strings.TrimSpace(correlationID))
	return err
}

func readOperatorProfile(ctx context.Context, q operatorProfileQueryer, id string) (domain.OperatorProfile, error) {
	id = strings.TrimSpace(id)
	query := `SELECT p.id,p.full_name_ar,coalesce(CASE WHEN p.state='admitted' THEN a.phone_e164 ELSE p.phone_e164 END,''),coalesce(p.actor_id,''),r.enabled,a.security_enabled,r.activated_at,p.state,p.version,p.created_at,p.updated_at
		FROM identity_operator_profiles p LEFT JOIN identity_actors a ON a.id=p.actor_id LEFT JOIN identity_actor_roles r ON r.actor_id=p.actor_id AND r.role='operator' WHERE p.id=$1`
	if strings.HasSuffix(id, " FOR UPDATE") {
		id = strings.TrimSpace(strings.TrimSuffix(id, " FOR UPDATE"))
		query += " FOR UPDATE OF p"
	}
	return scanOperatorProfile(q.QueryRowContext(ctx, query, id).Scan)
}

func scanOperatorProfile(scan func(...any) error) (domain.OperatorProfile, error) {
	var profile domain.OperatorProfile
	var roleEnabled, securityEnabled sql.NullBool
	var activatedAt sql.NullTime
	err := scan(&profile.ID, &profile.FullNameAr, &profile.PhoneE164, &profile.ActorID, &roleEnabled, &securityEnabled, &activatedAt, &profile.State, &profile.Version, &profile.CreatedAt, &profile.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.OperatorProfile{}, domain.ErrNotFound
	}
	if roleEnabled.Valid {
		profile.RoleEnabled = &roleEnabled.Bool
	}
	if securityEnabled.Valid {
		profile.SecurityEnabled = &securityEnabled.Bool
	}
	if activatedAt.Valid {
		profile.ActivatedAt = &activatedAt.Time
	}
	return profile, err
}

func readOperatorProfileRole(ctx context.Context, q operatorProfileQueryer, actorID string) (domain.ActorRoleView, error) {
	return scanRoleView(q.QueryRowContext(ctx, `SELECT a.id,a.phone_e164,r.role,r.enabled,r.activated_at,a.security_enabled,a.version,r.version,c.version
		FROM identity_actors a JOIN identity_actor_roles r ON r.actor_id=a.id LEFT JOIN identity_password_credentials c ON c.actor_id=r.actor_id AND c.role=r.role
		WHERE a.id=$1 AND r.role='operator'`, strings.TrimSpace(actorID)).Scan)
}

func decodeOperatorProfileCursor(raw, query, state, sort string) (operatorProfileCursor, error) {
	var cursor operatorProfileCursor
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil || json.Unmarshal(decoded, &cursor) != nil || cursor.Version != 1 || cursor.Query != query || cursor.State != state || cursor.Sort != sort || cursor.ID == "" {
		return operatorProfileCursor{}, domain.ErrInvalidInput
	}
	if _, err := time.Parse(time.RFC3339Nano, cursor.CreatedAt); err != nil {
		return operatorProfileCursor{}, domain.ErrInvalidInput
	}
	return cursor, nil
}
