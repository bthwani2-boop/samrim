package storeavailability

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The URL authority is not sufficient isolation: lib/pq also accepts query
// overrides and ambient PGHOSTADDR. Require the exact synthetic identity and
// a supported local endpoint; port 5432 is admitted only inside the separately
// named disposable CI container with explicit isolation enabled.
func isolatedMerchantTestDSN(rawDSN, container, hostAddr, isolatedMode string) bool {
	uri, err := url.Parse(rawDSN)
	if err != nil || uri.Scheme != "postgres" || uri.User == nil ||
		uri.User.Username() != "bthwani_session01" ||
		uri.Path != "/merchant_agent01" ||
		container != "bthwani-session01-merchant-pg" || hostAddr != "" {
		return false
	}
	if uri.Host != "127.0.0.1:35328" &&
		!(uri.Host == "127.0.0.1:5432" && isolatedMode == "true") {
		return false
	}
	params := uri.Query()
	if params.Get("sslmode") != "disable" {
		return false
	}
	for key := range params {
		if key != "sslmode" && key != "connect_timeout" {
			return false
		}
	}
	return true
}

// This test is intentionally opt-in and rejects every target except the
// session-01 disposable, loopback-only PostgreSQL database. No shared volumes.
func TestMerchantOwnedStoresRealPostgresAndHTTPReadback(t *testing.T) {
	dsn := os.Getenv("BTHWANI_MERCHANT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("NOT_RUN: session-01 disposable Merchant PostgreSQL not configured")
	}
	if !isolatedMerchantTestDSN(dsn, os.Getenv("BTHWANI_MERCHANT_TEST_CONTAINER"),
		os.Getenv("PGHOSTADDR"), os.Getenv("BTHWANI_ISOLATED_TEST_MODE")) {
		t.Fatal("refusing any database other than session-01 disposable Merchant PostgreSQL")
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
	var database string
	if err = db.QueryRowContext(ctx, "SELECT current_database()").Scan(&database); err != nil ||
		database != "merchant_agent01" {
		t.Fatalf("unexpected database %q, err=%v", database, err)
	}

	schema := fmt.Sprintf("merchant_session01_%d", time.Now().UnixNano())
	baseline, err := os.ReadFile(filepath.Join("..", "..", "..", "database", "migrations", "001_public_discovery.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, strings.ReplaceAll(string(baseline), "__SCHEMA__", schema)); err != nil {
		t.Fatalf("synthetic DSH schema migration: %v", err)
	}
	defer db.ExecContext(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE")

	if _, err = db.ExecContext(ctx, "INSERT INTO "+schema+".service_cities(id,active) VALUES('sanaa-merchant01',true)"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+schema+".verticals(id,active) VALUES('grocery',true)"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, `INSERT INTO `+schema+`.stores(id,owner_actor_id,city_id,vertical_id,relation,name,published) VALUES
		('merchant-own-a','merchant-a','sanaa-merchant01','grocery','MARKETPLACE','Owned One',false),
		('merchant-own-b','merchant-a','sanaa-merchant01','grocery','DIRECT','Owned Two',true),
		('merchant-other','merchant-b','sanaa-merchant01','grocery','DIRECT','Unrelated Store',true)`); err != nil {
		t.Fatal(err)
	}
	grants, err := NewPostgresStoreGrants(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	own, err := grants.ListOwnedMerchantStores(ctx, "merchant-a")
	if err != nil || len(own) != 2 || own[0].ID != "merchant-own-a" ||
		own[1].ID != "merchant-own-b" || own[0].Published ||
		!own[1].Published || own[1].Relation != "DIRECT" {
		t.Fatalf("owner readback leaked or lost canonical rows: %+v, %v", own, err)
	}
	if err = grants.RequireStoreAction(ctx, "merchant-a", "merchant-other", "store_operations"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("cross-Store operation admitted: %v", err)
	}
	if err = grants.RequireStoreAction(ctx, "merchant-a", "merchant-own-a", "store_operations"); err != nil {
		t.Fatalf("actual Store owner denied: %v", err)
	}

	count := 0
	service, err := NewService(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, grants,
		fakePolicy{}, fakeRepo{applies: &count})
	if err != nil {
		t.Fatal(err)
	}
	handler, err := NewHandler(service)
	if err != nil {
		t.Fatal(err)
	}
	readHTTP := func(h http.Handler) (int, MerchantStoreStanding) {
		t.Helper()
		request := httptest.NewRequest(http.MethodGet, "/v1/stores/mine", nil)
		request.Header.Set("Authorization", "Bearer synthetic-session-01")
		recorder := httptest.NewRecorder()
		h.ServeHTTP(recorder, request)
		if recorder.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("owner HTTP response must not be cached")
		}
		var body MerchantStoreStanding
		if recorder.Code == http.StatusOK {
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
		}
		return recorder.Code, body
	}
	if status, body := readHTTP(handler); status != http.StatusOK ||
		body.ActorID != "merchant-a" || len(body.Stores) != 2 {
		t.Fatalf("HTTP owner read status=%d standing=%+v", status, body)
	}
	for _, tc := range []struct {
		role   ActorRole
		denied bool
		want   int
	}{
		{role: "CUSTOMER", want: http.StatusForbidden},
		{role: OperatorRole, want: http.StatusForbidden},
		{role: MerchantRole, denied: true, want: http.StatusUnauthorized},
	} {
		guarded, err := NewService(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: tc.role}, denied: tc.denied},
			grants, fakePolicy{}, fakeRepo{applies: &count})
		if err != nil {
			t.Fatal(err)
		}
		guardedHandler, err := NewHandler(guarded)
		if err != nil {
			t.Fatal(err)
		}
		if status, _ := readHTTP(guardedHandler); status != tc.want {
			t.Fatalf("role %s denied=%v: HTTP %d wanted %d", tc.role, tc.denied, status, tc.want)
		}
	}

	// Transfer ownership using a separate connection; read the durable DB state
	// back independently rather than trusting a simulated mutation response.
	if _, err = db.ExecContext(ctx, "UPDATE "+schema+".stores SET owner_actor_id='merchant-b' WHERE id='merchant-own-a'"); err != nil {
		t.Fatal(err)
	}
	independent, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer independent.Close()
	var persistedOwner string
	if err = independent.QueryRowContext(ctx, "SELECT owner_actor_id FROM "+schema+".stores WHERE id='merchant-own-a'").
		Scan(&persistedOwner); err != nil || persistedOwner != "merchant-b" {
		t.Fatalf("independent owner readback=%q err=%v", persistedOwner, err)
	}
	if status, body := readHTTP(handler); status != http.StatusOK ||
		len(body.Stores) != 1 || body.Stores[0].ID != "merchant-own-b" {
		t.Fatalf("transferred Store remained visible to former owner: status=%d %+v", status, body)
	}
	if err = grants.RequireStoreAction(ctx, "merchant-a", "merchant-own-a", "store_operations"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("transferred Store operation remained authorized: %v", err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO "+schema+`.stores(id,owner_actor_id,city_id,vertical_id,relation,name,published)
		SELECT 'merchant-overflow-'||i,'merchant-a','sanaa-merchant01','grocery','MARKETPLACE','Overflow',false
		FROM generate_series(1,101) AS i`); err != nil {
		t.Fatal(err)
	}
	if _, err = service.ListMerchantStores(ctx, "synthetic-session-01"); !errors.Is(err, ErrStoreOwnerUnavailable) {
		t.Fatalf("over-limit canonical Store authority must fail closed: %v", err)
	}
}

func TestMerchantIsolatedPostgresDSNGuard(t *testing.T) {
	const ci = "postgres://bthwani_session01:synthetic-only@127.0.0.1:5432/merchant_agent01?sslmode=disable"
	const windows = "postgres://bthwani_session01:synthetic-only@127.0.0.1:35328/merchant_agent01?sslmode=disable"
	const expectedContainer = "bthwani-session01-merchant-pg"
	for _, tc := range []struct {
		name, dsn, container, hostAddr, isolatedMode string
		allowed                                      bool
	}{
		{"container loopback", ci, expectedContainer, "", "true", true},
		{"legacy Windows loopback", windows, expectedContainer, "", "", true},
		{"wrong user", "postgres://other:synthetic-only@127.0.0.1:5432/merchant_agent01?sslmode=disable", expectedContainer, "", "true", false},
		{"wrong database", "postgres://bthwani_session01:synthetic-only@127.0.0.1:5432/production?sslmode=disable", expectedContainer, "", "true", false},
		{"remote host", "postgres://bthwani_session01:synthetic-only@198.51.100.25:5432/merchant_agent01?sslmode=disable", expectedContainer, "", "true", false},
		{"wrong container name", ci, "different-postgres", "", "true", false},
		{"missing container name", ci, "", "", "true", false},
		{"no explicit container mode", ci, expectedContainer, "", "", false},
		{"ambient PGHOSTADDR bypass", ci, expectedContainer, "198.51.100.25", "true", false},
		{"localhost PGHOSTADDR bypass", ci, expectedContainer, "127.0.0.1", "true", false},
		{"DSN hostaddr bypass", ci + "&hostaddr=198.51.100.25", expectedContainer, "", "true", false},
		{"unexpected local port", "postgres://bthwani_session01:synthetic-only@127.0.0.1:5433/merchant_agent01?sslmode=disable", expectedContainer, "", "true", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := isolatedMerchantTestDSN(tc.dsn, tc.container, tc.hostAddr, tc.isolatedMode)
			if got != tc.allowed {
				t.Fatalf("isolated merchant test DSN allowed=%v, wanted %v", got, tc.allowed)
			}
		})
	}
}
