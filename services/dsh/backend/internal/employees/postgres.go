package employees

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
)

var (
	isolatedSchema = regexp.MustCompile(`^dsh_test_[a-z0-9_]{1,54}$`)
	recordID       = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)
	errConflict    = errors.New("employee registration operation already used")
)

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
	tx, err := dbscope.Begin(ctx, d.db, d.schema, &sql.TxOptions{ReadOnly: true}, "employees")
	if err != nil {
		return employee{}, err
	}
	defer tx.Rollback()
	record, err := scanEmployee(tx.QueryRowContext(ctx, `SELECT id,display_name,department,job_title,start_date,end_date
		FROM employees WHERE employer_kind='COMPANY' AND employer_id='bthwani' AND id=$1`, id))
	if err != nil {
		return employee{}, err
	}
	if err = tx.Commit(); err != nil {
		return employee{}, err
	}
	return record, nil
}

type page struct {
	Items      []employee `json:"items"`
	NextCursor *string    `json:"nextCursor"`
}

func (d directory) list(ctx context.Context, cursor string) (page, error) {
	tx, err := dbscope.Begin(ctx, d.db, d.schema, &sql.TxOptions{ReadOnly: true}, "employees")
	if err != nil {
		return page{}, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id,display_name,department,job_title,start_date,end_date
		FROM employees WHERE employer_kind='COMPANY' AND employer_id='bthwani'
		AND ($1='' OR id>NULLIF($1,'')::uuid) ORDER BY id LIMIT $2`, cursor, pageSize+1)
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
	if err = rows.Err(); err != nil {
		return page{}, err
	}
	if err = rows.Close(); err != nil {
		return page{}, err
	}
	if err = tx.Commit(); err != nil {
		return page{}, err
	}
	return result, nil
}

func (d directory) register(ctx context.Context, actor string, input registration) (string, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(body)
	tx, err := dbscope.Begin(ctx, d.db, d.schema, nil, "employees", "employee_registration_audit")
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
	err = tx.QueryRowContext(ctx, `SELECT employee_id,request_hash FROM employee_registration_audit
		WHERE employer_kind='COMPANY' AND employer_id='bthwani' AND acting_actor_id=$1 AND operation_id=$2`,
		actor, input.OperationID).Scan(&id, &recordedHash)
	if err == nil {
		if !bytes.Equal(hash[:], recordedHash) {
			return "", errConflict
		}
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}

	if err = tx.QueryRowContext(ctx, `INSERT INTO employees (employer_kind, employer_id, display_name, department, job_title, start_date)
		VALUES ('COMPANY','bthwani',$1,$2,$3,$4) RETURNING id`,
		input.DisplayName, input.Department, input.JobTitle, input.StartDate).Scan(&id); err != nil {
		return "", err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO employee_registration_audit
		(employer_kind, employer_id, employee_id, acting_actor_id, operation_id, request_hash)
		VALUES ('COMPANY','bthwani',$1,$2,$3,$4)`, id, actor, input.OperationID, hash[:]); err != nil {
		return "", err
	}
	if err = tx.Commit(); err != nil {
		return "", err
	}
	return id, nil
}
