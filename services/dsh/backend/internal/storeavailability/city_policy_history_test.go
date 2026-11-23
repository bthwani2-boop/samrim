package storeavailability

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type cityPolicyAuditIdentity struct {
	fakeIdentity
	calls            int
	revokeAfterFirst bool
}

func (i *cityPolicyAuditIdentity) RequireOperatorPermission(_ context.Context, _ string, _ string, permission string) error {
	i.calls++
	if permission != "platform_policies" || (i.revokeAfterFirst && i.calls > 1) {
		return ErrForbidden
	}
	return nil
}

const cityAuditURL = "/v1/operators/cities/sanaa/store-availability-policy/history"

type cityPolicyAuditFixture struct {
	calls int
}

func (f *cityPolicyAuditFixture) ReadCityPolicy(ctx context.Context, city string) (CityPolicy, error) {
	return CityPolicy{}, ErrPolicyUnavailable
}
func (f *cityPolicyAuditFixture) ReadCityPolicyHistory(ctx context.Context, city string, limit int, before int64) (CityPolicyHistoryPage, error) {
	f.calls++
	return CityPolicyHistoryPage{CityID: city, Entries: []CityPolicy{}}, nil
}

func cityAuditRequest(h http.Handler, method, path, bearer string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, nil)
	if bearer != "" {
		r.Header.Set("Authorization", "Bearer "+bearer)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestCityPolicyHistoryAuthorizationAndCursor(t *testing.T) {
	for _, tc := range []struct {
		name, path, method, token string
		role                      ActorRole
		revoke                    bool
		want, reads               int
	}{
		{"authorized", cityAuditURL, "GET", "token", OperatorRole, false, 200, 1},
		{"authorized pagination", cityAuditURL + "?limit=2&beforeVersion=3", "GET", "token", OperatorRole, false, 200, 1},
		{"revoked paginated read", cityAuditURL + "?limit=2&beforeVersion=3", "GET", "token", OperatorRole, true, 403, 1},
		{"anonymous", cityAuditURL, "GET", "", OperatorRole, false, 401, 0},
		{"merchant", cityAuditURL, "GET", "token", MerchantRole, false, 403, 0},
		{"revoked after read", cityAuditURL, "GET", "token", OperatorRole, true, 403, 1},
		{"injected selector", cityAuditURL + "?actorId=other", "GET", "token", OperatorRole, false, 400, 0},
		{"oversized page", cityAuditURL + "?limit=51", "GET", "token", OperatorRole, false, 400, 0},
		{"duplicate cursor", cityAuditURL + "?beforeVersion=2&beforeVersion=3", "GET", "token", OperatorRole, false, 400, 0},
		{"head", cityAuditURL, "HEAD", "token", OperatorRole, false, 405, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture := &cityPolicyAuditFixture{}
			identity := &cityPolicyAuditIdentity{fakeIdentity: fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: tc.role}}, revokeAfterFirst: tc.revoke}
			h, err := NewCityPolicyHandler(identity, fixture)
			if err != nil {
				t.Fatal(err)
			}
			w := cityAuditRequest(h, tc.method, tc.path, tc.token)
			if w.Code != tc.want || fixture.calls != tc.reads {
				t.Fatalf("status=%d reads=%d: %s", w.Code, fixture.calls, w.Body.String())
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("cacheable audit")
			}
			if tc.want == 403 && strings.Contains(w.Body.String(), "entries") {
				t.Fatal("unauthorized audit exposed")
			}
		})
	}
}

