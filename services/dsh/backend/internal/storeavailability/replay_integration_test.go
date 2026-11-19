package storeavailability

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Called only from the existing guarded disposable PostgreSQL test. Requests
// traverse HTTP and Service, rather than bypassing temporal/policy checks.
func assertHistoricalHTTPReplay(t *testing.T, ctx context.Context, db *sql.DB, schema string,
	repo *PostgresRepository, grants *PostgresStoreGrants, policy *PostgresPolicySource) {
	t.Helper()
	id := fmt.Sprintf("replay-a02-%d", time.Now().UnixNano())
	city := id + "-city"
	for _, query := range []string{
		`INSERT INTO %s.service_cities(id,active,timezone_name) VALUES ($1,true,'Asia/Aden')`,
		`INSERT INTO %s.store_operational_limits(city_id,max_pause_seconds,max_preparation_minutes,version,changed_by_actor,change_reason) VALUES ($1,3600,90,1,'synthetic-operator','Replay fixture')`,
	} {
		if _, err := db.ExecContext(ctx, fmt.Sprintf(query, schema), city); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf(`INSERT INTO %s.stores(id,owner_actor_id,city_id,vertical_id,relation,name,published)
		VALUES ($1,'synthetic-replay-owner',$2,'grocery','MARKETPLACE','Replay Store',false)`, schema), id, city); err != nil {
		t.Fatal(err)
	}
	svc, err := NewService(fakeIdentity{actor: VerifiedActor{Subject: "synthetic-replay-owner", Role: MerchantRole}}, grants, policy, repo)
	if err != nil {
		t.Fatal(err)
	}
	handler, _ := NewHandler(svc)
	input := map[string]any{
		"operationId": "historical-pause-001", "expectedVersion": 1,
		"weekly":             []WeeklyWindow{{Weekday: time.Monday, Opens: 600, Closes: 1200}},
		"preparationMinutes": 10, "reason": "Exact original request",
		"pausedUntil": time.Now().UTC().Add(30 * time.Minute).Format(time.RFC3339Nano),
	}
	patch := func(body map[string]any) (int, Snapshot, bool) {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("PATCH", "/v1/stores/"+id+"/availability", strings.NewReader(string(encoded)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer current-session")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		var result struct {
			Availability Snapshot `json:"availability"`
			Replay       bool     `json:"replay"`
		}
		if w.Code == 200 {
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
		}
		return w.Code, result.Availability, result.Replay
	}
	code, original, replay := patch(input)
	if code != 200 || replay || original.Version != 2 {
		t.Fatalf("first commit status=%d snapshot=%+v replay=%v", code, original, replay)
	}
	var originalHash string
	if err := db.QueryRowContext(ctx, fmt.Sprintf(`SELECT request_hash FROM %s.store_operational_commands WHERE store_id=$1 AND operation_id=$2`, schema), id, input["operationId"]).Scan(&originalHash); err != nil {
		t.Fatal(err)
	}
	checkReplay := func(label string) {
		t.Helper()
		code, got, replay := patch(input)
		if code != 200 || !replay || got.Version != 2 || got.Timezone != original.Timezone || got.Reason != original.Reason {
			t.Fatalf("%s: status=%d snapshot=%+v replay=%v", label, code, got, replay)
		}
	}
	svc.now = func() time.Time { return time.Now().Add(2 * time.Hour) }
	checkReplay("pause elapsed")
	if _, err := db.ExecContext(ctx, fmt.Sprintf(`UPDATE %s.store_operational_limits SET max_preparation_minutes=0,max_pause_seconds=0,version=2,changed_by_actor='synthetic-operator',change_reason='New tighter policy' WHERE city_id=$1`, schema), city); err != nil {
		t.Fatal(err)
	}
	checkReplay("policy version and bounds changed")
	if _, err := db.ExecContext(ctx, fmt.Sprintf(`UPDATE %s.service_cities SET timezone_name='Europe/London' WHERE id=$1`, schema), city); err != nil {
		t.Fatal(err)
	}
	checkReplay("canonical timezone changed")
	for _, field := range []string{"reason", "preparationMinutes", "expectedVersion", "weekly", "pausedUntil"} {
		changed := make(map[string]any)
		for k, v := range input {
			changed[k] = v
		}
		switch field {
		case "reason":
			changed[field] = "Different reason"
		case "preparationMinutes":
			changed[field] = 11
		case "expectedVersion":
			changed[field] = 2
		case "weekly":
			changed[field] = []WeeklyWindow{}
		case "pausedUntil":
			changed[field] = nil
		}
		if code, _, _ := patch(changed); code != http.StatusConflict {
			t.Fatalf("mismatched %s reused key: status=%d", field, code)
		}
	}
	newKey := make(map[string]any)
	for k, v := range input {
		newKey[k] = v
	}
	newKey["operationId"] = "uncommitted-pause-002"
	if code, _, _ := patch(newKey); code != http.StatusBadRequest {
		t.Fatalf("new operation bypassed current policy: status=%d", code)
	}
	// Deliberate corruption fixture in this synthetic Store only: a command
	// without its immutable audit must never become a guessed successful replay.
	orphan := make(map[string]any)
	for k, v := range input {
		orphan[k] = v
	}
	orphan["operationId"] = "orphan-command-001"
	if _, err := db.ExecContext(ctx, fmt.Sprintf(`INSERT INTO %s.store_operational_commands
		(store_id,operation_id,request_hash,resulting_version,result_snapshot)
		SELECT store_id,$2,request_hash,resulting_version,result_snapshot FROM %s.store_operational_commands
		WHERE store_id=$1 AND operation_id=$3`, schema, schema), id, orphan["operationId"], input["operationId"]); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := patch(orphan); code != http.StatusServiceUnavailable {
		t.Fatalf("orphan command did not fail closed: status=%d", code)
	}
	encoded, _ := json.Marshal(orphan)
	orphanReq := httptest.NewRequest("PATCH", "/v1/stores/"+id+"/availability", strings.NewReader(string(encoded)))
	orphanReq.Header.Set("Authorization", "Bearer current-session")
	orphanReq.Header.Set("Content-Type", "application/json")
	orphanResponse := httptest.NewRecorder()
	handler.ServeHTTP(orphanResponse, orphanReq)
	if !strings.Contains(orphanResponse.Body.String(), `"OPERATION_RESULT_UNKNOWN"`) {
		t.Fatalf("orphan result misclassified: %s", orphanResponse.Body.String())
	}
	svc.identity = fakeIdentity{denied: true}
	if code, _, _ := patch(input); code != http.StatusUnauthorized {
		t.Fatalf("revoked session replayed: status=%d", code)
	}
	svc.identity = fakeIdentity{actor: VerifiedActor{Subject: "synthetic-replay-owner", Role: MerchantRole}}
	assertReplayFallbackRechecksOwnership(t, ctx, db, schema, repo, id)
	if code, _, _ := patch(input); code != http.StatusForbidden {
		t.Fatalf("revoked Store ownership replayed: status=%d", code)
	}
	// Simulate ownership changing after the service-level grant check. The
	// repository must independently lock/recheck current scope before replay.
	svc.grants = fakeGrant{}
	if code, _, _ := patch(input); code != http.StatusForbidden {
		t.Fatalf("stale service grant bypassed replay transaction: status=%d", code)
	}
	var writes int
	var hash string
	if err := db.QueryRowContext(ctx, fmt.Sprintf(`SELECT count(*) FROM %s.store_operational_audit WHERE store_id=$1`, schema), id).Scan(&writes); err != nil || writes != 1 {
		t.Fatalf("replay created another audit count=%d error=%v", writes, err)
	}
	if err := db.QueryRowContext(ctx, fmt.Sprintf(`SELECT request_hash FROM %s.store_operational_commands WHERE store_id=$1 AND operation_id=$2`, schema), id, input["operationId"]).Scan(&hash); err != nil || hash != originalHash {
		t.Fatalf("historical command hash changed error=%v", err)
	}
}

func assertReplayFallbackRechecksOwnership(t *testing.T, ctx context.Context, db *sql.DB, schema string, repo *PostgresRepository, storeID string) {
	t.Helper()
	// Hold availability so Apply has acquired Store authority but cannot yet
	// discover its stale expectedVersion. Queue a transfer behind its Store lock.
	blocker, err := beginScopedStoreTx(ctx, db, schema, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback()
	var blockerPID int
	if err = blocker.QueryRowContext(ctx, `SELECT pg_backend_pid()`).Scan(&blockerPID); err != nil {
		t.Fatal(err)
	}
	var version int64
	if err = blocker.QueryRowContext(ctx, `SELECT version FROM store_operational_availability WHERE store_id=$1 FOR UPDATE`, storeID).Scan(&version); err != nil {
		t.Fatal(err)
	}
	change := AuthorizedChange{Change: Change{StoreID: storeID, OperationID: "fallback-race-001", ExpectedVersion: version - 1,
		Timezone: "Europe/London", Weekly: []WeeklyWindow{}, PreparationMinutes: 0, Reason: "Rejected stale mutation"},
		ActorID: "synthetic-replay-owner", AuthoritySource: "MERCHANT_STORE_GRANT", PolicyVersion: 2}
	result := make(chan error, 1)
	go func() { _, _, err := repo.Apply(ctx, change); result <- err }()
	awaitBlocked := func(blockingPID int) int {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			var pid int
			err := db.QueryRowContext(ctx, `SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)) LIMIT 1`, blockingPID).Scan(&pid)
			if err == nil {
				return pid
			}
			if !errors.Is(err, sql.ErrNoRows) {
				t.Fatal(err)
			}
			time.Sleep(5 * time.Millisecond)
		}
		t.Fatal("expected PostgreSQL lock wait was not observed")
		return 0
	}
	writerPID := awaitBlocked(blockerPID)
	transferred := make(chan error, 1)
	go func() {
		_, err := db.ExecContext(ctx, fmt.Sprintf(`UPDATE %s.stores SET owner_actor_id='different-current-owner' WHERE id=$1`, schema), storeID)
		transferred <- err
	}()
	awaitBlocked(writerPID)
	if err := blocker.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-transferred; err != nil {
		t.Fatal(err)
	}
	if err := <-result; !errors.Is(err, ErrForbidden) {
		t.Fatalf("post-conflict replay failed to recheck ownership: %v", err)
	}
}
