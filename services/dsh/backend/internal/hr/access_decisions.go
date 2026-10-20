package hr

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"
)

// A decision is serialized per request, including the provisioning claim and link.
// Rejection is final; a new submission is a distinct request with a fresh snapshot.
func DecideAccessRequest(ctx context.Context, db *sql.DB, id, action, reason string, expectedVersion int, acting, correlation, idem string) (AccessRequestResult, error) {
	reason = strings.TrimSpace(reason)
	if db == nil || !strings.HasPrefix(id, "hreq_") || len(id) != 37 ||
		(action != "rejected" && action != "identity_provisioning") || expectedVersion < 1 ||
		(action == "rejected" && (utf8.RuneCountInString(reason) < 8 || utf8.RuneCountInString(reason) > 500)) ||
		(action == "identity_provisioning" && reason != "") ||
		len(acting) < 1 || len(acting) > 128 || len(correlation) < 8 || len(correlation) > 128 || len(idem) < 8 || len(idem) > 128 {
		return AccessRequestResult{}, ErrInvalid
	}
	digest := sha256.Sum256([]byte(acting + ":" + id + ":" + action + ":" + reason + ":" + stringVersion(expectedVersion)))
	hash := hex.EncodeToString(digest[:])
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
		if previousID != id || previousHash != hash {
			return AccessRequestResult{}, ErrConflict
		}
		a, e := scanAccess(tx.QueryRowContext(ctx, accessSelectByID, id))
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
	request, err := scanAccess(tx.QueryRowContext(ctx, accessSelectByIDForUpdate, id))
	if errors.Is(err, sql.ErrNoRows) {
		return AccessRequestResult{}, ErrNotFound
	}
	if err != nil {
		return AccessRequestResult{}, err
	}
	if request.State != "pending_review" || request.Version != expectedVersion {
		return AccessRequestResult{}, ErrConflict
	}
	if action == "identity_provisioning" {
		// The share lock prevents employment changes from racing the durable claim.
		employee, e := scan(tx.QueryRowContext(ctx, employeeSelectByIDForShare, request.EmployeeID))
		if e != nil {
			return AccessRequestResult{}, e
		}
		if !AccessRequestMatchesEmployee(request, employee) {
			return AccessRequestResult{}, ErrConflict
		}
	}
	if action == "rejected" {
		_, err = tx.ExecContext(ctx, `UPDATE dsh.hr_operator_access_requests
 SET state='rejected',rejected_at=clock_timestamp(),rejected_by_actor_id=$2,rejection_reason=$3,
 updated_at=clock_timestamp(),version=version+1 WHERE id=$1`, id, acting, reason)
	} else {
		_, err = tx.ExecContext(ctx, `UPDATE dsh.hr_operator_access_requests
 SET state='identity_provisioning',provisioning_at=clock_timestamp(),provisioning_by_actor_id=$2,
 updated_at=clock_timestamp(),version=version+1 WHERE id=$1`, id, acting)
	}
	if err != nil {
		return AccessRequestResult{}, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.hr_operator_access_events
 (idempotency_key,request_id,event_type,request_hash,acting_actor_id,correlation_id)
 VALUES($1,$2,$3,$4,$5,$6)`, idem, id, action, hash, acting, correlation)
	if err != nil {
		return AccessRequestResult{}, err
	}
	a, err := scanAccess(tx.QueryRowContext(ctx, accessSelectByID, id))
	if err != nil {
		return AccessRequestResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return AccessRequestResult{}, err
	}
	return AccessRequestResult{Request: a}, nil
}
func stringVersion(v int) string { return strconv.Itoa(v) }
