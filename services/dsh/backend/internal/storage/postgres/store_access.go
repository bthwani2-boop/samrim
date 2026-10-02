package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/lib/pq"
)

const storeAccessInvitationLifetime = 7 * 24 * time.Hour

type StoreAccessGrant struct {
	ID                  string     `json:"id"`
	StoreID             string     `json:"storeId"`
	StoreName           string     `json:"storeName"`
	OwnerPartnerActorID string     `json:"ownerPartnerActorId"`
	DelegateActorID     string     `json:"delegateActorId"`
	Permissions         []string   `json:"permissions"`
	State               string     `json:"state"`
	Version             int        `json:"version"`
	ExpiresAt           time.Time  `json:"expiresAt"`
	AcceptedAt          *time.Time `json:"acceptedAt,omitempty"`
	DeclinedAt          *time.Time `json:"declinedAt,omitempty"`
	RevokedAt           *time.Time `json:"revokedAt,omitempty"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}

var (
	ErrStoreAccessNotFound = errors.New("Store access grant was not found")
	ErrStoreAccessForbidden = errors.New("actor is not authorized for this Store action")
	ErrStoreAccessConflict = errors.New("Store access grant conflicts with current state")
	ErrStoreAccessVersion = errors.New("Store access grant version is stale")
	ErrStoreAccessIdem = errors.New("Store access grant idempotency key conflicts with previous facts")
	ErrStoreAccessExpired = errors.New("Store access invitation has expired")
)

func HashStoreAccessInvitationCreate(storeID, ownerActorID, delegateActorID string, permissions []string) string {
	return hashLocationFacts("store-access-invitation-create", strings.TrimSpace(storeID), strings.TrimSpace(ownerActorID), strings.TrimSpace(delegateActorID), strings.Join(canonicalStorePermissions(permissions), ","))
}

func HashStoreAccessRoleAdmission(grantID, ownerActorID string, expectedVersion int) string {
	return hashLocationFacts("store-access-role-admission", strings.TrimSpace(grantID), strings.TrimSpace(ownerActorID), fmt.Sprint(expectedVersion))
}

func HashStoreAccessInvitationDecision(grantID, delegateActorID, decision string, expectedVersion int) string {
	return hashLocationFacts("store-access-invitation-decision", strings.TrimSpace(grantID), strings.TrimSpace(delegateActorID), strings.TrimSpace(decision), fmt.Sprint(expectedVersion))
}

func HashStoreAccessTransition(storeID, grantID, ownerActorID, state string, expectedVersion int) string {
	return hashLocationFacts("store-access-transition", strings.TrimSpace(storeID), strings.TrimSpace(grantID), strings.TrimSpace(ownerActorID), strings.TrimSpace(state), fmt.Sprint(expectedVersion))
}

func AuthorizePartnerStoreAction(ctx context.Context, db *sql.DB, storeID, actorID, permission string) (StoreRecord, string, error) {
	storeID, actorID, permission = strings.TrimSpace(storeID), strings.TrimSpace(actorID), strings.TrimSpace(permission)
	if db == nil || storeID == "" || actorID == "" || !validStorePermission(permission) {
		return StoreRecord{}, "", ErrStoreAccessForbidden
	}
	store, err := ReadStore(ctx, db, storeID)
	if err != nil {
		return StoreRecord{}, "", err
	}
	if store.PartnerActorID == actorID {
		return store, "STORE_OWNER", nil
	}
	var authorized bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM dsh.store_access_grants
		WHERE store_id=$1 AND delegate_actor_id=$2 AND state='active' AND expires_at > clock_timestamp() AND $3=ANY(permissions)
	)`, storeID, actorID, permission).Scan(&authorized); err != nil {
		return StoreRecord{}, "", fmt.Errorf("authorize Store grant: %w", err)
	}
	if !authorized {
		return StoreRecord{}, "", ErrStoreAccessForbidden
	}
	return store, "STORE_GRANT", nil
}

