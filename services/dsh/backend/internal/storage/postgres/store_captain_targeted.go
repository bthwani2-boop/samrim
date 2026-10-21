package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// A store-targeted Captain invitation is not a platform admission.
// The canonical Captain actor must accept before the relationship is active.
func HashStoreCaptainTargetedInvitation(storeID, ownerID, captainID, displayName string) string {
	return hashLocationFacts("store-captain-targeted-invite", storeID, ownerID, captainID, strings.TrimSpace(displayName))
}

func CreateTargetedStoreCaptainInvitation(ctx context.Context, db *sql.DB, storeID, ownerID, invitedCaptainID, displayNameAr, tokenHash string, expiresAt time.Time, idempotencyKey, correlationID string) (StoreCaptainMembership, bool, error) {
	storeID, ownerID, invitedCaptainID = strings.TrimSpace(storeID), strings.TrimSpace(ownerID), strings.TrimSpace(invitedCaptainID)
	displayNameAr = strings.TrimSpace(displayNameAr)
	if db == nil || storeID == "" || ownerID == "" || invitedCaptainID == "" || len([]rune(displayNameAr)) == 0 || len([]rune(displayNameAr)) > 80 || len(tokenHash) != 64 || len(idempotencyKey) < 8 || len(correlationID) < 8 || !expiresAt.After(time.Now()) {
		return StoreCaptainMembership{}, false, ErrStoreCaptainMembershipConflict
	}
	requestHash := HashStoreCaptainTargetedInvitation(storeID, ownerID, invitedCaptainID, displayNameAr)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return StoreCaptainMembership{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockStoreCaptainMembershipIdempotency(ctx, tx, idempotencyKey); err != nil {
		return StoreCaptainMembership{}, false, err
	}
	if err := verifyStoreCaptainOwnerTx(ctx, tx, storeID, ownerID); err != nil {
		return StoreCaptainMembership{}, false, err
	}
	if item, replayed, err := readStoreCaptainMembershipReplayTx(ctx, tx, idempotencyKey, requestHash, "invitation_create", ownerID); err == nil {
		if item.StoreID != storeID || item.InvitedCaptainActorID == nil || *item.InvitedCaptainActorID != invitedCaptainID {
			return StoreCaptainMembership{}, false, ErrStoreCaptainMembershipIdem
		}
		if err := tx.Commit(); err != nil {
			return StoreCaptainMembership{}, false, err
		}
		return item, replayed, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return StoreCaptainMembership{}, false, err
	}
	// A recipient cannot have two actionable memberships for the same Store.
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:store-captain-pair:"+storeID+":"+invitedCaptainID); err != nil {
		return StoreCaptainMembership{}, false, err
	}

	var duplicate bool
	err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM dsh.store_captain_memberships WHERE store_id=$1 AND ((invited_captain_actor_id=$2 AND state='pending' AND expires_at>clock_timestamp()) OR (captain_actor_id=$2 AND state IN ('active','suspended'))))", storeID, invitedCaptainID).Scan(&duplicate)
	if err != nil {
		return StoreCaptainMembership{}, false, err
	}
	if duplicate {
		return StoreCaptainMembership{}, false, ErrStoreCaptainAlreadyMember
	}
	id, err := newID("store-captain-membership")
	if err != nil {
		return StoreCaptainMembership{}, false, err
	}
	item, err := scanStoreCaptainMembership(tx.QueryRowContext(ctx,
		"INSERT INTO dsh.store_captain_memberships (id,store_id,partner_actor_id,invitation_token_hash,state,version,expires_at,invited_captain_actor_id,display_name_ar) "+
			"VALUES($1,$2,$3,$4,'pending',1,$5,$6,$7) RETURNING id,store_id,(SELECT name FROM dsh.stores WHERE id=store_id),partner_actor_id,captain_actor_id,state,version,expires_at,accepted_at,revoked_at,created_at,updated_at,invited_captain_actor_id,display_name_ar",
		id, storeID, ownerID, tokenHash, expiresAt, invitedCaptainID, displayNameAr))
	if err != nil {
		return StoreCaptainMembership{}, false, fmt.Errorf("create targeted Store Captain invite: %w", err)
	}
	if err := recordStoreCaptainMembershipMutationTx(ctx, tx, item, "invitation_create", ownerID, idempotencyKey, requestHash, correlationID, "invitation_created", nil, "pending", 0, 1); err != nil {
		return StoreCaptainMembership{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return StoreCaptainMembership{}, false, err
	}
	return item, false, nil
}

func AcceptTargetedStoreCaptainInvitation(ctx context.Context, db *sql.DB, membershipID, captainActorID, idempotencyKey, correlationID string) (StoreCaptainMembership, bool, error) {
	if db == nil || strings.TrimSpace(membershipID) == "" || strings.TrimSpace(captainActorID) == "" {
		return StoreCaptainMembership{}, false, ErrStoreCaptainMembershipConflict
	}
	// Only the logged-in canonical recipient can resolve the private token hash.
	// AcceptStoreCaptainInvitation locks the row and rechecks the recipient.
	var tokenHash string
	err := db.QueryRowContext(ctx, "SELECT invitation_token_hash FROM dsh.store_captain_memberships WHERE id=$1 AND invited_captain_actor_id=$2 AND state='pending'", membershipID, captainActorID).Scan(&tokenHash)
	if errors.Is(err, sql.ErrNoRows) {
		return StoreCaptainMembership{}, false, ErrStoreCaptainMembershipNotFound
	}
	if err != nil {
		return StoreCaptainMembership{}, false, err
	}
	requestHash := HashStoreCaptainInvitationAccept(tokenHash, captainActorID)
	return AcceptStoreCaptainInvitation(ctx, db, tokenHash, captainActorID, idempotencyKey, requestHash, correlationID)
}
