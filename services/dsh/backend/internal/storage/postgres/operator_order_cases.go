package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

var (
	ErrOpsCaseInvalid     = errors.New("invalid operations case facts")
	ErrOpsCaseConflict    = errors.New("operations case already open or stale")
	ErrOpsCaseForbidden   = errors.New("only the owning operator can advance this case")
	ErrOpsCaseIdempotency = errors.New("case idempotency mismatch")
	ErrOpsCaseNotFound    = errors.New("operations case not found")
	ErrOpsCaseUnverified  = errors.New("canonical money or goods closure proof is required")
)

type OpsCase struct {
	ID                    int64      `json:"id"`
	OrderID               string     `json:"orderId"`
	Reason                string     `json:"reason"`
	State                 string     `json:"state"`
	Priority              string     `json:"priority"`
	OwnerActorID          *string    `json:"ownerActorId,omitempty"`
	NextAction            string     `json:"nextAction"`
	Version               int        `json:"version"`
	ResolutionNote        *string    `json:"resolutionNote,omitempty"`
	ResolutionEvidenceRef *string    `json:"resolutionEvidenceRef,omitempty"`
	OpenedAt              time.Time  `json:"openedAt"`
	UpdatedAt             time.Time  `json:"updatedAt"`
	ResolvedAt            *time.Time `json:"resolvedAt,omitempty"`
}
type OpsCasePage struct {
	Items      []OpsCase `json:"items"`
	NextCursor string    `json:"nextCursor"`
}

func validCaseReason(s string) bool {
	switch s {
	case "PARTNER_DELAY", "DISPATCH_UNAVAILABLE", "DELIVERY_BLOCKED", "CAPTAIN_LOCATION_LOST", "CUSTOMER_CONTACT", "PAYMENT_EXCEPTION", "OTHER":
		return true
	}
	return false
}
func validCasePriority(s string) bool { return s == "NORMAL" || s == "URGENT" }
func validCaseAction(s string) bool {
	switch s {
	case "CLAIM", "ACTION_REQUIRED", "NEXT_ACTION", "RESOLVE":
		return true
	}
	return false
}
func validCaseNote(s string, max int) bool {
	n := len([]rune(strings.TrimSpace(s)))
	return n >= 12 && n <= max
}

const caseColumns = "id,order_id,reason,state,priority,owner_actor_id,next_action,version,resolution_note,resolution_evidence_ref,opened_at,updated_at,resolved_at"

func readCaseScan(row interface{ Scan(...any) error }) (OpsCase, error) {
	var result OpsCase
	var owner, note, evidence sql.NullString
	var resolved sql.NullTime
	err := row.Scan(&result.ID, &result.OrderID, &result.Reason, &result.State, &result.Priority, &owner,
		&result.NextAction, &result.Version, &note, &evidence, &result.OpenedAt, &result.UpdatedAt, &resolved)
	if err != nil {
		return OpsCase{}, err
	}
	if owner.Valid {
		v := owner.String
		result.OwnerActorID = &v
	}
	if note.Valid {
		v := note.String
		result.ResolutionNote = &v
	}
	if evidence.Valid {
		v := evidence.String
		result.ResolutionEvidenceRef = &v
	}
	if resolved.Valid {
		v := resolved.Time
		result.ResolvedAt = &v
	}
	return result, nil
}
func ReadOpsCase(ctx context.Context, db *sql.DB, id int64) (OpsCase, error) {
	row := db.QueryRowContext(ctx, "SELECT "+caseColumns+" FROM dsh.operator_order_cases WHERE id=$1", id)
	c, err := readCaseScan(row)
	if errors.Is(err, sql.ErrNoRows) {
		return OpsCase{}, ErrOpsCaseNotFound
	}
	return c, err
}
func ListOrderOpsCases(ctx context.Context, db *sql.DB, orderID string, limit int, cursor string) (OpsCasePage, error) {
	out := OpsCasePage{Items: []OpsCase{}}
	if len(strings.TrimSpace(orderID)) == 0 || len(orderID) > 128 || limit < 1 || limit > 30 {
		return out, ErrOpsCaseInvalid
	}
	var present string
	if err := db.QueryRowContext(ctx, "SELECT id FROM dsh.commerce_orders WHERE id=$1", orderID).Scan(&present); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return out, ErrOrderNotFound
		}
		return out, err
	}
	after := int64(9223372036854775807)
	if cursor != "" {
		n, err := strconv.ParseInt(cursor, 10, 64)
		if err != nil || n <= 0 {
			return out, ErrOpsCaseInvalid
		}
		after = n
	}
	rows, err := db.QueryContext(ctx, "SELECT "+caseColumns+" FROM dsh.operator_order_cases WHERE order_id=$1 AND id<$2 ORDER BY id DESC LIMIT $3", orderID, after, limit+1)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		item, err := readCaseScan(rows)
		if err != nil {
			return out, err
		}
		out.Items = append(out.Items, item)
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	if len(out.Items) > limit {
		out.Items = out.Items[:limit]
		out.NextCursor = strconv.FormatInt(out.Items[limit-1].ID, 10)
	}
	return out, nil
}
func opsCaseHash(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:])
}
func replayOpsCase(ctx context.Context, tx *sql.Tx, key, hash string) (int64, bool, error) {
	var id int64
	var previousHash string
	err := tx.QueryRowContext(ctx, "SELECT case_id,request_hash FROM dsh.operator_order_case_events WHERE idempotency_key=$1", key).Scan(&id, &previousHash)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	if previousHash != hash {
		return 0, false, ErrOpsCaseIdempotency
	}
	return id, true, nil
}
func caseWriteValid(actor, key, corr string) bool {
	return actor != "" && len(actor) <= 128 && len(key) >= 8 && len(key) <= 128 && len(corr) >= 8 && len(corr) <= 128
}

