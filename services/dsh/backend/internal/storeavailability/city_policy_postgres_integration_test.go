package storeavailability

import (
	"context"
	"database/sql"
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

// Optional real PostgreSQL acceptance proof. Only the dedicated synthetic
// agent02 database is permitted, and every run creates a fresh DSH namespace.
// Source/build tests without this environment explicitly SKIP; never pass
// this test against a shared, protected or real customer/financial database.
func TestRealPostgresVersionedCityPolicyWriterAndConcurrency(t *testing.T) {
	dsn := os.Getenv("BTHWANI_DSH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("NOT_RUN: dedicated isolated PostgreSQL unavailable")
	}
	uri, err := url.Parse(dsn)
	if err != nil || uri.Scheme != "postgres" || uri.User == nil ||
		uri.User.Username() != "bthwani_agent02" ||
		uri.Path != "/orderability_agent02" ||
		!(uri.Host == "127.0.0.1:35322" ||
			(uri.Host == "127.0.0.1:5432" &&
				os.Getenv("BTHWANI_DSH_TEST_CONTAINER") == "bthwani-session02-orderability-pg")) {
		t.Fatal("refusing non-agent02 synthetic database")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(14)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err = db.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	var actualDB string
	if err = db.QueryRowContext(ctx, "SELECT current_database()").Scan(&actualDB); err != nil || actualDB != "orderability_agent02" {
		t.Fatalf("untrusted database: %s %v", actualDB, err)
	}
	schema := fmt.Sprintf("dsh_test_policy_%d", time.Now().UnixNano())
	var preexisting int
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM pg_namespace WHERE nspname=$1", schema).Scan(&preexisting); err != nil || preexisting != 0 {
		t.Fatal("synthetic policy schema collision")
	}
	for _, file := range []string{"001_public_discovery.sql", "002_store_orderability.sql",
		"003_service_city_timezone.sql", "004_store_availability_city_limits.sql",
		"005_store_operational_policy_commands.sql"} {
		contents, e := os.ReadFile(filepath.Join("..", "..", "..", "database", "migrations", file))
		if e != nil {
			t.Fatal(e)
		}
		if _, e = db.ExecContext(ctx, strings.ReplaceAll(string(contents), "__SCHEMA__", schema)); e != nil {
			t.Fatalf("real policy migration %s failed: %v", file, e)
		}
	}
	city := "policy-city-a02"
	if _, err = db.ExecContext(ctx, fmt.Sprintf("INSERT INTO %s.service_cities(id,active,timezone_name) VALUES ($1,true,'Asia/Aden')", schema), city); err != nil {
		t.Fatal(err)
	}
	owner, err := NewPostgresPolicySource(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = owner.ReadCityPolicy(ctx, city); !errors.Is(err, ErrPolicyUnavailable) {
		t.Fatalf("missing initial policy was not unavailable: %v", err)
	}
	base := CityPolicyChange{CityID: city, OperationID: "policy-create-a02", ExpectedVersion: 0, MaxPauseSeconds: 1800, MaxPreparationMinutes: 80, Reason: "Explicit initial city limits"}
	created, replay, err := owner.ApplyCityPolicy(ctx, "operator-a", base)
	if err != nil || replay || created.Version != 1 || created.MaxPauseSeconds != 1800 {
		t.Fatalf("initial policy creation failed: %+v replay=%v err=%v", created, replay, err)
	}
	old, replay, err := owner.ApplyCityPolicy(ctx, "operator-a", base)
	if err != nil || !replay || old.Version != 1 || old.MaxPauseSeconds != 1800 {
		t.Fatalf("initial idempotent replay incorrect: %+v replay=%v err=%v", old, replay, err)
	}
	different := base
	different.MaxPauseSeconds = 900
	if _, _, err = owner.ApplyCityPolicy(ctx, "operator-a", different); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("same key mutated requested values: %v", err)
	}
	if _, _, err = owner.ApplyCityPolicy(ctx, "operator-b", base); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("different Operator reused another actor's key: %v", err)
	}
	stale := base
	stale.OperationID = "policy-stale-a02"
	if _, _, err = owner.ApplyCityPolicy(ctx, "operator-a", stale); !errors.Is(err, ErrPolicyVersionConflict) {
		t.Fatalf("stale expectedVersion accepted: %v", err)
	}
	change := base
	change.OperationID = "policy-update-a02"
	change.ExpectedVersion = 1
	change.MaxPauseSeconds = 900
	change.MaxPreparationMinutes = 40
	updated, replay, err := owner.ApplyCityPolicy(ctx, "operator-a", change)
	if err != nil || replay || updated.Version != 2 || updated.MaxPauseSeconds != 900 {
		t.Fatalf("policy update failed: %+v replay=%v err=%v", updated, replay, err)
	}
	const attempts = 16
	results := make(chan error, attempts)
	var wg sync.WaitGroup
	concurrent := change
	concurrent.OperationID = "policy-concurrent-a02"
	concurrent.ExpectedVersion = 2
	concurrent.MaxPauseSeconds = 600
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, _, e := owner.ApplyCityPolicy(ctx, "operator-a", concurrent)
			if e != nil || p.Version != 3 || p.MaxPauseSeconds != 600 {
				results <- fmt.Errorf("concurrent identical operation %+v err=%v", p, e)
			} else {
				results <- nil
			}
		}()
	}
	wg.Wait()
	close(results)
	for e := range results {
		if e != nil {
			t.Fatal(e)
		}
	}
	// Historical replay stays the committed version even after a later write.
	history, replay, err := owner.ApplyCityPolicy(ctx, "operator-a", base)
	if err != nil || !replay || history.Version != 1 || history.MaxPauseSeconds != 1800 {
		t.Fatalf("immutable historical replay changed: %+v replay=%v err=%v", history, replay, err)
	}
	// Two distinct changes against the SAME expected version must never both
	// commit. City-row locking is the durable arbiter, not request ordering.
	raceA := concurrent
	raceA.OperationID, raceA.ExpectedVersion = "policy-race-a02-a", 3
	raceA.MaxPauseSeconds, raceA.MaxPreparationMinutes = 400, 30
	raceB := concurrent
	raceB.OperationID, raceB.ExpectedVersion = "policy-race-a02-b", 3
	raceB.MaxPauseSeconds, raceB.MaxPreparationMinutes = 500, 35
	raceResults := make(chan error, 2)
	var raceWG sync.WaitGroup
	for _, command := range []CityPolicyChange{raceA, raceB} {
		raceWG.Add(1)
		go func(c CityPolicyChange) {
			defer raceWG.Done()
			_, _, e := owner.ApplyCityPolicy(ctx, "operator-a", c)
			raceResults <- e
		}(command)
	}
	raceWG.Wait()
	close(raceResults)
	successes, conflicts := 0, 0
	for e := range raceResults {
		switch {
		case e == nil:
			successes++
		case errors.Is(e, ErrPolicyVersionConflict):
			conflicts++
		default:
			t.Fatalf("unexpected competing policy write result: %v", e)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("policy write race had unsafe outcomes: success=%d conflict=%d", successes, conflicts)
	}
	independent, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer independent.Close()
	live, err := NewPostgresPolicySource(independent, schema)
	if err != nil {
		t.Fatal(err)
	}
	readback, err := live.ReadCityPolicy(ctx, city)
	if err != nil || readback.Version != 4 || readback.ChangedByActor != "operator-a" ||
		!((readback.MaxPauseSeconds == 400 && readback.MaxPreparationMinutes == 30) ||
			(readback.MaxPauseSeconds == 500 && readback.MaxPreparationMinutes == 35)) {
		t.Fatalf("independent current policy mismatch: %+v err=%v", readback, err)
	}
	var audits, commands int
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".store_operational_limits_audit WHERE city_id=$1", city).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if err = independent.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".store_operational_policy_commands WHERE city_id=$1", city).Scan(&commands); err != nil {
		t.Fatal(err)
	}
	if audits != 4 || commands != 4 {
		t.Fatalf("idempotent mutation duplicated permanent records: audits=%d commands=%d", audits, commands)
	}
	if _, err = independent.ExecContext(ctx, "UPDATE "+schema+".store_operational_policy_commands SET acting_actor_id='forged' WHERE city_id=$1", city); err == nil {
		t.Fatal("immutable idempotency command could be rewritten")
	}
	if _, err = independent.ExecContext(ctx, "DELETE FROM "+schema+".store_operational_limits_audit WHERE city_id=$1", city); err == nil {
		t.Fatal("immutable policy audit could be deleted")
	}
	if _, err = independent.ExecContext(ctx, "UPDATE "+schema+".service_cities SET active=false WHERE id=$1", city); err != nil {
		t.Fatal(err)
	}
	disabled := concurrent
	disabled.OperationID = "policy-disabled-a02"
	disabled.ExpectedVersion = 4
	if _, _, err = owner.ApplyCityPolicy(ctx, "operator-a", disabled); !errors.Is(err, ErrPolicyUnavailable) {
		t.Fatalf("inactive city accepted policy writes: %v", err)
	}
	if _, err = live.ReadCityPolicy(ctx, city); !errors.Is(err, ErrPolicyUnavailable) {
		t.Fatalf("inactive city exposed an active policy: %v", err)
	}
	t.Logf("REAL_CITY_POLICY_DSH_POSTGRES_PASS version=4 audits=%d commands=%d attempts=%d no_defaults=true immutable=true", audits, commands, attempts)
}
