package storeavailability

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type financeStandingIdentity struct {
	fakeIdentity
	grant string
	calls int
}

func (i *financeStandingIdentity) RequireOperatorPermission(_ context.Context, _ string, _ string, permission string) error {
	i.calls++
	if permission != "finance" || i.grant != "finance" {
		return ErrForbidden
	}
	return nil
}
func financialStandingMux(identity IdentitySessions, grants *PostgresStoreGrants) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/v1/operators/stores/{storeID}/financial-standing", NewOperatorFinancialStandingHandler(identity, grants))
	return mux
}

func TestOperatorFinancialStandingAdmission(t *testing.T) {
	const path = "/v1/operators/stores/store-a/financial-standing"
	for _, tc := range []struct {
		name, method, path, body, grant string
		role                            ActorRole
		authenticated                   bool
		status, calls                   int
	}{
		{"anonymous", "GET", path, "", "finance", OperatorRole, false, 401, 0},
		{"merchant", "GET", path, "", "finance", MerchantRole, true, 403, 0},
		{"operations", "GET", path, "", "operations", OperatorRole, true, 403, 1},
		{"unknown grant", "GET", path, "", "", OperatorRole, true, 403, 1},
		{"query injection", "GET", path + "?actorId=other", "", "finance", OperatorRole, true, 400, 0},
		{"empty query", "GET", path + "?", "", "finance", OperatorRole, true, 400, 0},
		{"body", "GET", path, "{}", "finance", OperatorRole, true, 400, 0},
		{"invalid Store", "GET", strings.Replace(path, "store-a", "STORE", 1), "", "finance", OperatorRole, true, 400, 0},
		{"HEAD", "HEAD", path, "", "finance", OperatorRole, true, 405, 0},
		{"write", "POST", path, "", "finance", OperatorRole, true, 405, 0},
		{"unavailable", "GET", path, "", "finance", OperatorRole, true, 503, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			identity := &financeStandingIdentity{fakeIdentity: fakeIdentity{actor: VerifiedActor{Subject: "operator-a", Role: tc.role}}, grant: tc.grant}
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			if tc.authenticated {
				req.Header.Set("Authorization", "Bearer synthetic")
			}
			w := httptest.NewRecorder()
			financialStandingMux(identity, nil).ServeHTTP(w, req)
			if w.Code != tc.status || identity.calls != tc.calls || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("got %d calls=%d body=%s", w.Code, identity.calls, w.Body.String())
			}
		})
	}
}

// Invoked by the existing real Identity + DSH PostgreSQL fixture, not a mock
// or shared environment. Finance permission changes are test-local only.
func verifyFinancialStanding(t *testing.T, ctx context.Context, db *sql.DB, identity IdentitySessions, grants *PostgresStoreGrants, identitySchema, dshSchema, operator, merchantA, merchantB, tokenOperator, tokenMerchant, store string) {
	t.Helper()
	server := httptest.NewServer(financialStandingMux(identity, grants))
	defer server.Close()
	read := func(token, id string, want int) FinancialStanding {
		t.Helper()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/v1/operators/stores/"+id+"/financial-standing", nil)
		if err != nil {
			t.Fatal(err)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != want || resp.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("financial standing got %d want %d", resp.StatusCode, want)
		}
		var result FinancialStanding
		if want == 200 {
			if err = json.NewDecoder(resp.Body).Decode(&result); err != nil {
				t.Fatal(err)
			}
		}
		return result
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	read("", store, 401)
	read(tokenMerchant, store, 403)
	read(tokenOperator, store, 403)
	exec("INSERT INTO "+identitySchema+".operator_permissions(actor_id,permission) VALUES($1,'finance')", operator)
	assert := func(owner string) {
		t.Helper()
		got := read(tokenOperator, store, 200)
		if got != (FinancialStanding{ActorID: operator, StoreID: store, Relation: "MARKETPLACE", OwnerActorID: owner}) {
			t.Fatalf("incorrect owner standing %+v", got)
		}
	}
	assert(merchantA)
	read(tokenOperator, "absent-finance-store", 404)
	exec("UPDATE "+dshSchema+".stores SET published=true,owner_actor_id=$1 WHERE id=$2", merchantB, store)
	assert(merchantB)
	exec("UPDATE "+dshSchema+".stores SET published=false,owner_actor_id=$1 WHERE id=$2", merchantA, store)
	exec("UPDATE "+identitySchema+".operator_permissions SET state='REVOKED' WHERE actor_id=$1 AND permission='finance'", operator)
	read(tokenOperator, store, 403)
	read(tokenOperator, "absent-finance-store", 403)
	t.Log("DSH_FINANCIAL_STANDING_PASS real_identity=true real_postgres=true unpublished=true published=true owner_transfer=true permission_revocation=true")
}
