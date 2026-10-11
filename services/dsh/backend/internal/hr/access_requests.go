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
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lib/pq"
)

var permittedWorkspaces = map[string]bool{"operations": true, "partners": true, "catalog": true, "marketing": true, "finance": true, "platform_policies": true, "hr": true}

type AccessRequestInput struct {
	EmployeeID           string   `json:"employeeId"`
	Reason               string   `json:"reason"`
	RequestedPermissions []string `json:"requestedPermissions"`
}
type AccessRequest struct {
	ID                   string     `json:"id"`
	EmployeeID           string     `json:"employeeId"`
	EmployeeName         string     `json:"employeeName"`
	PhoneE164            string     `json:"phoneE164"`
	Department           string     `json:"department"`
	JobTitle             string     `json:"jobTitle"`
	Reason               string     `json:"reason"`
	RequestedPermissions []string   `json:"requestedPermissions"`
	State                string     `json:"state"`
	OperatorProfileID    string     `json:"operatorProfileId,omitempty"`
	OperatorActorID      string     `json:"operatorActorId,omitempty"`
	RequestedByActorID   string     `json:"requestedByActorId"`
	CreatedAt            time.Time  `json:"createdAt"`
	RejectedAt           *time.Time `json:"rejectedAt,omitempty"`
	RejectionReason      string     `json:"rejectionReason,omitempty"`
	RejectedByActorID    string     `json:"rejectedByActorId,omitempty"`
	Version              int        `json:"version"`
}
type AccessRequestResult struct {
	Request          AccessRequest `json:"request"`
	IdempotentReplay bool          `json:"idempotentReplay"`
}
type AccessRequestPage struct {
	Items      []AccessRequest `json:"items"`
	NextCursor string          `json:"nextCursor,omitempty"`
}

func normalizeAccessRequest(in AccessRequestInput) (AccessRequestInput, error) {
	in.EmployeeID = strings.TrimSpace(in.EmployeeID)
	in.Reason = strings.TrimSpace(in.Reason)
	if !strings.HasPrefix(in.EmployeeID, "emp_") || len(in.EmployeeID) != 36 ||
		utf8.RuneCountInString(in.Reason) < 8 || utf8.RuneCountInString(in.Reason) > 500 || len(in.RequestedPermissions) > 7 {
		return AccessRequestInput{}, ErrInvalid
	}
	keys := make(map[string]bool)
	permissions := make([]string, 0, len(in.RequestedPermissions))
	for _, raw := range in.RequestedPermissions {
		v := strings.TrimSpace(raw)
		if !permittedWorkspaces[v] || keys[v] {
			return AccessRequestInput{}, ErrInvalid
		}
		keys[v] = true
		permissions = append(permissions, v)
	}
	// Canonical sorting ensures repeated submits with equivalent permission sets replay.
	for i := 0; i < len(permissions); i++ {
		for j := i + 1; j < len(permissions); j++ {
			if permissions[j] < permissions[i] {
				permissions[i], permissions[j] = permissions[j], permissions[i]
			}
		}
	}
	in.RequestedPermissions = permissions
	return in, nil
}

const accessSelect = `SELECT r.id,r.employee_id,r.employee_name_snapshot,r.phone_e164_snapshot,r.department_snapshot,r.job_title_snapshot,
 r.reason,r.requested_permissions,r.state,COALESCE(r.operator_profile_id,''),r.requested_by_actor_id,r.created_at,r.rejected_at,COALESCE(r.rejection_reason,''),COALESCE(r.rejected_by_actor_id,''),r.version,COALESCE(e.operator_actor_id,'')
 FROM dsh.hr_operator_access_requests r JOIN dsh.hr_employees e ON e.id=r.employee_id`

