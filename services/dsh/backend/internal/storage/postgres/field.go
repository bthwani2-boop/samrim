package postgres

import (
	"context"
	"database/sql"
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
)

type FieldAdmission struct {
	ID        string
	ActorID   string
	State     string
	Version   int
	CreatedAt time.Time
	UpdatedAt time.Time
}

func HashFieldAdmissionRequest(phone string) string {
	return hashFacts("field-admission", strings.TrimSpace(phone))
}

func HashFieldAccessRequest(actorID string, enabled bool, expectedVersion int) string {
	return hashFacts("field-access", strings.TrimSpace(actorID), strconv.FormatBool(enabled), strconv.Itoa(expectedVersion))
}

func HashJoiningCaseFieldRequest(fieldActorID, phone, businessName, firstStoreName, serviceCityID, verticalID string, latitude, longitude float64, fulfillmentModes []string) string {
	return hashFacts("field-joining-case", strings.TrimSpace(fieldActorID), strings.TrimSpace(phone), strings.TrimSpace(businessName), strings.TrimSpace(firstStoreName), strings.TrimSpace(serviceCityID), strings.TrimSpace(verticalID), fmt.Sprintf("%.6f", latitude), fmt.Sprintf("%.6f", longitude), strings.Join(fulfillmentModes, ","))
}

func CreateFieldAdmissionCandidate(ctx context.Context, db *sql.DB, phone, idempotencyKey, requestHash, actingActorID, correlationID string) (FieldAdmission, bool, error) {
	if db == nil || strings.TrimSpace(phone) == "" || strings.TrimSpace(idempotencyKey) == "" || strings.TrimSpace(requestHash) == "" || strings.TrimSpace(actingActorID) == "" || strings.TrimSpace(correlationID) == "" {
		return FieldAdmission{}, false, ErrFieldAdmissionConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return FieldAdmission{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:field-admission:"+idempotencyKey); err != nil {
		return FieldAdmission{}, false, err
	}
	var storedHash, admissionID string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,admission_id FROM dsh.field_admission_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&storedHash, &admissionID)
	if err == nil {
		if storedHash != requestHash {
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
	var existing string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.field_admissions WHERE contact_phone_e164=$1 AND state='pending_identity' FOR UPDATE", strings.TrimSpace(phone)).Scan(&existing); err == nil {
		return FieldAdmission{}, false, ErrFieldAdmissionExists
	} else if !errors.Is(err, sql.ErrNoRows) {
		return FieldAdmission{}, false, err
	}
	admissionID, err = newID("field-admission")
	if err != nil {
		return FieldAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.field_admissions(id,contact_phone_e164,state,version) VALUES($1,$2,'pending_identity',1)`, admissionID, strings.TrimSpace(phone)); err != nil {
		return FieldAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_idempotency(idempotency_key,request_hash,admission_id,operation,result_version,result_state) VALUES($1,$2,$3,'create',1,'pending_identity')`, idempotencyKey, requestHash, admissionID); err != nil {
		return FieldAdmission{}, false, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.field_admission_audit(event_type,idempotency_key,correlation_id,acting_actor_id,admission_id,to_state,result_version,request_hash) VALUES('field_admission_created',$1,$2,$3,$4,'pending_identity',1,$5)`, idempotencyKey, correlationID, actingActorID, admissionID, requestHash); err != nil {
		return FieldAdmission{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return FieldAdmission{}, false, err
	}
	admission, err := ReadFieldAdmission(ctx, db, admissionID)
	return admission, true, err
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
	if err := tx.QueryRowContext(ctx, `UPDATE dsh.field_admissions SET actor_id=$2,contact_phone_e164=NULL,state='eligible',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state='pending_identity' AND version=$3 RETURNING id,actor_id,state,version,created_at,updated_at`, admissionID, actorID, current.Version).Scan(&updated.ID, &updated.ActorID, &updated.State, &updated.Version, &updated.CreatedAt, &updated.UpdatedAt); err != nil {
		return FieldAdmission{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE dsh.field_admission_idempotency SET result_version=$2,result_state='eligible',result_actor_id=$3 WHERE idempotency_key=$1 AND request_hash=$4`, idempotencyKey, updated.Version, actorID, requestHash); err != nil {
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
	err := source.QueryRowContext(ctx, `SELECT id,COALESCE(actor_id,''),state,version,created_at,updated_at FROM dsh.field_admissions WHERE `+where, args...).Scan(&item.ID, &item.ActorID, &item.State, &item.Version, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return FieldAdmission{}, ErrFieldAdmissionNotFound
	}
	return item, err
}
