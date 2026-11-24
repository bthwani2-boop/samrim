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
	errScope       = errors.New("employee employer scope denied")
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

// A merchant employer is the current verified individual Store proprietor;
// storeID is the ownership proof, not a separate employment identity.
type employerScope struct {
	kind    string
	id      string
	storeID string
}

type directory struct {
	db     *sql.DB
	schema string
	scope  employerScope
}

func (d directory) begin(ctx context.Context, options *sql.TxOptions, relations ...string) (*sql.Tx, error) {
	if d.scope.kind == "MERCHANT" {
		relations = append(relations, "stores")
	}
	tx, err := dbscope.Begin(ctx, d.db, d.schema, options, relations...)
	if err != nil {
		return nil, err
	}
	if err = d.requireScope(ctx, tx, options == nil || !options.ReadOnly); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	return tx, nil
}

// Lock the exact proprietor's Store for mutations against ownership changes.
func (d directory) requireScope(ctx context.Context, tx *sql.Tx, lock bool) error {
	if d.scope.kind == "COMPANY" && d.scope.id == "bthwani" && d.scope.storeID == "" {
		return nil
	}
	if d.scope.kind != "MERCHANT" || d.scope.id == "" || d.scope.storeID == "" {
		return errScope
	}
	query := "SELECT owner_actor_id FROM stores WHERE id=$1"
	if lock {
		query += " FOR SHARE"
	}
	var owner string
	err := tx.QueryRowContext(ctx, query, d.scope.storeID).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && owner != d.scope.id) {
		return errScope
	}
	return err
}

func (d directory) verifyScope(ctx context.Context) error {
	if d.scope.kind == "COMPANY" && d.scope.id == "bthwani" && d.scope.storeID == "" {
		return nil
	}
	tx, err := d.begin(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	return tx.Commit()
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
	tx, err := d.begin(ctx, &sql.TxOptions{ReadOnly: true}, "employees")
	if err != nil {
		return employee{}, err
	}
	defer tx.Rollback()
	record, err := scanEmployee(tx.QueryRowContext(ctx, `SELECT id,display_name,department,job_title,start_date,end_date
		FROM employees WHERE employer_kind=$2 AND employer_id=$3 AND id=$1`, id, d.scope.kind, d.scope.id))
	if err != nil {
		return employee{}, err
	}
	if err = tx.Commit(); err != nil {
		return employee{}, err
	}
	return record, nil
}

type registrationEvent struct {
	EmployeeID          string `json:"employeeId"`
	RegisteredByActorID string `json:"registeredByActorId"`
	RecordedAt          string `json:"recordedAt"`
}

func (d directory) registrationAudit(ctx context.Context, id string) (registrationEvent, error) {
	tx, err := d.begin(ctx, &sql.TxOptions{ReadOnly: true}, "employee_registration_audit")
	if err != nil {
		return registrationEvent{}, err
	}
	defer tx.Rollback()
	var event registrationEvent
	var recorded time.Time
	err = tx.QueryRowContext(ctx, `SELECT employee_id,acting_actor_id,recorded_at
		FROM employee_registration_audit
		WHERE employer_kind=$2 AND employer_id=$3 AND employee_id=$1`, id, d.scope.kind, d.scope.id).
		Scan(&event.EmployeeID, &event.RegisteredByActorID, &recorded)
	if err != nil {
		return registrationEvent{}, err
	}
	event.RecordedAt = recorded.UTC().Format(time.RFC3339Nano)
	if err = tx.Commit(); err != nil {
		return registrationEvent{}, err
	}
	return event, nil
}

type page struct {
	Items      []employee `json:"items"`
	NextCursor *string    `json:"nextCursor"`
}

func (d directory) list(ctx context.Context, cursor string) (page, error) {
	tx, err := d.begin(ctx, &sql.TxOptions{ReadOnly: true}, "employees")
	if err != nil {
		return page{}, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT id,display_name,department,job_title,start_date,end_date
		FROM employees WHERE employer_kind=$3 AND employer_id=$4
		AND ($1='' OR id>NULLIF($1,'')::uuid) ORDER BY id LIMIT $2`, cursor, pageSize+1, d.scope.kind, d.scope.id)
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

func (d directory) register(ctx context.Context, actor string, input registration, confirm func(context.Context) error) (string, error) {
	if confirm == nil {
		return "", errScope
	}
	body, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(body)
	tx, err := d.begin(ctx, nil, "employees", "employee_registration_audit")
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	// An operation belongs to the employer and the currently verified author.
	// Serialize retries before creating the employee, including when no row exists.
	key := "employee-registration:" + d.scope.kind + ":" + d.scope.id + ":" + actor + ":" + input.OperationID
	if _, err = tx.ExecContext(ctx, "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))", key); err != nil {
		return "", err
	}
	var id string
	var recordedHash []byte
	err = tx.QueryRowContext(ctx, `SELECT employee_id,request_hash FROM employee_registration_audit
		WHERE employer_kind=$3 AND employer_id=$4 AND acting_actor_id=$1 AND operation_id=$2`,
		actor, input.OperationID, d.scope.kind, d.scope.id).Scan(&id, &recordedHash)
	if err == nil {
		if !bytes.Equal(hash[:], recordedHash) {
			return "", errConflict
		}
		if err = confirm(ctx); err != nil {
			return "", err
		}
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}

	if err = tx.QueryRowContext(ctx, `INSERT INTO employees (employer_kind, employer_id, display_name, department, job_title, start_date)
		VALUES ($5,$6,$1,$2,$3,$4) RETURNING id`,
		input.DisplayName, input.Department, input.JobTitle, input.StartDate, d.scope.kind, d.scope.id).Scan(&id); err != nil {
		return "", err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO employee_registration_audit
		(employer_kind, employer_id, employee_id, acting_actor_id, operation_id, request_hash)
		VALUES ($5,$6,$1,$2,$3,$4)`, id, actor, input.OperationID, hash[:], d.scope.kind, d.scope.id); err != nil {
		return "", err
	}
	if err = confirm(ctx); err != nil {
		return "", err
	}
	if err = tx.Commit(); err != nil {
		return "", err
	}
	return id, nil
}
