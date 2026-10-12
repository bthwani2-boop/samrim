package hr

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/lib/pq"
)

type EmploymentStatusInput struct {
	Status          string `json:"status"`
	Reason          string `json:"reason"`
	ExpectedVersion int    `json:"expectedVersion"`
}
type EmploymentStatusResult struct {
	Employee         Employee `json:"employee"`
	IdempotentReplay bool     `json:"idempotentReplay"`
}

func SetEmploymentStatus(ctx context.Context, db *sql.DB, id string, input EmploymentStatusInput, acting, correlation, idem string) (EmploymentStatusResult, error) {
	input.Reason = strings.TrimSpace(input.Reason)
	if db == nil || !strings.HasPrefix(id, "emp_") || len(id) != 36 ||
		(input.Status != "active" && input.Status != "inactive") ||
		utf8.RuneCountInString(input.Reason) < 8 || utf8.RuneCountInString(input.Reason) > 500 ||
		input.ExpectedVersion < 1 || len(acting) < 1 || len(acting) > 128 ||
		len(correlation) < 8 || len(correlation) > 128 || len(idem) < 8 || len(idem) > 128 {
		return EmploymentStatusResult{}, ErrInvalid
	}
	raw, _ := json.Marshal(input)
	hash := sha256.Sum256(append([]byte(acting+":"+id+":"), raw...))
	digest := hex.EncodeToString(hash[:])
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return EmploymentStatusResult{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "hr:organization:update"); err != nil {
		return EmploymentStatusResult{}, err
	}
	var previousID, previousHash string
	var snapshot []byte
	err = tx.QueryRowContext(ctx, "SELECT employee_id,request_hash,after_snapshot FROM dsh.hr_employee_events WHERE idempotency_key=$1", idem).Scan(&previousID, &previousHash, &snapshot)
	if err == nil {
		if previousID != id || previousHash != digest || len(snapshot) == 0 {
			return EmploymentStatusResult{}, ErrConflict
		}
		var recorded Employee
		if err = json.Unmarshal(snapshot, &recorded); err != nil {
			return EmploymentStatusResult{}, err
		}
		if err = tx.Commit(); err != nil {
			return EmploymentStatusResult{}, err
		}
		return EmploymentStatusResult{Employee: recorded, IdempotentReplay: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return EmploymentStatusResult{}, err
	}
	before, err := scan(tx.QueryRowContext(ctx, "SELECT "+employeeColumns+" FROM dsh.hr_employees WHERE id=$1 FOR UPDATE", id))
	if errors.Is(err, sql.ErrNoRows) {
		return EmploymentStatusResult{}, ErrNotFound
	}
	if err != nil {
		return EmploymentStatusResult{}, err
	}
	if before.Version != input.ExpectedVersion || before.Status == input.Status {
		return EmploymentStatusResult{}, ErrConflict
	}
	if input.Status == "inactive" {
		var activeReports bool
		if err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.hr_employees WHERE manager_employee_id=$1 AND status='active')", id).Scan(&activeReports); err != nil {
			return EmploymentStatusResult{}, err
		}
		if activeReports {
			return EmploymentStatusResult{}, ErrConflict
		}
	}
	res, err := tx.ExecContext(ctx, "UPDATE dsh.hr_employees SET status=$1,version=version+1,updated_at=clock_timestamp() WHERE id=$2 AND version=$3", input.Status, id, input.ExpectedVersion)
	if err != nil {
		return EmploymentStatusResult{}, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return EmploymentStatusResult{}, err
	}
	if n != 1 {
		return EmploymentStatusResult{}, ErrConflict
	}
	after, err := read(ctx, tx, id)
	if err != nil {
		return EmploymentStatusResult{}, err
	}
	b, _ := json.Marshal(before)
	a, _ := json.Marshal(after)
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.hr_employee_events(idempotency_key,employee_id,event_type,request_hash,acting_actor_id,correlation_id,before_snapshot,after_snapshot,reason)
 VALUES($1,$2,'status_changed',$3,$4,$5,$6::jsonb,$7::jsonb,$8)`, idem, id, digest, acting, correlation, string(b), string(a), input.Reason)
	if err != nil {
		var pg *pq.Error
		if errors.As(err, &pg) && pg.Code == "23505" {
			return EmploymentStatusResult{}, ErrConflict
		}
		return EmploymentStatusResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return EmploymentStatusResult{}, err
	}
	return EmploymentStatusResult{Employee: after}, nil
}
