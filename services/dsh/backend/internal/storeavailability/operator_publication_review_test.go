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

type publicationReviewIdentity struct {
	fakeIdentity
	allowed          bool
	permissionReads  int
	revokeAfterFirst bool
}

func (i *publicationReviewIdentity) RequireOperatorPermission(_ context.Context, _ string, _ string, permission string) error {
	i.permissionReads++
	if permission != "merchant" || !i.allowed || (i.revokeAfterFirst && i.permissionReads > 1) {
		return ErrForbidden
	}
	return nil
}

const reviewURL = "/v1/operators/cities/sanaa/store-publication-review/DIRECT"

func publicationReviewRequest(h http.Handler, method, path string, bearer bool) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, nil)
	if bearer {
		r.Header.Set("Authorization", "Bearer synthetic")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func publicationReviewMux(identity IdentitySessions, g *PostgresStoreGrants) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/v1/operators/cities/{cityID}/store-publication-review/{relation}", NewOperatorPublicationReviewHandler(identity, g))
	return mux
}

func TestOperatorPublicationReviewPermissionAndScope(t *testing.T) {
	for _, tc := range []struct {
		name            string
		role            ActorRole
		method, path    string
		allowed, bearer bool
		want            int
	}{
		{"anonymous", OperatorRole, "GET", reviewURL, true, false, 401},
		{"merchant not Operator", MerchantRole, "GET", reviewURL, true, true, 403},
		{"policy scope alone", OperatorRole, "GET", reviewURL, false, true, 403},
		{"invalid cursor", OperatorRole, "GET", reviewURL + "?after=../x", true, true, 400},
		{"repeated cursor", OperatorRole, "GET", reviewURL + "?after=a&after=b", true, true, 400},
		{"injected actor", OperatorRole, "GET", reviewURL + "?actorId=other", true, true, 400},
		{"bad relation", OperatorRole, "GET", strings.Replace(reviewURL, "DIRECT", "OTHER", 1), true, true, 400},
		{"write forbidden", OperatorRole, "PATCH", reviewURL, true, true, 405},
		{"head forbidden", OperatorRole, "HEAD", reviewURL, true, true, 405},
		{"owner unavailable", OperatorRole, "GET", reviewURL, true, true, 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			identity := &publicationReviewIdentity{fakeIdentity: fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: tc.role}}, allowed: tc.allowed}
			w := publicationReviewRequest(publicationReviewMux(identity, nil), tc.method, tc.path, tc.bearer)
			if w.Code != tc.want {
				t.Fatalf("status %d want %d: %s", w.Code, tc.want, w.Body.String())
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("review data must not be cacheable")
			}
		})
	}
}

func TestOperatorPublicationReviewRealPostgres(t *testing.T) {
	dsn := os.Getenv("BTHWANI_MERCHANT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("NOT_RUN: disposable Merchant PostgreSQL not configured")
	}
	if !isolatedMerchantTestDSN(dsn, os.Getenv("BTHWANI_MERCHANT_TEST_CONTAINER"), os.Getenv("PGHOSTADDR"), os.Getenv("BTHWANI_ISOLATED_TEST_MODE")) {
		t.Fatal("refusing non-isolated database")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	var database, role string
	if err = db.QueryRowContext(ctx, "SELECT current_database(),current_user").Scan(&database, &role); err != nil || database != "merchant_agent01" || role != "bthwani_session01" {
		t.Fatal("fixture identity mismatch")
	}
	schema := fmt.Sprintf("merchant_review_%d", time.Now().UnixNano())
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
	exec := func(statement string, args ...any) {
		t.Helper()
		if _, e := db.ExecContext(ctx, strings.ReplaceAll(statement, "__SCHEMA__", schema), args...); e != nil {
			t.Fatal(e)
		}
	}
	exec("INSERT INTO __SCHEMA__.service_cities(id,active) VALUES('sanaa',true),('aden',true)")
	exec("INSERT INTO __SCHEMA__.verticals(id,active) VALUES('grocery',true)")
	exec("INSERT INTO __SCHEMA__.store_registration_terms(version,body) VALUES('review-terms-v1','Synthetic terms')")
	for n := 1; n <= 21; n++ {
		id := fmt.Sprintf("store-%02d", n)
		exec("INSERT INTO __SCHEMA__.stores(id,owner_actor_id,city_id,vertical_id,relation,name,published,latitude,longitude) VALUES($1,'merchant-a','sanaa','grocery','DIRECT',$1,false,15.3,44.2)", id)
	}
	exec("INSERT INTO __SCHEMA__.stores(id,owner_actor_id,city_id,vertical_id,relation,name,published) VALUES('published','merchant-a','sanaa','grocery','DIRECT','Published',true),('other-relation','merchant-a','sanaa','grocery','MARKETPLACE','Market',false),('other-city','merchant-a','aden','grocery','DIRECT','Other',false)")
	exec("INSERT INTO __SCHEMA__.store_registration_commands(actor_id,operation_id,request_hash,store_id,policy_version,terms_version) VALUES('merchant-a','review-operation-001',repeat('a',64),'store-01',1,'review-terms-v1')")
	g, err := NewPostgresStoreGrants(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	i := &publicationReviewIdentity{fakeIdentity: fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: OperatorRole}}, allowed: true}
	h := publicationReviewMux(i, g)
	read := func(path string) PublicationReviewPage {
		t.Helper()
		w := publicationReviewRequest(h, "GET", path, true)
		if w.Code != 200 {
			t.Fatalf("%d: %s", w.Code, w.Body.String())
		}
		var p PublicationReviewPage
		if e := json.Unmarshal(w.Body.Bytes(), &p); e != nil {
			t.Fatal(e)
		}
		return p
	}
	first := read(reviewURL)
	if first.CityID != "sanaa" || first.Relation != "DIRECT" || len(first.Items) != 20 || first.NextCursor != "store-20" {
		t.Fatalf("bad first page: %+v", first)
	}
	if !first.Items[0].RegistrationTermsRecorded || !first.Items[0].LocationRecorded || first.Items[0].WeeklyHoursRecorded || first.Items[0].CatalogRecorded || first.Items[1].RegistrationTermsRecorded {
		t.Fatalf("invented or missing evidence: %+v", first.Items[0])
	}
	next := read(reviewURL + "?after=" + first.NextCursor)
	if len(next.Items) != 1 || next.Items[0].ID != "store-21" || next.NextCursor != "" {
		t.Fatalf("bad keyset: %+v", next)
	}
	market := read(strings.Replace(reviewURL, "DIRECT", "MARKETPLACE", 1))
	if len(market.Items) != 1 || market.Items[0].ID != "other-relation" {
		t.Fatal("cross-relation read")
	}
	aden := read(strings.Replace(reviewURL, "sanaa", "aden", 1))
	if len(aden.Items) != 1 || aden.Items[0].ID != "other-city" {
		t.Fatal("cross-city read")
	}
	i.permissionReads = 0
	i.revokeAfterFirst = true
	w := publicationReviewRequest(h, "GET", reviewURL, true)
	if w.Code != 403 || strings.Contains(w.Body.String(), "store-01") {
		t.Fatal("revoked permission leaked review")
	}
	var count int
	if err = db.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".stores WHERE published").Scan(&count); err != nil || count != 1 {
		t.Fatal("review changed publication")
	}
}