func CreateStoreAccessInvitation(ctx context.Context, db *sql.DB, storeID, ownerActorID, delegateActorID string, permissions []string, idempotencyKey, correlationID string) (StoreAccessGrant, bool, error) {
	storeID, ownerActorID, delegateActorID = strings.TrimSpace(storeID), strings.TrimSpace(ownerActorID), strings.TrimSpace(delegateActorID)
	idempotencyKey, correlationID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	permissions = canonicalStorePermissions(permissions)
	if db == nil || storeID == "" || ownerActorID == "" || delegateActorID == "" || ownerActorID == delegateActorID || len(permissions) == 0 || len(idempotencyKey) < 8 || len(correlationID) < 8 {
		return StoreAccessGrant{}, false, ErrStoreAccessConflict
	}
	for _, permission := range permissions {
		if !validStorePermission(permission) {
			return StoreAccessGrant{}, false, ErrStoreAccessConflict
		}
	}
	requestHash := HashStoreAccessInvitationCreate(storeID, ownerActorID, delegateActorID, permissions)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreAccessGrant{}, false, fmt.Errorf("begin Store access invitation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "store-access-idem:"+idempotencyKey); err != nil {
		return StoreAccessGrant{}, false, fmt.Errorf("lock Store access idempotency: %w", err)
	}
	if grant, replayed, err := readStoreAccessReplayTx(ctx, tx, idempotencyKey, requestHash, "invitation_create", ownerActorID); err == nil {
		if grant.StoreID != storeID || grant.DelegateActorID != delegateActorID {
			return StoreAccessGrant{}, false, ErrStoreAccessIdem
		}
		if err := tx.Commit(); err != nil {
			return StoreAccessGrant{}, false, err
		}
		return grant, replayed, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return StoreAccessGrant{}, false, err
	}
	if err := verifyStoreOwnerTx(ctx, tx, storeID, ownerActorID); err != nil {
		return StoreAccessGrant{}, false, ErrStoreAccessForbidden
	}
	var duplicate bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.store_access_grants
		WHERE store_id=$1 AND delegate_actor_id=$2 AND state IN ('pending_role_admission','pending_acceptance','active','suspended'))`, storeID, delegateActorID).Scan(&duplicate); err != nil {
		return StoreAccessGrant{}, false, err
	}
	if duplicate {
		return StoreAccessGrant{}, false, ErrStoreAccessConflict
	}
	id, err := newID("store-access-grant")
	if err != nil {
		return StoreAccessGrant{}, false, err
	}
	expiresAt := time.Now().UTC().Add(storeAccessInvitationLifetime)
	grant, err := readStoreAccessGrantRow(tx.QueryRowContext(ctx, `INSERT INTO dsh.store_access_grants
		(id,store_id,owner_partner_actor_id,delegate_actor_id,permissions,state,version,expires_at)
		VALUES($1,$2,$3,$4,$5,'pending_role_admission',1,$6)
		RETURNING id,store_id,(SELECT name FROM dsh.stores WHERE id=store_id),owner_partner_actor_id,delegate_actor_id,permissions,state,version,expires_at,accepted_at,declined_at,revoked_at,created_at,updated_at`,
		id, storeID, ownerActorID, delegateActorID, pq.Array(permissions), expiresAt))
	if err != nil {
		return StoreAccessGrant{}, false, fmt.Errorf("create Store access invitation: %w", err)
	}
	if err := recordStoreAccessMutationTx(ctx, tx, grant, "invitation_create", ownerActorID, idempotencyKey, requestHash, correlationID, "invitation_created", nil, grant.State, 0, grant.Version); err != nil {
		return StoreAccessGrant{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StoreAccessGrant{}, false, fmt.Errorf("commit Store access invitation: %w", err)
	}
	return grant, false, nil
}

func ConfirmStoreAccessRoleAdmission(ctx context.Context, db *sql.DB, grantID, ownerActorID string, expectedVersion int, idempotencyKey, correlationID string) (StoreAccessGrant, bool, error) {
	grantID, ownerActorID, idempotencyKey, correlationID = strings.TrimSpace(grantID), strings.TrimSpace(ownerActorID), strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if db == nil || grantID == "" || ownerActorID == "" || expectedVersion < 1 || len(idempotencyKey) < 8 || len(correlationID) < 8 {
		return StoreAccessGrant{}, false, ErrStoreAccessConflict
	}
	requestHash := HashStoreAccessRoleAdmission(grantID, ownerActorID, expectedVersion)
	return transitionStoreAccessGrant(ctx, db, grantID, ownerActorID, "pending_role_admission", "pending_acceptance", expectedVersion, idempotencyKey, requestHash, correlationID, "role_admission_confirm", "role_admission_confirmed", true)
}

func DecideStoreAccessInvitation(ctx context.Context, db *sql.DB, grantID, delegateActorID, decision string, expectedVersion int, idempotencyKey, correlationID string) (StoreAccessGrant, bool, error) {
	grantID, delegateActorID, decision = strings.TrimSpace(grantID), strings.TrimSpace(delegateActorID), strings.TrimSpace(decision)
	idempotencyKey, correlationID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if db == nil || grantID == "" || delegateActorID == "" || expectedVersion < 1 || (decision != "accept" && decision != "decline") || len(idempotencyKey) < 8 || len(correlationID) < 8 {
		return StoreAccessGrant{}, false, ErrStoreAccessConflict
	}
	requestHash := HashStoreAccessInvitationDecision(grantID, delegateActorID, decision, expectedVersion)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreAccessGrant{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "store-access-idem:"+idempotencyKey); err != nil {
		return StoreAccessGrant{}, false, err
	}
	operation := "invitation_accept"
	event := "invitation_accepted"
	target := "active"
	if decision == "decline" {
		operation, event, target = "invitation_decline", "invitation_declined", "declined"
	}
	if grant, replayed, err := readStoreAccessReplayTx(ctx, tx, idempotencyKey, requestHash, operation, delegateActorID); err == nil {
		if err := tx.Commit(); err != nil {
			return StoreAccessGrant{}, false, err
		}
		return grant, replayed, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return StoreAccessGrant{}, false, err
	}
	grant, err := readStoreAccessGrantForUpdateTx(ctx, tx, grantID)
	if errors.Is(err, sql.ErrNoRows) {
		return StoreAccessGrant{}, false, ErrStoreAccessNotFound
	}
	if err != nil {
		return StoreAccessGrant{}, false, err
	}
	if grant.DelegateActorID != delegateActorID || grant.State != "pending_acceptance" {
		return StoreAccessGrant{}, false, ErrStoreAccessConflict
	}
	if grant.Version != expectedVersion {
		return StoreAccessGrant{}, false, ErrStoreAccessVersion
	}
	if !grant.ExpiresAt.After(time.Now().UTC()) {
		return StoreAccessGrant{}, false, ErrStoreAccessExpired
	}
	var acceptedAt, declinedAt any
	if target == "active" {
		acceptedAt = time.Now().UTC()
	} else {
		declinedAt = time.Now().UTC()
	}
	updated, err := readStoreAccessGrantRow(tx.QueryRowContext(ctx, `UPDATE dsh.store_access_grants SET state=$2,version=version+1,
		accepted_at=COALESCE($3,accepted_at),declined_at=COALESCE($4,declined_at),updated_at=clock_timestamp()
		WHERE id=$1 AND version=$5 RETURNING id,store_id,(SELECT name FROM dsh.stores WHERE id=store_id),owner_partner_actor_id,delegate_actor_id,permissions,state,version,expires_at,accepted_at,declined_at,revoked_at,created_at,updated_at`,
		grant.ID, target, acceptedAt, declinedAt, expectedVersion))
	if err != nil {
		return StoreAccessGrant{}, false, err
	}
	if err := recordStoreAccessMutationTx(ctx, tx, updated, operation, delegateActorID, idempotencyKey, requestHash, correlationID, event, &grant.State, target, expectedVersion, updated.Version); err != nil {
		return StoreAccessGrant{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StoreAccessGrant{}, false, err
	}
	return updated, false, nil
}

func TransitionStoreAccessGrant(ctx context.Context, db *sql.DB, storeID, ownerActorID, grantID, targetState string, expectedVersion int, idempotencyKey, correlationID string) (StoreAccessGrant, bool, error) {
	storeID, ownerActorID, grantID, targetState = strings.TrimSpace(storeID), strings.TrimSpace(ownerActorID), strings.TrimSpace(grantID), strings.TrimSpace(targetState)
	if targetState != "active" && targetState != "suspended" && targetState != "revoked" {
		return StoreAccessGrant{}, false, ErrStoreAccessConflict
	}
	requestHash := HashStoreAccessTransition(storeID, grantID, ownerActorID, targetState, expectedVersion)
	grant, replayed, err := transitionStoreAccessGrant(ctx, db, grantID, ownerActorID, "", targetState, expectedVersion, strings.TrimSpace(idempotencyKey), requestHash, strings.TrimSpace(correlationID), "grant_transition", "grant_state_changed", false)
	if err != nil {
		return StoreAccessGrant{}, false, err
	}
	if grant.StoreID != storeID {
		return StoreAccessGrant{}, false, ErrStoreAccessForbidden
	}
	return grant, replayed, nil
}

func ListStoreAccessGrants(ctx context.Context, db *sql.DB, storeID, ownerActorID string) ([]StoreAccessGrant, error) {
	storeID, ownerActorID = strings.TrimSpace(storeID), strings.TrimSpace(ownerActorID)
	if db == nil || storeID == "" || ownerActorID == "" {
		return nil, ErrStoreAccessConflict
	}
	if store, err := ReadStoreOwnedByPartner(ctx, db, storeID, ownerActorID); err != nil || store.ID == "" {
		return nil, ErrStoreAccessForbidden
	}
	rows, err := db.QueryContext(ctx, `SELECT g.id,g.store_id,s.name,g.owner_partner_actor_id,g.delegate_actor_id,g.permissions,
		CASE WHEN g.state IN ('pending_role_admission','pending_acceptance') AND g.expires_at <= clock_timestamp() THEN 'expired' ELSE g.state END,
		g.version,g.expires_at,g.accepted_at,g.declined_at,g.revoked_at,g.created_at,g.updated_at
		FROM dsh.store_access_grants g JOIN dsh.stores s ON s.id=g.store_id
		WHERE g.store_id=$1 AND g.owner_partner_actor_id=$2 ORDER BY g.created_at DESC,g.id`, storeID, ownerActorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanStoreAccessGrantRows(rows)
}

func ListDelegateStoreAccessInvitations(ctx context.Context, db *sql.DB, delegateActorID string) ([]StoreAccessGrant, error) {
	delegateActorID = strings.TrimSpace(delegateActorID)
	if db == nil || delegateActorID == "" {
		return nil, ErrStoreAccessConflict
	}
	rows, err := db.QueryContext(ctx, `SELECT g.id,g.store_id,s.name,g.owner_partner_actor_id,g.delegate_actor_id,g.permissions,
		CASE WHEN g.state IN ('pending_role_admission','pending_acceptance') AND g.expires_at <= clock_timestamp() THEN 'expired' ELSE g.state END,
		g.version,g.expires_at,g.accepted_at,g.declined_at,g.revoked_at,g.created_at,g.updated_at
		FROM dsh.store_access_grants g JOIN dsh.stores s ON s.id=g.store_id
		WHERE g.delegate_actor_id=$1 ORDER BY g.created_at DESC,g.id`, delegateActorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanStoreAccessGrantRows(rows)
}

func transitionStoreAccessGrant(ctx context.Context, db *sql.DB, grantID, actingActorID, requiredFrom, targetState string, expectedVersion int, idempotencyKey, requestHash, correlationID, operation, event string, ownerOnly bool) (StoreAccessGrant, bool, error) {
	if db == nil || grantID == "" || actingActorID == "" || expectedVersion < 1 || len(idempotencyKey) < 8 || len(correlationID) < 8 {
		return StoreAccessGrant{}, false, ErrStoreAccessConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreAccessGrant{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "store-access-idem:"+idempotencyKey); err != nil {
		return StoreAccessGrant{}, false, err
	}
	if grant, replayed, err := readStoreAccessReplayTx(ctx, tx, idempotencyKey, requestHash, operation, actingActorID); err == nil {
		if err := tx.Commit(); err != nil {
			return StoreAccessGrant{}, false, err
		}
		return grant, replayed, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return StoreAccessGrant{}, false, err
	}
	grant, err := readStoreAccessGrantForUpdateTx(ctx, tx, grantID)
	if errors.Is(err, sql.ErrNoRows) {
		return StoreAccessGrant{}, false, ErrStoreAccessNotFound
	}
	if err != nil {
		return StoreAccessGrant{}, false, err
	}
	if ownerOnly && grant.OwnerPartnerActorID != actingActorID {
		return StoreAccessGrant{}, false, ErrStoreAccessForbidden
	}
	if !ownerOnly && operation == "grant_transition" && grant.OwnerPartnerActorID != actingActorID {
		return StoreAccessGrant{}, false, ErrStoreAccessForbidden
	}
	if requiredFrom != "" && grant.State != requiredFrom {
		return StoreAccessGrant{}, false, ErrStoreAccessConflict
	}
	if operation == "grant_transition" {
		legal := (grant.State == "active" && (targetState == "suspended" || targetState == "revoked")) || (grant.State == "suspended" && (targetState == "active" || targetState == "revoked"))
		if !legal {
			return StoreAccessGrant{}, false, ErrStoreAccessConflict
		}
	}
	if grant.Version != expectedVersion {
		return StoreAccessGrant{}, false, ErrStoreAccessVersion
	}
	var revokedAt any
	if targetState == "revoked" {
		revokedAt = time.Now().UTC()
	}
	updated, err := readStoreAccessGrantRow(tx.QueryRowContext(ctx, `UPDATE dsh.store_access_grants SET state=$2,version=version+1,
		revoked_at=COALESCE($3,revoked_at),updated_at=clock_timestamp() WHERE id=$1 AND version=$4
		RETURNING id,store_id,(SELECT name FROM dsh.stores WHERE id=store_id),owner_partner_actor_id,delegate_actor_id,permissions,state,version,expires_at,accepted_at,declined_at,revoked_at,created_at,updated_at`,
		grant.ID, targetState, revokedAt, expectedVersion))
	if err != nil {
		return StoreAccessGrant{}, false, err
	}
	if err := recordStoreAccessMutationTx(ctx, tx, updated, operation, actingActorID, idempotencyKey, requestHash, correlationID, event, &grant.State, targetState, expectedVersion, updated.Version); err != nil {
		return StoreAccessGrant{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StoreAccessGrant{}, false, err
	}
	return updated, false, nil
}

func verifyStoreOwnerTx(ctx context.Context, tx *sql.Tx, storeID, actorID string) error {
	var exists bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.stores WHERE id=$1 AND partner_actor_id=$2)", storeID, actorID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrStoreAccessForbidden
	}
	return nil
}

func recordStoreAccessMutationTx(ctx context.Context, tx *sql.Tx, grant StoreAccessGrant, operation, actingActorID, idempotencyKey, requestHash, correlationID, event string, fromState *string, toState string, expectedVersion, resultVersion int) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_access_grant_idempotency
		(idempotency_key,request_hash,operation,grant_id,acting_actor_id,result_state,result_version)
		VALUES($1,$2,$3,$4,$5,$6,$7)`, idempotencyKey, requestHash, operation, grant.ID, actingActorID, resultState(toState), resultVersion); err != nil {
		return fmt.Errorf("record Store access idempotency: %w", err)
	}
	var from any
	if fromState != nil {
		from = *fromState
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_access_grant_audit
		(event_type,idempotency_key,correlation_id,acting_actor_id,owner_partner_actor_id,delegate_actor_id,store_id,grant_id,from_state,to_state,expected_version,result_version,request_hash)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, event, idempotencyKey, correlationID, actingActorID, grant.OwnerPartnerActorID, grant.DelegateActorID, grant.StoreID, grant.ID, from, toState, expectedVersion, resultVersion, requestHash); err != nil {
		return fmt.Errorf("record Store access audit: %w", err)
	}
	return nil
}

