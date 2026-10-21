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
	"github.com/lib/pq"
)

func TestFreshOwnerManagedStoreTeam(t *testing.T) {
	uri := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if uri == "" {
		t.Skip("isolated PostgreSQL test needs DSH_DATABASE_URL")
	}
	root, err := sql.Open("postgres", uri)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, uri, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		const storeID = "owner_team_store"
		const ownerID = "owner_team_actor"
		const workerID = "owner_team_employee"
		const captainID = "owner_team_captain"
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: storeID, PartnerActorID: ownerID, Name: "متجر اختبار الفريق"})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "foreign_team_store", PartnerActorID: "foreign_team_owner", Name: "متجر منفصل"})

		grant, replayed, err := postgres.CreateStoreAccessInvitationNamed(ctx, db, storeID, ownerID, workerID, "خالد الموظف", []string{"orders"}, "team_staff_idem_01", "team_staff_corr_01")
		if err != nil || replayed || grant.DisplayNameAr != "خالد الموظف" || grant.State != "pending_acceptance" {
			t.Fatalf("member invite: %+v %v %v", grant, replayed, err)
		}
		if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, storeID, workerID, "orders"); !errors.Is(err, postgres.ErrStoreAccessForbidden) {
			t.Fatalf("pending worker got access %v", err)
		}
		listed, err := postgres.ListStoreAccessGrants(ctx, db, storeID, ownerID)
		if err != nil || len(listed) != 1 || listed[0].DisplayNameAr != "خالد الموظف" {
			t.Fatalf("worker readback %+v %v", listed, err)
		}
		duplicate, duplicateReplay, duplicateErr := postgres.CreateStoreAccessInvitationNamed(ctx, db, storeID, ownerID, workerID, "خالد الموظف", []string{"orders"}, "team_staff_idem_01", "team_staff_corr_repeat")
		if duplicateErr != nil || !duplicateReplay || duplicate.ID != grant.ID {
			t.Fatalf("employee creation replay changed identity: %+v replay=%t err=%v", duplicate, duplicateReplay, duplicateErr)
		}
		acceptedEmployee, employeeReplay, employeeErr := postgres.DecideStoreAccessInvitation(ctx, db, grant.ID, workerID, "accept", "active", grant.Version, "team_staff_accept_01", "team_staff_accept_corr")
		if employeeErr != nil || employeeReplay || acceptedEmployee.State != "active" {
			t.Fatalf("employee acceptance: %+v replay=%t err=%v", acceptedEmployee, employeeReplay, employeeErr)
		}
		if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, storeID, workerID, "orders"); err != nil {
			t.Fatalf("active employee cannot use permitted Store action: %v", err)
		}
		if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, storeID, workerID, "finance_read"); !errors.Is(err, postgres.ErrStoreAccessForbidden) {
			t.Fatalf("employee accessed finance without a grant: %v", err)
		}
		if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, "foreign_team_store", workerID, "orders"); !errors.Is(err, postgres.ErrStoreAccessForbidden) {
			t.Fatalf("employee accessed another Store: %v", err)
		}
		suspendedEmployee, _, employeeErr := postgres.TransitionStoreAccessGrant(ctx, db, storeID, ownerID, grant.ID, "suspended", acceptedEmployee.Version, "team_staff_suspend_01", "team_staff_suspend_corr")
		if employeeErr != nil || suspendedEmployee.State != "suspended" {
			t.Fatalf("owner cannot suspend employee: %+v %v", suspendedEmployee, employeeErr)
		}
		if _, _, err := postgres.AuthorizePartnerStoreAction(ctx, db, storeID, workerID, "orders"); !errors.Is(err, postgres.ErrStoreAccessForbidden) {
			t.Fatalf("suspended employee retained access: %v", err)
		}
		revokedEmployee, _, employeeErr := postgres.TransitionStoreAccessGrant(ctx, db, storeID, ownerID, grant.ID, "revoked", suspendedEmployee.Version, "team_staff_revoke_01", "team_staff_revoke_corr")
		if employeeErr != nil || revokedEmployee.State != "revoked" {
			t.Fatalf("owner cannot remove employee: %+v %v", revokedEmployee, employeeErr)
		}
		_, _, err = postgres.CreateStoreAccessInvitationNamed(ctx, db, "foreign_team_store", ownerID, workerID, "خالد", []string{"orders"}, "team_staff_idem_02", "team_staff_corr_02")
		if !errors.Is(err, postgres.ErrStoreAccessForbidden) {
			t.Fatalf("foreign owner invite %v", err)
		}

		token := strings.Repeat("a", 64)
		invited, replayed, err := postgres.CreateTargetedStoreCaptainInvitation(ctx, db, storeID, ownerID, captainID, "محمد الكابتن", token, time.Now().UTC().Add(time.Hour), "team_captain_idem_01", "team_captain_corr_01")
		if err != nil || replayed || invited.InvitedCaptainActorID == nil || *invited.InvitedCaptainActorID != captainID || invited.DisplayNameAr != "محمد الكابتن" {
			t.Fatalf("captain invite %+v %v %v", invited, replayed, err)
		}
		pending, err := postgres.ListCaptainStoreMemberships(ctx, db, captainID)
		if err != nil || len(pending) != 1 || pending[0].ID != invited.ID || pending[0].State != "pending" {
			t.Fatalf("target recipient cannot see invite %+v %v", pending, err)
		}
		wrong, err := postgres.ListCaptainStoreMemberships(ctx, db, "unrelated_captain")
		if err != nil || len(wrong) != 0 {
			t.Fatalf("foreign Captain saw invite %+v %v", wrong, err)
		}
		if _, _, err := postgres.AcceptTargetedStoreCaptainInvitation(ctx, db, invited.ID, "unrelated_captain", "team_wrong_idem_01", "team_wrong_corr_01"); !errors.Is(err, postgres.ErrStoreCaptainMembershipNotFound) {
			t.Fatalf("foreign Captain accepted invite %v", err)
		}
		accepted, replayed, err := postgres.AcceptTargetedStoreCaptainInvitation(ctx, db, invited.ID, captainID, "team_accept_idem_01", "team_accept_corr_01")
		if err != nil || replayed || accepted.State != "active" || accepted.CaptainActorID == nil || *accepted.CaptainActorID != captainID {
			t.Fatalf("captain accept %+v %v %v", accepted, replayed, err)
		}
		if _, _, err := postgres.CreateTargetedStoreCaptainInvitation(ctx, db, storeID, ownerID, captainID, "محمد الكابتن", strings.Repeat("b", 64), time.Now().UTC().Add(time.Hour), "team_captain_new_idem_02", "team_captain_new_corr_02"); !errors.Is(err, postgres.ErrStoreCaptainAlreadyMember) {
			t.Fatalf("duplicate Captain membership %v", err)
		}
		suspended, replayed, err := postgres.TransitionStoreCaptainMembership(ctx, db, storeID, ownerID, invited.ID, "suspended", 2, "team_suspend_idem_01", postgres.HashStoreCaptainMembershipTransition(storeID, invited.ID, ownerID, "suspended", 2), "team_suspend_corr_01")
		if err != nil || replayed || suspended.State != "suspended" {
			t.Fatalf("suspend %+v %v", suspended, err)
		}
		if _, _, err := postgres.CreateTargetedStoreCaptainInvitation(ctx, db, "foreign_team_store", ownerID, captainID, "محمد", strings.Repeat("c", 64), time.Now().UTC().Add(time.Hour), "team_foreign_idem_01", "team_foreign_corr_01"); !errors.Is(err, postgres.ErrStoreCaptainMembershipNotFound) {
			t.Fatalf("foreign owner captain invite %v", err)
		}
	})
}