// OpenOpsCase serializes against other case commands on the same order and
// deduplicates an active exception for the same cause; no order state or WLT mutation.
func OpenOpsCase(ctx context.Context, db *sql.DB, orderID, actor, reason, priority, nextAction, key, corr string) (OpsCase, bool, error) {
	orderID = strings.TrimSpace(orderID)
	actor = strings.TrimSpace(actor)
	key = strings.TrimSpace(key)
	corr = strings.TrimSpace(corr)
	nextAction = strings.TrimSpace(nextAction)
	if db == nil || orderID == "" || len(orderID) > 128 || !caseWriteValid(actor, key, corr) || !validCaseReason(reason) || !validCasePriority(priority) || !validCaseNote(nextAction, 500) {
		return OpsCase{}, false, ErrOpsCaseInvalid
	}
	hash := opsCaseHash("OPEN", orderID, actor, reason, priority, nextAction)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OpsCase{}, false, err
	}
	defer tx.Rollback()
	var locked string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE", orderID).Scan(&locked); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return OpsCase{}, false, ErrOrderNotFound
		}
		return OpsCase{}, false, err
	}
	id, replayed, err := replayOpsCase(ctx, tx, key, hash)
	if err != nil {
		return OpsCase{}, false, err
	}
	if replayed {
		if err := tx.Commit(); err != nil {
			return OpsCase{}, false, err
		}
		item, err := ReadOpsCase(ctx, db, id)
		return item, true, err
	}
	var active int64
	err = tx.QueryRowContext(ctx, "SELECT id FROM dsh.operator_order_cases WHERE order_id=$1 AND reason=$2 AND state<>'RESOLVED'", orderID, reason).Scan(&active)
	if err == nil {
		return OpsCase{}, false, ErrOpsCaseConflict
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return OpsCase{}, false, err
	}
	err = tx.QueryRowContext(ctx, `INSERT INTO dsh.operator_order_cases(order_id,reason,priority,next_action,opened_by_actor_id,updated_by_actor_id)
 VALUES($1,$2,$3,$4,$5,$5) RETURNING id`, orderID, reason, priority, nextAction, actor).Scan(&id)
	if err != nil {
		return OpsCase{}, false, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.operator_order_case_events
 (case_id,action,actor_id,idempotency_key,request_hash,correlation_id,detail)
 VALUES($1,'OPEN',$2,$3,$4,$5,$6)`, id, actor, key, hash, corr, nextAction); err != nil {
		return OpsCase{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return OpsCase{}, false, err
	}
	item, err := ReadOpsCase(ctx, db, id)
	return item, false, err
}
func UpdateOpsCase(ctx context.Context, db *sql.DB, orderID string, id int64, actor, action, note, key, corr string, expectedVersion int, evidenceRefs ...string) (OpsCase, bool, error) {
	actor = strings.TrimSpace(actor)
	key = strings.TrimSpace(key)
	corr = strings.TrimSpace(corr)
	note = strings.TrimSpace(note)
	evidenceRef := ""
	if len(evidenceRefs) > 1 {
		return OpsCase{}, false, ErrOpsCaseInvalid
	}
	if len(evidenceRefs) == 1 {
		evidenceRef = strings.TrimSpace(evidenceRefs[0])
	}
	if len(evidenceRef) > 128 || (action != "RESOLVE" && evidenceRef != "") {
		return OpsCase{}, false, ErrOpsCaseInvalid
	}
	if db == nil || orderID == "" || len(orderID) > 128 || id <= 0 || !caseWriteValid(actor, key, corr) || !validCaseAction(action) || expectedVersion < 1 {
		return OpsCase{}, false, ErrOpsCaseInvalid
	}
	if action == "RESOLVE" && !validCaseNote(note, 1000) {
		return OpsCase{}, false, ErrOpsCaseInvalid
	}
	if (action == "ACTION_REQUIRED" || action == "NEXT_ACTION") && !validCaseNote(note, 500) {
		return OpsCase{}, false, ErrOpsCaseInvalid
	}
	hash := opsCaseHash(action, orderID, strconv.FormatInt(id, 10), actor, strconv.Itoa(expectedVersion), note, evidenceRef)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return OpsCase{}, false, err
	}
	defer tx.Rollback()
	var locked string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM dsh.commerce_orders WHERE id=$1 FOR UPDATE", orderID).Scan(&locked); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return OpsCase{}, false, ErrOrderNotFound
		}
		return OpsCase{}, false, err
	}
	existingID, replayed, err := replayOpsCase(ctx, tx, key, hash)
	if err != nil {
		return OpsCase{}, false, err
	}
	if replayed {
		if existingID != id {
			return OpsCase{}, false, ErrOpsCaseIdempotency
		}
		if err := tx.Commit(); err != nil {
			return OpsCase{}, false, err
		}
		item, err := ReadOpsCase(ctx, db, id)
		return item, true, err
	}
	var state, reason string
	var currentVersion int
	var owner sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT state,reason,version,owner_actor_id FROM dsh.operator_order_cases
 WHERE id=$1 AND order_id=$2 FOR UPDATE`, id, orderID).Scan(&state, &reason, &currentVersion, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return OpsCase{}, false, ErrOpsCaseNotFound
	}
	if err != nil {
		return OpsCase{}, false, err
	}
	if state == "RESOLVED" || currentVersion != expectedVersion {
		return OpsCase{}, false, ErrOpsCaseConflict
	}
	switch action {
	case "CLAIM":
		if owner.Valid && owner.String != actor {
			return OpsCase{}, false, ErrOpsCaseConflict
		}
		if _, err = tx.ExecContext(ctx, `UPDATE dsh.operator_order_cases SET owner_actor_id=$2,state='IN_PROGRESS',
   updated_by_actor_id=$2,updated_at=clock_timestamp(),version=version+1 WHERE id=$1`, id, actor); err != nil {
			return OpsCase{}, false, err
		}
	default:
		if !owner.Valid || owner.String != actor {
			return OpsCase{}, false, ErrOpsCaseForbidden
		}
		switch action {
		case "ACTION_REQUIRED":
			_, err = tx.ExecContext(ctx, `UPDATE dsh.operator_order_cases SET state='ACTION_REQUIRED',
   next_action=$2,updated_by_actor_id=$3,updated_at=clock_timestamp(),version=version+1 WHERE id=$1`, id, note, actor)
		case "NEXT_ACTION":
			_, err = tx.ExecContext(ctx, `UPDATE dsh.operator_order_cases SET state='IN_PROGRESS',
   next_action=$2,updated_by_actor_id=$3,updated_at=clock_timestamp(),version=version+1 WHERE id=$1`, id, note, actor)
		case "RESOLVE":
			// A recovered fix or verified terminal delivery resolves missing GPS.
			if reason == "CAPTAIN_LOCATION_LOST" {
				var recovered bool
				err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.captain_assignments a JOIN dsh.commerce_orders o ON o.id=a.order_id JOIN dsh.captain_mission_latest ml ON ml.assignment_id=a.id WHERE a.order_id=$1 AND a.state IN ('assigned','in_custody') AND o.state IN ('CAPTAIN_ASSIGNED','IN_CUSTODY') AND ml.received_at>=clock_timestamp()-interval '90 seconds' AND ml.recorded_at>=clock_timestamp()-interval '90 seconds') OR EXISTS(SELECT 1 FROM dsh.commerce_orders o JOIN dsh.commerce_order_delivery_proofs p ON p.order_id=o.id WHERE o.id=$1 AND o.state='DELIVERED' AND p.state='VERIFIED')", orderID).Scan(&recovered)
				if err != nil {
					return OpsCase{}, false, err
				}
				if !recovered {
					return OpsCase{}, false, ErrOpsCaseUnverified
				}
			}
			if reason == "PAYMENT_EXCEPTION" || reason == "DELIVERY_BLOCKED" {
				if err = verifyOperatorCaseResolutionProof(ctx, tx, orderID, reason, evidenceRef); err != nil {
					return OpsCase{}, false, err
				}
			} else if evidenceRef != "" {
				return OpsCase{}, false, ErrOpsCaseInvalid
			}
			_, err = tx.ExecContext(ctx, `UPDATE dsh.operator_order_cases SET state='RESOLVED',
   resolution_note=$2,resolution_evidence_ref=NULLIF($4,''),resolved_at=clock_timestamp(),updated_by_actor_id=$3,updated_at=clock_timestamp(),version=version+1 WHERE id=$1`, id, note, actor, evidenceRef)
		}
		if err != nil {
			return OpsCase{}, false, err
		}
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO dsh.operator_order_case_events
 (case_id,action,actor_id,idempotency_key,request_hash,correlation_id,detail)
 VALUES($1,$2,$3,$4,$5,$6,$7)`, id, action, actor, key, hash, corr, fmt.Sprintf("v%d %s evidence=%s", expectedVersion, note, evidenceRef)); err != nil {
		return OpsCase{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return OpsCase{}, false, err
	}
	item, err := ReadOpsCase(ctx, db, id)
	return item, false, err
}
