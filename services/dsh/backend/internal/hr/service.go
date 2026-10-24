package hr

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/lib/pq"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrInvalid  = errors.New("invalid HR employee input")
	ErrConflict = errors.New("HR employee already exists or conflicts")
	ErrNotFound = errors.New("HR employee not found")
)
var phonePattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

type Employee struct {
	ID                string    `json:"id"`
	FullNameAr        string    `json:"fullNameAr"`
	PhoneE164         string    `json:"phoneE164,omitempty"`
	Department        string    `json:"department"`
	JobTitle          string    `json:"jobTitle"`
	ManagerEmployeeID *string   `json:"managerEmployeeId,omitempty"`
	StartDate         string    `json:"startDate"`
	WorkLocation      string    `json:"workLocation"`
	Status            string    `json:"status"`
	OperatorActorID   *string   `json:"operatorActorId,omitempty"`
	Version           int       `json:"version"`
	CreatedAt         time.Time `json:"createdAt"`
}
type CreateInput struct {
	FullNameAr        string `json:"fullNameAr"`
	PhoneE164         string `json:"phoneE164"`
	Department        string `json:"department"`
	JobTitle          string `json:"jobTitle"`
	ManagerEmployeeID string `json:"managerEmployeeId"`
	StartDate         string `json:"startDate"`
	WorkLocation      string `json:"workLocation"`
}
type CreateResult struct {
	Employee         Employee `json:"employee"`
	IdempotentReplay bool     `json:"idempotentReplay"`
}
type Page struct {
	Items      []Employee `json:"items"`
	NextCursor string     `json:"nextCursor,omitempty"`
}
type ListFilters struct {
	Query      string
	Cursor     string
	Department string
	JobTitle   string
	Status     string
	Linked     string
	Limit      int
}

type cursor struct {
	Query      string    `json:"q"`
	Department string    `json:"d,omitempty"`
	JobTitle   string    `json:"j,omitempty"`
	Status     string    `json:"s,omitempty"`
	Linked     string    `json:"l,omitempty"`
	CreatedAt  time.Time `json:"t"`
	ID         string    `json:"id"`
}

func normalize(in CreateInput) (CreateInput, error) {
	in.FullNameAr = strings.TrimSpace(in.FullNameAr)
	in.PhoneE164 = strings.TrimSpace(in.PhoneE164)
	in.Department = strings.TrimSpace(in.Department)
	in.JobTitle = strings.TrimSpace(in.JobTitle)
	in.ManagerEmployeeID = strings.TrimSpace(in.ManagerEmployeeID)
	in.WorkLocation = strings.TrimSpace(in.WorkLocation)
	start, err := time.Parse("2006-01-02", in.StartDate)
	if err != nil || start.Format("2006-01-02") != in.StartDate ||
		utf8.RuneCountInString(in.FullNameAr) < 2 || utf8.RuneCountInString(in.FullNameAr) > 120 ||
		(in.PhoneE164 != "" && !phonePattern.MatchString(in.PhoneE164)) ||
		utf8.RuneCountInString(in.Department) < 1 || utf8.RuneCountInString(in.Department) > 80 ||
		utf8.RuneCountInString(in.JobTitle) < 1 || utf8.RuneCountInString(in.JobTitle) > 80 ||
		utf8.RuneCountInString(in.WorkLocation) < 1 || utf8.RuneCountInString(in.WorkLocation) > 100 ||
		len(in.ManagerEmployeeID) > 128 {
		return CreateInput{}, ErrInvalid
	}
	return in, nil
}

