package employees

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"time"
)

var (
	isolatedSchema = regexp.MustCompile(`^dsh_test_[a-z0-9_]{1,54}$`)
	recordID       = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)
	errConflict    = errors.New("employee registration operation already used")
)

const companyScope = "employer_kind='COMPANY' AND employer_id='bthwani'"
const employeeColumns = "id, display_name, department, job_title, start_date, end_date"
const pageSize = 30

type employee struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"displayName"`
	Department  string  `json:"department"`
	JobTitle    string  `json:"jobTitle"`
	StartDate   string  `json:"startDate"`
	EndDate     *string `json:"endDate"`
}

type registration struct {
	OperationID string `json:"operationId"`
	DisplayName string `json:"displayName"`
	Department  string `json:"department"`
	JobTitle    string `json:"jobTitle"`
	StartDate   string `json:"startDate"`
}

type directory struct {
	db     *sql.DB
	schema string
}

type rowScanner interface{ Scan(...any) error }

func scanEmployee(row rowScanner) (employee, error) {
	var record employee
	var start time.Time
	var end sql.NullTime
	err := row.Scan(&record.ID, &record.DisplayName, &record.Department, &record.JobTitle, &start, &end)
	if err != nil {
		return employee{}, err
	}
	record.StartDate = start.Format(time.DateOnly)
	if end.Valid {
		value := end.Time.Format(time.DateOnly)
		record.EndDate = &value
	}
	return record, nil
}

func (d directory) get(ctx context.Context, id string) (employee, error) {
	query := fmt.Sprintf("SELECT %s FROM %s.employees WHERE %s AND id=$1", employeeColumns, d.schema, companyScope)
	return scanEmployee(d.db.QueryRowContext(ctx, query, id))
}

type page struct {
	Items      []employee `json:"items"`
	NextCursor *string    `json:"nextCursor"`
}

func (d directory) list(ctx context.Context, cursor string) (page, error) {
	query := fmt.Sprintf("SELECT %s FROM %s.employees WHERE %s", employeeColumns, d.schema, companyScope)
	var args []any
	if cursor != "" {
		query += " AND id>$1"
		args = append(args, cursor)
	}
	query += fmt.Sprintf(" ORDER BY id LIMIT %d", pageSize+1)
	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		return page{}, err
	}
	defer rows.Close()
	result := page{Items: make([]employee, 0, pageSize+1)}
	for rows.Next() {
		record, scanErr := scanEmployee(rows)
		if scanErr != nil {
			return page{}, scanErr
		}
		result.Items = append(result.Items, record)
	}
	if len(result.Items) > pageSize {
		result.Items = result.Items[:pageSize]
		result.NextCursor = &result.Items[pageSize-1].ID
	}
	return result, rows.Err()
}

func (d directory) register(ctx context.Context, actor string, input registration) (string, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(body)
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	// An operation belongs to the company and the currently verified author.
	// Serialize retries before creating the employee, including when no row exists.
	key := "employee-registration:" + actor + ":" + input.OperationID
	if _, err = tx.ExecContext(ctx, "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))", key); err != nil {
		return "", err
	}
	var id string
	var recordedHash []byte
	read := fmt.Sprintf("SELECT employee_id, request_hash FROM %s.employee_registration_audit WHERE %s AND acting_actor_id=$1 AND operation_id=$2", d.schema, companyScope)
	err = tx.QueryRowContext(ctx, read, actor, input.OperationID).Scan(&id, &recordedHash)
	if err == nil {
		if !bytes.Equal(hash[:], recordedHash) {
			return "", errConflict
		}
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}

	insert := fmt.Sprintf(`INSERT INTO %s.employees (employer_kind, employer_id, display_name, department, job_title, start_date)
		VALUES ('COMPANY','bthwani',$1,$2,$3,$4) RETURNING id`, d.schema)
	if err = tx.QueryRowContext(ctx, insert, input.DisplayName, input.Department, input.JobTitle, input.StartDate).Scan(&id); err != nil {
		return "", err
	}
	audit := fmt.Sprintf(`INSERT INTO %s.employee_registration_audit
		(employer_kind, employer_id, employee_id, acting_actor_id, operation_id, request_hash)
		VALUES ('COMPANY','bthwani',$1,$2,$3,$4)`, d.schema)
	if _, err = tx.ExecContext(ctx, audit, id, actor, input.OperationID, hash[:]); err != nil {
		return "", err
	}
	if err = tx.Commit(); err != nil {
		return "", err
	}
	return id, nil
}
