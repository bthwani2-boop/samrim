package captainstanding

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// Runs only against session-02's explicitly isolated, disposable PostgreSQL.
// It never accepts the project's retained Docker DB, protected schemas, or
// a remote or production-like DSN. No tests use developer real accounts.
func TestCaptainStandingRealPostgresOwnerLifecycle(t *testing.T) {
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		t.Skip("NOT_RUN: dedicated isolated Captain PostgreSQL test not enabled")
	}
	dsn := os.Getenv("BTHWANI_CAPTAIN_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("NOT_RUN: dedicated isolated Captain PostgreSQL URL not configured")
	}
	if !isolatedCaptainTestDSN(dsn, os.Getenv("BTHWANI_CAPTAIN_TEST_CONTAINER"),
		os.Getenv("PGHOSTADDR")) {
		t.Fatal("refusing any database other than dedicated ephemeral session-02 PostgreSQL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(8)
	if err = db.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	var databaseName string
	if err = db.QueryRowContext(ctx, "SELECT current_database()").Scan(&databaseName); err != nil || databaseName != "refoundation_captain_agent02" {
		t.Fatal("dedicated disposable database identity not confirmed")
	}
	random := make([]byte, 5)
	if _, err = rand.Read(random); err != nil {
		t.Fatal(err)
	}
	schema := "dsh_test_captain_s02_" + hex.EncodeToString(random)
	for _, migration := range []string{
		"001_public_discovery.sql",
		"002_store_orderability.sql",
		"003_service_city_timezone.sql",
		"004_store_availability_city_limits.sql",
		"005_store_operational_policy_commands.sql",
		"006_captain_standing.sql",
	} {
		sqlBytes, e := os.ReadFile(filepath.Join("..", "..", "..", "database", "migrations", migration))
		if e != nil {
			t.Fatal(e)
		}
		if _, e = db.ExecContext(ctx, strings.ReplaceAll(string(sqlBytes), "__SCHEMA__", schema)); e != nil {
			t.Fatalf("DSH Captain migration %s failed: %v", migration, e)
		}
	}
	repo, err := NewPostgresRepository(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	identity := &fakeIdentity{actor: Actor{ID: "captain-approved-s02", Role: "customer"}}
	svc := NewService(identity, repo)
	pending, err := svc.Apply(ctx, "verified-customer-opaque")
	if err != nil || pending.Status != Pending || pending.Version != 1 {
		t.Fatalf("application: %+v %v", pending, err)
	}
	again, err := svc.Apply(ctx, "verified-customer-opaque")
	if err != nil || again != pending {
		t.Fatalf("application replay: %+v %v", again, err)
	}
	if _, err = svc.ReadSelf(ctx, "verified-customer-opaque", "customer"); !errors.Is(err, ErrNotEligible) {
		t.Fatalf("pending Captain got privilege: %v", err)
	}
	identity.actor = Actor{ID: "operations-reviewer-s02", Role: "operator"}
	approve := Change{ActorID: pending.ActorID, Status: Approved, ExpectedVersion: 1,
		OperationID: "captain-approve-001", Reason: "synthetic reviewed onboarding"}
	if _, err = svc.Change(ctx, "operator-opaque", approve); !errors.Is(err, ErrForbidden) {
		t.Fatalf("operator role without operations permission approved: %v", err)
	}
	identity.allow = true
	approved, err := svc.Change(ctx, "operator-opaque", approve)
	if err != nil || approved.Status != Approved || approved.Version != 2 {
		t.Fatalf("review: %+v %v", approved, err)
	}
	replay, err := svc.Change(ctx, "operator-opaque", approve)
	if err != nil || replay != approved {
		t.Fatalf("approval idempotent replay: %+v %v", replay, err)
	}
	changed := approve
	changed.Reason = "conflicting operator request"
	if _, err = svc.Change(ctx, "operator-opaque", changed); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("reused key with other payload accepted: %v", err)
	}
	suspend := Change{ActorID: pending.ActorID, Status: Suspended, ExpectedVersion: 2,
		OperationID: "captain-suspend-001", Reason: "synthetic test suspension"}
	stopped, err := svc.Change(ctx, "operator-opaque", suspend)
	if err != nil || stopped.Status != Suspended || stopped.Version != 3 {
		t.Fatalf("suspension: %+v %v", stopped, err)
	}
	oldReplay, err := svc.Change(ctx, "operator-opaque", approve)
	if err != nil || oldReplay != approved {
		t.Fatalf("old replay returned newer status: %+v %v", oldReplay, err)
	}
	identity.actor = Actor{ID: pending.ActorID, Role: "captain"}
	if _, err = svc.ReadSelf(ctx, "captain-role-opaque", "captain"); !errors.Is(err, ErrNotEligible) {
		t.Fatalf("suspended captain still had DSH operational access: %v", err)
	}
	independent, e := sql.Open("postgres", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer independent.Close()
	independentRepo, e := NewPostgresRepository(independent, schema)
	if e != nil {
		t.Fatal(e)
	}
	durable, e := independentRepo.Read(ctx, pending.ActorID)
	if e != nil || durable != stopped {
		t.Fatalf("independent PostgreSQL readback: %+v %v", durable, e)
	}
	var auditCount, commandsCount int
	queryBase := fmt.Sprintf("%s.", schema)
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM "+queryBase+"captain_standing_audit WHERE actor_id=$1", pending.ActorID).Scan(&auditCount); err != nil || auditCount != 2 {
		t.Fatalf("exactly-once audit: count=%d err=%v", auditCount, err)
	}
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM "+queryBase+"captain_standing_commands WHERE actor_id=$1", pending.ActorID).Scan(&commandsCount); err != nil || commandsCount != 2 {
		t.Fatalf("exactly-once command log: count=%d err=%v", commandsCount, err)
	}
	if _, err = db.ExecContext(ctx, "DELETE FROM "+queryBase+"captain_standing_audit WHERE actor_id=$1", pending.ActorID); err == nil {
		t.Fatal("immutable Captain audit deletion succeeded")
	}
	if _, err = db.ExecContext(ctx, "DELETE FROM "+queryBase+"captain_standing WHERE actor_id=$1", pending.ActorID); err == nil {
		t.Fatal("retained Captain standing was deleted")
	}

	racer, err := repo.Apply(ctx, "captain-race-s02")
	if err != nil || racer.Version != 1 {
		t.Fatalf("concurrency fixture: %+v %v", racer, err)
	}
	var result [2]error
	var wg sync.WaitGroup
	for i, status := range []Status{Approved, Suspended} {
		wg.Add(1)
		go func(index int, action Status) {
			defer wg.Done()
			_, result[index] = repo.Change(ctx, Change{
				ActorID: racer.ActorID, Status: action, ExpectedVersion: 1,
				OperationID: fmt.Sprintf("captain-race-%03d", index), Reason: "synthetic simultaneous review",
				ActingActorID: "operations-reviewer-s02",
			})
		}(i, status)
	}
	wg.Wait()
	success, conflict := 0, 0
	for _, e := range result {
		if e == nil {
			success++
		} else if errors.Is(e, ErrVersionConflict) {
			conflict++
		} else {
			t.Fatalf("unexpected concurrent owner error: %v", e)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("concurrent writes not serialized: %+v", result)
	}
	var raceAudit int
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM "+queryBase+"captain_standing_audit WHERE actor_id=$1", racer.ActorID).Scan(&raceAudit); err != nil || raceAudit != 1 {
		t.Fatalf("concurrent audit count=%d err=%v", raceAudit, err)
	}
}

