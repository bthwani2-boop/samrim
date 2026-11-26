package customercart

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityaccess"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
)

type fulfillmentPolicySession struct{}

func (fulfillmentPolicySession) ResolveCurrentSession(_ context.Context, token string) (identityaccess.VerifiedActor, error) {
	switch token {
	case "operator":
		return identityaccess.VerifiedActor{Subject: "operator-a", Role: identityaccess.OperatorRole}, nil
	case "denied":
		return identityaccess.VerifiedActor{Subject: "operator-b", Role: identityaccess.OperatorRole}, nil
	case "merchant":
		return identityaccess.VerifiedActor{Subject: "merchant-a", Role: identityaccess.MerchantRole}, nil
	default:
		return identityaccess.VerifiedActor{}, identityaccess.ErrUnauthorized
	}
}
func (fulfillmentPolicySession) RequireOperatorPermission(_ context.Context, token, actor, permission string) error {
	if token == "operator" && actor == "operator-a" && permission == "platform_policies" {
		return nil
	}
	return identityaccess.ErrForbidden
}
func verifyFulfillmentPolicyOnPostgres(t *testing.T, ctx context.Context, db *sql.DB, schema string) {
	t.Helper()
	source, err := storeavailability.NewPostgresPolicySource(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	handler, err := storeavailability.NewCityPolicyHandler(fulfillmentPolicySession{}, source, source)
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, relation, token, body string) (int, []byte) {
		req := httptest.NewRequest(method, "/v1/operators/cities/sanaa/fulfillment-policy/"+relation, bytes.NewBufferString(body))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec.Code, rec.Body.Bytes()
	}
	check := func(method, relation, token, body string, want int) []byte {
		t.Helper()
		code, raw := request(method, relation, token, body)
		if code != want {
			t.Fatalf("%s %s: %d want %d: %s", method, relation, code, want, raw)
		}
		return raw
	}
	get := func(relation string) map[string]any {
		t.Helper()
		var p map[string]any
		if err := json.Unmarshal(check("GET", relation, "operator", "", 200), &p); err != nil {
			t.Fatal(err)
		}
		return p
	}
	for _, rel := range []string{"DIRECT", "MARKETPLACE"} {
		p := get(rel)
		if p["version"] != float64(0) || len(p["allowedModes"].([]any)) != 0 {
			t.Fatalf("invented policy: %v", p)
		}
	}
	body := func(key string, version int, modes []string) string {
		b, e := json.Marshal(map[string]any{"operationId": key, "expectedVersion": version, "allowedModes": modes, "reason": "Synthetic policy"})
		if e != nil {
			t.Fatal(e)
		}
		return string(b)
	}
	initial := body("mode-policy-001", 0, []string{"CUSTOMER_PICKUP", "BTHWANI_CAPTAIN"})
	for _, token := range []string{"merchant", "denied"} {
		check("PATCH", "DIRECT", token, initial, 403)
	}
	check("PATCH", "DIRECT", "", initial, 401)
	check("PATCH", "INVALID", "operator", initial, 400)
	check("PATCH", "DIRECT", "operator", body("mode-policy-bad", 0, []string{"UNKNOWN"}), 400)
	check("PATCH", "DIRECT", "operator", body("mode-policy-bad", 0, []string{"CUSTOMER_PICKUP", "CUSTOMER_PICKUP"}), 400)
	check("PATCH", "DIRECT", "operator", `{"operationId":"mode-policy-bad","expectedVersion":0,"reason":"missing modes"}`, 400)
	check("PATCH", "DIRECT", "operator", initial, 200)
	var replay map[string]any
	if err := json.Unmarshal(check("PATCH", "DIRECT", "operator", initial, 200), &replay); err != nil || replay["replay"] != true {
		t.Fatalf("replay: %v %v", replay, err)
	}
	check("PATCH", "DIRECT", "operator", body("mode-policy-001", 0, []string{"PARTNER_CAPTAIN"}), 409)
	check("PATCH", "DIRECT", "operator", body("mode-policy-stale", 0, []string{}), 409)
	if p := get("MARKETPLACE"); p["version"] != float64(0) {
		t.Fatalf("relations crossed: %v", p)
	}
	check("PATCH", "MARKETPLACE", "operator", body("mode-policy-001", 0, []string{"PARTNER_CAPTAIN"}), 200)
	if p := get("DIRECT"); p["version"] != float64(1) || len(p["allowedModes"].([]any)) != 2 {
		t.Fatalf("wrong direct policy: %v", p)
	}
	// Competing writers at version one: only one may commit a new version.
	results := make(chan int, 2)
	var wg sync.WaitGroup
	for _, key := range []string{"mode-policy-race-a", "mode-policy-race-b"} {
		payload := body(key, 1, []string{})
		wg.Add(1)
		go func() { defer wg.Done(); code, _ := request("PATCH", "DIRECT", "operator", payload); results <- code }()
	}
	wg.Wait()
	close(results)
	counts := map[int]int{}
	for code := range results {
		counts[code]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatalf("concurrent results: %v", counts)
	}
	if p := get("DIRECT"); p["version"] != float64(2) || len(p["allowedModes"].([]any)) != 0 {
		t.Fatalf("explicit deny all lost: %v", p)
	}
	if p := get("MARKETPLACE"); p["version"] != float64(1) || len(p["allowedModes"].([]any)) != 1 {
		t.Fatalf("market policy overwritten: %v", p)
	}
	var rows int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".city_fulfillment_policy_versions").Scan(&rows); err != nil || rows != 3 {
		t.Fatalf("audit count %d %v", rows, err)
	}
	if _, err := db.ExecContext(ctx, "UPDATE "+schema+".city_fulfillment_policy_versions SET reason='rewrite' WHERE relation='DIRECT'"); err == nil {
		t.Fatal("immutable policy changed")
	}
	if _, err := db.ExecContext(ctx, "DELETE FROM "+schema+".city_fulfillment_policy_versions WHERE relation='DIRECT'"); err == nil {
		t.Fatal("immutable policy deleted")
	}
	t.Log("DSH_FULFILLMENT_POLICY_PASS independent_relations=true explicit_modes=true replay=true concurrent=true immutable=true")
}
