package postgres

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
)

var (
	ErrFieldAdmissionNotFound    = errors.New("field admission was not found")
	ErrFieldAdmissionExists      = errors.New("field admission already exists")
	ErrFieldAdmissionConflict    = errors.New("field admission is in conflict")
	ErrFieldAdmissionNotEligible = errors.New("field admission is not eligible")
	ErrFieldOperationConflict    = errors.New("field operation idempotency key was already used with different facts")
	ErrFieldVersionConflict      = errors.New("field admission version is stale")
	ErrFieldAdmissionRegistry    = errors.New("field admission registry query is invalid")
)

type FieldAdmissionPage struct {
	Admissions []FieldAdmission
	NextCursor string
}

type fieldAdmissionCursor struct {
	Version   int    `json:"v"`
	Query     string `json:"q"`
	State     string `json:"s"`
	Sort      string `json:"o"`
	CreatedAt string `json:"t"`
	ID        string `json:"i"`
}

type FieldAdmission struct {
	ID         string
	ActorID    string
	FullNameAr string
	PhoneE164  string
	State      string
	Version    int
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

func HashFieldAdmissionRequest(fullNameAr, phone string) string {
	return hashFacts("field-admission", strings.TrimSpace(fullNameAr), strings.TrimSpace(phone))
}

func HashFieldAdmissionTransition(operation, admissionID string) string {
	return hashFacts("field-admission-"+strings.TrimSpace(operation), strings.TrimSpace(admissionID))
}

func HashFieldAdmissionProfileRequest(admissionID, fullNameAr string, expectedVersion int) string {
	return hashFacts("field-admission-profile", strings.TrimSpace(admissionID), strings.TrimSpace(fullNameAr), strconv.Itoa(expectedVersion))
}

func HashFieldAccessRequest(actorID string, enabled bool, expectedVersion int) string {
	return hashFacts("field-access", strings.TrimSpace(actorID), strconv.FormatBool(enabled), strconv.Itoa(expectedVersion))
}

func HashJoiningCaseFieldRequest(fieldActorID, phone, businessName, firstStoreName, serviceCityID, verticalID string, latitude, longitude float64, fulfillmentModes []string) string {
	return hashFacts("field-joining-case", strings.TrimSpace(fieldActorID), strings.TrimSpace(phone), strings.TrimSpace(businessName), strings.TrimSpace(firstStoreName), strings.TrimSpace(serviceCityID), strings.TrimSpace(verticalID), fmt.Sprintf("%.6f", latitude), fmt.Sprintf("%.6f", longitude), strings.Join(fulfillmentModes, ","))
}

func CreateFieldAdmissionCandidate(ctx context.Context, db *sql.DB, fullNameAr, phone, idempotencyKey, requestHash, actingActorID, correlationID string) (FieldAdmission, string, bool, error) {
	fullNameAr = strings.TrimSpace(fullNameAr)
	phone = strings.TrimSpace(phone)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if db == nil || len([]rune(fullNameAr)) < 2 || len([]rune(fullNameAr)) > 120 || phone == "" || idempotencyKey == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return FieldAdmission{}, "", false, ErrFieldAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FieldAdmission{}, "", false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:field-admission:"+idempotencyKey); err != nil {
		return FieldAdmission{}, "", false, err
	}
	var storedHash, admissionID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,admission_id FROM dsh.field_admission_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &admissionID)
	if err == nil {
		if storedHash != requestHash {
			return FieldAdmission{}, "", false, ErrFieldOperationConflict
		}
		admission, readErr := readFieldAdmissionTx(ctx, tx, "id=$1", admissionID)
		if readErr != nil {
			return FieldAdmission{}, "", false, readErr
		}
		if err := tx.Commit(); err != nil {
			return FieldAdmission{}, "", false, err
		}
		return admission, idempotencyKey, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FieldAdmission{}, "", false, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:field-admission-phone:"+phone); err != nil {
		return FieldAdmission{}, "", false, err
	}
	var existing string
	err = tx.QueryRowContext(ctx, "SELECT id FROM dsh.field_admissions WHERE contact_phone_e164=$1 AND state IN ('pending_review','pending_identity') FOR UPDATE", phone).Scan(&existing)
	if err == nil {
		var resumeKey string
		if err := tx.QueryRowContext(ctx, "SELECT idempotency_key FROM dsh.field_admission_idempotency WHERE admission_id=$1 AND operation='create' ORDER BY created_at,idempotency_key LIMIT 1", existing).Scan(&resumeKey); err != nil {
			return FieldAdmission{}, "", false, ErrFieldAdmissionConflict
		}
		admission, readErr := readFieldAdmissionTx(ctx, tx, "id=$1", existing)
		if readErr != nil {
			return FieldAdmission{}, "", false, readErr
		}
		if err := tx.Commit(); err != nil {
			return FieldAdmission{}, "", false, err
		}
		return admission, resumeKey, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FieldAdmission{}, "", false, err
	}
	admissionID, err = newID("field-admission")
	if err != nil {
		return FieldAdmission{}, "", false, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.field_admissions(id,full_name_ar,contact_phone_e164,state,version) VALUES($1,$2,$3,'pending_review',1)", admissionID, fullNameAr, phone); err != nil {
		return FieldAdmission{}, "", false, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.field_admission_idempotency(idempotency_key,request_hash,admission_id,operation,result_version,result_state) VALUES($1,$2,$3,'create',1,'pending_review')", idempotencyKey, requestHash, admissionID); err != nil {
		return FieldAdmission{}, "", false, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.field_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,to_state,result_version,request_hash) VALUES('field_admission_created',$1,$2,$3,$4,'pending_review',1,$5)", idempotencyKey, correlationID, actingActorID, admissionID, requestHash); err != nil {
		return FieldAdmission{}, "", false, err
	}
	if err := tx.Commit(); err != nil {
		return FieldAdmission{}, "", false, err
	}
	admission, err := ReadFieldAdmission(ctx, db, admissionID)
	return admission, idempotencyKey, false, err
}

