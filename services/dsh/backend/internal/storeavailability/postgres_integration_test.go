package storeavailability

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// This test uses a real, separately isolated PostgreSQL container. The SQL
// setup below provisions ONLY synthetic Store prerequisites; it is not proof
// of Identity/merchant admission, an actual checkout or a production upgrade.
func TestRealPostgresVersionIdempotencyAuditAndReadback(t *testing.T) {
	dsn := os.Getenv("BTHWANI_DSH_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("NOT_RUN: dedicated agent-02 PostgreSQL URL is not configured")
	}
	uri, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	// The only approved targets are the dedicated synthetic agent-02
	// database from Windows loopback, or localhost inside its own Docker
	// container. Neither path can point at a shared/production database.
	containerLocal := uri.Host == "127.0.0.1:5432" &&
		os.Getenv("BTHWANI_DSH_TEST_CONTAINER") == "bthwani-session02-orderability-pg"
	windowsLoopback := uri.Host == "127.0.0.1:35322"
	if uri.Scheme != "postgres" || (!containerLocal && !windowsLoopback) ||
		strings.TrimPrefix(uri.Path, "/") != "orderability_agent02" ||
		uri.User.Username() != "bthwani_agent02" {
		t.Fatal("refusing any DB except the dedicated synthetic agent-02 PostgreSQL")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(5)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err = db.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	schema := "dsh_orderability_agent02"
	for _, file := range []string{"001_public_discovery.sql", "002_store_orderability.sql", "003_service_city_timezone.sql"} {
		path := filepath.Join("..", "..", "..", "database", "migrations", file)
		contents, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		sqlText := strings.ReplaceAll(string(contents), "__SCHEMA__", schema)
		if _, err = db.ExecContext(ctx, sqlText); err != nil {
			t.Fatalf("migration %s: %v", file, err)
		}
	}
	id := fmt.Sprintf("synthetic-a02-%d", time.Now().UnixNano())
	_, err = db.ExecContext(ctx, fmt.Sprintf(`
		INSERT INTO %s.service_cities(id,active,timezone_name) VALUES('sanaa',true,'Asia/Aden')
			ON CONFLICT(id) DO UPDATE SET timezone_name=EXCLUDED.timezone_name;
		INSERT INTO %s.verticals(id,active) VALUES('grocery',true) ON CONFLICT(id) DO NOTHING;`, schema, schema))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.ExecContext(ctx, fmt.Sprintf(`INSERT INTO %s.stores
		(id,owner_actor_id,city_id,vertical_id,relation,name,published)
		VALUES ($1,'synthetic-merchant-01','sanaa','grocery','MARKETPLACE','متجر اختبار آمن',false)`, schema), id)
	if err != nil {
		t.Fatal(err)
	}
	repo, err := NewPostgresRepository(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	grants, err := NewPostgresStoreGrants(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	if err := grants.RequireStoreAction(ctx, "synthetic-merchant-01", id, "store_operations"); err != nil {
		t.Fatalf("real DSH owner cannot operate Store: %v", err)
	}
	if err := grants.RequireStoreAction(ctx, "synthetic-merchant-02", id, "store_operations"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("cross-Store actor authorized: %v", err)
	}
	if err := grants.RequireStoreAction(ctx, "synthetic-merchant-01", id, "finance_approve"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("unapproved action authorized: %v", err)
	}
	zone, err := grants.StoreTimezone(ctx, id)
	if err != nil || zone != "Asia/Aden" {
		t.Fatalf("canonical city timezone %q: %v", zone, err)
	}
	first, err := repo.Read(ctx, id)
	if err != nil || first.Version != 1 || first.Timezone != "" {
		t.Fatalf("unexpected empty Store availability %+v %v", first, err)
	}
	command := AuthorizedChange{
		Change: Change{StoreID: id, OperationID: "agent02-op-0001", ExpectedVersion: 1,
			Timezone: "Asia/Aden", Weekly: []WeeklyWindow{{Weekday: time.Monday, Opens: 9 * 60, Closes: 17 * 60}},
			PreparationMinutes: 15, Reason: "Scheduled opening"},
		ActorID: "synthetic-merchant-01", AuthoritySource: "MERCHANT_STORE_GRANT",
	}
	forgedTimezone := command
	forgedTimezone.Timezone = "Pacific/Honolulu"
	if _, _, err := repo.Apply(ctx, forgedTimezone); !errors.Is(err, ErrInvalidTimezone) {
		t.Fatalf("non-canonical Store timezone accepted by PostgreSQL writer: %v", err)
	}
	forgedOwner := command
	forgedOwner.ActorID = "synthetic-merchant-02"
	if _, _, err := repo.Apply(ctx, forgedOwner); !errors.Is(err, ErrForbidden) {
		t.Fatalf("owner changed before SQL commit was not denied: %v", err)
	}
	committed, replay, err := repo.Apply(ctx, command)
	if err != nil || replay || committed.Version != 2 {
		t.Fatalf("first commit %+v replay %v err %v", committed, replay, err)
	}
	readback, err := repo.Read(ctx, id)
	if err != nil || readback.Version != 2 || readback.Reason != command.Reason ||
		len(readback.Weekly) != 1 || readback.Timezone != "Asia/Aden" {
		t.Fatalf("owner-backed readback %+v err %v", readback, err)
	}
	replayed, wasReplay, err := repo.Apply(ctx, command)
	if err != nil || !wasReplay || replayed.Version != 2 {
		t.Fatalf("idempotent replay %+v %v %v", replayed, wasReplay, err)
	}
	forged := command
	forged.Reason = "Different payload"
	if _, _, err = repo.Apply(ctx, forged); !errors.Is(err, ErrOperationConflict) {
		t.Fatalf("payload-replay not denied: %v", err)
	}
	stale := command
	stale.OperationID = "agent02-op-0002"
	if _, _, err = repo.Apply(ctx, stale); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale expected version not denied: %v", err)
	}
	// Both writers race against the SAME actual persisted version, not a fake.
	start := make(chan struct{})
	var wg sync.WaitGroup
	type outcome struct {
		version int64
		err     error
	}
	results := make(chan outcome, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			c := command
			c.ExpectedVersion = 2
			c.OperationID = fmt.Sprintf("agent02-race-%04d", i)
			c.Reason = fmt.Sprintf("Concurrent version attempt %d", i)
			result, _, errorResult := repo.Apply(context.Background(), c)
			results <- outcome{version: result.Version, err: errorResult}
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)
	success, conflicts := 0, 0
	for outcome := range results {
		if outcome.err == nil && outcome.version == 3 {
			success++
		} else if errors.Is(outcome.err, ErrVersionConflict) {
			conflicts++
		} else {
			t.Errorf("unexpected race result: %+v", outcome)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatalf("race accepted %d writes and %d conflicts", success, conflicts)
	}
	// Distinct connection verifies the durable owner state, not in-memory state.
	other, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	secondRepo, err := NewPostgresRepository(other, schema)
	if err != nil {
		t.Fatal(err)
	}
	final, err := secondRepo.Read(ctx, id)
	if err != nil || final.Version != 3 {
		t.Fatalf("durable read from different DB connection %+v %v", final, err)
	}
	var audits, commands int
	if err = db.QueryRowContext(ctx, fmt.Sprintf(`SELECT count(*) FROM %s.store_operational_audit WHERE store_id=$1`, schema), id).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRowContext(ctx, fmt.Sprintf(`SELECT count(*) FROM %s.store_operational_commands WHERE store_id=$1`, schema), id).Scan(&commands); err != nil {
		t.Fatal(err)
	}
	if audits != 2 || commands != 2 {
		t.Fatalf("exactly once audit=%d commands=%d", audits, commands)
	}
	if _, err = db.ExecContext(ctx, fmt.Sprintf("UPDATE %s.store_operational_audit SET reason='tamper' WHERE store_id=$1", schema), id); err == nil {
		t.Fatal("immutable audit table permitted UPDATE")
	}
	if _, err = NewPostgresRepository(db, "public;DROP TABLE stores"); !errors.Is(err, ErrInvalidChange) {
		t.Fatal("unvalidated schema identifier accepted")
	}

	// HTTP -> current-session verifier interface -> DSH Store scope ->
	// real PostgreSQL mutation/readback. Identity verifier is fake here:
	// full multi-service authentication E2E is explicitly NOT proven.
	identity := fakeIdentity{actor: VerifiedActor{Subject: "synthetic-merchant-01", Role: MerchantRole}}
	service, err := NewService(identity, grants, fakePolicy{}, repo)
	if err != nil {
		t.Fatal(err)
	}
	handler, err := NewHandler(service)
	if err != nil {
		t.Fatal(err)
	}
	getRequest := httptest.NewRequest(http.MethodGet, "/v1/stores/"+id+"/availability", nil)
	getRequest.Header.Set("Authorization", "Bearer test-only-identity-placeholder")
	getResponse := httptest.NewRecorder()
	handler.ServeHTTP(getResponse, getRequest)
	if getResponse.Code != http.StatusOK || !strings.Contains(getResponse.Body.String(), "\"version\":3") {
		t.Fatalf("owner-backed GET HTTP failure: %d %s", getResponse.Code, getResponse.Body.String())
	}
	patchBody := `{"operationId":"agent02-http-0003","expectedVersion":3,"weekly":[{"weekday":1,"opens":600,"closes":1200}],"preparationMinutes":20,"reason":"Authorized owner HTTP test"}`
	patchRequest := httptest.NewRequest(http.MethodPatch, "/v1/stores/"+id+"/availability", strings.NewReader(patchBody))
	patchRequest.Header.Set("Authorization", "Bearer test-only-identity-placeholder")
	patchRequest.Header.Set("Content-Type", "application/json")
	patchResponse := httptest.NewRecorder()
	handler.ServeHTTP(patchResponse, patchRequest)
	if patchResponse.Code != http.StatusOK {
		t.Fatalf("owner-backed PATCH HTTP failure: %d %s", patchResponse.Code, patchResponse.Body.String())
	}
	afterHTTP, err := secondRepo.Read(ctx, id)
	if err != nil || afterHTTP.Version != 4 || afterHTTP.PreparationMinutes != 20 {
		t.Fatalf("HTTP change is not persistent %+v %v", afterHTTP, err)
	}
	var afterAudits int
	if err := db.QueryRowContext(ctx, fmt.Sprintf(`SELECT count(*) FROM %s.store_operational_audit WHERE store_id=$1`, schema), id).Scan(&afterAudits); err != nil || afterAudits != 3 {
		t.Fatalf("HTTP mutation audit must be once only: %d %v", afterAudits, err)
	}
	noGrantService, _ := NewService(fakeIdentity{actor: VerifiedActor{Subject: "synthetic-merchant-02", Role: MerchantRole}}, grants, fakePolicy{}, repo)
	noGrantHandler, _ := NewHandler(noGrantService)
	deniedRequest := httptest.NewRequest(http.MethodGet, "/v1/stores/"+id+"/availability", nil)
	deniedRequest.Header.Set("Authorization", "Bearer wrong-store-session")
	deniedResponse := httptest.NewRecorder()
	noGrantHandler.ServeHTTP(deniedResponse, deniedRequest)
	if deniedResponse.Code != http.StatusForbidden {
		t.Fatalf("wrong-Store GET returned %d", deniedResponse.Code)
	}
	revokedService, _ := NewService(fakeIdentity{denied: true}, grants, fakePolicy{}, repo)
	revokedHandler, _ := NewHandler(revokedService)
	revokedRequest := httptest.NewRequest(http.MethodPatch, "/v1/stores/"+id+"/availability", strings.NewReader(patchBody))
	revokedRequest.Header.Set("Authorization", "Bearer revoked-identity")
	revokedRequest.Header.Set("Content-Type", "application/json")
	revokedResponse := httptest.NewRecorder()
	revokedHandler.ServeHTTP(revokedResponse, revokedRequest)
	if revokedResponse.Code != http.StatusUnauthorized {
		t.Fatalf("revoked Identity PATCH returned %d", revokedResponse.Code)
	}
	finalReadback, err := secondRepo.Read(ctx, id)
	if err != nil || finalReadback.Version != 4 {
		t.Fatalf("denied requests changed state %+v %v", finalReadback, err)
	}
	// Identical concurrent operation IDs must never create a second mutation,
	// lose the committed result, or be misreported as an ordinary stale write.
	nextVersion := int64(4)
	for round := 0; round < 3; round++ {
		duplicate := command
		duplicate.OperationID = fmt.Sprintf("agent02-same-retry-%04d", round)
		duplicate.ExpectedVersion = nextVersion
		duplicate.Reason = fmt.Sprintf("Concurrent identical retry round %d", round)
		duplicate.PreparationMinutes = 25 + round
		startSame := make(chan struct{})
		var sameWG sync.WaitGroup
		type sameOutcome struct {
			version int64
			replay  bool
			err     error
		}
		sameResults := make(chan sameOutcome, 2)
		for j := 0; j < 2; j++ {
			sameWG.Add(1)
			go func() {
				defer sameWG.Done()
				<-startSame
				got, wasReplay, applyErr := repo.Apply(context.Background(), duplicate)
				sameResults <- sameOutcome{version: got.Version, replay: wasReplay, err: applyErr}
			}()
		}
		close(startSame)
		sameWG.Wait()
		close(sameResults)
		writes, replays := 0, 0
		for outcome := range sameResults {
			if outcome.err != nil {
				t.Fatalf("identical concurrent retry failed round %d: %v", round, outcome.err)
			}
			if outcome.version != nextVersion+1 {
				t.Fatalf("identical operation produced version %d instead of %d", outcome.version, nextVersion+1)
			}
			if outcome.replay {
				replays++
			} else {
				writes++
			}
		}
		if writes != 1 || replays != 1 {
			t.Fatalf("duplicate operation round %d: writes=%d replays=%d", round, writes, replays)
		}
		nextVersion++
	}
	afterSame, err := secondRepo.Read(ctx, id)
	if err != nil || afterSame.Version != nextVersion {
		t.Fatalf("concurrent duplicate not durable %+v %v", afterSame, err)
	}
	var totalAudits, totalCommands int
	if err := db.QueryRowContext(ctx, fmt.Sprintf("SELECT count(*) FROM %s.store_operational_audit WHERE store_id=$1", schema), id).Scan(&totalAudits); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, fmt.Sprintf("SELECT count(*) FROM %s.store_operational_commands WHERE store_id=$1", schema), id).Scan(&totalCommands); err != nil {
		t.Fatal(err)
	}
	if totalAudits != 6 || totalCommands != 6 {
		t.Fatalf("concurrent identical requests duplicated owner audit/commands: audits=%d commands=%d", totalAudits, totalCommands)
	}
	// A missing or invalid canonical DSH city timezone never falls back to a client value.
	if _, err := db.ExecContext(ctx, fmt.Sprintf("UPDATE %s.service_cities SET timezone_name='Not/AZone' WHERE id='sanaa'", schema)); err != nil {
		t.Fatal(err)
	}
	if _, err := grants.StoreTimezone(ctx, id); !errors.Is(err, ErrInvalidTimezone) {
		t.Fatalf("invalid canonical timezone accepted: %v", err)
	}
	t.Logf("PASS real DSH PostgreSQL: store=%s finalVersion=%d audits=%d commands=%d, concurrent identical key exactly once, denied calls preserved state", id, afterSame.Version, totalAudits, totalCommands)
}