func TestOwnerTeamUpgradeFrom137PreservesExistingMemberships(t *testing.T) {
	uri := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if uri == "" {
		t.Skip("isolated PostgreSQL test needs DSH_DATABASE_URL")
	}
	root, err := sql.Open("postgres", uri)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, uri, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback() }()
		if _, err := tx.ExecContext(ctx, "CREATE SCHEMA dsh"); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.ExecContext(ctx, "CREATE TABLE dsh.schema_migrations(version integer PRIMARY KEY,name text NOT NULL,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp())"); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 137; i++ {
			if _, err := tx.ExecContext(ctx, migrationSQL[i]); err != nil {
				t.Fatalf("prior migration %d: %v", i+1, err)
			}
			if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.schema_migrations(version,name,sha256) VALUES($1,$2,$3)", records[i].Version, records[i].Name, records[i].SHA256); err != nil {
				t.Fatal(err)
			}
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "prior_team_store", PartnerActorID: "prior_team_owner", Name: "متجر قائم"})
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.store_access_grants(id,store_id,owner_partner_actor_id,delegate_actor_id,permissions,state,version,expires_at) VALUES($1,$2,$3,$4,$5,'pending_acceptance',1,clock_timestamp()+interval '1 day')", "prior_team_employee_grant", "prior_team_store", "prior_team_owner", "prior_team_member", pq.Array([]string{"orders"})); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.store_captain_memberships(id,store_id,partner_actor_id,invitation_token_hash,state,version,expires_at) VALUES($1,$2,$3,$4,'pending',1,clock_timestamp()+interval '1 day')", "prior_team_captain_member", "prior_team_store", "prior_team_owner", strings.Repeat("b", 64)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("upgrade migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		var employeeName, captainName string
		if err := db.QueryRowContext(ctx, "SELECT display_name_ar FROM dsh.store_access_grants WHERE id=$1", "prior_team_employee_grant").Scan(&employeeName); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRowContext(ctx, "SELECT display_name_ar FROM dsh.store_captain_memberships WHERE id=$1", "prior_team_captain_member").Scan(&captainName); err != nil {
			t.Fatal(err)
		}
		if employeeName != "" || captainName != "" {
			t.Fatalf("upgrade changed preexisting labels: employee=%q captain=%q", employeeName, captainName)
		}
	})
}
