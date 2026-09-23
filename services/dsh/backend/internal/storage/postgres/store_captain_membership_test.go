package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func verifyStoreCaptainMembership(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()
	const (
		storeID        = "store_captain_membership_v1"
		partnerActorID = "act_partner_membership_v1"
		captainActorID = "act_captain_membership_v1"
		otherPartnerID = "act_other_membership_v1"
	)
	if _, err := db.ExecContext(ctx, "INSERT INTO dsh.stores(id,partner_actor_id,name) VALUES($1,$2,$3)", storeID, partnerActorID, "متجر العضوية"); err != nil {
		t.Fatalf("insert Store Captain membership fixture: %v", err)
	}

	firstTokenHash := strings.Repeat("a", 64)
	createHash := postgres.HashStoreCaptainInvitationCreate(storeID, partnerActorID)
	first, replayed, err := postgres.CreateStoreCaptainInvitation(ctx, db, storeID, partnerActorID, firstTokenHash, time.Now().Add(time.Hour), "idem-membership-create-v1", createHash, "corr-membership-create-v1")
	requireStoreCaptainMembershipResult(t, first, replayed, err, false, "pending", 1)
	createReplay, replayed, err := postgres.CreateStoreCaptainInvitation(ctx, db, storeID, partnerActorID, strings.Repeat("b", 64), time.Now().Add(2*time.Hour), "idem-membership-create-v1", createHash, "corr-membership-create-replay-v1")
	requireStoreCaptainMembershipResult(t, createReplay, replayed, err, true, "pending", 1)
	if createReplay.ID != first.ID || createReplay.StoreName != "متجر العضوية" {
		t.Fatalf("Store Captain invitation replay lost its canonical record: %+v", createReplay)
	}
	if _, err := postgres.ListStoreCaptainMemberships(ctx, db, storeID, otherPartnerID); !errors.Is(err, postgres.ErrStoreCaptainMembershipNotFound) {
		t.Fatalf("foreign partner could read Store Captain membership, error=%v", err)
	}

	acceptHash := postgres.HashStoreCaptainInvitationAccept(firstTokenHash, captainActorID)
	accepted, replayed, err := postgres.AcceptStoreCaptainInvitation(ctx, db, firstTokenHash, captainActorID, "idem-membership-accept-v1", acceptHash, "corr-membership-accept-v1")
	requireStoreCaptainMembershipResult(t, accepted, replayed, err, false, "active", 2)
	if accepted.CaptainActorID == nil || *accepted.CaptainActorID != captainActorID || accepted.AcceptedAt == nil {
		t.Fatalf("accepted Store Captain membership did not bind the canonical actor: %+v", accepted)
	}
	acceptedReplay, replayed, err := postgres.AcceptStoreCaptainInvitation(ctx, db, firstTokenHash, captainActorID, "idem-membership-accept-v1", acceptHash, "corr-membership-accept-replay-v1")
	requireStoreCaptainMembershipResult(t, acceptedReplay, replayed, err, true, "active", 2)

	owned, err := postgres.ListCaptainStoreMemberships(ctx, db, captainActorID)
	if err != nil || len(owned) != 1 || owned[0].ID != first.ID {
		t.Fatalf("Captain Store membership readback failed: %+v err=%v", owned, err)
	}

	secondTokenHash := strings.Repeat("d", 64)
	second, replayed, err := postgres.CreateStoreCaptainInvitation(ctx, db, storeID, partnerActorID, secondTokenHash, time.Now().Add(time.Hour), "idem-membership-create-v2", createHash, "corr-membership-create-v2")
	requireStoreCaptainMembershipResult(t, second, replayed, err, false, "pending", 1)
	if _, _, err := postgres.AcceptStoreCaptainInvitation(ctx, db, secondTokenHash, captainActorID, "idem-membership-accept-v2", postgres.HashStoreCaptainInvitationAccept(secondTokenHash, captainActorID), "corr-membership-accept-v2"); !errors.Is(err, postgres.ErrStoreCaptainAlreadyMember) {
		t.Fatalf("duplicate current Store membership was accepted: %v", err)
	}
	if _, err := db.ExecContext(ctx, "UPDATE dsh.store_captain_memberships SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", second.ID); err != nil {
		t.Fatalf("expire Store Captain invitation fixture: %v", err)
	}
	items, err := postgres.ListStoreCaptainMemberships(ctx, db, storeID, partnerActorID)
	if err != nil || len(items) != 2 || items[0].State != "expired" {
		t.Fatalf("expired invitation readback failed: %+v err=%v", items, err)
	}
	if _, _, err := postgres.AcceptStoreCaptainInvitation(ctx, db, secondTokenHash, captainActorID, "idem-membership-accept-expired-v1", postgres.HashStoreCaptainInvitationAccept(secondTokenHash, captainActorID), "corr-membership-accept-expired-v1"); !errors.Is(err, postgres.ErrStoreCaptainInvitationExpired) {
		t.Fatalf("expired Store Captain invitation was accepted: %v", err)
	}
	second, replayed, err = postgres.TransitionStoreCaptainMembership(ctx, db, storeID, partnerActorID, second.ID, "revoked", 1, "idem-membership-revoke-expired-v1", postgres.HashStoreCaptainMembershipTransition(storeID, second.ID, partnerActorID, "revoked", 1), "corr-membership-revoke-expired-v1")
	requireStoreCaptainMembershipResult(t, second, replayed, err, false, "revoked", 2)

	suspended, replayed, err := postgres.TransitionStoreCaptainMembership(ctx, db, storeID, partnerActorID, first.ID, "suspended", 2, "idem-membership-suspend-v1", postgres.HashStoreCaptainMembershipTransition(storeID, first.ID, partnerActorID, "suspended", 2), "corr-membership-suspend-v1")
	requireStoreCaptainMembershipResult(t, suspended, replayed, err, false, "suspended", 3)
	suspendReplay, replayed, err := postgres.TransitionStoreCaptainMembership(ctx, db, storeID, partnerActorID, first.ID, "suspended", 2, "idem-membership-suspend-v1", postgres.HashStoreCaptainMembershipTransition(storeID, first.ID, partnerActorID, "suspended", 2), "corr-membership-suspend-replay-v1")
	requireStoreCaptainMembershipResult(t, suspendReplay, replayed, err, true, "suspended", 3)
	if _, _, err := postgres.TransitionStoreCaptainMembership(ctx, db, storeID, partnerActorID, first.ID, "active", 2, "idem-membership-stale-v1", postgres.HashStoreCaptainMembershipTransition(storeID, first.ID, partnerActorID, "active", 2), "corr-membership-stale-v1"); !errors.Is(err, postgres.ErrStoreCaptainMembershipVersion) {
		t.Fatalf("stale Store Captain membership version was accepted: %v", err)
	}
	active, replayed, err := postgres.TransitionStoreCaptainMembership(ctx, db, storeID, partnerActorID, first.ID, "active", 3, "idem-membership-reactivate-v1", postgres.HashStoreCaptainMembershipTransition(storeID, first.ID, partnerActorID, "active", 3), "corr-membership-reactivate-v1")
	requireStoreCaptainMembershipResult(t, active, replayed, err, false, "active", 4)
	revoked, replayed, err := postgres.TransitionStoreCaptainMembership(ctx, db, storeID, partnerActorID, first.ID, "revoked", 4, "idem-membership-revoke-v1", postgres.HashStoreCaptainMembershipTransition(storeID, first.ID, partnerActorID, "revoked", 4), "corr-membership-revoke-v1")
	requireStoreCaptainMembershipResult(t, revoked, replayed, err, false, "revoked", 5)

	var audits int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.store_captain_membership_audit WHERE store_id=$1", storeID).Scan(&audits); err != nil || audits != 7 {
		t.Fatalf("Store Captain membership audit count mismatch: got=%d err=%v", audits, err)
	}
}

func requireStoreCaptainMembershipResult(t *testing.T, membership postgres.StoreCaptainMembership, replayed bool, err error, wantReplay bool, wantState string, wantVersion int) {
	t.Helper()
	if err != nil || replayed != wantReplay || membership.ID == "" || membership.State != wantState || membership.Version != wantVersion {
		t.Fatalf("Store Captain membership result mismatch: membership=%+v replayed=%t err=%v", membership, replayed, err)
	}
}