func readStoreAccessReplayTx(ctx context.Context, tx *sql.Tx, idempotencyKey, requestHash, operation, actingActorID string) (StoreAccessGrant, bool, error) {
	var storedHash, storedOperation, grantID, storedActor string
	if err := tx.QueryRowContext(ctx, `SELECT request_hash,operation,grant_id,acting_actor_id FROM dsh.store_access_grant_idempotency WHERE idempotency_key=$1`, idempotencyKey).Scan(&storedHash, &storedOperation, &grantID, &storedActor); err != nil {
		return StoreAccessGrant{}, false, err
	}
	if storedHash != requestHash || storedOperation != operation || storedActor != actingActorID {
		return StoreAccessGrant{}, false, ErrStoreAccessIdem
	}
	grant, err := readStoreAccessGrantForUpdateTx(ctx, tx, grantID)
	return grant, true, err
}

func readStoreAccessGrantForUpdateTx(ctx context.Context, tx *sql.Tx, grantID string) (StoreAccessGrant, error) {
	return readStoreAccessGrantRow(tx.QueryRowContext(ctx, `SELECT g.id,g.store_id,s.name,g.owner_partner_actor_id,g.delegate_actor_id,g.permissions,g.state,g.version,
		g.expires_at,g.accepted_at,g.declined_at,g.revoked_at,g.created_at,g.updated_at
		FROM dsh.store_access_grants g JOIN dsh.stores s ON s.id=g.store_id WHERE g.id=$1 FOR UPDATE OF g`, grantID))
}

