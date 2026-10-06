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
	DelegateActorID                string     `json:"delegateActorId"`
	DelegatePhoneMasked            string     `json:"delegatePhoneMasked,omitempty"`
	DelegateBeneficiaryName        string     `json:"delegateBeneficiaryName,omitempty"`
	DelegateWalletProviderKey      string     `json:"delegateWalletProviderKey,omitempty"`
	DelegateWalletIdentifierMasked string     `json:"delegateWalletIdentifierMasked,omitempty"`
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

type PartnerAccessibleStore struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	ServiceCityID     string   `json:"serviceCityId"`
	PrimaryVerticalID string   `json:"primaryVerticalId"`
	PublicationState  string   `json:"publicationState"`
	FulfillmentModes  []string `json:"fulfillmentModes"`
	Owned             bool     `json:"owned"`
	Permissions       []string `json:"permissions"`
}

type PartnerAccessibleStorePage struct {
	Stores     []PartnerAccessibleStore `json:"stores"`
	NextCursor string                   `json:"nextCursor"`
}

var (
	ErrStoreAccessNotFound  = errors.New("Store access grant was not found")
	ErrStoreAccessForbidden = errors.New("actor is not authorized for this Store action")
	ErrStoreAccessConflict  = errors.New("Store access grant conflicts with current state")
	ErrStoreAccessVersion   = errors.New("Store access grant version is stale")
	ErrStoreAccessIdem      = errors.New("Store access grant idempotency key conflicts with previous facts")
	ErrStoreAccessExpired   = errors.New("Store access invitation has expired")
)

func HashStoreAccessInvitationCreate(storeID, ownerActorID, delegateActorID string, permissions []string) string {
	return hashLocationFacts("store-access-invitation-create", strings.TrimSpace(storeID), strings.TrimSpace(ownerActorID), strings.TrimSpace(delegateActorID), strings.Join(canonicalStorePermissions(permissions), ","))
}

func HashStoreAccessRoleAdmission(grantID, actingActorID string, expectedVersion int) string {
	return hashLocationFacts("store-access-role-admission", strings.TrimSpace(grantID), strings.TrimSpace(actingActorID), fmt.Sprint(expectedVersion))
}

func HashStoreAccessPartnerActivation(grantID, delegateActorID string, expectedVersion int) string {
	return hashLocationFacts("store-access-partner-activation", strings.TrimSpace(grantID), strings.TrimSpace(delegateActorID), fmt.Sprint(expectedVersion))
}

func HashStoreAccessInvitationDecision(grantID, delegateActorID, decision string, expectedVersion int) string {
	return hashLocationFacts("store-access-invitation-decision", strings.TrimSpace(grantID), strings.TrimSpace(delegateActorID), strings.TrimSpace(decision), fmt.Sprint(expectedVersion))
}

func HashStoreAccessTransition(storeID, grantID, ownerActorID, state string, expectedVersion int) string {
	return hashLocationFacts("store-access-transition", strings.TrimSpace(storeID), strings.TrimSpace(grantID), strings.TrimSpace(ownerActorID), strings.TrimSpace(state), fmt.Sprint(expectedVersion))
}