func TestCityPolicyHistoryRealPostgres(t *testing.T) {
	dsn := os.Getenv("BTHWANI_MERCHANT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("NOT_RUN: disposable Merchant PostgreSQL not configured")
	}
	if !isolatedMerchantTestDSN(dsn, os.Getenv("BTHWANI_MERCHANT_TEST_CONTAINER"), os.Getenv("PGHOSTADDR"), os.Getenv("BTHWANI_ISOLATED_TEST_MODE")) {
		t.Fatal("non-isolated database")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	var database, role string
	if err = db.QueryRowContext(ctx, "SELECT current_database(),current_user").Scan(&database, &role); err != nil || database != "merchant_agent01" || role != "bthwani_session01" {
		t.Fatal("fixture identity mismatch")
	}
	schema := fmt.Sprintf("dsh_test_history_%d", time.Now().UnixNano())
	root := filepath.Join("..", "..", "..", "database", "schema")
	files, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	for _, file := range files {
		if file.IsDir() || !strings.HasSuffix(file.Name(), ".sql") {
			t.Fatal("unexpected baseline source")
		}
		data, e := os.ReadFile(filepath.Join(root, file.Name()))
		if e != nil {
			t.Fatal(e)
		}
		if _, e = tx.ExecContext(ctx, strings.ReplaceAll(string(data), "__SCHEMA__", schema)); e != nil {
			t.Fatalf("baseline %s: %v", file.Name(), e)
		}
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	defer db.ExecContext(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
	if _, err = db.ExecContext(ctx, "INSERT INTO "+schema+".service_cities(id,active,timezone_name) VALUES('sanaa',true,'Asia/Aden'),('aden',true,'Asia/Aden')"); err != nil {
		t.Fatal(err)
	}
	source, err := NewPostgresPolicySource(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	identity := &cityPolicyAuditIdentity{fakeIdentity: fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}}
	h, err := NewCityPolicyHandler(identity, source, source)
	if err != nil {
		t.Fatal(err)
	}
	read := func(path string) CityPolicyHistoryPage {
		t.Helper()
		w := cityAuditRequest(h, "GET", path, "token")
		if w.Code != 200 {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
		var page CityPolicyHistoryPage
		if err = json.Unmarshal(w.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		return page
	}
	if empty := read(cityAuditURL); empty.CityID != "sanaa" || empty.Entries == nil || len(empty.Entries) != 0 {
		t.Fatalf("unexpected empty history: %+v", empty)
	}
	for n := 0; n < 3; n++ {
		command := CityPolicyChange{CityID: "sanaa", OperationID: fmt.Sprintf("city-audit-command-%d", n), ExpectedVersion: int64(n), MaxPauseSeconds: 100 + n, MaxPreparationMinutes: 20 + n, Reason: fmt.Sprintf("Reviewed change number %d", n)}
		if _, replay, e := source.ApplyCityPolicy(ctx, "operator-a", command); e != nil || replay {
			t.Fatalf("write: replay=%v %v", replay, e)
		}
		if _, replay, e := source.ApplyCityPolicy(ctx, "operator-a", command); e != nil || !replay {
			t.Fatalf("replay: %v %v", replay, e)
		}
	}
	p := read(cityAuditURL + "?limit=2")
	if p.CityID != "sanaa" || len(p.Entries) != 2 || p.Entries[0].Version != 3 || p.Entries[1].Version != 2 || p.NextBeforeVersion != "2" || p.Entries[0].MaxPauseSeconds != 102 || p.Entries[0].ChangedByActor != "operator-a" {
		t.Fatalf("wrong audit %+v", p)
	}
	p = read(cityAuditURL + "?limit=2&beforeVersion=2")
	if len(p.Entries) != 1 || p.Entries[0].Version != 1 || p.NextBeforeVersion != "" {
		t.Fatalf("wrong next page %+v", p)
	}
	if len(read(strings.Replace(cityAuditURL, "sanaa", "aden", 1)).Entries) != 0 {
		t.Fatal("cross-city audit leak")
	}
	if _, err = db.ExecContext(ctx, "UPDATE "+schema+".service_cities SET active=false WHERE id='sanaa'"); err != nil {
		t.Fatal(err)
	}
	if len(read(cityAuditURL).Entries) != 3 {
		t.Fatal("inactive city lost history")
	}
	if _, err = source.ReadCityPolicy(ctx, "sanaa"); err == nil {
		t.Fatal("history reactivated current policy")
	}
	identity.calls = 0
	identity.revokeAfterFirst = true
	w := cityAuditRequest(h, "GET", cityAuditURL, "token")
	if w.Code != 403 || strings.Contains(w.Body.String(), "entries") {
		t.Fatal("revoked read returned audit")
	}
	var count int
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".store_operational_limits_audit WHERE city_id='sanaa'").Scan(&count); err != nil || count != 3 {
		t.Fatal("audit changed or duplicate replay")
	}
}