func Create(ctx context.Context, db *sql.DB, input CreateInput, acting, correlation, idem string) (CreateResult, error) {
	input, err := normalize(input)
	if err != nil {
		return CreateResult{}, err
	}
	if db == nil || strings.TrimSpace(acting) == "" || len(acting) > 128 ||
		len(correlation) < 8 || len(correlation) > 128 || len(idem) < 8 || len(idem) > 128 {
		return CreateResult{}, ErrInvalid
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return CreateResult{}, err
	}
	hash := sha256.Sum256(append([]byte(strings.TrimSpace(acting)+":"), raw...))
	requestHash := hex.EncodeToString(hash[:])
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return CreateResult{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "hr:create:"+idem); err != nil {
		return CreateResult{}, err
	}
	var previousID, previousHash string
	err = tx.QueryRowContext(ctx, "SELECT employee_id,request_hash FROM dsh.hr_employee_events WHERE idempotency_key=$1", idem).Scan(&previousID, &previousHash)
	if err == nil {
		if previousHash != requestHash {
			return CreateResult{}, ErrConflict
		}
		employee, readErr := read(ctx, tx, previousID)
		if readErr != nil {
			return CreateResult{}, readErr
		}
		if err = tx.Commit(); err != nil {
			return CreateResult{}, err
		}
		return CreateResult{Employee: employee, IdempotentReplay: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CreateResult{}, err
	}
	var manager any
	if input.ManagerEmployeeID != "" {
		var status string
		if err = tx.QueryRowContext(ctx, "SELECT status FROM dsh.hr_employees WHERE id=$1 FOR SHARE", input.ManagerEmployeeID).Scan(&status); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return CreateResult{}, ErrInvalid
			}
			return CreateResult{}, err
		}
		if status != "active" {
			return CreateResult{}, ErrInvalid
		}
		manager = input.ManagerEmployeeID
	}
	var phone any
	if input.PhoneE164 != "" {
		phone = input.PhoneE164
	}
	b := make([]byte, 16)
	if _, err = rand.Read(b); err != nil {
		return CreateResult{}, err
	}
	id := "emp_" + hex.EncodeToString(b)
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.hr_employees
        (id,full_name_ar,phone_e164,department,job_title,manager_employee_id,start_date,work_location,created_by_actor_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,$9)`,
		id, input.FullNameAr, phone, input.Department, input.JobTitle, manager, input.StartDate, input.WorkLocation, acting)
	if err != nil {
		var pgErr *pq.Error
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return CreateResult{}, ErrConflict
		}
		return CreateResult{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.hr_employee_events
        (idempotency_key,employee_id,event_type,request_hash,acting_actor_id,correlation_id)
        VALUES ($1,$2,'created',$3,$4,$5)`, idem, id, requestHash, acting, correlation)
	if err != nil {
		return CreateResult{}, err
	}
	employee, err := read(ctx, tx, id)
	if err != nil {
		return CreateResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return CreateResult{}, err
	}
	return CreateResult{Employee: employee}, nil
}

type rowScanner interface{ Scan(...any) error }
type rowQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func scan(row rowScanner) (Employee, error) {
	var item Employee
	var phone, manager, operator sql.NullString
	var started time.Time
	err := row.Scan(&item.ID, &item.FullNameAr, &phone, &item.Department, &item.JobTitle, &manager, &started, &item.WorkLocation, &item.Status, &operator, &item.Version, &item.CreatedAt)
	if err != nil {
		return Employee{}, err
	}
	if phone.Valid {
		item.PhoneE164 = phone.String
	}
	if manager.Valid {
		item.ManagerEmployeeID = &manager.String
	}
	if operator.Valid {
		item.OperatorActorID = &operator.String
	}
	item.StartDate = started.Format("2006-01-02")
	return item, nil
}

const employeeColumns = "id,full_name_ar,phone_e164,department,job_title,manager_employee_id,start_date,work_location,status,operator_actor_id,version,created_at"

// Immutable SQL statement variants; all input values use database parameters.
const (
	employeeSelectByID          = "SELECT " + employeeColumns + " FROM dsh.hr_employees WHERE id=$1"
	employeeSelectByIDForUpdate = "SELECT " + employeeColumns + " FROM dsh.hr_employees WHERE id=$1 FOR UPDATE"
	employeeSelectByIDForShare  = "SELECT " + employeeColumns + " FROM dsh.hr_employees WHERE id=$1 FOR SHARE"
	employeeSelectByOperator    = "SELECT " + employeeColumns + " FROM dsh.hr_employees WHERE operator_actor_id=$1"
	employeeSelectList          = `SELECT ` + employeeColumns + `
        FROM dsh.hr_employees
        WHERE ($1='' OR lower(full_name_ar) LIKE '%' || lower($1) || '%' OR lower(department) LIKE '%' || lower($1) || '%')
        AND ($2='' OR lower(department) LIKE '%' || lower($2) || '%')
        AND ($3='' OR lower(job_title) LIKE '%' || lower($3) || '%')
        AND ($4='' OR status=$4)
        AND ($5='' OR ($5='linked' AND operator_actor_id IS NOT NULL) OR ($5='unlinked' AND operator_actor_id IS NULL))
        AND ($6::timestamptz IS NULL OR (created_at,id)<($6::timestamptz,$7))
        ORDER BY created_at DESC,id DESC LIMIT $8`
)

