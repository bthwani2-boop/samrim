package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestFreshStoreAccessDelegationJourney(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the fresh Store access delegation proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured postgres is not reachable: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply fresh DSH migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify fresh DSH schema: %v", err)
		}

		const storeID = "store_access_journey"
		const ownerActorID = "partner_store_access_owner"
		const delegateActorID = "partner_store_access_delegate"
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: storeID, PartnerActorID: ownerActorID, Name: "متجر اختبار تفويض الوصول"})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "store_access_other", PartnerActorID: "partner_store_access_other", Name: "متجر آخر"})

		grant, replayed, err := postgres.CreateStoreAccessInvitation(ctx, db, storeID, ownerActorID, delegateActorID, []string{"orders", "catalog"}, "idem-access-create-v1", "corr-access-create-v1")
		if err != nil || replayed || grant.State != "pending_acceptance" || grant.AcceptedAt != nil || grant.Version != 1 {
			t.Fatalf("new Store access invitation is not awaiting delegate consent: grant=%+v replayed=%t err=%v", grant, replayed, err)
		}
		if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, storeID, delegateActorID, "orders"); !errors.Is(err, postgres.ErrStoreAccessForbidden) {
			t.Fatalf("delegate received Store access before accepting the invitation: err=%v", err)
		}

		grant, replayed, err = postgres.DecideStoreAccessInvitation(ctx, db, grant.ID, delegateActorID, "accept", "pending_role_admission", 1, "idem-access-accept-v1", "corr-access-accept-v1")
		if err != nil || replayed || grant.State != "pending_role_admission" || grant.AcceptedAt == nil || grant.Version != 2 {
			t.Fatalf("delegate consent was not recorded before role admission: grant=%+v replayed=%t err=%v", grant, replayed, err)
		}
		admissions, err := postgres.ListPendingStoreAccessRoleAdmissions(ctx, db)
		if err != nil || len(admissions) != 1 || admissions[0].ID != grant.ID || admissions[0].AcceptedAt == nil {
			t.Fatalf("operator admission queue omitted the accepted invitation: items=%+v err=%v", admissions, err)
		}
		if eligible, err := postgres.HasPartnerWorkspaceEligibility(ctx, db, delegateActorID); err != nil || !eligible {
			t.Fatalf("accepted invitation did not establish Partner workspace eligibility: eligible=%t err=%v", eligible, err)
		}
		if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, storeID, delegateActorID, "orders"); !errors.Is(err, postgres.ErrStoreAccessForbidden) {
			t.Fatalf("accepted but not admitted delegate received Store access: err=%v", err)
		}

		if _, err := db.ExecContext(ctx, `UPDATE dsh.store_access_grants SET created_at=clock_timestamp()-interval '3 days',expires_at=clock_timestamp()-interval '1 day' WHERE id=$1`, grant.ID); err != nil {
			t.Fatalf("age accepted invitation past its original invitation expiry: %v", err)
		}
		grant, replayed, err = postgres.ConfirmStoreAccessRoleAdmission(ctx, db, grant.ID, "operator_store_access", grant.Version, "idem-access-admit-v1", "corr-access-admit-v1")
		if err != nil || replayed || grant.State != "pending_partner_activation" || grant.Version != 3 {
			t.Fatalf("operator role admission failed after delegate acceptance: grant=%+v replayed=%t err=%v", grant, replayed, err)
		}
		admissions, err = postgres.ListPendingStoreAccessRoleAdmissions(ctx, db)
		if err != nil || len(admissions) != 0 {
			t.Fatalf("role-admitted invitation remains in the operator queue: items=%+v err=%v", admissions, err)
		}
		if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, storeID, delegateActorID, "orders"); !errors.Is(err, postgres.ErrStoreAccessForbidden) {
			t.Fatalf("delegate received Store access before Partner activation: err=%v", err)
		}
		if _, _, err := postgres.ConfirmStoreAccessPartnerActivation(ctx, db, grant.ID, "partner_store_access_impostor", grant.Version, "idem-access-wrong-actor-v1", "corr-access-wrong-actor-v1"); !errors.Is(err, postgres.ErrStoreAccessForbidden) {
			t.Fatalf("another actor activated the delegate's Store access: err=%v", err)
		}

		grant, replayed, err = postgres.ConfirmStoreAccessPartnerActivation(ctx, db, grant.ID, delegateActorID, grant.Version, "idem-access-activate-v1", "corr-access-activate-v1")
		if err != nil || replayed || grant.State != "active" || grant.Version != 4 {
			t.Fatalf("Partner activation failed: grant=%+v replayed=%t err=%v", grant, replayed, err)
		}
		store, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, storeID, delegateActorID, "orders")
		if err != nil || store.ID != storeID {
			t.Fatalf("active delegate could not access the granted Store: store=%+v err=%v", store, err)
		}
		if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, "store_access_other", delegateActorID, "orders"); !errors.Is(err, postgres.ErrStoreAccessForbidden) {
			t.Fatalf("delegate grant leaked to another Store: err=%v", err)
		}
		accessible, err := postgres.ListPartnerAccessibleStores(ctx, db, delegateActorID, 25, "")
		if err != nil || len(accessible.Stores) != 1 || accessible.Stores[0].ID != storeID || accessible.Stores[0].Owned || len(accessible.Stores[0].Permissions) != 2 {
			t.Fatalf("active delegated Store is absent or incorrectly scoped in Partner readback: page=%+v err=%v", accessible, err)
		}

		grant, replayed, err = postgres.TransitionStoreAccessGrant(ctx, db, storeID, ownerActorID, grant.ID, "revoked", grant.Version, "idem-access-revoke-v1", "corr-access-revoke-v1")
		if err != nil || replayed || grant.State != "revoked" || grant.Version != 5 {
			t.Fatalf("owner revocation failed: grant=%+v replayed=%t err=%v", grant, replayed, err)
		}
		if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, storeID, delegateActorID, "orders"); !errors.Is(err, postgres.ErrStoreAccessForbidden) {
			t.Fatalf("revoked delegate retained Store access: err=%v", err)
		}
		accessible, err = postgres.ListPartnerAccessibleStores(ctx, db, delegateActorID, 25, "")
		if err != nil || len(accessible.Stores) != 0 {
			t.Fatalf("revoked Store remains in Partner accessible-Store readback: page=%+v err=%v", accessible, err)
		}
		var auditEvents int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM dsh.store_access_grant_audit WHERE grant_id=$1`, grant.ID).Scan(&auditEvents); err != nil || auditEvents != 5 {
			t.Fatalf("Store access lifecycle audit is incomplete: events=%d err=%v", auditEvents, err)
		}
	})
}

func TestStoreAccessExpandedPermissionAllowlist(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the expanded permission allowlist proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured postgres is not reachable: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply fresh DSH migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify fresh DSH schema: %v", err)
		}

		const storeID = "store_access_expanded"
		const ownerActorID = "partner_expanded_owner"
		const promoteActorID = "partner_expanded_promoter"
		const payoutActorID = "partner_expanded_payout"
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: storeID, PartnerActorID: ownerActorID, Name: "متجر الصلاحيات الموسعة"})

		promoteGrant, replayed, err := postgres.CreateStoreAccessInvitation(ctx, db, storeID, ownerActorID, promoteActorID, []string{"promotions", "catalog"}, "idem-expanded-promote-v1", "corr-expanded-promote-v1")
		if err != nil || replayed {
			t.Fatalf("promotions invitation create failed: replayed=%t err=%v", replayed, err)
		}
		activateGrantDirectly(t, ctx, db, promoteGrant, ownerActorID)
		payoutGrant, replayed, err := postgres.CreateStoreAccessInvitation(ctx, db, storeID, ownerActorID, payoutActorID, []string{"payout_request", "finance_read"}, "idem-expanded-payout-v1", "corr-expanded-payout-v1")
		if err != nil || replayed {
			t.Fatalf("payout invitation create failed: replayed=%t err=%v", replayed, err)
		}
		activateGrantDirectly(t, ctx, db, payoutGrant, ownerActorID)

		if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, storeID, promoteActorID, "promotions"); err != nil {
			t.Fatalf("promotions delegate denied promotion management: err=%v", err)
		}
		if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, storeID, promoteActorID, "finance_read"); !errors.Is(err, postgres.ErrStoreAccessForbidden) {
			t.Fatalf("promotions grant leaked financial read: err=%v", err)
		}
		if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, storeID, payoutActorID, "payout_request"); err != nil {
			t.Fatalf("payout-request delegate denied payout intent: err=%v", err)
		}
		if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, storeID, payoutActorID, "promotions"); !errors.Is(err, postgres.ErrStoreAccessForbidden) {
			t.Fatalf("payout-request grant leaked promotion management: err=%v", err)
		}
		if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, storeID, payoutActorID, "fulfillment"); !errors.Is(err, postgres.ErrStoreAccessForbidden) {
			t.Fatalf("payout-request grant leaked fulfillment: err=%v", err)
		}
		if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, storeID, promoteActorID, "payout_recipient_routing"); !errors.Is(err, postgres.ErrStoreAccessForbidden) {
			t.Fatalf("unknown permission vocabulary accepted by authorization: err=%v", err)
		}
	})
}

// activateGrantDirectly fast-forwards an invitation to an active grant the same way
// the governed lifecycle does, without repeating the full journey proof above.
func activateGrantDirectly(t *testing.T, ctx context.Context, db *sql.DB, grant postgres.StoreAccessGrant, ownerActorID string) {
	t.Helper()
	grant, replayed, err := postgres.DecideStoreAccessInvitation(ctx, db, grant.ID, grant.DelegateActorID, "accept", "pending_role_admission", grant.Version, "idem-"+grant.ID+"-accept", "corr-"+grant.ID+"-accept")
	if err != nil || replayed {
		t.Fatalf("delegate acceptance failed for %s: replayed=%t err=%v", grant.ID, replayed, err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE dsh.store_access_grants SET created_at=clock_timestamp()-interval '3 days',expires_at=clock_timestamp()-interval '1 day' WHERE id=$1`, grant.ID); err != nil {
		t.Fatalf("age invitation for admission: %v", err)
	}
	grant, replayed, err = postgres.ConfirmStoreAccessRoleAdmission(ctx, db, grant.ID, ownerActorID, grant.Version, "idem-"+grant.ID+"-admit", "corr-"+grant.ID+"-admit")
	if err != nil || replayed {
		t.Fatalf("role admission failed for %s: replayed=%t err=%v", grant.ID, replayed, err)
	}
	grant, replayed, err = postgres.ConfirmStoreAccessPartnerActivation(ctx, db, grant.ID, grant.DelegateActorID, grant.Version, "idem-"+grant.ID+"-activate", "corr-"+grant.ID+"-activate")
	if err != nil || replayed || grant.State != "active" {
		t.Fatalf("activation failed for %s: state=%s replayed=%t err=%v", grant.ID, grant.State, replayed, err)
	}
}
