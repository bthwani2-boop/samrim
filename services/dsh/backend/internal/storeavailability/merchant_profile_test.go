package storeavailability

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/testfixture"
)

func TestMerchantStoreProfileHTTPBoundary(t *testing.T) {
	service := &MerchantStoreRegistrar{identity: fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}}
	handler := NewMerchantStoreProfileHandler(service)
	good := `{"operationId":"profile-operation-001","expectedVersion":1,"name":"متجر","description":""}`
	for _, c := range []struct {
		method, path, body, token, origin string
		status                            int
	}{
		{"GET", "/v1/stores/store-a/profile", "", "", "", 401},
		{"PATCH", "/v1/stores/store-a/profile", good, "", "", 401},
		{"PATCH", "/v1/stores/store-a/profile?actorId=merchant-b", good, "token", "", 400},
		{"PATCH", "/v1/stores/store-a/profile", good, "token", "https://foreign.example", 400},
		{"PATCH", "/v1/stores/store-a/profile", `{"operationId":"profile-operation-001","expectedVersion":1,"name":"name"}`, "token", "", 400},
		{"PATCH", "/v1/stores/store-a/profile", `{"operationId":"profile-operation-001","expectedVersion":1,"name":"name","description":null}`, "token", "", 400},
		{"PATCH", "/v1/stores/store-a/profile", `{"operationId":"profile-operation-001","expectedVersion":1,"name":"name","Name":"other","description":""}`, "token", "", 400},
		{"PATCH", "/v1/stores/store-a/profile", `{"operationId":"profile-operation-001","expectedVersion":1,"name":"name","description":"","published":true}`, "token", "", 400},
		{"PATCH", "/v1/stores/store-a/profile", strings.Repeat("x", 17000), "token", "", 400},
	} {
		r := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
		if c.token != "" {
			r.Header.Set("Authorization", "Bearer "+c.token)
		}
		r.Header.Set("Content-Type", "application/json")
		if c.origin != "" {
			r.Header.Set("Origin", c.origin)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != c.status || w.Header().Get("Cache-Control") != "no-store" {
			t.Errorf("%s %s: %d %s", c.method, c.path, w.Code, w.Body.String())
		}
	}
}

func TestMerchantStoreProfileRealPostgres(t *testing.T) {
	dsn := os.Getenv("BTHWANI_MERCHANT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("NOT_RUN: isolated merchant PostgreSQL not configured")
	}
	if !isolatedMerchantTestDSN(dsn, os.Getenv("BTHWANI_MERCHANT_TEST_CONTAINER"), os.Getenv("PGHOSTADDR"), os.Getenv("BTHWANI_ISOLATED_TEST_MODE")) {
		t.Fatal("fixture not admitted")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	schema := fmt.Sprintf("dsh_test_profile_%d", time.Now().UnixNano())
	testfixture.Fresh(t, ctx, db, "dsh", schema, filepath.Join("..", "..", "..", "database", "schema"))
	defer db.ExecContext(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
	for _, q := range []string{
		"INSERT INTO " + schema + ".service_cities(id,active) VALUES('sanaa',true)",
		"INSERT INTO " + schema + ".verticals(id,active) VALUES('grocery',true)",
		"INSERT INTO " + schema + ".stores(id,owner_actor_id,city_id,vertical_id,relation,name,published) VALUES ('store-a','merchant-a','sanaa','grocery','DIRECT','Original',false),('store-b','merchant-a','sanaa','grocery','MARKETPLACE','Published',true),('store-c','merchant-b','sanaa','grocery','DIRECT','Other',false)",
	} {
		if _, err = db.ExecContext(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	grants, err := NewPostgresStoreGrants(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewMerchantStoreRegistrar(fakeIdentity{actor: VerifiedActor{Subject: "merchant-a", Role: MerchantRole}}, grants)
	if err != nil {
		t.Fatal(err)
	}
	handler := NewMerchantStoreProfileHandler(service)
	call := func(method, store, body string, status int) []byte {
		t.Helper()
		r := httptest.NewRequest(method, "/v1/stores/"+store+"/profile", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer token")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != status || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: %d %s", method, store, w.Code, w.Body.String())
		}
		return w.Body.Bytes()
	}
	change := `{"operationId":"profile-operation-001","expectedVersion":1,"name":"متجر جديد","description":"وصف"}`
	call("GET", "store-c", "", 403)
	call("PATCH", "store-c", change, 403)
	call("PATCH", "store-b", change, 403)
	var first, replay MerchantStoreProfileResult
	if err = json.Unmarshal(call("PATCH", "store-a", change, 200), &first); err != nil || first.Replay || first.Profile.Version != 2 || first.Profile.Name != "متجر جديد" {
		t.Fatalf("first %+v %v", first, err)
	}
	if err = json.Unmarshal(call("PATCH", "store-a", change, 200), &replay); err != nil || !replay.Replay || replay.Profile != first.Profile {
		t.Fatalf("replay %+v %v", replay, err)
	}
	call("PATCH", "store-a", strings.Replace(change, "وصف", "different", 1), 409)
	call("PATCH", "store-a", strings.Replace(change, "operation-001", "operation-002", 1), 409)
	var read MerchantStoreProfile
	if err = json.Unmarshal(call("GET", "store-a", "", 200), &read); err != nil || read != first.Profile {
		t.Fatalf("readback %+v %v", read, err)
	}
	var name, description, owner, relation string
	var published bool
	var version, count int
	err = db.QueryRowContext(ctx, "SELECT name,description,owner_actor_id,relation,published,profile_version,(SELECT count(*) FROM "+schema+".store_profile_commands) FROM "+schema+".stores WHERE id='store-a'").Scan(&name, &description, &owner, &relation, &published, &version, &count)
	if err != nil || name != "متجر جديد" || description != "وصف" || owner != "merchant-a" || relation != "DIRECT" || published || version != 2 || count != 1 {
		t.Fatalf("durable state mismatch: %v %d %d", err, version, count)
	}
	if _, err = db.ExecContext(ctx, "UPDATE "+schema+".store_profile_commands SET result_name='tampered'"); err == nil {
		t.Fatal("audit mutation accepted")
	}
}
