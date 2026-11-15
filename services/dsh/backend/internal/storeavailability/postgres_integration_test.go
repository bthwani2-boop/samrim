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
	for _, file := range []string{"001_public_discovery.sql", "002_store_orderability.sql", "003_service_city_timezone.sql", "004_store_availability_city_limits.sql"} {
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
	cityID := fmt.Sprintf("sanaa-a02-%d", time.Now().UnixNano())
	_, err = db.ExecContext(ctx, fmt.Sprintf(`INSERT INTO %s.service_cities(id,active,timezone_name)
		VALUES ($1,true,'Asia/Aden')`, schema), cityID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.ExecContext(ctx, fmt.Sprintf(`INSERT INTO %s.verticals(id,active)
		VALUES ('grocery',true) ON CONFLICT(id) DO NOTHING`, schema))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.ExecContext(ctx, fmt.Sprintf(`INSERT INTO %s.stores
		(id,owner_actor_id,city_id,vertical_id,relation,name,published)
		VALUES ($1,'synthetic-merchant-01',$2,'grocery','MARKETPLACE','متجر اختبار آمن',false)`, schema), id, cityID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.ExecContext(ctx, fmt.Sprintf(`INSERT INTO %s.store_operational_limits
		(city_id,max_pause_seconds,max_preparation_minutes,version,changed_by_actor,change_reason)
		VALUES ($1,3600,90,1,'synthetic-operator','Isolated scoped policy')`, schema), cityID)
	if err != nil {
		t.Fatal(err)
	}
	policy, err := NewPostgresPolicySource(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	limits, err := policy.CurrentLimits(ctx, id)
	if err != nil || limits.Version != 1 || limits.MaxPause != time.Hour || limits.MaxPreparationMinutes != 90 {
		t.Fatalf("DSH city policy readback %+v %v", limits, err)
	}
	if _, err = policy.CurrentLimits(ctx, "no-such-store"); !errors.Is(err, ErrPolicyUnavailable) {
		t.Fatalf("missing Store policy allowed: %v", err)
	}
	// A real Store in a different city without an effective DSH policy
	// must remain unmodifiable; absence is not a permissive zero/default.
	noPolicyID := id + "-no-policy"
	_, err = db.ExecContext(ctx, fmt.Sprintf(`INSERT INTO %s.service_cities(id,active,timezone_name)
		VALUES ('sanaa-no-policy',true,'Asia/Aden') ON CONFLICT(id) DO NOTHING`, schema))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.ExecContext(ctx, fmt.Sprintf(`INSERT INTO %s.stores(id,owner_actor_id,city_id,vertical_id,relation,name,published)
		VALUES ($1,'synthetic-merchant-01','sanaa-no-policy','grocery','MARKETPLACE','No policy Store',false)
		ON CONFLICT(id) DO NOTHING`, schema), noPolicyID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = policy.CurrentLimits(ctx, noPolicyID); !errors.Is(err, ErrPolicyUnavailable) {
		t.Fatalf("existing Store without city policy was admitted: %v", err)
	}
	repo, err := NewPostgresRepository(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	// Read authorization must be checked in the same database transaction as
	// the Store availability snapshot, not merely before an ownership transfer.
	transferID := id + "-read-owner-transfer"
	_, err = db.ExecContext(ctx, fmt.Sprintf(`INSERT INTO %s.stores
		(id,owner_actor_id,city_id,vertical_id,relation,name,published)
		VALUES ($1,'synthetic-merchant-01',$2,'grocery','MARKETPLACE','Transfer test',false)`, schema), transferID, cityID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = repo.ReadAuthorized(ctx, transferID, "synthetic-merchant-01", "MERCHANT_STORE_GRANT"); err != nil {
		t.Fatalf("current owner denied authenticated read: %v", err)
	}
	if _, err = repo.ReadAuthorized(ctx, transferID, "different-merchant", "MERCHANT_STORE_GRANT"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("cross-store read was not denied: %v", err)
	}
	// Simulate a transfer that has locked the canonical Store but not yet
	// committed. The former owner must never read around the pending change.
	transferTx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer transferTx.Rollback()
	_, err = transferTx.ExecContext(ctx, fmt.Sprintf(`UPDATE %s.stores SET owner_actor_id=$2 WHERE id=$1`, schema), transferID, "new-merchant")
	if err != nil {
		t.Fatal(err)
	}
	readResult := make(chan error, 1)
	go func() {
		_, readErr := repo.ReadAuthorized(ctx, transferID, "synthetic-merchant-01", "MERCHANT_STORE_GRANT")
		readResult <- readErr
	}()
	select {
	case readErr := <-readResult:
		t.Fatalf("read bypassed an uncommitted Store ownership transfer: %v", readErr)
	case <-time.After(100 * time.Millisecond):
	}
	if err := transferTx.Commit(); err != nil {
		t.Fatal(err)
	}
	select {
	case readErr := <-readResult:
		if !errors.Is(readErr, ErrForbidden) {
			t.Fatalf("former owner read after committed transfer: %v", readErr)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("authorized read did not recover after ownership transfer committed")
	}
	if _, err = repo.ReadAuthorized(ctx, transferID, "new-merchant", "MERCHANT_STORE_GRANT"); err != nil {
		t.Fatalf("new owner denied availability after transfer: %v", err)
	}
	grants, err := NewPostgresStoreGrants(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	// The same DB connection must never retain Store schema authority after a
	// request, including a rejected query in another schema. An implicit global
	// search_path could expose a different Store on the next pooled request.
	singleConnDB, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer singleConnDB.Close()
	singleConnDB.SetMaxOpenConns(1)
	// A temporary relation named like a DSH Store must not shadow the
	// owner schema even when pooled onto the same PostgreSQL session.
	if _, err = singleConnDB.ExecContext(ctx, "CREATE TEMP TABLE stores (id text PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	var beforeSearchPath, afterSearchPath string
	if err = singleConnDB.QueryRowContext(ctx, "SELECT current_setting('search_path')").Scan(&beforeSearchPath); err != nil {
		t.Fatal(err)
	}
	isolatedRepo, err := NewPostgresRepository(singleConnDB, schema)
	if err != nil {
		t.Fatal(err)
	}
	isolatedGrants, err := NewPostgresStoreGrants(singleConnDB, schema)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = isolatedRepo.Read(ctx, id); err != nil {
		t.Fatalf("Store read on one pooled connection: %v", err)
	}
	if err = isolatedGrants.RequireStoreAction(ctx, "synthetic-merchant-01", id, "store_operations"); err != nil {
		t.Fatalf("Store owner on same connection: %v", err)
	}
	wrongSchemaRepo, err := NewPostgresRepository(singleConnDB, "public")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = wrongSchemaRepo.Read(ctx, id); err == nil {
		t.Fatal("another schema incorrectly exposed the Store")
	}
	if _, err = isolatedRepo.Read(ctx, id); err != nil {
		t.Fatalf("schema was not restored after failed read: %v", err)
	}
	if err = singleConnDB.QueryRowContext(ctx, "SELECT current_setting('search_path')").Scan(&afterSearchPath); err != nil {
		t.Fatal(err)
	}
	if afterSearchPath != beforeSearchPath {
		t.Fatalf("transaction schema escaped into pooled connection: %q -> %q", beforeSearchPath, afterSearchPath)
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
		ActorID: "synthetic-merchant-01", AuthoritySource: "MERCHANT_STORE_GRANT", PolicyVersion: limits.Version,
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
	service, err := NewService(identity, grants, policy, repo)
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
	noGrantService, _ := NewService(fakeIdentity{actor: VerifiedActor{Subject: "synthetic-merchant-02", Role: MerchantRole}}, grants, policy, repo)
	noGrantHandler, _ := NewHandler(noGrantService)
	deniedRequest := httptest.NewRequest(http.MethodGet, "/v1/stores/"+id+"/availability", nil)
	deniedRequest.Header.Set("Authorization", "Bearer wrong-store-session")
	deniedResponse := httptest.NewRecorder()
	noGrantHandler.ServeHTTP(deniedResponse, deniedRequest)
	if deniedResponse.Code != http.StatusForbidden {
		t.Fatalf("wrong-Store GET returned %d", deniedResponse.Code)
	}
	revokedService, _ := NewService(fakeIdentity{denied: true}, grants, policy, repo)
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
	// Operator policy changes are versioned DSH facts: an in-flight Store
	// update cannot persist using a stale authorization snapshot. A committed
	// operation may still be replayed after the effective policy changes.
	_, err = db.ExecContext(ctx, fmt.Sprintf(`UPDATE %s.store_operational_limits
		SET max_preparation_minutes=10, version=2, changed_by_actor='synthetic-operator',
		change_reason='Lower the preparation maximum' WHERE city_id=$1`, schema), cityID)
	if err != nil {
		t.Fatal(err)
	}
	newLimits, err := policy.CurrentLimits(ctx, id)
	if err != nil || newLimits.Version != 2 || newLimits.MaxPreparationMinutes != 10 {
		t.Fatalf("changed DSH policy not visible %+v %v", newLimits, err)
	}
	// A future Operator writer must not be able to rewrite the effective
	// bounds without advancing the version; the database enforces this.
	if _, err = db.ExecContext(ctx, fmt.Sprintf(`UPDATE %s.store_operational_limits
		SET max_preparation_minutes=7 WHERE city_id=$1`, schema), cityID); err == nil {
		t.Fatal("Store policy changed without incrementing its version")
	}
	stalePolicy := command
	stalePolicy.OperationID = "agent02-stale-policy-0001"
	stalePolicy.ExpectedVersion = nextVersion
	stalePolicy.PreparationMinutes = 9
	if _, _, err = repo.Apply(ctx, stalePolicy); !errors.Is(err, ErrPolicyVersionConflict) {
		t.Fatalf("stale DSH policy allowed a Store change: %v", err)
	}
	if replayed, replay, replayErr := repo.Apply(ctx, command); replayErr != nil || !replay || replayed.Version != 2 {
		t.Fatalf("durably committed operation lost after policy update %+v %v %v", replayed, replay, replayErr)
	}
	stalePolicy.PolicyVersion = newLimits.Version
	stalePolicy.PreparationMinutes = 20
	if _, _, err = repo.Apply(ctx, stalePolicy); !errors.Is(err, ErrInvalidChange) {
		t.Fatalf("new preparation maximum bypassed: %v", err)
	}
	stalePolicy.PreparationMinutes = 9
	futurePause := time.Now().Add(2 * time.Hour)
	stalePolicy.PausedUntil = &futurePause
	if _, _, err = repo.Apply(ctx, stalePolicy); !errors.Is(err, ErrInvalidChange) {
		t.Fatalf("live city pause maximum bypassed: %v", err)
	}
	stalePolicy.PausedUntil = nil
	updated, wasReplay, err := repo.Apply(ctx, stalePolicy)
	if err != nil || wasReplay || updated.Version != nextVersion+1 {
		t.Fatalf("authorized new-policy Store mutation failed %+v replay=%v err=%v", updated, wasReplay, err)
	}
	var updatedAudits int
	if err = db.QueryRowContext(ctx, fmt.Sprintf("SELECT count(*) FROM %s.store_operational_audit WHERE store_id=$1", schema), id).Scan(&updatedAudits); err != nil || updatedAudits != 7 {
		t.Fatalf("rejected policy requests changed audit: count=%d err=%v", updatedAudits, err)
	}
	var firstPolicyVersion, acceptedPolicyVersion int64
	err = db.QueryRowContext(ctx, fmt.Sprintf(`SELECT policy_version FROM %s.store_operational_audit
		WHERE store_id=$1 AND operation_id=$2`, schema), id, command.OperationID).Scan(&firstPolicyVersion)
	if err != nil || firstPolicyVersion != 1 {
		t.Fatalf("initial Store audit did not freeze city policy version=%d err=%v", firstPolicyVersion, err)
	}
	err = db.QueryRowContext(ctx, fmt.Sprintf(`SELECT policy_version FROM %s.store_operational_audit
		WHERE store_id=$1 AND operation_id=$2`, schema), id, stalePolicy.OperationID).Scan(&acceptedPolicyVersion)
	if err != nil || acceptedPolicyVersion != 2 {
		t.Fatalf("updated Store audit did not freeze city policy version=%d err=%v", acceptedPolicyVersion, err)
	}
	var cityPolicyAudits int
	if err = db.QueryRowContext(ctx, fmt.Sprintf(`SELECT count(*) FROM %s.store_operational_limits_audit
		WHERE city_id=$1`, schema), cityID).Scan(&cityPolicyAudits); err != nil || cityPolicyAudits != 2 {
		t.Fatalf("policy revision history incomplete: count=%d err=%v", cityPolicyAudits, err)
	}
	if _, err = db.ExecContext(ctx, fmt.Sprintf(`UPDATE %s.store_operational_limits_audit
		SET reason='tampered' WHERE city_id=$1`, schema), cityID); err == nil {
		t.Fatal("policy history could be rewritten")
	}
	if _, err = db.ExecContext(ctx, fmt.Sprintf(`DELETE FROM %s.store_operational_limits
		WHERE city_id=$1`, schema), cityID); err == nil {
		t.Fatal("active policy could be erased without a versioned change")
	}
	// Host-local time is not a Store IANA timezone: a different host's TZ
	// must never make opening hours or a Store mutation permissive.
	for caseIndex, invalidZone := range []string{"Local", "Not/AZone"} {
		if _, err := db.ExecContext(ctx, fmt.Sprintf("UPDATE %s.service_cities SET timezone_name=$2 WHERE id=$1", schema), cityID, invalidZone); err != nil {
			t.Fatal(err)
		}
		if _, err := grants.StoreTimezone(ctx, id); !errors.Is(err, ErrInvalidTimezone) {
			t.Fatalf("invalid canonical timezone %q accepted: %v", invalidZone, err)
		}
		invalidChange := stalePolicy
		invalidChange.OperationID = fmt.Sprintf("timezone-reject-%d", caseIndex)
		invalidChange.ExpectedVersion = updated.Version
		invalidChange.Timezone = invalidZone
		if _, _, err := repo.Apply(ctx, invalidChange); !errors.Is(err, ErrInvalidTimezone) {
			t.Fatalf("invalid timezone %q reached Store mutation: %v", invalidZone, err)
		}
	}
	if err := db.QueryRowContext(ctx,
		fmt.Sprintf("SELECT count(*) FROM %s.store_operational_audit WHERE store_id=$1", schema), id).
		Scan(&updatedAudits); err != nil || updatedAudits != 7 {
		t.Fatalf("invalid timezone changed durable Store audit: count=%d err=%v", updatedAudits, err)
	}
	t.Logf("PASS real DSH PostgreSQL: store=%s finalVersion=%d audits=%d, policy versions 1->2 frozen; concurrent identical key exactly once, denied calls preserved state", id, updated.Version, updatedAudits)
}
