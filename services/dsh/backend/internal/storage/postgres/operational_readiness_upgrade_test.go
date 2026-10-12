package postgres_test

import (
	"context"
	"database/sql"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/hr"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestOperationalReadinessUpgradePreservesExistingEmployee(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("DSH_DATABASE_URL is required for isolated readiness upgrade proof")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, scripts []string) {
		if err := applyMigrationPrefix(ctx, db, records, scripts, 119); err != nil {
			t.Fatal(err)
		}
		created, err := hr.Create(ctx, db, hr.CreateInput{FullNameAr: "موظف الترقية المحفوظ", Department: "العمليات", JobTitle: "موظف", StartDate: "2026-10-01", WorkLocation: "صنعاء"}, "act_upgrade_proof", "upgrade-create-employee", "upgrade-employee-001")
		if err != nil {
			t.Fatal(err)
		}
		before, err := hr.Read(ctx, db, created.Employee.ID)
		if err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifyOperationalReadiness(ctx, db, records); err == nil {
			t.Fatal("old schema was incorrectly reported ready")
		}
		if err := postgres.Migrate(ctx, db, records, scripts, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifyOperationalReadiness(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		after, err := hr.Read(ctx, db, before.ID)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(before, after) {
			t.Fatal("upgrade changed the existing employee")
		}
		attendance, err := hr.ListAttendance(ctx, db, before.ID, "2026-10-01", "2026-10-31")
		if err != nil || len(attendance.Items) != 0 {
			t.Fatalf("upgrade manufactured attendance: count=%d error=%v", len(attendance.Items), err)
		}
		if err := postgres.Migrate(ctx, db, records, scripts, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("migration replay: %v", err)
		}
	})
}
