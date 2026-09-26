package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

type StoreCaptainMembership struct {
	ID             string
	StoreID        string
	StoreName      string
	PartnerActorID string
	CaptainActorID *string
	State          string
	Version        int
	ExpiresAt      time.Time
	AcceptedAt     *time.Time
	RevokedAt      *time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

var (
	ErrStoreCaptainMembershipNotFound = errors.New("Store Captain membership was not found")
	ErrStoreCaptainMembershipConflict = errors.New("Store Captain membership state conflicts with the request")
	ErrStoreCaptainMembershipVersion  = errors.New("Store Captain membership version is stale")
	ErrStoreCaptainMembershipIdem     = errors.New("Store Captain membership idempotency key conflicts with previous facts")
	ErrStoreCaptainInvitationExpired  = errors.New("Store Captain invitation has expired")
	ErrStoreCaptainInvitationUsed     = errors.New("Store Captain invitation is no longer actionable")
	ErrStoreCaptainAlreadyMember      = errors.New("Captain is already an active member of this Store")
)

func HashStoreCaptainInvitationCreate(storeID, partnerActorID string) string {
	return hashLocationFacts("store-captain-invitation-create", strings.TrimSpace(storeID), strings.TrimSpace(partnerActorID))
}

func HashStoreCaptainInvitationAccept(tokenHash, captainActorID string) string {
	return hashLocationFacts("store-captain-invitation-accept", strings.TrimSpace(tokenHash), strings.TrimSpace(captainActorID))
}

func HashStoreCaptainMembershipTransition(storeID, membershipID, partnerActorID, state string, expectedVersion int) string {
	return hashLocationFacts("store-captain-membership-transition", strings.TrimSpace(storeID), strings.TrimSpace(membershipID), strings.TrimSpace(partnerActorID), strings.TrimSpace(state), fmt.Sprint(expectedVersion))
}

func CreateStoreCaptainInvitation(ctx context.Context, db *sql.DB, storeID, partnerActorID, tokenHash string, expiresAt time.Time, idempotencyKey, requestHash, correlationID string) (StoreCaptainMembership, bool, error) {
	storeID, partnerActorID = strings.TrimSpace(storeID), strings.TrimSpace(partnerActorID)
	tokenHash, idempotencyKey, requestHash, correlationID = strings.TrimSpace(tokenHash), strings.TrimSpace(idempotencyKey), strings.TrimSpace(requestHash), strings.TrimSpace(correlationID)
	if db == nil || storeID == "" || partnerActorID == "" || len(tokenHash) != 64 || idempotencyKey == "" || requestHash == "" || correlationID == "" || !expiresAt.After(time.Now()) {
		return StoreCaptainMembership{}, false, ErrStoreCaptainMembershipConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreCaptainMembership{}, false, fmt.Errorf("begin Store Captain invitation: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockStoreCaptainMembershipIdempotency(ctx, tx, idempotencyKey); err != nil {
		return StoreCaptainMembership{}, false, err
	}
	if err := verifyStoreCaptainOwnerTx(ctx, tx, storeID, partnerActorID); err != nil {
		return StoreCaptainMembership{}, false, err
	}
	if membership, replayed, err := readStoreCaptainMembershipReplayTx(ctx, tx, idempotencyKey, requestHash, "invitation_create", partnerActorID); err == nil {
		if err := tx.Commit(); err != nil {
			return StoreCaptainMembership{}, false, fmt.Errorf("commit Store Captain invitation replay: %w", err)
		}
		return membership, replayed, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return StoreCaptainMembership{}, false, err
	}

	id, err := newID("store-captain-membership")
	if err != nil {
		return StoreCaptainMembership{}, false, fmt.Errorf("create Store Captain membership id: %w", err)
	}
	var membership StoreCaptainMembership
	err = tx.QueryRowContext(ctx, `INSERT INTO dsh.store_captain_memberships
		(id,store_id,partner_actor_id,invitation_token_hash,state,version,expires_at)
		VALUES($1,$2,$3,$4,'pending',1,$5)
		RETURNING id,store_id,partner_actor_id,captain_actor_id,state,version,expires_at,accepted_at,revoked_at,created_at,updated_at`,
		id, storeID, partnerActorID, tokenHash, expiresAt).Scan(
		&membership.ID, &membership.StoreID, &membership.PartnerActorID, &membership.CaptainActorID,
		&membership.State, &membership.Version, &membership.ExpiresAt, &membership.AcceptedAt, &membership.RevokedAt, &membership.CreatedAt, &membership.UpdatedAt)
	if err != nil {
		return StoreCaptainMembership{}, false, fmt.Errorf("create Store Captain membership invitation: %w", err)
	}
	if err := tx.QueryRowContext(ctx, "SELECT name FROM dsh.stores WHERE id=$1", storeID).Scan(&membership.StoreName); err != nil {
		return StoreCaptainMembership{}, false, fmt.Errorf("read Store name for Captain invitation: %w", err)
	}
	if err := recordStoreCaptainMembershipMutationTx(ctx, tx, membership, "invitation_create", partnerActorID, idempotencyKey, requestHash, correlationID, "invitation_created", nil, "pending", 0, 1); err != nil {
		return StoreCaptainMembership{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StoreCaptainMembership{}, false, fmt.Errorf("commit Store Captain invitation: %w", err)
	}
	return membership, false, nil
}

func AcceptStoreCaptainInvitation(ctx context.Context, db *sql.DB, tokenHash, captainActorID, idempotencyKey, requestHash, correlationID string) (StoreCaptainMembership, bool, error) {
	tokenHash, captainActorID = strings.TrimSpace(tokenHash), strings.TrimSpace(captainActorID)
	idempotencyKey, requestHash, correlationID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(requestHash), strings.TrimSpace(correlationID)
	if db == nil || len(tokenHash) != 64 || captainActorID == "" || idempotencyKey == "" || requestHash == "" || correlationID == "" {
		return StoreCaptainMembership{}, false, ErrStoreCaptainMembershipConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreCaptainMembership{}, false, fmt.Errorf("begin Store Captain invitation acceptance: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockStoreCaptainMembershipIdempotency(ctx, tx, idempotencyKey); err != nil {
		return StoreCaptainMembership{}, false, err
	}
	if membership, replayed, err := readStoreCaptainMembershipReplayTx(ctx, tx, idempotencyKey, requestHash, "invitation_accept", captainActorID); err == nil {
		if err := tx.Commit(); err != nil {
			return StoreCaptainMembership{}, false, fmt.Errorf("commit Store Captain acceptance replay: %w", err)
		}
		return membership, replayed, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return StoreCaptainMembership{}, false, err
	}

	membership, err := readStoreCaptainMembershipByTokenTx(ctx, tx, tokenHash, true)
	if errors.Is(err, sql.ErrNoRows) {
		return StoreCaptainMembership{}, false, ErrStoreCaptainMembershipNotFound
	}
	if err != nil {
		return StoreCaptainMembership{}, false, fmt.Errorf("read Store Captain invitation: %w", err)
	}
	if membership.State == "active" && membership.CaptainActorID != nil && *membership.CaptainActorID == captainActorID {
		if err := insertStoreCaptainMembershipIdempotencyTx(ctx, tx, idempotencyKey, requestHash, "invitation_accept", membership.ID, captainActorID, membership.State, membership.Version); err != nil {
			return StoreCaptainMembership{}, false, err
		}
		if err := tx.Commit(); err != nil {
			return StoreCaptainMembership{}, false, fmt.Errorf("commit Store Captain acceptance replay: %w", err)
		}
		return membership, true, nil
	}
	if membership.State != "pending" {
		return StoreCaptainMembership{}, false, ErrStoreCaptainInvitationUsed
	}
	var expired bool
	if err := tx.QueryRowContext(ctx, "SELECT expires_at <= clock_timestamp() FROM dsh.store_captain_memberships WHERE id=$1", membership.ID).Scan(&expired); err != nil {
		return StoreCaptainMembership{}, false, fmt.Errorf("check Store Captain invitation expiry: %w", err)
	}
	if expired {
		return StoreCaptainMembership{}, false, ErrStoreCaptainInvitationExpired
	}
	var alreadyMember bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM dsh.store_captain_memberships
		WHERE store_id=$1 AND captain_actor_id=$2 AND state IN ('active','suspended') AND id<>$3)`,
		membership.StoreID, captainActorID, membership.ID).Scan(&alreadyMember); err != nil {
		return StoreCaptainMembership{}, false, fmt.Errorf("check existing Store Captain membership: %w", err)
	}
	if alreadyMember {
		return StoreCaptainMembership{}, false, ErrStoreCaptainAlreadyMember
	}
	var accepted StoreCaptainMembership
	err = tx.QueryRowContext(ctx, `UPDATE dsh.store_captain_memberships
		SET captain_actor_id=$2,state='active',version=version+1,accepted_at=clock_timestamp(),updated_at=clock_timestamp()
		WHERE id=$1 AND state='pending' AND version=$3
		RETURNING id,store_id,(SELECT name FROM dsh.stores WHERE id=store_id),partner_actor_id,captain_actor_id,state,version,expires_at,accepted_at,revoked_at,created_at,updated_at`,
		membership.ID, captainActorID, membership.Version).Scan(
		&accepted.ID, &accepted.StoreID, &accepted.StoreName, &accepted.PartnerActorID, &accepted.CaptainActorID,
		&accepted.State, &accepted.Version, &accepted.ExpiresAt, &accepted.AcceptedAt, &accepted.RevokedAt, &accepted.CreatedAt, &accepted.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return StoreCaptainMembership{}, false, ErrStoreCaptainAlreadyMember
		}
		return StoreCaptainMembership{}, false, fmt.Errorf("accept Store Captain invitation: %w", err)
	}
	if err := recordStoreCaptainMembershipMutationTx(ctx, tx, accepted, "invitation_accept", captainActorID, idempotencyKey, requestHash, correlationID, "invitation_accepted", &membership.State, accepted.State, membership.Version, accepted.Version); err != nil {
		return StoreCaptainMembership{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StoreCaptainMembership{}, false, fmt.Errorf("commit Store Captain invitation acceptance: %w", err)
	}
	return accepted, false, nil
}

func ListStoreCaptainMemberships(ctx context.Context, db *sql.DB, storeID, partnerActorID string) ([]StoreCaptainMembership, error) {
	storeID, partnerActorID = strings.TrimSpace(storeID), strings.TrimSpace(partnerActorID)
	if db == nil || storeID == "" || partnerActorID == "" {
		return nil, ErrStoreCaptainMembershipConflict
	}
	var owned bool
	if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.stores WHERE id=$1 AND partner_actor_id=$2)", storeID, partnerActorID).Scan(&owned); err != nil {
		return nil, fmt.Errorf("verify Store Captain membership ownership: %w", err)
	}
	if !owned {
		return nil, ErrStoreCaptainMembershipNotFound
	}
	rows, err := db.QueryContext(ctx, `SELECT m.id,m.store_id,s.name,m.partner_actor_id,m.captain_actor_id,
		CASE WHEN m.state='pending' AND m.expires_at <= clock_timestamp() THEN 'expired' ELSE m.state END,
		m.version,m.expires_at,m.accepted_at,m.revoked_at,m.created_at,m.updated_at
		FROM dsh.store_captain_memberships m JOIN dsh.stores s ON s.id=m.store_id
		WHERE m.store_id=$1 AND m.partner_actor_id=$2 ORDER BY m.created_at DESC,m.id LIMIT 100`, storeID, partnerActorID)
	if err != nil {
		return nil, fmt.Errorf("list Store Captain memberships: %w", err)
	}
	defer rows.Close()
	items := make([]StoreCaptainMembership, 0)
	for rows.Next() {
		membership, err := scanStoreCaptainMembership(rows)
		if err != nil {
			return nil, fmt.Errorf("scan Store Captain membership: %w", err)
		}
		items = append(items, membership)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read Store Captain memberships: %w", err)
	}
	return items, nil
}

func ListCaptainStoreMemberships(ctx context.Context, db *sql.DB, captainActorID string) ([]StoreCaptainMembership, error) {
	captainActorID = strings.TrimSpace(captainActorID)
	if db == nil || captainActorID == "" {
		return nil, ErrStoreCaptainMembershipConflict
	}
	rows, err := db.QueryContext(ctx, `SELECT m.id,m.store_id,s.name,m.partner_actor_id,m.captain_actor_id,m.state,
		m.version,m.expires_at,m.accepted_at,m.revoked_at,m.created_at,m.updated_at
		FROM dsh.store_captain_memberships m JOIN dsh.stores s ON s.id=m.store_id
		WHERE m.captain_actor_id=$1 ORDER BY m.created_at DESC,m.id LIMIT 100`, captainActorID)
	if err != nil {
		return nil, fmt.Errorf("list Captain Store memberships: %w", err)
	}
	defer rows.Close()
	items := make([]StoreCaptainMembership, 0)
	for rows.Next() {
		membership, err := scanStoreCaptainMembership(rows)
		if err != nil {
			return nil, fmt.Errorf("scan Captain Store membership: %w", err)
		}
		items = append(items, membership)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read Captain Store memberships: %w", err)
	}
	return items, nil
}

func TransitionStoreCaptainMembership(ctx context.Context, db *sql.DB, storeID, partnerActorID, membershipID, targetState string, expectedVersion int, idempotencyKey, requestHash, correlationID string) (StoreCaptainMembership, bool, error) {
	storeID, partnerActorID, membershipID = strings.TrimSpace(storeID), strings.TrimSpace(partnerActorID), strings.TrimSpace(membershipID)
	targetState, idempotencyKey, requestHash, correlationID = strings.TrimSpace(targetState), strings.TrimSpace(idempotencyKey), strings.TrimSpace(requestHash), strings.TrimSpace(correlationID)
	if db == nil || storeID == "" || partnerActorID == "" || membershipID == "" || expectedVersion < 1 || idempotencyKey == "" || requestHash == "" || correlationID == "" || (targetState != "active" && targetState != "suspended" && targetState != "revoked") {
		return StoreCaptainMembership{}, false, ErrStoreCaptainMembershipConflict
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreCaptainMembership{}, false, fmt.Errorf("begin Store Captain membership transition: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockStoreCaptainMembershipIdempotency(ctx, tx, idempotencyKey); err != nil {
		return StoreCaptainMembership{}, false, err
	}
	if err := verifyStoreCaptainOwnerTx(ctx, tx, storeID, partnerActorID); err != nil {
		return StoreCaptainMembership{}, false, err
	}
	if membership, replayed, err := readStoreCaptainMembershipReplayTx(ctx, tx, idempotencyKey, requestHash, "membership_transition", partnerActorID); err == nil {
		if membership.StoreID != storeID || membership.ID != membershipID {
			return StoreCaptainMembership{}, false, ErrStoreCaptainMembershipIdem
		}
		if err := tx.Commit(); err != nil {
			return StoreCaptainMembership{}, false, fmt.Errorf("commit Store Captain transition replay: %w", err)
		}
		return membership, replayed, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return StoreCaptainMembership{}, false, err
	}
	var current StoreCaptainMembership
	err = tx.QueryRowContext(ctx, `SELECT id,store_id,(SELECT name FROM dsh.stores WHERE id=store_id),partner_actor_id,captain_actor_id,state,
		version,expires_at,accepted_at,revoked_at,created_at,updated_at
		FROM dsh.store_captain_memberships WHERE id=$1 AND store_id=$2 AND partner_actor_id=$3 FOR UPDATE`, membershipID, storeID, partnerActorID).Scan(
		&current.ID, &current.StoreID, &current.StoreName, &current.PartnerActorID, &current.CaptainActorID,
		&current.State, &current.Version, &current.ExpiresAt, &current.AcceptedAt, &current.RevokedAt, &current.CreatedAt, &current.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return StoreCaptainMembership{}, false, ErrStoreCaptainMembershipNotFound
	}
	if err != nil {
		return StoreCaptainMembership{}, false, fmt.Errorf("read Store Captain membership for transition: %w", err)
	}
	if current.Version != expectedVersion {
		return StoreCaptainMembership{}, false, ErrStoreCaptainMembershipVersion
	}
	if !validStoreCaptainMembershipTransition(current.State, targetState) {
		return StoreCaptainMembership{}, false, ErrStoreCaptainMembershipConflict
	}
	result := current
	if current.State != targetState {
		result, err = transitionStoreCaptainMembershipTx(ctx, tx, current, targetState)
		if err != nil {
			return StoreCaptainMembership{}, false, err
		}
	}
	if current.State == targetState {
		if err := insertStoreCaptainMembershipIdempotencyTx(ctx, tx, idempotencyKey, requestHash, "membership_transition", current.ID, partnerActorID, current.State, current.Version); err != nil {
			return StoreCaptainMembership{}, false, err
		}
	} else if err := recordStoreCaptainMembershipMutationTx(ctx, tx, result, "membership_transition", partnerActorID, idempotencyKey, requestHash, correlationID, "membership_state_changed", &current.State, targetState, current.Version, result.Version); err != nil {
		return StoreCaptainMembership{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StoreCaptainMembership{}, false, fmt.Errorf("commit Store Captain membership transition: %w", err)
	}
	return result, false, nil
}

func validStoreCaptainMembershipTransition(from, to string) bool {
	switch from {
	case "pending":
		return to == "revoked"
	case "active":
		return to == "suspended" || to == "revoked" || to == "active"
	case "suspended":
		return to == "active" || to == "revoked" || to == "suspended"
	default:
		return false
	}
}

func transitionStoreCaptainMembershipTx(ctx context.Context, tx *sql.Tx, current StoreCaptainMembership, targetState string) (StoreCaptainMembership, error) {
	var updated StoreCaptainMembership
	err := tx.QueryRowContext(ctx, `UPDATE dsh.store_captain_memberships
		SET state=$2,version=version+1,revoked_at=CASE WHEN $2='revoked' THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp()
		WHERE id=$1 AND version=$3
		RETURNING id,store_id,(SELECT name FROM dsh.stores WHERE id=store_id),partner_actor_id,captain_actor_id,state,version,expires_at,accepted_at,revoked_at,created_at,updated_at`, current.ID, targetState, current.Version).Scan(
		&updated.ID, &updated.StoreID, &updated.StoreName, &updated.PartnerActorID, &updated.CaptainActorID,
		&updated.State, &updated.Version, &updated.ExpiresAt, &updated.AcceptedAt, &updated.RevokedAt, &updated.CreatedAt, &updated.UpdatedAt)
	if err != nil {
		return StoreCaptainMembership{}, fmt.Errorf("transition Store Captain membership: %w", err)
	}
	return updated, nil
}

type storeCaptainMembershipScanner interface {
	Scan(dest ...any) error
}

func scanStoreCaptainMembership(row storeCaptainMembershipScanner) (StoreCaptainMembership, error) {
	var membership StoreCaptainMembership
	err := row.Scan(&membership.ID, &membership.StoreID, &membership.StoreName, &membership.PartnerActorID, &membership.CaptainActorID,
		&membership.State, &membership.Version, &membership.ExpiresAt, &membership.AcceptedAt, &membership.RevokedAt, &membership.CreatedAt, &membership.UpdatedAt)
	return membership, err
}

func readStoreCaptainMembershipByTokenTx(ctx context.Context, tx *sql.Tx, tokenHash string, forUpdate bool) (StoreCaptainMembership, error) {
	query := `SELECT id,store_id,(SELECT name FROM dsh.stores WHERE id=store_id),partner_actor_id,captain_actor_id,state,
		version,expires_at,accepted_at,revoked_at,created_at,updated_at FROM dsh.store_captain_memberships WHERE invitation_token_hash=$1`
	if forUpdate {
		query += " FOR UPDATE"
	}
	return scanStoreCaptainMembership(tx.QueryRowContext(ctx, query, tokenHash))
}

func readStoreCaptainMembershipReplayTx(ctx context.Context, tx *sql.Tx, key, requestHash, operation, actorID string) (StoreCaptainMembership, bool, error) {
	var membershipID, storedHash, storedOperation, storedActor string
	err := tx.QueryRowContext(ctx, `SELECT membership_id,request_hash,operation,acting_actor_id
		FROM dsh.store_captain_membership_idempotency WHERE idempotency_key=$1 FOR UPDATE`, strings.TrimSpace(key)).Scan(&membershipID, &storedHash, &storedOperation, &storedActor)
	if err != nil {
		return StoreCaptainMembership{}, false, err
	}
	if storedHash != requestHash || storedOperation != operation || storedActor != actorID {
		return StoreCaptainMembership{}, false, ErrStoreCaptainMembershipIdem
	}
	var membership StoreCaptainMembership
	err = tx.QueryRowContext(ctx, `SELECT id,store_id,(SELECT name FROM dsh.stores WHERE id=store_id),partner_actor_id,captain_actor_id,state,
		version,expires_at,accepted_at,revoked_at,created_at,updated_at FROM dsh.store_captain_memberships WHERE id=$1`, membershipID).Scan(
		&membership.ID, &membership.StoreID, &membership.StoreName, &membership.PartnerActorID, &membership.CaptainActorID,
		&membership.State, &membership.Version, &membership.ExpiresAt, &membership.AcceptedAt, &membership.RevokedAt, &membership.CreatedAt, &membership.UpdatedAt)
	if err != nil {
		return StoreCaptainMembership{}, false, err
	}
	return membership, true, nil
}

func lockStoreCaptainMembershipIdempotency(ctx context.Context, tx *sql.Tx, key string) error {
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:store-captain-membership:idempotency:"+strings.TrimSpace(key)); err != nil {
		return fmt.Errorf("lock Store Captain membership idempotency: %w", err)
	}
	return nil
}

func verifyStoreCaptainOwnerTx(ctx context.Context, tx *sql.Tx, storeID, partnerActorID string) error {
	var owned bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.stores WHERE id=$1 AND partner_actor_id=$2)", storeID, partnerActorID).Scan(&owned); err != nil {
		return fmt.Errorf("verify Store Captain membership Store ownership: %w", err)
	}
	if !owned {
		return ErrStoreCaptainMembershipNotFound
	}
	return nil
}

func insertStoreCaptainMembershipIdempotencyTx(ctx context.Context, tx *sql.Tx, key, requestHash, operation, membershipID, actorID, resultState string, resultVersion int) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_captain_membership_idempotency
		(idempotency_key,request_hash,operation,membership_id,acting_actor_id,result_state,result_version)
		VALUES($1,$2,$3,$4,$5,$6,$7)`, key, requestHash, operation, membershipID, actorID, resultState, resultVersion); err != nil {
		return fmt.Errorf("record Store Captain membership idempotency: %w", err)
	}
	return nil
}

func recordStoreCaptainMembershipMutationTx(ctx context.Context, tx *sql.Tx, membership StoreCaptainMembership, operation, actorID, key, requestHash, correlationID, event string, fromState *string, toState string, expectedVersion, resultVersion int) error {
	if err := insertStoreCaptainMembershipIdempotencyTx(ctx, tx, key, requestHash, operation, membership.ID, actorID, toState, resultVersion); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dsh.store_captain_membership_audit
		(event_type,idempotency_key,correlation_id,acting_actor_id,partner_actor_id,store_id,membership_id,from_state,to_state,expected_version,result_version,request_hash)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, event, key, correlationID, actorID, membership.PartnerActorID, membership.StoreID, membership.ID, fromState, toState, expectedVersion, resultVersion, requestHash); err != nil {
		return fmt.Errorf("audit Store Captain membership mutation: %w", err)
	}
	return nil
}
