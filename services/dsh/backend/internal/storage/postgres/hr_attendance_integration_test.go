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

func TestHRManualAttendanceIdempotencyCorrectionAndUnknownDays(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("requires isolated DSH_DATABASE_URL; persistent HR records remain protected")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	if err = root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		user, err := hr.Create(ctx, db, hr.CreateInput{
			FullNameAr: "محمد سالم الاختبار", Department: "العمليات", JobTitle: "موظف",
			StartDate: "2026-10-01", WorkLocation: "صنعاء",
		}, "act_hr_root_proof", "hr-create-attendance-proof", "hr-attendance-create-0001")
		if err != nil {
			t.Fatal(err)
		}
		id := user.Employee.ID
		read := func(from, to string) hr.AttendancePage {
			t.Helper()
			a, e := hr.ListAttendance(ctx, db, id, from, to)
			if e != nil {
				t.Fatal(e)
			}
			return a
		}
		if got := read("2026-10-01", "2026-10-31"); len(got.Items) != 0 {
			t.Fatalf("missing attendance must remain unknown: %+v", got)
		}
		day := hr.AttendanceInput{Date: "2026-10-12", Status: "present", Note: "تم التسجيل يدويًا وفق إفادة المسؤول"}
		saved, err := hr.RecordAttendance(ctx, db, id, day, "act_hr_root_proof", "hr-attendance-correlation", "hr-attendance-day-001")
		if err != nil || saved.Record.Version != 1 || saved.IdempotentReplay {
			t.Fatalf("initial attendance rejected: %+v %v", saved, err)
		}
		same, err := hr.RecordAttendance(ctx, db, id, day, "act_hr_root_proof", "hr-attendance-replay-correlation", "hr-attendance-day-001")
		if err != nil || !same.IdempotentReplay || same.Record.Version != 1 {
			t.Fatalf("exact replay duplicated record: %+v %v", same, err)
		}
		other := day
		other.Status = "late"
		_, err = hr.RecordAttendance(ctx, db, id, other, "act_hr_root_proof", "hr-attendance-key-collision", "hr-attendance-day-001")
		if !errors.Is(err, hr.ErrConflict) {
			t.Fatalf("key reuse changed meaning: %v", err)
		}
		_, err = hr.RecordAttendance(ctx, db, id, other, "act_hr_root_proof", "hr-attendance-stale-version", "hr-attendance-day-002")
		if !errors.Is(err, hr.ErrConflict) {
			t.Fatalf("zero version overwrote prior: %v", err)
		}
		overnight := hr.AttendanceInput{
			Date: "2026-10-12", Status: "late", Note: "تصحيح معتمَد من مشرف الموارد البشرية",
			CheckInAt: "2026-10-12T22:00:00+03:00", CheckOutAt: "2026-10-13T06:00:00+03:00", ExpectedVersion: 1,
		}
		corrected, err := hr.RecordAttendance(ctx, db, id, overnight, "act_hr_root_proof", "hr-attendance-correct-correlation", "hr-attendance-day-003")
		if err != nil || corrected.Record.Version != 2 || corrected.Record.CheckOutAt == nil {
			t.Fatalf("overnight correction failed: %+v %v", corrected, err)
		}
		original, err := hr.RecordAttendance(ctx, db, id, day, "act_hr_root_proof", "hr-attendance-old-replay", "hr-attendance-day-001")
		if err != nil || !original.IdempotentReplay || original.Record.Version != 1 {
			t.Fatalf("old replay should return immutable old event: %+v %v", original, err)
		}
		got := read("2026-10-01", "2026-10-31")
		if len(got.Items) != 1 || got.Items[0].Version != 2 || got.Items[0].Status != "late" {
			t.Fatalf("canonical latest record lost correction: %+v", got)
		}
		var events int
		if err = db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.hr_attendance_events WHERE employee_id=$1", id).Scan(&events); err != nil {
			t.Fatal(err)
		}
		if events != 2 {
			t.Fatalf("append-only attendance correction count=%d", events)
		}
		if _, err := hr.ListAttendance(ctx, db, id, "2026-10-01", "2026-12-01"); !errors.Is(err, hr.ErrInvalid) {
			t.Fatalf("unbounded attendance query should be denied: %v", err)
		}
		inactive, err := hr.SetEmploymentStatus(ctx, db, id, hr.EmploymentStatusInput{
			Status: "inactive", Reason: "انتهت العلاقة الوظيفية وتمت الموافقة", ExpectedVersion: user.Employee.Version,
		}, "act_hr_root_proof", "hr-inactive-attendance", "hr-attendance-inactive-0001")
		if err != nil || inactive.Employee.Status != "inactive" {
			t.Fatalf("inactive setup failed: %+v %v", inactive, err)
		}
		_, err = hr.RecordAttendance(ctx, db, id, hr.AttendanceInput{
			Date: "2026-10-13", Status: "absent", Note: "لا يجب تسجيل الغياب تلقائيًا",
		}, "act_hr_root_proof", "hr-inactive-attempt", "hr-attendance-day-004")
		if !errors.Is(err, hr.ErrConflict) {
			t.Fatalf("inactive employee accepted manual attendance: %v", err)
		}
	})
}