func scanAccess(row rowScanner) (AccessRequest, error) {
	var a AccessRequest
	err := row.Scan(&a.ID, &a.EmployeeID, &a.EmployeeName, &a.PhoneE164, &a.Department, &a.JobTitle,
		&a.Reason, pq.Array(&a.RequestedPermissions), &a.State, &a.OperatorProfileID, &a.RequestedByActorID, &a.CreatedAt, &a.RejectedAt, &a.RejectionReason, &a.RejectedByActorID, &a.Version, &a.OperatorActorID)
	return a, err
}
func ReadAccessRequest(ctx context.Context, db *sql.DB, id string) (AccessRequest, error) {
	if db == nil || !strings.HasPrefix(id, "hreq_") || len(id) != 37 {
		return AccessRequest{}, ErrInvalid
	}
	a, err := scanAccess(db.QueryRowContext(ctx, accessSelect+" WHERE r.id=$1", id))
	if errors.Is(err, sql.ErrNoRows) {
		return AccessRequest{}, ErrNotFound
	}
	return a, err
}
func ListAccessRequests(ctx context.Context, db *sql.DB, employeeID, encoded string, limit int) (AccessRequestPage, error) {
	if db == nil || limit < 1 || limit > 50 || len(encoded) > 1024 ||
		(employeeID != "" && (!strings.HasPrefix(employeeID, "emp_") || len(employeeID) != 36)) {
		return AccessRequestPage{}, ErrInvalid
	}
	var since any
	var afterID string
	if encoded != "" {
		decoded, err := base64.RawURLEncoding.DecodeString(encoded)
		if err != nil {
			return AccessRequestPage{}, ErrInvalid
		}
		var c cursor
		if json.Unmarshal(decoded, &c) != nil || c.Query != employeeID || c.ID == "" || c.CreatedAt.IsZero() {
			return AccessRequestPage{}, ErrInvalid
		}
		since = c.CreatedAt
		afterID = c.ID
	}
	rows, err := db.QueryContext(ctx, accessSelect+` WHERE ($1='' OR r.employee_id=$1)
 AND ($2::timestamptz IS NULL OR (r.created_at,r.id)<($2::timestamptz,$3))
 ORDER BY r.created_at DESC,r.id DESC LIMIT $4`, employeeID, since, afterID, limit+1)
	if err != nil {
		return AccessRequestPage{}, err
	}
	defer rows.Close()
	page := AccessRequestPage{Items: make([]AccessRequest, 0, limit)}
	for rows.Next() {
		row, e := scanAccess(rows)
		if e != nil {
			return AccessRequestPage{}, e
		}
		page.Items = append(page.Items, row)
	}
	if err = rows.Err(); err != nil {
		return AccessRequestPage{}, err
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		last := page.Items[len(page.Items)-1]
		b, _ := json.Marshal(cursor{Query: employeeID, CreatedAt: last.CreatedAt, ID: last.ID})
		page.NextCursor = base64.RawURLEncoding.EncodeToString(b)
	}
	return page, nil
}
func CreateAccessRequest(ctx context.Context, db *sql.DB, input AccessRequestInput, acting, correlation, idem string) (AccessRequestResult, error) {
	input, err := normalizeAccessRequest(input)
	if err != nil {
		return AccessRequestResult{}, err
	}
	if db == nil || len(acting) < 1 || len(acting) > 128 || len(correlation) < 8 || len(correlation) > 128 || len(idem) < 8 || len(idem) > 128 {
		return AccessRequestResult{}, ErrInvalid
	}
	b, _ := json.Marshal(input)
	hash := sha256.Sum256(append([]byte(acting+":"), b...))
	hashString := hex.EncodeToString(hash[:])
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return AccessRequestResult{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "hr:access:"+idem); err != nil {
		return AccessRequestResult{}, err
	}
	var oldID, oldHash string
	err = tx.QueryRowContext(ctx, "SELECT request_id,request_hash FROM dsh.hr_operator_access_events WHERE idempotency_key=$1", idem).Scan(&oldID, &oldHash)
	if err == nil {
		if oldHash != hashString {
			return AccessRequestResult{}, ErrConflict
		}
		a, e := scanAccess(tx.QueryRowContext(ctx, accessSelect+" WHERE r.id=$1", oldID))
		if e != nil {
			return AccessRequestResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return AccessRequestResult{}, e
		}
		return AccessRequestResult{Request: a, IdempotentReplay: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return AccessRequestResult{}, err
	}
	var phone, status, name, department, title string
	var linked sql.NullString
	err = tx.QueryRowContext(ctx, "SELECT COALESCE(phone_e164,''),status,operator_actor_id,full_name_ar,department,job_title FROM dsh.hr_employees WHERE id=$1 FOR SHARE", input.EmployeeID).Scan(&phone, &status, &linked, &name, &department, &title)
	if errors.Is(err, sql.ErrNoRows) {
		return AccessRequestResult{}, ErrNotFound
	}
	if err != nil {
		return AccessRequestResult{}, err
	}
	if phone == "" || status != "active" || linked.Valid {
		return AccessRequestResult{}, ErrInvalid
	}
	token := make([]byte, 16)
	if _, err = rand.Read(token); err != nil {
		return AccessRequestResult{}, err
	}
	id := "hreq_" + hex.EncodeToString(token)
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.hr_operator_access_requests
 (id,employee_id,reason,requested_permissions,requested_by_actor_id,employee_name_snapshot,phone_e164_snapshot,department_snapshot,job_title_snapshot)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, id, input.EmployeeID, input.Reason, pq.Array(input.RequestedPermissions), acting, name, phone, department, title)
	if err != nil {
		var pg *pq.Error
		if errors.As(err, &pg) && pg.Code == "23505" {
			return AccessRequestResult{}, ErrConflict
		}
		return AccessRequestResult{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.hr_operator_access_events
 (idempotency_key,request_id,event_type,request_hash,acting_actor_id,correlation_id)
 VALUES ($1,$2,'requested',$3,$4,$5)`, idem, id, hashString, acting, correlation)
	if err != nil {
		return AccessRequestResult{}, err
	}
	a, err := scanAccess(tx.QueryRowContext(ctx, accessSelect+" WHERE r.id=$1", id))
	if err != nil {
		return AccessRequestResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return AccessRequestResult{}, err
	}
	return AccessRequestResult{Request: a}, nil
}
func LinkAccessRequest(ctx context.Context, db *sql.DB, id, profileID, acting, correlation, idem string) (AccessRequestResult, error) {
	if db == nil || !strings.HasPrefix(id, "hreq_") || len(id) != 37 ||
		!strings.HasPrefix(profileID, "oprof_") || len(profileID) > 128 || len(acting) < 1 || len(acting) > 128 ||
		len(correlation) < 8 || len(correlation) > 128 || len(idem) < 8 || len(idem) > 128 {
		return AccessRequestResult{}, ErrInvalid
	}
	hash := sha256.Sum256([]byte(acting + ":" + id + ":" + profileID))
	hashString := hex.EncodeToString(hash[:])
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return AccessRequestResult{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "hr:access:action:"+id); err != nil {
		return AccessRequestResult{}, err
	}
	var previousID, previousHash string
	err = tx.QueryRowContext(ctx, "SELECT request_id,request_hash FROM dsh.hr_operator_access_events WHERE idempotency_key=$1", idem).Scan(&previousID, &previousHash)
	if err == nil {
		if previousID != id || previousHash != hashString {
			return AccessRequestResult{}, ErrConflict
		}
		a, e := scanAccess(tx.QueryRowContext(ctx, accessSelect+" WHERE r.id=$1", id))
		if e != nil {
			return AccessRequestResult{}, e
		}
		if e = tx.Commit(); e != nil {
			return AccessRequestResult{}, e
		}
		return AccessRequestResult{Request: a, IdempotentReplay: true}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return AccessRequestResult{}, err
	}
	var state, oldProfile string
	err = tx.QueryRowContext(ctx, "SELECT state,COALESCE(operator_profile_id,'') FROM dsh.hr_operator_access_requests WHERE id=$1 FOR UPDATE", id).Scan(&state, &oldProfile)
	if errors.Is(err, sql.ErrNoRows) {
		return AccessRequestResult{}, ErrNotFound
	}
	if err != nil {
		return AccessRequestResult{}, err
	}
	if state != "identity_provisioning" || oldProfile != "" {
		return AccessRequestResult{}, ErrConflict
	}
	_, err = tx.ExecContext(ctx, `UPDATE dsh.hr_operator_access_requests SET state='identity_profile_created',
 operator_profile_id=$2,linked_by_actor_id=$3,updated_at=clock_timestamp(),version=version+1 WHERE id=$1`, id, profileID, acting)
	if err != nil {
		var pg *pq.Error
		if errors.As(err, &pg) && pg.Code == "23505" {
			return AccessRequestResult{}, ErrConflict
		}
		return AccessRequestResult{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.hr_operator_access_events
 (idempotency_key,request_id,event_type,request_hash,acting_actor_id,correlation_id)
 VALUES ($1,$2,'identity_profile_created',$3,$4,$5)`, idem, id, hashString, acting, correlation)
	if err != nil {
		return AccessRequestResult{}, err
	}
	a, err := scanAccess(tx.QueryRowContext(ctx, accessSelect+" WHERE r.id=$1", id))
	if err != nil {
		return AccessRequestResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return AccessRequestResult{}, err
	}
	return AccessRequestResult{Request: a}, nil
}
