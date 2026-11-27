package customercart

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const addressID = "addr-00000000000000000000000000000001"

func addressInput() map[string]any {
	return map[string]any{"cityId": "sanaa", "label": "بيت", "details": "عنوان اختبار اصطناعي", "latitude": 15.3, "longitude": 44.2, "expectedVersion": 0}
}
func addressRequest(method, path, actor string, body []byte) *http.Request {
	r := httptest.NewRequest(method, path, bytes.NewReader(body))
	if actor != "" {
		r.Header.Set("Authorization", "Bearer "+cartTestBearer(actor))
	}
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	return r
}
func TestCustomerAddressStrictBoundary(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://synthetic@127.0.0.1:1/unused?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h, err := NewHandler(db, "dsh_test_addresses", cartSessionAdapter{&testSession{}})
	if err != nil {
		t.Fatal(err)
	}
	good, _ := json.Marshal(addressInput())
	tests := []struct {
		method, path, actor string
		body                []byte
		status              int
	}{
		{"GET", "/v1/addresses", "", nil, 401},
		{"GET", "/v1/addresses", "merchant-a", nil, 403},
		{"GET", "/v1/addresses?actorId=customer-b", "customer-a", nil, 400},
		{"GET", "/v1/addresses?after=x&after=y", "customer-a", nil, 400},
		{"GET", "/v1/addresses?after=%ZZ", "customer-a", nil, 400},
		{"GET", "/v1/addresses/" + addressID, "", nil, 401},
		{"GET", "/v1/addresses/" + addressID, "merchant-a", nil, 403},
		{"GET", "/v1/addresses/bad", "customer-a", nil, 400},
		{"GET", "/v1/addresses/" + addressID + "?actorId=customer-b", "customer-a", nil, 400},
		{"GET", "/v1/addresses/" + addressID, "customer-a", good, 400},
		{"PUT", "/v1/addresses/" + addressID, "", good, 401},
		{"PUT", "/v1/addresses/" + addressID, "merchant-a", good, 403},
		{"PUT", "/v1/addresses/bad", "customer-a", good, 400},
		{"PUT", "/v1/addresses/" + addressID + "?actorId=customer-b", "customer-a", good, 400},
		{"PUT", "/v1/addresses/" + addressID, "customer-a", []byte(strings.Replace(string(good), "{", `{"actorId":"customer-b",`, 1)), 400},
		{"PUT", "/v1/addresses/" + addressID, "customer-a", []byte(strings.Replace(string(good), "{", `{"cityId":"aden",`, 1)), 400},
		{"PUT", "/v1/addresses/" + addressID, "customer-a", []byte(strings.Replace(string(good), `"latitude":15.3`, `"latitude":91`, 1)), 400},
		{"PUT", "/v1/addresses/" + addressID, "customer-a", []byte(strings.Replace(string(good), `"latitude":15.3,`, "", 1)), 400},
		{"PUT", "/v1/addresses/" + addressID, "customer-a", append(append([]byte{}, good...), []byte("{}")...), 400},
	}
	for _, tc := range tests {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, addressRequest(tc.method, tc.path, tc.actor, tc.body))
		if w.Code != tc.status || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: got %d want %d", tc.method, tc.path, w.Code, tc.status)
		}
	}
}