func HashStoreAccessPermissionsUpdate(storeID, grantID, ownerActorID string, permissions []string, expectedVersion int) string {
	return hashLocationFacts("store-access-permissions-update", strings.TrimSpace(storeID), strings.TrimSpace(grantID), strings.TrimSpace(ownerActorID), strings.Join(canonicalStorePermissions(permissions), ","), fmt.Sprint(expectedVersion))
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
		WHERE store_id=$1 AND delegate_actor_id=$2 AND state='active' AND $3=ANY(permissions)
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
	if !validStorePermissionSet(permissions) {
		return StoreAccessGrant{}, false, ErrStoreAccessConflict
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
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "store-access-pair:"+storeID+":"+delegateActorID); err != nil {
		return StoreAccessGrant{}, false, fmt.Errorf("lock Store access invitation pair: %w", err)
	}
	var duplicate bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM dsh.store_access_grants
		WHERE store_id=$1 AND delegate_actor_id=$2 AND (
			state IN ('active','suspended','pending_role_admission','pending_partner_activation') OR
			(state='pending_acceptance' AND expires_at > clock_timestamp())
		))`, storeID, delegateActorID).Scan(&duplicate); err != nil {
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
		VALUES($1,$2,$3,$4,$5,'pending_acceptance',1,$6)
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

func ConfirmStoreAccessRoleAdmission(ctx context.Context, db *sql.DB, grantID, actingActorID string, expectedVersion int, idempotencyKey, correlationID string) (StoreAccessGrant, bool, error) {
	grantID, actingActorID, idempotencyKey, correlationID = strings.TrimSpace(grantID), strings.TrimSpace(actingActorID), strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if db == nil || grantID == "" || actingActorID == "" || expectedVersion < 1 || len(idempotencyKey) < 8 || len(correlationID) < 8 {
		return StoreAccessGrant{}, false, ErrStoreAccessConflict
	}
	requestHash := HashStoreAccessRoleAdmission(grantID, actingActorID, expectedVersion)
	return transitionStoreAccessGrant(ctx, db, grantID, actingActorID, "pending_role_admission", "pending_partner_activation", expectedVersion, idempotencyKey, requestHash, correlationID, "role_admission_confirm", "role_admission_confirmed", "", false)
}

func ConfirmStoreAccessPartnerActivation(ctx context.Context, db *sql.DB, grantID, delegateActorID string, expectedVersion int, idempotencyKey, correlationID string) (StoreAccessGrant, bool, error) {
	grantID, delegateActorID, idempotencyKey, correlationID = strings.TrimSpace(grantID), strings.TrimSpace(delegateActorID), strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if db == nil || grantID == "" || delegateActorID == "" || expectedVersion < 1 || len(idempotencyKey) < 8 || len(correlationID) < 8 {
		return StoreAccessGrant{}, false, ErrStoreAccessConflict
	}
	requestHash := HashStoreAccessPartnerActivation(grantID, delegateActorID, expectedVersion)
	return transitionStoreAccessGrant(ctx, db, grantID, delegateActorID, "pending_partner_activation", "active", expectedVersion, idempotencyKey, requestHash, correlationID, "partner_activation_confirm", "partner_activation_confirmed", "", false)
}

func ReadStoreAccessGrant(ctx context.Context, db *sql.DB, grantID string) (StoreAccessGrant, error) {
	grantID = strings.TrimSpace(grantID)
	if db == nil || grantID == "" {
		return StoreAccessGrant{}, ErrStoreAccessConflict
	}
	grant, err := readStoreAccessGrantRow(db.QueryRowContext(ctx, `SELECT g.id,g.store_id,s.name,g.owner_partner_actor_id,g.delegate_actor_id,g.permissions,
		CASE WHEN g.state='pending_acceptance' AND g.expires_at <= clock_timestamp() THEN 'expired' ELSE g.state END,
		g.version,g.expires_at,g.accepted_at,g.declined_at,g.revoked_at,g.created_at,g.updated_at
		FROM dsh.store_access_grants g JOIN dsh.stores s ON s.id=g.store_id WHERE g.id=$1`, grantID))
	if errors.Is(err, sql.ErrNoRows) {
		return StoreAccessGrant{}, ErrStoreAccessNotFound
	}
	return grant, err
}

func ReadStoreAccessMutationReplay(ctx context.Context, db *sql.DB, idempotencyKey, operation, actingActorID, grantID string) (StoreAccessGrant, bool, error) {
	idempotencyKey, operation, actingActorID, grantID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(operation), strings.TrimSpace(actingActorID), strings.TrimSpace(grantID)
	if db == nil || len(idempotencyKey) < 8 || operation == "" || actingActorID == "" || grantID == "" {
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
	var recordedOperation, recordedActorID, recordedGrantID string
	err = tx.QueryRowContext(ctx, `SELECT operation,acting_actor_id,grant_id
		FROM dsh.store_access_grant_idempotency WHERE idempotency_key=$1`, idempotencyKey).Scan(&recordedOperation, &recordedActorID, &recordedGrantID)
	if errors.Is(err, sql.ErrNoRows) {
		return StoreAccessGrant{}, false, sql.ErrNoRows
	}
	if err != nil {
		return StoreAccessGrant{}, false, err
	}
	if recordedOperation != operation || recordedActorID != actingActorID || recordedGrantID != grantID {
		return StoreAccessGrant{}, false, ErrStoreAccessIdem
	}
	grant, err := readStoreAccessGrantRow(tx.QueryRowContext(ctx, `SELECT g.id,g.store_id,s.name,g.owner_partner_actor_id,g.delegate_actor_id,g.permissions,
		CASE WHEN g.state='pending_acceptance' AND g.expires_at <= clock_timestamp() THEN 'expired' ELSE g.state END,
		g.version,g.expires_at,g.accepted_at,g.declined_at,g.revoked_at,g.created_at,g.updated_at
		FROM dsh.store_access_grants g JOIN dsh.stores s ON s.id=g.store_id WHERE g.id=$1`, grantID))
	if err != nil {
		return StoreAccessGrant{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StoreAccessGrant{}, false, err
	}
	return grant, true, nil
}

func HasPartnerWorkspaceEligibility(ctx context.Context, db *sql.DB, actorID string) (bool, error) {
	actorID = strings.TrimSpace(actorID)
	if db == nil || actorID == "" || len(actorID) > 128 {
		return false, ErrStoreAccessConflict
	}
	var eligible bool
	err := db.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM dsh.stores WHERE partner_actor_id=$1
		UNION ALL
		SELECT 1 FROM dsh.joining_cases WHERE partner_actor_id=$1
		UNION ALL
		SELECT 1 FROM dsh.store_access_grants
		WHERE delegate_actor_id=$1 AND state IN ('pending_role_admission','pending_partner_activation','active','suspended')
	)`, actorID).Scan(&eligible)
	return eligible, err
}

