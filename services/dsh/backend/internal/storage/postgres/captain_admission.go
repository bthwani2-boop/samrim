package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

func CreateCaptainAdmissionCandidate(ctx context.Context, db *sql.DB, fullNameAr, phone, walletProviderKey, idempotencyKey, requestHash, actingActorID, correlationID string) (CaptainAdmission, bool, error) {
	fullNameAr = strings.TrimSpace(fullNameAr)
	walletProviderKey = strings.TrimSpace(walletProviderKey)
	if db == nil || len([]rune(fullNameAr)) < 2 || len([]rune(fullNameAr)) > 120 || strings.TrimSpace(phone) == "" || len([]rune(walletProviderKey)) < 1 || len([]rune(walletProviderKey)) > 64 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainAdmission{}, false, ErrCaptainAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:captain-admission:"+idempotencyKey); err != nil {
		return CaptainAdmission{}, false, err
	}
	var storedHash, admissionID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,admission_id FROM dsh.captain_admission_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &admissionID)
	if err == nil {
		if storedHash != requestHash {
			return CaptainAdmission{}, false, ErrCaptainOperationConflict
		}
		admission, readErr := readCaptainAdmissionTx(ctx, tx, "id=$1", admissionID)
		if readErr != nil {
			return CaptainAdmission{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, false, err
		}
		return admission, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, false, err
	}
	var existing string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.captain_admissions WHERE contact_phone_e164=$1 AND state IN ('pending_review','pending_identity') FOR UPDATE", strings.TrimSpace(phone)).Scan(&existing); err == nil {
		return CaptainAdmission{}, false, ErrCaptainAdmissionExists
	} else if !errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, false, err
	}
	admissionID, err = newID("captain-admission")
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admissions(id,full_name_ar,contact_phone_e164,wallet_provider_key,state,availability_state,version) VALUES($1,$2,$3,$4,'pending_review','unavailable',1)`, admissionID, fullNameAr, strings.TrimSpace(phone), walletProviderKey); err != nil {
		return CaptainAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_idempotency(idempotency_key,request_hash,admission_id,operation,result_version,result_state) VALUES($1,$2,$3,'create',1,'pending_review')`, idempotencyKey, requestHash, admissionID); err != nil {
		return CaptainAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,to_state,result_version,request_hash) VALUES('captain_admission_created',$1,$2,$3,$4,'pending_review',1,$5)`, idempotencyKey, correlationID, actingActorID, admissionID, requestHash); err != nil {
		return CaptainAdmission{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAdmission{}, false, err
	}
	admission, err := ReadCaptainAdmission(ctx, db, admissionID)
	return admission, false, err
}

func ApproveCaptainAdmission(ctx context.Context, db *sql.DB, admissionID string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CaptainAdmission, bool, error) {
	if db == nil || strings.TrimSpace(admissionID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainAdmission{}, false, ErrCaptainAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,admission_id,operation FROM dsh.captain_admission_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != admissionID || operation != "approve" {
			return CaptainAdmission{}, false, ErrCaptainOperationConflict
		}
		admission, readErr := readCaptainAdmissionTx(ctx, tx, "id=$1", admissionID)
		if readErr != nil {
			return CaptainAdmission{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, false, err
		}
		return admission, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, false, err
	}
	var current CaptainAdmission
	var actorID, phone sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT id,actor_id,full_name_ar,contact_phone_e164,state,availability_state,version,created_at,updated_at FROM dsh.captain_admissions WHERE id=$1 FOR UPDATE`, admissionID).Scan(&current.ID, &actorID, &current.FullNameAr, &phone, &current.State, &current.AvailabilityState, &current.Version, &current.CreatedAt, &current.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, false, ErrCaptainAdmissionNotFound
	}
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	if actorID.Valid {
		current.ActorID = actorID.String
	}
	if phone.Valid {
		current.PhoneE164 = phone.String
	}
	if current.State != "pending_review" || current.FullNameAr == "" {
		return CaptainAdmission{}, false, ErrCaptainAdmissionConflict
	}
	if current.Version != expectedVersion {
		return CaptainAdmission{}, false, ErrCaptainVersionConflict
	}
	err = tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET state='pending_identity',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='pending_review' AND version=$2 RETURNING id,COALESCE(actor_id,''),COALESCE(full_name_ar,''),COALESCE(contact_phone_e164,''),state,availability_state,version,created_at,updated_at`, admissionID, current.Version).Scan(&current.ID, &current.ActorID, &current.FullNameAr, &current.PhoneE164, &current.State, &current.AvailabilityState, &current.Version, &current.CreatedAt, &current.UpdatedAt)
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_idempotency(idempotency_key,request_hash,admission_id,operation,result_version,result_state) VALUES($1,$2,$3,'approve',$4,'pending_identity')`, idempotencyKey, requestHash, admissionID, current.Version); err != nil {
		return CaptainAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,from_state,to_state,from_version,result_version,request_hash) VALUES('captain_admission_approved',$1,$2,$3,$4,'pending_review','pending_identity',$5,$6,$7)`, idempotencyKey, correlationID, actingActorID, admissionID, current.Version-1, current.Version, requestHash); err != nil {
		return CaptainAdmission{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAdmission{}, false, err
	}
	return current, false, nil
}

func UpdateCaptainAdmissionProfile(ctx context.Context, db *sql.DB, admissionID, fullNameAr string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CaptainAdmission, bool, error) {
	fullNameAr = strings.TrimSpace(fullNameAr)
	if db == nil || len([]rune(fullNameAr)) < 2 || len([]rune(fullNameAr)) > 120 || expectedVersion < 1 || strings.TrimSpace(admissionID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" {
		return CaptainAdmission{}, false, ErrCaptainAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	var oldHash, oldID, operation string
	err = tx.QueryRowContext(ctx, `SELECT request_hash,admission_id,operation FROM dsh.captain_admission_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&oldHash, &oldID, &operation)
	if err == nil {
		if oldHash != requestHash || oldID != admissionID || operation != "profile" {
			return CaptainAdmission{}, false, ErrCaptainOperationConflict
		}
		item, readErr := readCaptainAdmissionTx(ctx, tx, "id=$1", admissionID)
		if readErr != nil {
			return CaptainAdmission{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, false, err
	}
	current, err := readCaptainAdmissionTx(ctx, tx, "id=$1 FOR UPDATE", admissionID)
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	if current.State != "pending_review" && !(current.State == "suspended" && current.RequiresProfileReview) {
		return CaptainAdmission{}, false, ErrCaptainAdmissionConflict
	}
	if current.Version != expectedVersion {
		return CaptainAdmission{}, false, ErrCaptainVersionConflict
	}
	err = tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET full_name_ar=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND (state='pending_review' OR (state='suspended' AND requires_profile_review)) AND version=$3 RETURNING id,COALESCE(actor_id,''),COALESCE(full_name_ar,''),COALESCE(contact_phone_e164,''),state,availability_state,requires_profile_review,version,created_at,updated_at`, admissionID, fullNameAr, expectedVersion).Scan(&current.ID, &current.ActorID, &current.FullNameAr, &current.PhoneE164, &current.State, &current.AvailabilityState, &current.RequiresProfileReview, &current.Version, &current.CreatedAt, &current.UpdatedAt)
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_idempotency(idempotency_key,request_hash,admission_id,operation,result_version,result_state) VALUES($1,$2,$3,'profile',$4,$5)`, idempotencyKey, requestHash, admissionID, current.Version, current.State); err != nil {
		return CaptainAdmission{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,from_state,to_state,from_version,result_version,request_hash) VALUES('captain_admission_profile_updated',$1,$2,$3,$4,$5,$5,$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, admissionID, current.State, expectedVersion, current.Version, requestHash); err != nil {
		return CaptainAdmission{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return CaptainAdmission{}, false, err
	}
	return current, false, nil
}

func ReviewCaptainAdmissionProfile(ctx context.Context, db *sql.DB, admissionID string, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID string) (CaptainAdmission, bool, error) {
	if db == nil || strings.TrimSpace(admissionID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainAdmission{}, false, ErrCaptainAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	var storedHash, storedID, operation string
	err = tx.QueryRowContext(ctx, `SELECT request_hash,admission_id,operation FROM dsh.captain_admission_idempotency WHERE idempotency_key=$1 FOR UPDATE`, idempotencyKey).Scan(&storedHash, &storedID, &operation)
	if err == nil {
		if storedHash != requestHash || storedID != admissionID || operation != "profile_review" {
			return CaptainAdmission{}, false, ErrCaptainOperationConflict
		}
		item, readErr := readCaptainAdmissionTx(ctx, tx, "id=$1", admissionID)
		if readErr != nil {
			return CaptainAdmission{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, false, err
	}
	current, err := readCaptainAdmissionTx(ctx, tx, "id=$1 FOR UPDATE", admissionID)
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	if current.State != "suspended" || !current.RequiresProfileReview || current.ActorID == "" || current.FullNameAr == "" {
		return CaptainAdmission{}, false, ErrCaptainAdmissionConflict
	}
	if current.Version != expectedVersion {
		return CaptainAdmission{}, false, ErrCaptainVersionConflict
	}
	err = tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET requires_profile_review=false,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='suspended' AND requires_profile_review=true AND version=$2 RETURNING id,actor_id,COALESCE(full_name_ar,''),COALESCE(contact_phone_e164,''),state,availability_state,requires_profile_review,version,created_at,updated_at`, admissionID, current.Version).Scan(&current.ID, &current.ActorID, &current.FullNameAr, &current.PhoneE164, &current.State, &current.AvailabilityState, &current.RequiresProfileReview, &current.Version, &current.CreatedAt, &current.UpdatedAt)
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_idempotency(idempotency_key,request_hash,admission_id,operation,result_version,result_state,result_actor_id) VALUES($1,$2,$3,'profile_review',$4,$5,$6)`, idempotencyKey, requestHash, admissionID, current.Version, current.State, current.ActorID); err != nil {
		return CaptainAdmission{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash,reason) VALUES('captain_admission_profile_reviewed',$1,$2,$3,$4,$5,'suspended','suspended',$6,$7,$8,'مراجعة الملف وإثبات اكتمال الاسم العربي')`, idempotencyKey, correlationID, actingActorID, admissionID, current.ActorID, current.Version-1, current.Version, requestHash); err != nil {
		return CaptainAdmission{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAdmission{}, false, err
	}
	return current, false, nil
}

func ListCaptainAdmissions(ctx context.Context, db *sql.DB, query, state, sort string, limit int, rawCursor string) (CaptainAdmissionPage, error) {
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
	if db == nil || len([]rune(query)) > 100 || limit < 1 || limit > 50 || (state != "all" && state != "pending" && state != "pending_review" && state != "pending_identity" && state != "eligible" && state != "suspended" && state != "review_required") || (sort != "created_desc" && sort != "created_asc") {
		return CaptainAdmissionPage{}, ErrCaptainAdmissionRegistry
	}
	cursor, err := decodeCaptainAdmissionCursor(rawCursor, query, state, sort)
	if err != nil {
		return CaptainAdmissionPage{}, err
	}
	var cursorCreatedAt any
	var cursorID string
	if cursor != nil {
		cursorCreatedAt = cursor.CreatedAt
		cursorID = cursor.ID
	}
	rows, err := db.QueryContext(ctx, `SELECT id,COALESCE(actor_id,''),COALESCE(full_name_ar,''),COALESCE(contact_phone_e164,''),state,availability_state,requires_profile_review,version,created_at,updated_at
		FROM dsh.captain_admissions
		WHERE ($1='' OR full_name_ar ILIKE '%'||$1||'%' OR COALESCE(contact_phone_e164,'') ILIKE '%'||$1||'%')
		AND ($2='all' OR ($2='pending' AND state IN ('pending_review','pending_identity')) OR ($2='review_required' AND requires_profile_review) OR state=$2)
		AND (NOT $5::boolean OR ($6='created_asc' AND (created_at,id)>($3::timestamptz,$4)) OR ($6='created_desc' AND (created_at,id)<($3::timestamptz,$4)))
		ORDER BY CASE WHEN $6='created_asc' THEN created_at END ASC,CASE WHEN $6='created_desc' THEN created_at END DESC,
		CASE WHEN $6='created_asc' THEN id END ASC,CASE WHEN $6='created_desc' THEN id END DESC
		LIMIT $7`, query, state, cursorCreatedAt, cursorID, cursor != nil, sort, limit+1)
	if err != nil {
		return CaptainAdmissionPage{}, err
	}
	defer rows.Close()
	items := make([]CaptainAdmission, 0, limit+1)
	for rows.Next() {
		var v CaptainAdmission
		if err := rows.Scan(&v.ID, &v.ActorID, &v.FullNameAr, &v.PhoneE164, &v.State, &v.AvailabilityState, &v.RequiresProfileReview, &v.Version, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return CaptainAdmissionPage{}, err
		}
		items = append(items, v)
	}
	if err := rows.Err(); err != nil {
		return CaptainAdmissionPage{}, err
	}
	page := CaptainAdmissionPage{Admissions: items}
	if len(items) > limit {
		page.Admissions = items[:limit]
		last := page.Admissions[len(page.Admissions)-1]
		b, _ := json.Marshal(captainAdmissionCursor{Version: 1, Query: query, State: state, Sort: sort, CreatedAt: last.CreatedAt.UTC().Format(time.RFC3339Nano), ID: last.ID})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(b)
	}
	return page, nil
}

func decodeCaptainAdmissionCursor(raw, query, state, sort string) (*captainAdmissionCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, ErrCaptainAdmissionRegistry
	}
	var c captainAdmissionCursor
	if json.Unmarshal(b, &c) != nil || c.Version != 1 || c.Query != query || c.State != state || c.Sort != sort || c.ID == "" || c.CreatedAt == "" {
		return nil, ErrCaptainAdmissionRegistry
	}
	if _, err = time.Parse(time.RFC3339Nano, c.CreatedAt); err != nil {
		return nil, ErrCaptainAdmissionRegistry
	}
	return &c, nil
}

func ReadCaptainAdmission(ctx context.Context, db *sql.DB, admissionID string) (CaptainAdmission, error) {
	if db == nil || strings.TrimSpace(admissionID) == "" {
		return CaptainAdmission{}, ErrCaptainAdmissionNotFound
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var actorID string
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(actor_id,'') FROM dsh.captain_admissions WHERE id=$1`, strings.TrimSpace(admissionID)).Scan(&actorID); errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, ErrCaptainAdmissionNotFound
	} else if err != nil {
		return CaptainAdmission{}, err
	}
	if actorID != "" {
		if err := canonicalizeCaptainOffersTx(ctx, tx, actorID); err != nil {
			return CaptainAdmission{}, err
		}
	}
	admission, err := readCaptainAdmissionTx(ctx, tx, "id=$1", strings.TrimSpace(admissionID))
	if err != nil {
		return CaptainAdmission{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAdmission{}, err
	}
	return admission, nil
}

func ReadCaptainAdmissionForActor(ctx context.Context, db *sql.DB, actorID string) (CaptainAdmission, error) {
	if db == nil || strings.TrimSpace(actorID) == "" {
		return CaptainAdmission{}, ErrCaptainAdmissionNotFound
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := canonicalizeCaptainOffersTx(ctx, tx, strings.TrimSpace(actorID)); err != nil {
		return CaptainAdmission{}, err
	}
	admission, err := readCaptainAdmissionTx(ctx, tx, "actor_id=$1", strings.TrimSpace(actorID))
	if err != nil {
		return CaptainAdmission{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAdmission{}, err
	}
	return admission, nil
}

func LockCaptainReenrollmentAdmission(ctx context.Context, db *sql.DB, actorID string) (*sql.Tx, CaptainAdmission, error) {
	actorID = strings.TrimSpace(actorID)
	if db == nil || actorID == "" || len(actorID) > 128 {
		return nil, CaptainAdmission{}, ErrCaptainAdmissionNotFound
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, CaptainAdmission{}, err
	}
	admission, err := readCaptainAdmissionTx(ctx, tx, "actor_id=$1 FOR UPDATE", actorID)
	if err != nil {
		_ = tx.Rollback()
		return nil, CaptainAdmission{}, err
	}
	return tx, admission, nil
}

func ReadCaptainFinancialAdmissionState(ctx context.Context, db *sql.DB, actorID string) (string, error) {
	actorID = strings.TrimSpace(actorID)
	if db == nil || actorID == "" || len(actorID) > 128 {
		return "", ErrCaptainAdmissionNotFound
	}
	var state string
	var requiresProfileReview bool
	err := db.QueryRowContext(ctx, `SELECT state,requires_profile_review FROM dsh.captain_admissions WHERE actor_id=$1`, actorID).Scan(&state, &requiresProfileReview)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrCaptainAdmissionNotFound
	}
	if err == nil && requiresProfileReview {
		return "suspended", nil
	}
	return state, err
}

func BindCaptainAdmission(ctx context.Context, db *sql.DB, admissionID, actorID, idempotencyKey, requestHash, actingActorID, correlationID string) (CaptainAdmission, error) {
	if db == nil || strings.TrimSpace(admissionID) == "" || strings.TrimSpace(actorID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainAdmission{}, ErrCaptainAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var current CaptainAdmission
	var actorStateID, phone sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT id,actor_id,contact_phone_e164,state,availability_state,version,created_at,updated_at FROM dsh.captain_admissions WHERE id=$1 FOR UPDATE`, admissionID).Scan(&current.ID, &actorStateID, &phone, &current.State, &current.AvailabilityState, &current.Version, &current.CreatedAt, &current.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, ErrCaptainAdmissionNotFound
	}
	if err != nil {
		return CaptainAdmission{}, err
	}
	if actorStateID.Valid {
		current.ActorID = actorStateID.String
	}
	if current.State == "eligible" && current.ActorID == actorID {
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, err
		}
		return current, nil
	}
	if current.State != "pending_identity" || current.ActorID != "" || !phone.Valid {
		return CaptainAdmission{}, ErrCaptainAdmissionConflict
	}
	var updated CaptainAdmission
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET actor_id=$2,contact_phone_e164=NULL,state='eligible',availability_state='unavailable',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='pending_identity' AND version=$3 RETURNING id,actor_id,COALESCE(full_name_ar,''),'',state,availability_state,version,created_at,updated_at`, admissionID, actorID, current.Version).Scan(&updated.ID, &updated.ActorID, &updated.FullNameAr, &updated.PhoneE164, &updated.State, &updated.AvailabilityState, &updated.Version, &updated.CreatedAt, &updated.UpdatedAt); err != nil {
		return CaptainAdmission{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_idempotency(idempotency_key,request_hash,admission_id,operation,result_version,result_state,result_actor_id) VALUES($1,$4,$5,'bind',$2,'eligible',$3)`, idempotencyKey, updated.Version, actorID, requestHash, admissionID); err != nil {
		return CaptainAdmission{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('captain_admission_bound',$1,$2,$3,$4,$5,'pending_identity','eligible',$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, admissionID, actorID, current.Version, updated.Version, requestHash); err != nil {
		return CaptainAdmission{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAdmission{}, err
	}
	return updated, nil
}

func SetCaptainAvailability(ctx context.Context, db *sql.DB, actorID string, available bool, expectedVersion int, idempotencyKey, requestHash, actingActorID, correlationID, reason string) (CaptainAdmission, bool, error) {
	if db == nil || strings.TrimSpace(actorID) == "" || expectedVersion < 1 || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainAdmission{}, false, ErrCaptainOperationConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := canonicalizeCaptainOffersTx(ctx, tx, strings.TrimSpace(actorID)); err != nil {
		return CaptainAdmission{}, false, err
	}
	replay, err := captainOperationReplayTx(ctx, tx, idempotencyKey, requestHash, "availability")
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	if replay != nil {
		admission, readErr := readCaptainAdmissionTx(ctx, tx, "id=$1", replay.AdmissionID)
		if readErr != nil {
			return CaptainAdmission{}, false, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, false, err
		}
		return admission, true, nil
	}
	var admission CaptainAdmission
	err = tx.QueryRowContext(ctx, `SELECT id,actor_id,COALESCE(full_name_ar,''),state,availability_state,requires_profile_review,version,created_at,updated_at FROM dsh.captain_admissions WHERE actor_id=$1 FOR UPDATE`, actorID).Scan(&admission.ID, &admission.ActorID, &admission.FullNameAr, &admission.State, &admission.AvailabilityState, &admission.RequiresProfileReview, &admission.Version, &admission.CreatedAt, &admission.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, false, ErrCaptainAdmissionNotFound
	}
	if err != nil {
		return CaptainAdmission{}, false, err
	}
	if admission.State != "eligible" {
		return CaptainAdmission{}, false, ErrCaptainNotEligible
	}
	if available && (admission.RequiresProfileReview || admission.FullNameAr == "") {
		return CaptainAdmission{}, false, ErrCaptainNotEligible
	}
	if admission.Version != expectedVersion {
		return CaptainAdmission{}, false, ErrCaptainVersionConflict
	}
	if available {
		var hasActiveWork bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM dsh.captain_dispatch_offers WHERE captain_actor_id=$1 AND state='offered') OR EXISTS (SELECT 1 FROM dsh.captain_assignments WHERE captain_actor_id=$1 AND state IN ('assigned','in_custody'))`, actorID).Scan(&hasActiveWork); err != nil {
			return CaptainAdmission{}, false, err
		}
		if hasActiveWork {
			return CaptainAdmission{}, false, ErrCaptainOperationConflict
		}
	}
	wanted := "unavailable"
	if available {
		wanted = "available"
	}
	previousAvailability := admission.AvailabilityState
	if admission.AvailabilityState != wanted {
		if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET availability_state=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$3 RETURNING actor_id,state,availability_state,version,created_at,updated_at`, admission.ID, wanted, expectedVersion).Scan(&admission.ActorID, &admission.State, &admission.AvailabilityState, &admission.Version, &admission.CreatedAt, &admission.UpdatedAt); err != nil {
			return CaptainAdmission{}, false, err
		}
	}
	// End of shift removes the last dispatch GPS fix in the same transaction.
	if !available {
		if _, err := tx.ExecContext(ctx, `DELETE FROM dsh.captain_presence_latest WHERE captain_actor_id=$1`, actorID); err != nil {
			return CaptainAdmission{}, false, err
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_operation_idempotency(idempotency_key,request_hash,operation,admission_id,result_version) VALUES($1,$2,'availability',$3,$4)`, idempotencyKey, requestHash, admission.ID, admission.Version); err != nil {
		return CaptainAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash,reason) VALUES('captain_availability_changed',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULLIF($11,''))`, idempotencyKey, correlationID, actingActorID, admission.ID, actorID, previousAvailability, wanted, expectedVersion, admission.Version, requestHash, strings.TrimSpace(reason)); err != nil {
		return CaptainAdmission{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAdmission{}, false, err
	}
	return admission, false, nil
}

// SuspendCaptainAdmission is the DSH half of a managed Captain role disable.
// It releases offers, reopens pre-custody assignments for dispatch, and leaves
// the admission unavailable before Identity security is changed.
func SuspendCaptainAdmission(ctx context.Context, db *sql.DB, actorID, idempotencyKey, requestHash, actingActorID, correlationID string) (CaptainAdmission, error) {
	if db == nil || strings.TrimSpace(actorID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainAdmission{}, ErrCaptainAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, err
	}
	defer func() { _ = tx.Rollback() }()
	actorID = strings.TrimSpace(actorID)
	if err := canonicalizeCaptainOffersTx(ctx, tx, actorID); err != nil {
		return CaptainAdmission{}, err
	}
	replayed, err := captainAdmissionAccessReplayTx(ctx, tx, "captain_admission_suspended", idempotencyKey, requestHash)
	if err != nil {
		return CaptainAdmission{}, err
	}
	if replayed {
		admission, readErr := readCaptainAdmissionTx(ctx, tx, "actor_id=$1", actorID)
		if readErr != nil {
			return CaptainAdmission{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, err
		}
		return admission, nil
	}
	var offerID, offerOrderID string
	err = tx.QueryRowContext(ctx, `SELECT id,order_id FROM dsh.captain_dispatch_offers WHERE captain_actor_id=$1 AND state='offered' FOR UPDATE`, actorID).Scan(&offerID, &offerOrderID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, err
	}

	var admission CaptainAdmission
	err = tx.QueryRowContext(ctx, `SELECT id,actor_id,COALESCE(full_name_ar,''),state,availability_state,requires_profile_review,version,created_at,updated_at FROM dsh.captain_admissions WHERE actor_id=$1 FOR UPDATE`, actorID).Scan(&admission.ID, &admission.ActorID, &admission.FullNameAr, &admission.State, &admission.AvailabilityState, &admission.RequiresProfileReview, &admission.Version, &admission.CreatedAt, &admission.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, ErrCaptainAdmissionNotFound
	}
	if err != nil {
		return CaptainAdmission{}, err
	}
	if admission.State != "eligible" {
		if admission.State != "suspended" {
			return CaptainAdmission{}, ErrCaptainNotEligible
		}
	}

	var assignmentID, orderID, assignmentState string
	err = tx.QueryRowContext(ctx, `SELECT id,order_id,state FROM dsh.captain_assignments WHERE captain_actor_id=$1 AND state IN ('assigned','in_custody') FOR UPDATE`, actorID).Scan(&assignmentID, &orderID, &assignmentState)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, err
	}
	if assignmentState == "in_custody" {
		return CaptainAdmission{}, ErrCaptainCustodyConflict
	}
	if assignmentID != "" {
		var assignmentVersion int
		if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_assignments SET state='reassigned',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='assigned' RETURNING version`, assignmentID).Scan(&assignmentVersion); err != nil {
			return CaptainAdmission{}, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE dsh.captain_handoffs SET state='superseded',version=version+1,updated_at=clock_timestamp() WHERE assignment_id=$1 AND state <> 'superseded'`, assignmentID); err != nil {
			return CaptainAdmission{}, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE dsh.commerce_orders SET state='READY_FOR_DISPATCH',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='CAPTAIN_ASSIGNED'`, orderID); err != nil {
			return CaptainAdmission{}, err
		}
		assignmentKey := idempotencyKey + ":assignment:" + assignmentID
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,assignment_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('captain_assignment_reassigned',$1,$2,$3,$4,$5,$6,'assigned','reassigned',$7,$8)`, assignmentKey, correlationID, actingActorID, orderID, assignmentID, actorID, assignmentVersion, requestHash); err != nil {
			return CaptainAdmission{}, err
		}
		var paymentIntentID sql.NullString
		var paymentState string
		if err := tx.QueryRowContext(ctx, `SELECT payment_intent_id,payment_state FROM dsh.commerce_orders WHERE id=$1`, orderID).Scan(&paymentIntentID, &paymentState); err != nil {
			return CaptainAdmission{}, err
		}
		if paymentIntentID.Valid && paymentState == "REQUIRES_COLLECTION" {
			if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "CAPTAIN_COD_RELEASE", SourceRef: assignmentID, OrderID: orderID, PaymentIntentID: paymentIntentID.String, CaptainActorID: actorID, IdempotencyKey: assignmentKey, CorrelationID: correlationID, ActingActorID: actingActorID}); err != nil {
				return CaptainAdmission{}, err
			}
		}
	}

	if offerID != "" {
		var supersededVersion int
		if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_dispatch_offers SET state='superseded',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='offered' RETURNING version`, offerID).Scan(&supersededVersion); err != nil {
			return CaptainAdmission{}, err
		}
		offerKey := idempotencyKey + ":offer:" + offerID
		if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_audit(event_type,idempotency_key,correlation_id,acting_actor_id,order_id,offer_id,captain_actor_id,from_state,to_state,result_version,request_hash) VALUES('captain_offer_superseded_by_access',$1,$2,$3,$4,$5,$6,'offered','superseded',$7,$8)`, offerKey, correlationID, actingActorID, offerOrderID, offerID, actorID, supersededVersion, requestHash); err != nil {
			return CaptainAdmission{}, err
		}
		var paymentIntentID sql.NullString
		var paymentState string
		if err := tx.QueryRowContext(ctx, `SELECT payment_intent_id,payment_state FROM dsh.commerce_orders WHERE id=$1`, offerOrderID).Scan(&paymentIntentID, &paymentState); err != nil {
			return CaptainAdmission{}, err
		}
		if paymentIntentID.Valid && paymentState == "REQUIRES_COLLECTION" {
			if err := enqueueFinancialHandoffTx(ctx, tx, FinancialHandoffOutbox{EffectType: "CAPTAIN_COD_RELEASE", SourceRef: offerID, OrderID: offerOrderID, PaymentIntentID: paymentIntentID.String, CaptainActorID: actorID, IdempotencyKey: offerKey, CorrelationID: correlationID, ActingActorID: actingActorID}); err != nil {
				return CaptainAdmission{}, err
			}
		}
	}
	if admission.State == "suspended" {
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, err
		}
		return admission, nil
	}

	var suspended CaptainAdmission
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET state='suspended',availability_state='unavailable',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='eligible' RETURNING id,actor_id,COALESCE(full_name_ar,''),state,availability_state,requires_profile_review,version,created_at,updated_at`, admission.ID).Scan(&suspended.ID, &suspended.ActorID, &suspended.FullNameAr, &suspended.State, &suspended.AvailabilityState, &suspended.RequiresProfileReview, &suspended.Version, &suspended.CreatedAt, &suspended.UpdatedAt); err != nil {
		return CaptainAdmission{}, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM dsh.captain_presence_latest WHERE captain_actor_id=$1`, actorID); err != nil {
		return CaptainAdmission{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('captain_admission_suspended',$1,$2,$3,$4,$5,'eligible','suspended',$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, suspended.ID, actorID, admission.Version, suspended.Version, requestHash); err != nil {
		return CaptainAdmission{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAdmission{}, err
	}
	return suspended, nil
}

// RestoreCaptainAdmission restores operational eligibility only. It always
// returns the Captain unavailable so an operator cannot silently grant work.
func RestoreCaptainAdmission(ctx context.Context, db *sql.DB, actorID, idempotencyKey, requestHash, actingActorID, correlationID string) (CaptainAdmission, error) {
	if db == nil || strings.TrimSpace(actorID) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return CaptainAdmission{}, ErrCaptainAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CaptainAdmission{}, err
	}
	defer func() { _ = tx.Rollback() }()
	actorID = strings.TrimSpace(actorID)
	if err := canonicalizeCaptainOffersTx(ctx, tx, actorID); err != nil {
		return CaptainAdmission{}, err
	}
	replayed, err := captainAdmissionAccessReplayTx(ctx, tx, "captain_admission_restored", idempotencyKey, requestHash)
	if err != nil {
		return CaptainAdmission{}, err
	}
	if replayed {
		admission, readErr := readCaptainAdmissionTx(ctx, tx, "actor_id=$1", actorID)
		if readErr != nil {
			return CaptainAdmission{}, readErr
		}
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, err
		}
		return admission, nil
	}
	var admission CaptainAdmission
	err = tx.QueryRowContext(ctx, `SELECT id,actor_id,COALESCE(full_name_ar,''),state,availability_state,requires_profile_review,version,created_at,updated_at FROM dsh.captain_admissions WHERE actor_id=$1 FOR UPDATE`, actorID).Scan(&admission.ID, &admission.ActorID, &admission.FullNameAr, &admission.State, &admission.AvailabilityState, &admission.RequiresProfileReview, &admission.Version, &admission.CreatedAt, &admission.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptainAdmission{}, ErrCaptainAdmissionNotFound
	}
	if err != nil {
		return CaptainAdmission{}, err
	}
	if admission.State == "pending_identity" || admission.RequiresProfileReview || admission.FullNameAr == "" {
		return CaptainAdmission{}, ErrCaptainNotEligible
	}
	if admission.State == "eligible" {
		if admission.AvailabilityState == "available" {
			var updated CaptainAdmission
			if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET availability_state='unavailable',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='eligible' AND availability_state='available' RETURNING id,actor_id,COALESCE(full_name_ar,''),state,availability_state,requires_profile_review,version,created_at,updated_at`, admission.ID).Scan(&updated.ID, &updated.ActorID, &updated.FullNameAr, &updated.State, &updated.AvailabilityState, &updated.RequiresProfileReview, &updated.Version, &updated.CreatedAt, &updated.UpdatedAt); err != nil {
				return CaptainAdmission{}, err
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('captain_availability_changed',$1,$2,$3,$4,$5,'available','unavailable',$6,$7,$8)`, idempotencyKey+":availability", correlationID, actingActorID, updated.ID, actorID, admission.Version, updated.Version, requestHash); err != nil {
				return CaptainAdmission{}, err
			}
			admission = updated
		}
		if err := tx.Commit(); err != nil {
			return CaptainAdmission{}, err
		}
		return admission, nil
	}
	var hasActiveWork bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM dsh.captain_dispatch_offers WHERE captain_actor_id=$1 AND state='offered') OR EXISTS (SELECT 1 FROM dsh.captain_assignments WHERE captain_actor_id=$1 AND state IN ('assigned','in_custody'))`, actorID).Scan(&hasActiveWork); err != nil {
		return CaptainAdmission{}, err
	}
	if hasActiveWork {
		return CaptainAdmission{}, ErrCaptainCustodyConflict
	}
	var restored CaptainAdmission
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.captain_admissions SET state='eligible',availability_state='unavailable',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='suspended' RETURNING id,actor_id,COALESCE(full_name_ar,''),state,availability_state,requires_profile_review,version,created_at,updated_at`, admission.ID).Scan(&restored.ID, &restored.ActorID, &restored.FullNameAr, &restored.State, &restored.AvailabilityState, &restored.RequiresProfileReview, &restored.Version, &restored.CreatedAt, &restored.UpdatedAt); err != nil {
		return CaptainAdmission{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.captain_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,actor_id,from_state,to_state,from_version,result_version,request_hash) VALUES('captain_admission_restored',$1,$2,$3,$4,$5,'suspended','eligible',$6,$7,$8)`, idempotencyKey, correlationID, actingActorID, restored.ID, actorID, admission.Version, restored.Version, requestHash); err != nil {
		return CaptainAdmission{}, err
	}
	if err := tx.Commit(); err != nil {
		return CaptainAdmission{}, err
	}
	return restored, nil
}
