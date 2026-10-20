package hr

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/lib/pq"
)

type AdmissionResult struct {
	Request          AccessRequest `json:"request"`
	Employee         Employee      `json:"employee"`
	IdempotentReplay bool          `json:"idempotentReplay"`
}

// ReadAccessRequestByProfile is used by the initial Operator to ensure that
// Identity approvals originate in an actual HR employee access request.
func ReadAccessRequestByProfile(ctx context.Context, db *sql.DB, profileID string) (AccessRequest, error) {
	if db == nil || !strings.HasPrefix(profileID, "oprof_") || len(profileID) > 128 {
		return AccessRequest{}, ErrInvalid
	}
	result, err := scanAccess(db.QueryRowContext(ctx, accessSelectByProfile, profileID))
	if errors.Is(err, sql.ErrNoRows) {
		return AccessRequest{}, ErrNotFound
	}
	return result, err
}

// AdmitAccessRequest records the durable employee/actor link after Identity has
// already granted the role. A stable key permits recovery from a lost response.
func AdmitAccessRequest(ctx context.Context, db *sql.DB, requestID, profileID, operatorActorID, acting, correlation, idem string) (AdmissionResult, error) {
	if db == nil || !strings.HasPrefix(requestID, "hreq_") || len(requestID) != 37 ||
		!strings.HasPrefix(profileID, "oprof_") || len(profileID) > 128 ||
		!strings.HasPrefix(operatorActorID, "act_") || len(operatorActorID) > 128 ||
		acting == "" || len(acting) > 128 || len(correlation) < 8 || len(correlation) > 128 ||
		len(idem) < 8 || len(idem) > 128 {
		return AdmissionResult{}, ErrInvalid
	}
	digest := sha256.Sum256([]byte(acting + ":" + requestID + ":" + profileID + ":" + operatorActorID))
	hash := hex.EncodeToString(digest[:])
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return AdmissionResult{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "hr:access:action:"+requestID); err != nil {
		return AdmissionResult{}, err
	}
	var previousID, previousHash string
	err = tx.QueryRowContext(ctx, "SELECT request_id,request_hash FROM dsh.hr_operator_access_events WHERE idempotency_key=$1", idem).Scan(&previousID, &previousHash)
	if err == nil {
		if previousID != requestID || previousHash != hash {
			return AdmissionResult{}, ErrConflict
		}
		request, e := scanAccess(tx.QueryRowContext(ctx, accessSelectByID, requestID))
		if e != nil {
			return AdmissionResult{}, e
		}
		employee, e := read(ctx, tx, request.EmployeeID)
		if e != nil {
			return AdmissionResult{}, e
		}
		if employee.OperatorActorID == nil || *employee.OperatorActorID != operatorActorID {
			return AdmissionResult{}, ErrConflict
		}
		if e = tx.Commit(); e != nil {
			return AdmissionResult{}, e
		}
		return AdmissionResult{Request: request, Employee: employee, IdempotentReplay: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return AdmissionResult{}, err
	}
	request, err := scanAccess(tx.QueryRowContext(ctx, accessSelectByIDForUpdate, requestID))
	if errors.Is(err, sql.ErrNoRows) {
		return AdmissionResult{}, ErrNotFound
	}
	if err != nil {
		return AdmissionResult{}, err
	}
	if request.State != "identity_profile_created" || request.OperatorProfileID != profileID {
		return AdmissionResult{}, ErrConflict
	}
	result, err := tx.ExecContext(ctx, `UPDATE dsh.hr_employees SET operator_actor_id=$1, version=version+1,updated_at=clock_timestamp()
		WHERE id=$2 AND status='active' AND operator_actor_id IS NULL`, operatorActorID, request.EmployeeID)
	if err != nil {
		var pg *pq.Error
		if errors.As(err, &pg) && pg.Code == "23505" {
			return AdmissionResult{}, ErrConflict
		}
		return AdmissionResult{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return AdmissionResult{}, err
	}
	if changed != 1 {
		return AdmissionResult{}, ErrConflict
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.hr_operator_access_events(idempotency_key,request_id,event_type,request_hash,acting_actor_id,correlation_id)
		VALUES($1,$2,'operator_admitted',$3,$4,$5)`, idem, requestID, hash, acting, correlation)
	if err != nil {
		return AdmissionResult{}, err
	}
	employee, err := read(ctx, tx, request.EmployeeID)
	if err != nil {
		return AdmissionResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return AdmissionResult{}, err
	}
	return AdmissionResult{Request: request, Employee: employee}, nil
}