type storeAccessRowScanner interface{ Scan(...any) error }

func readStoreAccessGrantRow(row storeAccessRowScanner) (StoreAccessGrant, error) {
	var grant StoreAccessGrant
	if err := row.Scan(&grant.ID, &grant.StoreID, &grant.StoreName, &grant.OwnerPartnerActorID, &grant.DelegateActorID, pq.Array(&grant.Permissions), &grant.State, &grant.Version,
		&grant.ExpiresAt, &grant.AcceptedAt, &grant.DeclinedAt, &grant.RevokedAt, &grant.CreatedAt, &grant.UpdatedAt); err != nil {
		return StoreAccessGrant{}, err
	}
	grant.Permissions = canonicalStorePermissions(grant.Permissions)
	return grant, nil
}

func scanStoreAccessGrantRows(rows *sql.Rows) ([]StoreAccessGrant, error) {
	items := make([]StoreAccessGrant, 0)
	for rows.Next() {
		grant, err := readStoreAccessGrantRow(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, grant)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func canonicalStorePermissions(input []string) []string {
	set := map[string]struct{}{}
	for _, permission := range input {
		permission = strings.TrimSpace(permission)
		if permission != "" {
			set[permission] = struct{}{}
		}
	}
	result := make([]string, 0, len(set))
	for permission := range set {
		result = append(result, permission)
	}
	sort.Strings(result)
	return result
}

func validStorePermission(permission string) bool {
	return permission == "orders" || permission == "catalog" || permission == "store_operations"
}