func verifyAddressesOnRealPostgres(t *testing.T, ctx context.Context, db *sql.DB, schema string, h http.Handler, sessions *testSession) {
	t.Helper()
	run := func(method, path, actor string, input any, want int) []byte {
		t.Helper()
		var body []byte
		if input != nil {
			body, _ = json.Marshal(input)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, addressRequest(method, path, actor, body))
		if w.Code != want {
			t.Fatalf("address %s %s status=%d want=%d body=%s", method, path, w.Code, want, w.Body.String())
		}
		return w.Body.Bytes()
	}
	path := "/v1/addresses/" + addressID
	input := addressInput()
	var created AddressResult
	if err := json.Unmarshal(run("PUT", path, "customer-a", input, 200), &created); err != nil || created.Replay || created.ActorID != "customer-a" || created.Address.Version != 1 {
		t.Fatalf("create: %+v %v", created, err)
	}
	var replay AddressResult
	if err := json.Unmarshal(run("PUT", path, "customer-a", input, 200), &replay); err != nil || !replay.Replay || replay.Address != created.Address {
		t.Fatalf("replay: %+v %v", replay, err)
	}
	var page AddressPage
	if err := json.Unmarshal(run("GET", "/v1/addresses", "customer-b", nil, 200), &page); err != nil || len(page.Items) != 0 || page.ActorID != "customer-b" {
		t.Fatal("cross-actor read")
	}
	input["expectedVersion"] = 1
	input["label"] = "عنوان محدث"
	run("PUT", path, "customer-b", input, 409)
	var updated AddressResult
	if err := json.Unmarshal(run("PUT", path, "customer-a", input, 200), &updated); err != nil || updated.Address.Version != 2 || updated.Address.Label != "عنوان محدث" {
		t.Fatal("update failed")
	}
	input["label"] = "stale overwrite"
	run("PUT", path, "customer-a", input, 409)
	input["expectedVersion"] = 2
	input["cityId"] = "unknown-city"
	run("PUT", path, "customer-a", input, 404)
	input["cityId"] = "sanaa"
	input["label"] = "ack-lost"
	// Commit is independent of the response being delivered; exact retry retains version.
	b, _ := json.Marshal(input)
	ack := &closedAck{header: make(http.Header)}
	h.ServeHTTP(ack, addressRequest("PUT", path, "customer-a", b))
	if ack.status != 200 {
		t.Fatal("write did not reach lost acknowledgement")
	}
	if err := json.Unmarshal(run("PUT", path, "customer-a", input, 200), &replay); err != nil || !replay.Replay || replay.Address.Version != 3 {
		t.Fatal("lost acknowledgement duplicate")
	}
	// Competing edits against the same version: one succeeds and one conflicts.
	statuses := make(chan int, 2)
	for _, label := range []string{"concurrent-a", "concurrent-b"} {
		go func(label string) {
			change := addressInput()
			change["expectedVersion"] = 3
			change["label"] = label
			data, _ := json.Marshal(change)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, addressRequest("PUT", path, "customer-a", data))
			statuses <- w.Code
		}(label)
	}
	a, z := <-statuses, <-statuses
	if !((a == 200 && z == 409) || (a == 409 && z == 200)) {
		t.Fatalf("competing edits: %d %d", a, z)
	}
	var count, version int
	if err := db.QueryRowContext(ctx, "SELECT count(*),max(version) FROM "+schema+".customer_addresses WHERE actor_id='customer-a' AND id=$1", addressID).Scan(&count, &version); err != nil || count != 1 || version != 4 {
		t.Fatalf("durable readback %d %d %v", count, version, err)
	}
	for n := 2; n <= 21; n++ {
		run("PUT", fmt.Sprintf("/v1/addresses/addr-%032x", n), "customer-a", addressInput(), 200)
	}
	if err := json.Unmarshal(run("GET", "/v1/addresses", "customer-a", nil, 200), &page); err != nil || len(page.Items) != 20 || page.NextCursor == "" {
		t.Fatal("first page")
	}
	cursor := page.NextCursor
	page = AddressPage{}
	if err := json.Unmarshal(run("GET", "/v1/addresses?after="+cursor, "customer-a", nil, 200), &page); err != nil || len(page.Items) != 1 || page.NextCursor != "" {
		t.Fatal("second page")
	}
	secondPageAddress := "/v1/addresses/" + page.Items[0].ID
	var read struct {
		ActorID string  `json:"actorId"`
		Address Address `json:"address"`
	}
	if err := json.Unmarshal(run("GET", secondPageAddress, "customer-a", nil, 200), &read); err != nil || read.ActorID != "customer-a" || read.Address != page.Items[0] {
		t.Fatalf("targeted later-page address read: %+v %v", read, err)
	}
	foreign := run("GET", secondPageAddress, "customer-b", nil, 404)
	missing := run("GET", "/v1/addresses/addr-ffffffffffffffffffffffffffffffff", "customer-b", nil, 404)
	if !bytes.Equal(foreign, missing) {
		t.Fatal("address lookup distinguishes foreign and missing records")
	}
	sessions.mu.Lock()
	sessions.revoked = true
	sessions.mu.Unlock()
	run("GET", secondPageAddress, "customer-a", nil, 401)
	run("GET", "/v1/addresses", "customer-a", nil, 401)
	run("PUT", path, "customer-a", input, 401)
	sessions.mu.Lock()
	sessions.revoked = false
	sessions.mu.Unlock()
}

func TestAddressAndFavoriteUseLiteralOwnerSQL(t *testing.T) {
	for _, path := range []string{"addresses.go", "favorites.go"} {
		t.Run(path, func(t *testing.T) {
			file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
			if err != nil {
				t.Fatal(err)
			}
			checked := 0
			ast.Inspect(file, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok {
					return true
				}
				method, ok := call.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				switch method.Sel.Name {
				case "QueryContext", "QueryRowContext", "ExecContext":
					checked++
					if len(call.Args) < 2 {
						t.Error("missing owner statement")
						return true
					}
					lit, ok := call.Args[1].(*ast.BasicLit)
					if !ok || lit.Kind != token.STRING {
						t.Errorf("%s must use fixed literal SQL", method.Sel.Name)
					}
				}
				return true
			})
			if checked == 0 {
				t.Fatal("no SQL calls examined")
			}
		})
	}
}