func ListPendingStoreAccessRoleAdmissions(ctx context.Context, db *sql.DB) ([]StoreAccessGrant, error) {
	if db == nil {
		return nil, ErrStoreAccessConflict
	}
	rows, err := db.QueryContext(ctx, `SELECT g.id,g.store_id,s.name,g.owner_partner_actor_id,g.delegate_actor_id,g.permissions,g.state,
		g.version,g.expires_at,g.accepted_at,g.declined_at,g.revoked_at,g.created_at,g.updated_at
		FROM dsh.store_access_grants g JOIN dsh.stores s ON s.id=g.store_id
		WHERE g.state='pending_role_admission' AND g.accepted_at IS NOT NULL
		ORDER BY g.created_at,g.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanStoreAccessGrantRows(rows)
}

func ListPartnerAccessibleStores(ctx context.Context, db *sql.DB, actorID string, limit int, cursor string) (PartnerAccessibleStorePage, error) {
	actorID, cursor = strings.TrimSpace(actorID), strings.TrimSpace(cursor)
	if db == nil || actorID == "" || len(actorID) > 128 || limit < 1 || limit > 50 || len(cursor) > 128 {
		return PartnerAccessibleStorePage{}, ErrStoreAccessConflict
	}
	rows, err := db.QueryContext(ctx, `SELECT s.id,s.name,COALESCE(s.service_city_id,''),s.primary_vertical_id,s.publication_state,s.fulfillment_modes,
		s.partner_actor_id=$1,
		CASE WHEN s.partner_actor_id=$1 THEN ARRAY['orders','catalog','store_operations','promotions','finance_read','payout_request','fulfillment']::text[] ELSE g.permissions END
		FROM dsh.stores s
		LEFT JOIN LATERAL (
			SELECT permissions FROM dsh.store_access_grants
			WHERE store_id=s.id AND delegate_actor_id=$1 AND state='active'
			ORDER BY updated_at DESC,id DESC LIMIT 1
		) g ON true
		WHERE (s.partner_actor_id=$1 OR g.permissions IS NOT NULL) AND s.id>$2
		ORDER BY s.id LIMIT $3`, actorID, cursor, limit+1)
	if err != nil {
		return PartnerAccessibleStorePage{}, fmt.Errorf("list Partner-accessible Stores: %w", err)
	}
	defer rows.Close()
	page := PartnerAccessibleStorePage{Stores: make([]PartnerAccessibleStore, 0, limit)}
	for rows.Next() {
		var item PartnerAccessibleStore
		if err := rows.Scan(&item.ID, &item.Name, &item.ServiceCityID, &item.PrimaryVerticalID, &item.PublicationState, pq.Array(&item.FulfillmentModes), &item.Owned, pq.Array(&item.Permissions)); err != nil {
			return PartnerAccessibleStorePage{}, err
		}
		item.Permissions = canonicalStorePermissions(item.Permissions)
		if len(page.Stores) == limit {
			page.NextCursor = page.Stores[len(page.Stores)-1].ID
			break
		}
		page.Stores = append(page.Stores, item)
	}
	if err := rows.Err(); err != nil {
		return PartnerAccessibleStorePage{}, err
	}
	return page, nil
}

type PartnerFinanceStore struct {
	ID             string
	Name           string
	PartnerActorID string
}

// Hold the exact ownership/grant facts through the WLT mutation. Revocation,
// suspension and permission changes cannot race a previously resolved scope.
func LockPartnerPayoutStores(ctx context.Context, tx *sql.Tx, actorID string, stores []PartnerFinanceStore) error {
	for _, store := range stores {
		var owner string
		if err := tx.QueryRowContext(ctx, "SELECT partner_actor_id FROM dsh.stores WHERE id=$1 FOR SHARE", store.ID).Scan(&owner); err != nil {
			return err
		}
		if owner != store.PartnerActorID {
			return ErrStoreAccessForbidden
		}
		if owner == actorID {
			continue
		}
		var grantID string
		err := tx.QueryRowContext(ctx, `SELECT id FROM dsh.store_access_grants WHERE store_id=$1 AND delegate_actor_id=$2
			AND state='active' AND 'payout_request'=ANY(permissions) ORDER BY id LIMIT 1 FOR SHARE`, store.ID, actorID).Scan(&grantID)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrStoreAccessForbidden
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// Financial scopes use the same current ownership and active Store grants as
// object authorization. Read and request permissions remain independent.
func ListPartnerFinanceStores(ctx context.Context, db *sql.DB, actorID, permission string) ([]PartnerFinanceStore, error) {
	actorID = strings.TrimSpace(actorID)
	if db == nil || actorID == "" || len(actorID) > 128 || (permission != "finance_read" && permission != "payout_request") {
		return nil, ErrStoreAccessForbidden
	}
	rows, err := db.QueryContext(ctx, `SELECT s.id,s.name,s.partner_actor_id FROM dsh.stores s
		WHERE s.partner_actor_id=$1 OR EXISTS (
			SELECT 1 FROM dsh.store_access_grants g WHERE g.store_id=s.id AND g.delegate_actor_id=$1
			AND g.state='active' AND $2=ANY(g.permissions)) ORDER BY s.id`, actorID, permission)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]PartnerFinanceStore, 0)
	for rows.Next() {
		var store PartnerFinanceStore
		if err := rows.Scan(&store.ID, &store.Name, &store.PartnerActorID); err != nil {
			return nil, err
		}
		result = append(result, store)
	}
	return result, rows.Err()
}

func DecideStoreAccessInvitation(ctx context.Context, db *sql.DB, grantID, delegateActorID, decision, acceptedState string, expectedVersion int, idempotencyKey, correlationID string) (StoreAccessGrant, bool, error) {
	grantID, delegateActorID, decision, acceptedState = strings.TrimSpace(grantID), strings.TrimSpace(delegateActorID), strings.TrimSpace(decision), strings.TrimSpace(acceptedState)
	idempotencyKey, correlationID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if db == nil || grantID == "" || delegateActorID == "" || expectedVersion < 1 || (decision != "accept" && decision != "decline") || (decision == "accept" && acceptedState != "active" && acceptedState != "pending_role_admission" && acceptedState != "pending_partner_activation") || len(idempotencyKey) < 8 || len(correlationID) < 8 {
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
	target := acceptedState
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
	var inviteValid bool
	if err := tx.QueryRowContext(ctx, "SELECT $1 > clock_timestamp()", grant.ExpiresAt).Scan(&inviteValid); err != nil {
		return StoreAccessGrant{}, false, err
	}
	if !inviteValid {
		return StoreAccessGrant{}, false, ErrStoreAccessExpired
	}
	var acceptedAt, declinedAt any
	if decision == "accept" {
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
	return transitionStoreAccessGrant(ctx, db, grantID, ownerActorID, "", targetState, expectedVersion, strings.TrimSpace(idempotencyKey), requestHash, strings.TrimSpace(correlationID), "grant_transition", "grant_state_changed", storeID, false)
}

func UpdateStoreAccessGrantPermissions(ctx context.Context, db *sql.DB, storeID, ownerActorID, grantID string, permissions []string, expectedVersion int, idempotencyKey, correlationID string) (StoreAccessGrant, bool, error) {
	storeID, ownerActorID, grantID = strings.TrimSpace(storeID), strings.TrimSpace(ownerActorID), strings.TrimSpace(grantID)
	idempotencyKey, correlationID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	permissions = canonicalStorePermissions(permissions)
	if db == nil || storeID == "" || ownerActorID == "" || grantID == "" || expectedVersion < 1 || len(permissions) == 0 || len(idempotencyKey) < 8 || len(correlationID) < 8 {
		return StoreAccessGrant{}, false, ErrStoreAccessConflict
	}
	if !validStorePermissionSet(permissions) {
		return StoreAccessGrant{}, false, ErrStoreAccessConflict
	}
	requestHash := HashStoreAccessPermissionsUpdate(storeID, grantID, ownerActorID, permissions, expectedVersion)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreAccessGrant{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "store-access-idem:"+idempotencyKey); err != nil {
		return StoreAccessGrant{}, false, err
	}
	if grant, replayed, err := readStoreAccessReplayTx(ctx, tx, idempotencyKey, requestHash, "grant_permissions_update", ownerActorID); err == nil {
		if grant.StoreID != storeID {
			return StoreAccessGrant{}, false, ErrStoreAccessIdem
		}
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
	if grant.StoreID != storeID || grant.OwnerPartnerActorID != ownerActorID {
		return StoreAccessGrant{}, false, ErrStoreAccessForbidden
	}
	if grant.Version != expectedVersion {
		return StoreAccessGrant{}, false, ErrStoreAccessVersion
	}
	if grant.State != "active" && grant.State != "suspended" && grant.State != "pending_role_admission" && grant.State != "pending_partner_activation" && grant.State != "pending_acceptance" {
		return StoreAccessGrant{}, false, ErrStoreAccessConflict
	}
	if grant.State == "pending_acceptance" {
		var inviteValid bool
		if err := tx.QueryRowContext(ctx, "SELECT $1 > clock_timestamp()", grant.ExpiresAt).Scan(&inviteValid); err != nil {
			return StoreAccessGrant{}, false, err
		}
		if !inviteValid {
			return StoreAccessGrant{}, false, ErrStoreAccessExpired
		}
	}
	if equalStorePermissions(grant.Permissions, permissions) {
		if err := recordStoreAccessMutationTx(ctx, tx, grant, "grant_permissions_update", ownerActorID, idempotencyKey, requestHash, correlationID, "grant_permissions_changed", &grant.State, grant.State, expectedVersion, grant.Version); err != nil {
			return StoreAccessGrant{}, false, err
		}
		if err := tx.Commit(); err != nil {
			return StoreAccessGrant{}, false, err
		}
		return grant, false, nil
	}
	updated, err := readStoreAccessGrantRow(tx.QueryRowContext(ctx, `UPDATE dsh.store_access_grants SET permissions=$2,version=version+1,updated_at=clock_timestamp()
		WHERE id=$1 AND version=$3
		RETURNING id,store_id,(SELECT name FROM dsh.stores WHERE id=store_id),owner_partner_actor_id,delegate_actor_id,permissions,state,version,expires_at,accepted_at,declined_at,revoked_at,created_at,updated_at`, grant.ID, pq.Array(permissions), expectedVersion))
	if err != nil {
		return StoreAccessGrant{}, false, err
	}
	if err := recordStoreAccessMutationTx(ctx, tx, updated, "grant_permissions_update", ownerActorID, idempotencyKey, requestHash, correlationID, "grant_permissions_changed", &grant.State, grant.State, expectedVersion, updated.Version); err != nil {
		return StoreAccessGrant{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StoreAccessGrant{}, false, err
	}
	return updated, false, nil
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
		CASE WHEN g.state='pending_acceptance' AND g.expires_at <= clock_timestamp() THEN 'expired' ELSE g.state END,
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
		CASE WHEN g.state='pending_acceptance' AND g.expires_at <= clock_timestamp() THEN 'expired' ELSE g.state END,
		g.version,g.expires_at,g.accepted_at,g.declined_at,g.revoked_at,g.created_at,g.updated_at
		FROM dsh.store_access_grants g JOIN dsh.stores s ON s.id=g.store_id
		WHERE g.delegate_actor_id=$1 ORDER BY g.created_at DESC,g.id`, delegateActorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanStoreAccessGrantRows(rows)
}

func transitionStoreAccessGrant(ctx context.Context, db *sql.DB, grantID, actingActorID, requiredFrom, targetState string, expectedVersion int, idempotencyKey, requestHash, correlationID, operation, event, requiredStoreID string, ownerOnly bool) (StoreAccessGrant, bool, error) {
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
		if requiredStoreID != "" && grant.StoreID != requiredStoreID {
			return StoreAccessGrant{}, false, ErrStoreAccessForbidden
		}
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
	if requiredStoreID != "" && grant.StoreID != requiredStoreID {
		return StoreAccessGrant{}, false, ErrStoreAccessForbidden
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
	if operation == "role_admission_confirm" && grant.AcceptedAt == nil {
		return StoreAccessGrant{}, false, ErrStoreAccessConflict
	}
	if operation == "partner_activation_confirm" && (grant.AcceptedAt == nil || grant.DelegateActorID != actingActorID) {
		return StoreAccessGrant{}, false, ErrStoreAccessForbidden
	}
	if operation == "grant_transition" {
		legal := (grant.State == "active" && (targetState == "suspended" || targetState == "revoked")) ||
			(grant.State == "suspended" && (targetState == "active" || targetState == "revoked")) ||
			((grant.State == "pending_role_admission" || grant.State == "pending_partner_activation" || grant.State == "pending_acceptance") && targetState == "revoked")
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
		VALUES($1,$2,$3,$4,$5,$6,$7)`, idempotencyKey, requestHash, operation, grant.ID, actingActorID, toState, resultVersion); err != nil {
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

func equalStorePermissions(left, right []string) bool {
	left, right = canonicalStorePermissions(left), canonicalStorePermissions(right)
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

// storeAccessPermissionAllowlist is the bounded canonical permission vocabulary.
// Payout-recipient routing is intentionally absent: it is owner-only authority and
// never a delegable grant. finance_read does not imply payout_request, and
// payout_request never routes a payout recipient.
var storeAccessPermissionAllowlist = map[string]struct{}{
	"orders":           {},
	"catalog":          {},
	"store_operations": {},
	"promotions":       {},
	"finance_read":     {},
	"payout_request":   {},
	"fulfillment":      {},
}

func validStorePermission(permission string) bool {
	_, ok := storeAccessPermissionAllowlist[permission]
	return ok
}

func validStorePermissionSet(permissions []string) bool {
	if len(permissions) == 0 {
		return false
	}
	hasOrders := false
	hasFulfillment := false
	for _, permission := range permissions {
		if !validStorePermission(permission) {
			return false
		}
		if permission == "orders" {
			hasOrders = true
		}
		if permission == "fulfillment" {
			hasFulfillment = true
		}
	}
	return !hasFulfillment || hasOrders
}

// storeGrantHoldsPermissionTx reports whether an active Store grant for the actor
// carries the permission. It runs on the caller's transaction so mutation-time
// authorization observes the same grant truth as the surrounding write.
func storeGrantHoldsPermissionTx(ctx context.Context, tx *sql.Tx, storeID, actorID, permission string) bool {
	if tx == nil || storeID == "" || actorID == "" || !validStorePermission(permission) {
		return false
	}
	var authorized bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM dsh.store_access_grants
		WHERE store_id=$1 AND delegate_actor_id=$2 AND state='active' AND $3=ANY(permissions)
	)`, storeID, actorID, permission).Scan(&authorized); err != nil {
		return false
	}
	return authorized
}