func read(ctx context.Context, db rowQueryer, id string) (Employee, error) {
	result, err := scan(db.QueryRowContext(ctx, employeeSelectByID, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Employee{}, ErrNotFound
	}
	return result, err
}
func ReadByOperatorActor(ctx context.Context, db *sql.DB, actorID string) (Employee, error) {
	if db == nil || !strings.HasPrefix(actorID, "act_") || len(actorID) > 128 {
		return Employee{}, ErrInvalid
	}
	result, err := scan(db.QueryRowContext(ctx, employeeSelectByOperator, actorID))
	if errors.Is(err, sql.ErrNoRows) {
		return Employee{}, ErrNotFound
	}
	return result, err
}
func Read(ctx context.Context, db *sql.DB, id string) (Employee, error) {
	if db == nil || !strings.HasPrefix(id, "emp_") || len(id) != 36 {
		return Employee{}, ErrInvalid
	}
	return read(ctx, db, id)
}
func validateListFilters(filters ListFilters) (ListFilters, error) {
	filters.Query = strings.TrimSpace(filters.Query)
	filters.Department = strings.TrimSpace(filters.Department)
	filters.JobTitle = strings.TrimSpace(filters.JobTitle)
	if utf8.RuneCountInString(filters.Query) > 80 ||
		utf8.RuneCountInString(filters.Department) > 80 ||
		utf8.RuneCountInString(filters.JobTitle) > 80 ||
		len(filters.Cursor) > 1024 || filters.Limit < 1 || filters.Limit > 50 ||
		(filters.Status != "" && filters.Status != "active" && filters.Status != "inactive") ||
		(filters.Linked != "" && filters.Linked != "linked" && filters.Linked != "unlinked") {
		return ListFilters{}, ErrInvalid
	}
	return filters, nil
}

func List(ctx context.Context, db *sql.DB, options ListFilters) (Page, error) {
	if db == nil {
		return Page{}, ErrInvalid
	}
	filters, err := validateListFilters(options)
	if err != nil {
		return Page{}, err
	}
	var since any
	var afterID string
	if filters.Cursor != "" {
		b, err := base64.RawURLEncoding.DecodeString(filters.Cursor)
		if err != nil {
			return Page{}, ErrInvalid
		}
		var c cursor
		if json.Unmarshal(b, &c) != nil ||
			c.Query != filters.Query || c.Department != filters.Department ||
			c.JobTitle != filters.JobTitle || c.Status != filters.Status ||
			c.Linked != filters.Linked || c.ID == "" || c.CreatedAt.IsZero() {
			return Page{}, ErrInvalid
		}
		since = c.CreatedAt
		afterID = c.ID
	}
	rows, err := db.QueryContext(ctx, employeeSelectList,
		filters.Query, filters.Department, filters.JobTitle, filters.Status,
		filters.Linked, since, afterID, filters.Limit+1)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	page := Page{Items: make([]Employee, 0, filters.Limit)}
	for rows.Next() {
		employee, scanErr := scan(rows)
		if scanErr != nil {
			return Page{}, scanErr
		}
		page.Items = append(page.Items, employee)
	}
	if err = rows.Err(); err != nil {
		return Page{}, err
	}
	if len(page.Items) > filters.Limit {
		page.Items = page.Items[:filters.Limit]
		last := page.Items[len(page.Items)-1]
		raw, _ := json.Marshal(cursor{
			Query: filters.Query, Department: filters.Department, JobTitle: filters.JobTitle,
			Status: filters.Status, Linked: filters.Linked,
			CreatedAt: last.CreatedAt, ID: last.ID,
		})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return page, nil
}
func IsInputError(err error) bool {
	return errors.Is(err, ErrInvalid) || errors.Is(err, ErrConflict) || errors.Is(err, ErrNotFound)
}
func DescribeError(err error) string { return fmt.Sprint(err) }