func ApproveFieldAdmission(ctx context.Context, db *sql.DB, admissionID, idempotencyKey, requestHash, actingActorID, correlationID string) (FieldAdmission, bool, error) {
	if db == nil || strings.TrimSpace(admissionID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return FieldAdmission{}, false, ErrFieldAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FieldAdmission{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,admission_id,operation FROM dsh.field_admission_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != admissionID || operation != "approve" {
			return FieldAdmission{}, false, ErrFieldOperationConflict
		}
		admission, readErr := readFieldAdmissionTx(ctx, tx, "id=$1", admissionID)
		if readErr != nil {
			return FieldAdmission{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return FieldAdmission{}, false, err
		}
		return admission, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FieldAdmission{}, false, err
	}
	current, err := readFieldAdmissionTx(ctx, tx, "id=$1 FOR UPDATE", admissionID)
	if err != nil {
		return FieldAdmission{}, false, err
	}
	if current.State != "pending_review" || current.FullNameAr == "" {
		return FieldAdmission{}, false, ErrFieldAdmissionConflict
	}
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.field_admissions SET state='pending_identity',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='pending_review' AND version=$2 RETURNING id,COALESCE(actor_id,''),COALESCE(full_name_ar,''),COALESCE(contact_phone_e164,''),state,version,created_at,updated_at`, admissionID, current.Version).Scan(&current.ID, &current.ActorID, &current.FullNameAr, &current.PhoneE164, &current.State, &current.Version, &current.CreatedAt, &current.UpdatedAt); err != nil {
		return FieldAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_idempotency(idempotency_key,request_hash,admission_id,operation,result_version,result_state) VALUES($1,$2,$3,'approve',$4,'pending_identity')`, idempotencyKey, requestHash, admissionID, current.Version); err != nil {
		return FieldAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,from_state,to_state,from_version,result_version,request_hash) VALUES('field_admission_approved',$1,$2,$3,$4,'pending_review','pending_identity',$5,$6,$7)`, idempotencyKey, correlationID, actingActorID, admissionID, current.Version-1, current.Version, requestHash); err != nil {
		return FieldAdmission{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return FieldAdmission{}, false, err
	}
	return current, false, nil
}

func UpdateFieldAdmissionProfile(ctx context.Context, db *sql.DB, admissionID, fullNameAr string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (FieldAdmission, bool, error) {
	fullNameAr = strings.TrimSpace(fullNameAr)
	if db == nil || len([]rune(fullNameAr)) < 2 || len([]rune(fullNameAr)) > 120 || expectedVersion < 1 || strings.TrimSpace(admissionID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" {
		return FieldAdmission{}, false, ErrFieldAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FieldAdmission{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	var oldHash, oldID, operation string
	err = tx.QueryRowContext(ctx, `SELECT request_hash,admission_id,operation FROM dsh.field_admission_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&oldHash, &oldID, &operation)
	if err == nil {
		if oldHash != requestHash || oldID != admissionID || operation != "profile" {
			return FieldAdmission{}, false, ErrFieldOperationConflict
		}
		item, readErr := readFieldAdmissionTx(ctx, tx, "id=$1", admissionID)
		if readErr != nil {
			return FieldAdmission{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return FieldAdmission{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return FieldAdmission{}, false, err
	}
	current, err := readFieldAdmissionTx(ctx, tx, "id=$1 FOR UPDATE", admissionID)
	if err != nil {
		return FieldAdmission{}, false, err
	}
	if current.State != "pending_review" {
		return FieldAdmission{}, false, ErrFieldAdmissionConflict
	}
	if current.Version != expectedVersion {
		return FieldAdmission{}, false, ErrFieldVersionConflict
	}
	err = tx.QueryRowContext(ctx, `UPDATE dsh.field_admissions SET full_name_ar=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='pending_review' AND version=$3 RETURNING id,COALESCE(actor_id,''),COALESCE(full_name_ar,''),COALESCE(contact_phone_e164,''),state,version,created_at,updated_at`, admissionID, fullNameAr, expectedVersion).Scan(&current.ID, &current.ActorID, &current.FullNameAr, &current.PhoneE164, &current.State, &current.Version, &current.CreatedAt, &current.UpdatedAt)
	if err != nil {
		return FieldAdmission{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_idempotency(idempotency_key,request_hash,admission_id,operation,result_version,result_state) VALUES($1,$2,$3,'profile',$4,$5)`, idempotencyKey, requestHash, admissionID, current.Version, current.State); err != nil {
		return FieldAdmission{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,from_state,to_state,from_version,result_version,request_hash) VALUES('field_admission_profile_updated',$1,$2,$3,$4,$5,$5,$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, admissionID, current.State, expectedVersion, current.Version, requestHash); err != nil {
		return FieldAdmission{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return FieldAdmission{}, false, err
	}
	return current, false, nil
}

func ListFieldAdmissions(ctx context.Context, db *sql.DB, query, state, sort string, limit int, rawCursor string) (FieldAdmissionPage, error) {
	query, state, sort = strings.TrimSpace(query), strings.TrimSpace(state), strings.TrimSpace(sort)
	if state == "all" {
		state = ""
	}
	if state == "" {
		state = "all"
	}
	if sort == "" {
		sort = "created_desc"
	}
	if db == nil || len([]rune(query)) > 100 || limit < 1 || limit > 50 || (state != "all" && state != "pending" && state != "pending_review" && state != "pending_identity" && state != "eligible" && state != "suspended") || (sort != "created_desc" && sort != "created_asc") {
		return FieldAdmissionPage{}, ErrFieldAdmissionRegistry
	}
	cursor, err := decodeFieldAdmissionCursor(rawCursor, query, state, sort)
	if err != nil {
		return FieldAdmissionPage{}, err
	}
	args := []any{query, state}
	where := `($1='' OR full_name_ar ILIKE '%'||$1||'%' OR COALESCE(contact_phone_e164,'') ILIKE '%'||$1||'%') AND ($2='all' OR ($2='pending' AND state IN ('pending_review','pending_identity')) OR state=$2)`
	if cursor != nil {
		args = append(args, cursor.CreatedAt, cursor.ID)
		op := `<`
		if sort == "created_asc" {
			op = `>`
		}
		where += ` AND (created_at ` + op + ` $3::timestamptz OR (created_at=$3::timestamptz AND id ` + op + ` $4))`
	}
	order := `created_at DESC,id DESC`
	if sort == "created_asc" {
		order = `created_at ASC,id ASC`
	}
	args = append(args, limit+1)
	rows, err := db.QueryContext(ctx, `SELECT id,COALESCE(actor_id,''),COALESCE(full_name_ar,''),COALESCE(contact_phone_e164,''),state,version,created_at,updated_at FROM dsh.field_admissions WHERE `+where+` ORDER BY `+order+` LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return FieldAdmissionPage{}, err
	}
	defer rows.Close()
	items := make([]FieldAdmission, 0, limit+1)
	for rows.Next() {
		var v FieldAdmission
		if err := rows.Scan(&v.ID, &v.ActorID, &v.FullNameAr, &v.PhoneE164, &v.State, &v.Version, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return FieldAdmissionPage{}, err
		}
		items = append(items, v)
	}
	if err := rows.Err(); err != nil {
		return FieldAdmissionPage{}, err
	}
	page := FieldAdmissionPage{Admissions: items}
	if len(items) > limit {
		page.Admissions = items[:limit]
		last := page.Admissions[len(page.Admissions)-1]
		b, _ := json.Marshal(fieldAdmissionCursor{Version: 1, Query: query, State: state, Sort: sort, CreatedAt: last.CreatedAt.UTC().Format(time.RFC3339Nano), ID: last.ID})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(b)
	}
	return page, nil
}

func decodeFieldAdmissionCursor(raw, query, state, sort string) (*fieldAdmissionCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, ErrFieldAdmissionRegistry
	}
	var c fieldAdmissionCursor
	if json.Unmarshal(b, &c) != nil || c.Version != 1 || c.Query != query || c.State != state || c.Sort != sort || c.ID == "" || c.CreatedAt == "" {
		return nil, ErrFieldAdmissionRegistry
	}
	if _, err = time.Parse(time.RFC3339Nano, c.CreatedAt); err != nil {
		return nil, ErrFieldAdmissionRegistry
	}
	return &c, nil
}

func BindFieldAdmission(ctx context.Context, db *sql.DB, admissionID, actorID, idempotencyKey, requestHash, actingActorID, correlationID string) (FieldAdmission, error) {
	if db == nil || strings.TrimSpace(admissionID) == "" || strings.TrimSpace(actorID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return FieldAdmission{}, ErrFieldAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FieldAdmission{}, err
	}
	defer func() { _ = tx.Rollback() }()
	current, err := readFieldAdmissionTx(ctx, tx, "id=$1 FOR UPDATE", admissionID)
	if err != nil {
		return FieldAdmission{}, err
	}
	if current.State == "eligible" && current.ActorID == actorID {
		if err := tx.Commit(); err != nil {
			return FieldAdmission{}, err
		}
		return current, nil
	}
	if current.State != "pending_identity" || current.ActorID != "" {
		return FieldAdmission{}, ErrFieldAdmissionConflict
	}
	var updated FieldAdmission
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.field_admissions SET actor_id=$2,contact_phone_e164=NULL,state='eligible',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='pending_identity' AND version=$3 RETURNING id,actor_id,COALESCE(full_name_ar,''),'',state,version,created_at,updated_at`, admissionID, actorID, current.Version).Scan(&updated.ID, &updated.ActorID, &updated.FullNameAr, &updated.PhoneE164, &updated.State, &updated.Version, &updated.CreatedAt, &updated.UpdatedAt); err != nil {
		return FieldAdmission{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_idempotency(idempotency_key,request_hash,admission_id,operation,result_version,result_state,result_actor_id) VALUES($1,$4,$5,'bind',$2,'eligible',$3)`, idempotencyKey, updated.Version, actorID, requestHash, admissionID); err != nil {
		return FieldAdmission{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('field_admission_bound',$1,$2,$3,$4,$5,'pending_identity','eligible',$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, admissionID, actorID, current.Version, updated.Version, requestHash); err != nil {
		return FieldAdmission{}, err
	}
	if err := tx.Commit(); err != nil {
		return FieldAdmission{}, err
	}
	return updated, nil
}

func LockFieldLifecycle(ctx context.Context, db *sql.DB, actorID string) (*sql.Tx, error) {
	actorID = strings.TrimSpace(actorID)
	if db == nil || actorID == "" {
		return nil, ErrFieldAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:field-lifecycle:"+actorID); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	return tx, nil
}

func ReadFieldAdmission(ctx context.Context, db *sql.DB, admissionID string) (FieldAdmission, error) {
	if db == nil || strings.TrimSpace(admissionID) == "" {
		return FieldAdmission{}, ErrFieldAdmissionNotFound
	}
	return readFieldAdmissionTx(ctx, db, "id=$1", strings.TrimSpace(admissionID))
}

func ReadFieldAdmissionForActor(ctx context.Context, db *sql.DB, actorID string) (FieldAdmission, error) {
	if db == nil || strings.TrimSpace(actorID) == "" {
		return FieldAdmission{}, ErrFieldAdmissionNotFound
	}
	return readFieldAdmissionTx(ctx, db, "actor_id=$1", strings.TrimSpace(actorID))
}

func SuspendFieldAdmission(ctx context.Context, db *sql.DB, actorID, idempotencyKey, requestHash, actingActorID, correlationID string) (FieldAdmission, error) {
	return transitionFieldAdmission(ctx, db, actorID, "suspended", "field_admission_suspended", idempotencyKey, requestHash, actingActorID, correlationID)
}

func RestoreFieldAdmission(ctx context.Context, db *sql.DB, actorID, idempotencyKey, requestHash, actingActorID, correlationID string) (FieldAdmission, error) {
	return transitionFieldAdmission(ctx, db, actorID, "eligible", "field_admission_restored", idempotencyKey, requestHash, actingActorID, correlationID)
}

func transitionFieldAdmission(ctx context.Context, db *sql.DB, actorID, targetState, eventType, idempotencyKey, requestHash, actingActorID, correlationID string) (FieldAdmission, error) {
	if db == nil || strings.TrimSpace(actorID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return FieldAdmission{}, ErrFieldAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FieldAdmission{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if replay, err := fieldAdmissionAccessReplayTx(ctx, tx, eventType, idempotencyKey, requestHash); err != nil {
		return FieldAdmission{}, err
	} else if replay {
		admission, readErr := readFieldAdmissionTx(ctx, tx, "actor_id=$1", actorID)
		if readErr != nil {
			return FieldAdmission{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return FieldAdmission{}, err
		}
		return admission, nil
	}
	current, err := readFieldAdmissionTx(ctx, tx, "actor_id=$1 FOR UPDATE", actorID)
	if err != nil {
		return FieldAdmission{}, err
	}
	if current.State == targetState {
		if err := tx.Commit(); err != nil {
			return FieldAdmission{}, err
		}
		return current, nil
	}
	if (targetState == "suspended" && current.State != "eligible") || (targetState == "eligible" && current.State != "suspended") {
		return FieldAdmission{}, ErrFieldAdmissionConflict
	}
	var updated FieldAdmission
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.field_admissions SET state=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state=$3 AND version=$4 RETURNING id,COALESCE(actor_id,''),state,version,created_at,updated_at`, current.ID, targetState, current.State, current.Version).Scan(&updated.ID, &updated.ActorID, &updated.State, &updated.Version, &updated.CreatedAt, &updated.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return FieldAdmission{}, ErrFieldVersionConflict
		}
		return FieldAdmission{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, eventType, idempotencyKey, correlationID, actingActorID, current.ID, actorID, current.State, targetState, current.Version, updated.Version, requestHash); err != nil {
		return FieldAdmission{}, err
	}
	if err := tx.Commit(); err != nil {
		return FieldAdmission{}, err
	}
	return updated, nil
}

func fieldAdmissionAccessReplayTx(ctx context.Context, tx *sql.Tx, eventType, idempotencyKey, requestHash string) (bool, error) {
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "dsh:field-access:"+idempotencyKey); err != nil {
		return false, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT event_type,request_hash FROM dsh.field_admission_audit WHERE idempotency_key=$1 ORDER BY id FOR UPDATE`, idempotencyKey)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	count := 0
	matching := false
	for rows.Next() {
		var storedEventType, storedHash string
		if err := rows.Scan(&storedEventType, &storedHash); err != nil {
			return false, err
		}
		count++
		matching = matching || (storedEventType == eventType && storedHash == requestHash)
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	if count == 0 {
		return false, nil
	}
	if count != 1 || !matching {
		return false, ErrFieldOperationConflict
	}
	return true, nil
}

func readFieldAdmissionTx(ctx context.Context, source interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, where string, args ...any) (FieldAdmission, error) {
	var item FieldAdmission
	err := source.QueryRowContext(ctx, `SELECT id,COALESCE(actor_id,''),COALESCE(full_name_ar,''),COALESCE(contact_phone_e164,''),state,version,created_at,updated_at FROM dsh.field_admissions WHERE `+where, args...).Scan(&item.ID, &item.ActorID, &item.FullNameAr, &item.PhoneE164, &item.State, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return FieldAdmission{}, ErrFieldAdmissionNotFound
	}
	return item, err
}