// isolatedCaptainTestDSN validates the actual endpoint selected by lib/pq.
// A URL's host alone is insufficient: lib/pq also accepts PGHOSTADDR and
// hostaddr, which may override its network destination. Reject all ambient
// address overrides and unexpected connection options before any SQL executes.
func isolatedCaptainTestDSN(raw, testContainer, pgHostAddr string) bool {
	if pgHostAddr != "" {
		return false
	}
	uri, err := url.Parse(raw)
	if err != nil || uri == nil || uri.Scheme != "postgres" ||
		uri.User == nil || uri.User.Username() != "bt_cap_s02" ||
		uri.Path != "/refoundation_captain_agent02" ||
		uri.Fragment != "" || uri.Opaque != "" {
		return false
	}
	windowsOnly := uri.Host == "127.0.0.1:35327" && testContainer == ""
	insideOwnContainer := uri.Host == "127.0.0.1:5432" &&
		testContainer == "bthwani-session02-captain-pg"
	if !windowsOnly && !insideOwnContainer {
		return false
	}
	params := uri.Query()
	// Refuse hostaddr (including duplicate or encoded forms), service and
	// options so a validated URI cannot secretly switch host or search path.
	return len(params) == 1 && len(params["sslmode"]) == 1 &&
		params.Get("sslmode") == "disable"
}

func TestCaptainIsolatedPostgresRejectsRedirectedConnection(t *testing.T) {
	base := "postgres://bt_cap_s02:synthetic-only@127.0.0.1:5432/refoundation_captain_agent02?sslmode=disable"
	for _, tc := range []struct {
		name, dsn, container, hostaddr string
		ok                             bool
	}{
		{"isolated loopback", base, "bthwani-session02-captain-pg", "", true},
		{"ambient remote PGHOSTADDR", base, "bthwani-session02-captain-pg", "198.51.100.25", false},
		{"ambient local PGHOSTADDR also refused", base, "bthwani-session02-captain-pg", "127.0.0.1", false},
		{"DSN remote hostaddr", base + "&hostaddr=198.51.100.25", "bthwani-session02-captain-pg", "", false},
		{"DSN encoded hostaddr", base + "&host%61ddr=198.51.100.25", "bthwani-session02-captain-pg", "", false},
		{"DSN local hostaddr also refused", base + "&hostaddr=127.0.0.1", "bthwani-session02-captain-pg", "", false},
		{"DSN service override", base + "&service=external", "bthwani-session02-captain-pg", "", false},
		{"DSN unexpected options", base + "&options=-csearch_path%3Dpublic", "bthwani-session02-captain-pg", "", false},
		{"host changed", "postgres://bt_cap_s02:synthetic-only@192.0.2.9:5432/refoundation_captain_agent02?sslmode=disable", "bthwani-session02-captain-pg", "", false},
		{"container identity wrong", base, "another-container", "", false},
		{"bad parse", "%zz", "bthwani-session02-captain-pg", "", false},
		{"duplicate sslmode", base + "&sslmode=disable", "bthwani-session02-captain-pg", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := isolatedCaptainTestDSN(tc.dsn, tc.container, tc.hostaddr); got != tc.ok {
				t.Fatalf("safe isolated connection=%t; want %t", got, tc.ok)
			}
		})
	}
}
