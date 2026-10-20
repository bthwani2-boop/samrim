package hr

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"github.com/lib/pq"
)

type UpdateInput struct {
	CreateInput
	ExpectedVersion int `json:"expectedVersion"`
}
type UpdateResult struct {
	Employee         Employee `json:"employee"`
	IdempotentReplay bool     `json:"idempotentReplay"`
}

func Update(ctx context.Context, db *sql.DB, id string, input UpdateInput, acting, correlation, idem string) (UpdateResult, error) {
	norm, err := normalize(input.CreateInput)
	if err != nil {
		return UpdateResult{}, err
	}
	if db == nil || !strings.HasPrefix(id, "emp_") || len(id) != 36 || input.ExpectedVersion < 1 ||
		len(acting) < 1 || len(acting) > 128 || len(correlation) < 8 || len(correlation) > 128 ||
		len(idem) < 8 || len(idem) > 128 || norm.ManagerEmployeeID == id {
		return UpdateResult{}, ErrInvalid
	}
	input.CreateInput = norm
	raw, err := json.Marshal(input)
	if err != nil {
		return UpdateResult{}, err
	}
	hash := sha256.Sum256(append([]byte(acting+":"+id+":"), raw...))
	requestHash := hex.EncodeToString(hash[:])
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return UpdateResult{}, err
	}
	defer tx.Rollback()
	// Serialize changes to reporting lines. Concurrent "A reports to B" / "B reports to A"
	// cannot both pass graph validation.
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "hr:organization:update"); err != nil {
		return UpdateResult{}, err
	}
	var previousID, previousHash string
	var resultJSON []byte
	err = tx.QueryRowContext(ctx, `SELECT employee_id,request_hash,after_snapshot
 FROM dsh.hr_employee_events WHERE idempotency_key=$1`, idem).Scan(&previousID, &previousHash, &resultJSON)
	if err == nil {
		if previousID != id || previousHash != requestHash || len(resultJSON) == 0 {
			return UpdateResult{}, ErrConflict
		}
		var snapshot Employee
		if e := json.Unmarshal(resultJSON, &snapshot); e != nil {
			return UpdateResult{}, e
		}
		if e := tx.Commit(); e != nil {
			return UpdateResult{}, e
		}
		return UpdateResult{Employee: snapshot, IdempotentReplay: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return UpdateResult{}, err
	}
	before, err := scan(tx.QueryRowContext(ctx, employeeSelectByIDForUpdate, id))
	if errors.Is(err, sql.ErrNoRows) {
		return UpdateResult{}, ErrNotFound
	}
	if err != nil {
		return UpdateResult{}, err
	}
	if before.Version != input.ExpectedVersion {
		return UpdateResult{}, ErrConflict
	}
	// Access requests carry an immutable identity snapshot. Changing the employee's
	// identity-relevant fields during that lifecycle would make Identity onboarding ambiguous.
	if norm.FullNameAr != before.FullNameAr || norm.PhoneE164 != before.PhoneE164 ||
		norm.Department != before.Department || norm.JobTitle != before.JobTitle {
		var hasRequest bool
		err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.hr_operator_access_requests WHERE employee_id=$1 AND state<>'rejected')`, id).Scan(&hasRequest)
		if err != nil {
			return UpdateResult{}, err
		}
		if hasRequest {
			return UpdateResult{}, ErrConflict
		}
	}
	var manager any
	if norm.ManagerEmployeeID != "" {
		var status string
		var cycle bool
		err = tx.QueryRowContext(ctx, `WITH RECURSIVE ancestors(id,manager_employee_id) AS (
    SELECT id,manager_employee_id FROM dsh.hr_employees WHERE id=$1
    UNION ALL
    SELECT e.id,e.manager_employee_id FROM dsh.hr_employees e
    JOIN ancestors a ON e.id=a.manager_employee_id
  )
  SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=$2)`, norm.ManagerEmployeeID, id).Scan(&cycle)
		if err != nil {
			return UpdateResult{}, err
		}
		if cycle {
			return UpdateResult{}, ErrInvalid
		}
		err = tx.QueryRowContext(ctx, "SELECT status FROM dsh.hr_employees WHERE id=$1", norm.ManagerEmployeeID).Scan(&status)
		if errors.Is(err, sql.ErrNoRows) {
			return UpdateResult{}, ErrInvalid
		}
		if err != nil {
			return UpdateResult{}, err
		}
		if status != "active" {
			return UpdateResult{}, ErrInvalid
		}
		manager = norm.ManagerEmployeeID
	}
	var phone any
	if norm.PhoneE164 != "" {
		phone = norm.PhoneE164
	}
	result, err := tx.ExecContext(ctx, `UPDATE dsh.hr_employees SET
 full_name_ar=$3,phone_e164=$4,department=$5,job_title=$6,manager_employee_id=$7,
 start_date=$8::date,work_location=$9,version=version+1,updated_at=clock_timestamp()
 WHERE id=$1 AND version=$2`, id, input.ExpectedVersion, norm.FullNameAr, phone, norm.Department, norm.JobTitle, manager, norm.StartDate, norm.WorkLocation)
	if err != nil {
		var pg *pq.Error
		if errors.As(err, &pg) && pg.Code == "23505" {
			return UpdateResult{}, ErrConflict
		}
		return UpdateResult{}, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return UpdateResult{}, err
	}
	if affected != 1 {
		return UpdateResult{}, ErrConflict
	}
	after, err := read(ctx, tx, id)
	if err != nil {
		return UpdateResult{}, err
	}
	beforeJSON, _ := json.Marshal(before)
	afterJSON, _ := json.Marshal(after)
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.hr_employee_events
 (idempotency_key,employee_id,event_type,request_hash,acting_actor_id,correlation_id,before_snapshot,after_snapshot)
 VALUES ($1,$2,'updated',$3,$4,$5,$6::jsonb,$7::jsonb)`, idem, id, requestHash, acting, correlation, string(beforeJSON), string(afterJSON))
	if err != nil {
		var pg *pq.Error
		if errors.As(err, &pg) && pg.Code == "23505" {
			return UpdateResult{}, ErrConflict
		}
		return UpdateResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return UpdateResult{}, err
	}
	return UpdateResult{Employee: after}, nil
}
