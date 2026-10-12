package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/hr"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// Prove HR/Identity provisioning recovery and stale employee denial against an
// isolated disposable database. Never mutate the persistent local HR directory.
func TestHROperatorAccessProvisioningAtomicityAndRecovery(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated DSH_DATABASE_URL is required")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	if err := root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, scripts []string) {
		if err := postgres.Migrate(ctx, db, records, scripts, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		actor := "act_hr_root_proof"
		create := func(phone, name string) hr.CreateResult {
			t.Helper()
			out, err := hr.Create(ctx, db, hr.CreateInput{
				FullNameAr: name, PhoneE164: phone, Department: "العمليات", JobTitle: "مشرف",
				StartDate: "2026-10-12", WorkLocation: "صنعاء",
			}, actor, "hr-correlation-create", "hr-create-"+phone)
			if err != nil {
				t.Fatal(err)
			}
			return out
		}
		request := func(id, phone string) hr.AccessRequestResult {
			t.Helper()
			out, err := hr.CreateAccessRequest(ctx, db, hr.AccessRequestInput{
				EmployeeID: id, Reason: "مراجعة العمليات المعتمدة", RequestedPermissions: []string{"operations"},
			}, actor, "hr-correlation-request", "hr-request-"+phone)
			if err != nil {
				t.Fatal(err)
			}
			return out
		}
		claim := func(req hr.AccessRequestResult) {
			t.Helper()
			_, err := hr.DecideAccessRequest(ctx, db, req.Request.ID, "identity_provisioning", "",
				req.Request.Version, actor, "hr-correlation-provision", "hr-provision-"+req.Request.ID)
			if err != nil {
				t.Fatal(err)
			}
		}
		// Race: employment cannot be disabled while HR admission has been claimed.
		first := create("+967777111222", "أحمد صالح")
		req := request(first.Employee.ID, "first")
		claim(req)
		_, err = hr.SetEmploymentStatus(ctx, db, first.Employee.ID, hr.EmploymentStatusInput{
			Status: "inactive", Reason: "قرار فصل موظف", ExpectedVersion: first.Employee.Version,
		}, actor, "hr-correlation-inactive", "hr-inactive-first")
		if !errors.Is(err, hr.ErrConflict) {
			t.Fatalf("pending HR access must block offboarding: %v", err)
		}
		altered := hr.CreateInput{
			FullNameAr: first.Employee.FullNameAr, PhoneE164: "+967777111224",
			Department: first.Employee.Department, JobTitle: first.Employee.JobTitle,
			StartDate: first.Employee.StartDate, WorkLocation: first.Employee.WorkLocation,
		}
		_, err = hr.Update(ctx, db, first.Employee.ID, hr.UpdateInput{CreateInput: altered, ExpectedVersion: first.Employee.Version},
			actor, "hr-correlation-update", "hr-update-first")
		if !errors.Is(err, hr.ErrConflict) {
			t.Fatalf("HR identity changes must be blocked during admission: %v", err)
		}

		const profile = "oprof_hr_atomicity_proof"
		linked, err := hr.LinkAccessRequest(ctx, db, req.Request.ID, profile, actor,
			"hr-correlation-link", "hr-link-"+req.Request.ID)
		if err != nil {
			t.Fatal(err)
		}
		if linked.Request.OperatorProfileID != profile || linked.Request.State != "identity_profile_created" {
			t.Fatalf("wrong canonical linked state: %+v", linked.Request)
		}
		replay, err := hr.LinkAccessRequest(ctx, db, req.Request.ID, profile, actor,
			"hr-correlation-link-retry", "hr-link-"+req.Request.ID)
		if err != nil || !replay.IdempotentReplay || replay.Request.OperatorProfileID != profile {
			t.Fatalf("link replay must preserve same profile: %+v %v", replay, err)
		}
		_, err = hr.LinkAccessRequest(ctx, db, req.Request.ID, "oprof_conflicting", actor,
			"hr-correlation-link-conflict", "hr-link-"+req.Request.ID)
		if !errors.Is(err, hr.ErrConflict) {
			t.Fatalf("same key with different profile must conflict: %v", err)
		}
		_, err = hr.LinkAccessRequest(ctx, db, req.Request.ID, "oprof_conflicting", actor,
			"hr-correlation-link-conflict", "hr-second-profile")
		if !errors.Is(err, hr.ErrConflict) {
			t.Fatalf("second profile must not attach to admitted request: %v", err)
		}

		// Fault injection in the disposable database: bypass normal HR write guards
		// to emulate stale external data arriving between claim and Identity success.
		second := create("+967777111223", "محمد علي")
		secondReq := request(second.Employee.ID, "second")
		claim(secondReq)
		if _, err = db.ExecContext(ctx, "UPDATE dsh.hr_employees SET job_title='مسمى معدل' WHERE id=$1", second.Employee.ID); err != nil {
			t.Fatal(err)
		}
		_, err = hr.LinkAccessRequest(ctx, db, secondReq.Request.ID, "oprof_stale_proof", actor,
			"hr-correlation-link-stale", "hr-link-"+secondReq.Request.ID)
		if !errors.Is(err, hr.ErrConflict) {
			t.Fatalf("stale employee snapshot must reject profile link: %v", err)
		}
		canonical, err := hr.ReadAccessRequest(ctx, db, secondReq.Request.ID)
		if err != nil {
			t.Fatal(err)
		}
		if canonical.State != "identity_provisioning" || canonical.OperatorProfileID != "" {
			t.Fatalf("failed link must not commit partial association: %+v", canonical)
		}

		third := create("+967777111225", "خالد محمد")
		thirdReq := request(third.Employee.ID, "third")
		if _, err = db.ExecContext(ctx, "UPDATE dsh.hr_employees SET full_name_ar='اسم مختلف' WHERE id=$1", third.Employee.ID); err != nil {
			t.Fatal(err)
		}
		_, err = hr.DecideAccessRequest(ctx, db, thirdReq.Request.ID, "identity_provisioning", "",
			thirdReq.Request.Version, actor, "hr-correlation-stale-claim", "hr-provision-"+thirdReq.Request.ID)
		if !errors.Is(err, hr.ErrConflict) {
			t.Fatalf("stale HR request must not be claimed: %v", err)
		}
		pending, err := hr.ReadAccessRequest(ctx, db, thirdReq.Request.ID)
		if err != nil || pending.State != "pending_review" {
			t.Fatalf("stale claim must retain recoverable pending state: %+v %v", pending, err)
		}
	})
}
