package customercart

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
)

func TestCheckoutReviewRejectsInvalidAndUnverifiedRequests(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://synthetic@127.0.0.1:1/unused?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h, err := NewHandler(db, "dsh_test_checkout", cartSessionAdapter{&testSession{}})
	if err != nil {
		t.Fatal(err)
	}
	self := `{"expectedCartVersion":1,"recipientPurpose":"SELF","fulfillmentMode":"CUSTOMER_PICKUP"}`
	delivery := `{"expectedCartVersion":1,"recipientPurpose":"OTHER","fulfillmentMode":"BTHWANI_CAPTAIN","addressId":"addr-00000000000000000000000000000001","expectedAddressVersion":1,"recipientName":"Synthetic recipient","recipientPhone":"+967700000001"}`
	for _, tc := range []struct {
		name, body, actor string
		status            int
	}{
		{"valid self requires identity", self, "", 401},
		{"valid other requires identity", delivery, "", 401},
		{"merchant denied", self, "merchant-a", 403},
		{"self cannot override identity", strings.Replace(self, "\"SELF\"", "\"SELF\",\"recipientPhone\":\"+967700000001\"", 1), "", 400},
		{"unknown mode", strings.Replace(self, "CUSTOMER_PICKUP", "UNKNOWN", 1), "", 400},
		{"no delivery address", strings.Replace(self, "CUSTOMER_PICKUP", "BTHWANI_CAPTAIN", 1), "", 400},
		{"pickup cannot carry delivery address", strings.Replace(delivery, "BTHWANI_CAPTAIN", "CUSTOMER_PICKUP", 1), "", 400},
		{"other needs phone", strings.Replace(delivery, "+967700000001", "", 1), "", 400},
		{"other needs name", strings.Replace(delivery, "Synthetic recipient", " ", 1), "", 400},
		{"caller actor forbidden", strings.Replace(self, "{", "{\"actorId\":\"customer-b\",", 1), "", 400},
		{"caller total forbidden", strings.Replace(self, "{", "{\"totalYer\":1,", 1), "", 400},
		{"duplicate version", strings.Replace(self, "{", "{\"expectedCartVersion\":2,", 1), "", 400},
		{"duplicate purpose", strings.Replace(self, "{", "{\"recipientPurpose\":\"OTHER\",", 1), "", 400},
		{"missing version", strings.Replace(self, "\"expectedCartVersion\":1,", "", 1), "", 400},
		{"invalid version", strings.Replace(self, ":1,", ":0,", 1), "", 400},
		{"trailing JSON", self + "{}", "", 400},
		{"null optional", strings.Replace(self, "{", "{\"recipientName\":null,", 1), "", 400},
		{"invalid phone", strings.Replace(delivery, "+967700000001", "abc", 1), "", 400},
		{"no database fallback", self, "customer-a", 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/v1/carts/store-a/checkout-review", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")
			if tc.actor != "" {
				req.Header.Set("Authorization", "Bearer "+cartTestBearer(tc.actor))
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.status || rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("got %d want %d: %s", rec.Code, tc.status, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "Synthetic recipient") || strings.Contains(rec.Body.String(), "+967700000001") {
				t.Fatal("private recipient leaked")
			}
		})
	}
	t.Run("SQL syntax rejected in Store selector", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/v1/carts/store-a%27%20OR%201%3D1--/checkout-review", bytes.NewBufferString(self))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+cartTestBearer("customer-a"))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 400 || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("invalid Store selector accepted: %d %s", rec.Code, rec.Body.String())
		}
	})
}

func checkoutReviewRequest(t *testing.T, h http.Handler, actor string, payload map[string]any) (int, []byte) {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, addressRequest("POST", "/v1/carts/store-a/checkout-review", actor, body))
	return rec.Code, rec.Body.Bytes()
}

func verifyCheckoutReviewOnPostgres(t *testing.T, ctx context.Context, db *sql.DB, schema string, h http.Handler) {
	t.Helper()
	const addressID = "addr-00000000000000000000000000000099"
	if _, err := db.ExecContext(ctx, "UPDATE "+schema+".stores SET latitude=15.3, longitude=44.2 WHERE id='store-a'"); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := db.ExecContext(ctx, "UPDATE "+schema+".stores SET latitude=NULL,longitude=NULL WHERE id='store-a'"); err != nil {
			t.Error(err)
		}
	}()
	pickup := map[string]any{"expectedCartVersion": 1, "recipientPurpose": "SELF", "fulfillmentMode": "CUSTOMER_PICKUP"}
	status, body := checkoutReviewRequest(t, h, "customer-a", pickup)
	assertCartStatus(t, status, 200, body)
	var review checkoutReviewResult
	if err := json.Unmarshal(body, &review); err != nil {
		t.Fatal(err)
	}
	if review.ActorID != "customer-a" || review.StoreID != "store-a" || review.CartVersion != 1 || review.Merchandise.MerchandiseSubtotalYER != "1100" || review.CheckoutReady || review.Delivery != nil || len(review.Blockers) != 3 {
		t.Fatalf("wrong pickup review: %s", body)
	}
	if review.StoreSchedule.Status != "UNAVAILABLE" || review.StoreSchedule.Version != 0 {
		t.Fatalf("unconfigured schedule fabricated evidence: %s", body)
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO "+schema+".store_operational_availability(store_id,store_timezone,paused_until,preparation_minutes,changed_by_actor,change_reason) VALUES ('store-a','UTC',transaction_timestamp()+interval '1 hour',15,'synthetic-operator','checkout test')"); err != nil {
		t.Fatal(err)
	}
	status, body = checkoutReviewRequest(t, h, "customer-a", pickup)
	assertCartStatus(t, status, 200, body)
	review = checkoutReviewResult{}
	if err := json.Unmarshal(body, &review); err != nil || review.StoreSchedule.Status != "PAUSED" || review.StoreSchedule.Version != 1 || review.CheckoutReady {
		t.Fatalf("pause must be read from owner: %s %v", body, err)
	}
	delivery := map[string]any{"expectedCartVersion": 1, "recipientPurpose": "OTHER", "fulfillmentMode": "BTHWANI_CAPTAIN", "addressId": addressID, "expectedAddressVersion": 2, "recipientName": "Synthetic recipient", "recipientPhone": "+967700000001"}
	status, body = checkoutReviewRequest(t, h, "customer-a", delivery)
	assertCartStatus(t, status, 200, body)
	review = checkoutReviewResult{}
	if err := json.Unmarshal(body, &review); err != nil {
		t.Fatal(err)
	}
	if review.Delivery == nil || review.Delivery.Evidence == nil || review.Delivery.Evidence.AddressVersion != 2 || review.Delivery.Evidence.PolicyVersion != 2 || review.Delivery.Status != "SERVICEABLE" || review.CheckoutReady || len(review.Blockers) != 3 {
		t.Fatalf("wrong delivery review: %s", body)
	}
	if strings.Contains(string(body), "Synthetic recipient") || strings.Contains(string(body), "+967700000001") {
		t.Fatal("private contact echoed")
	}
	if review.DistanceFee != nil {
		t.Fatal("unconfigured tariff fabricated an estimate")
	}
	// The existing fixture has an address one latitude degree from the Store.
	// Configure only this synthetic DSH owner row; never seed commercial prices.
	owner, err := storeavailability.NewPostgresPolicySource(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	bands, valid := storeavailability.DecodeDistanceBands([]byte(`[{"upToMeters":100000,"ratePerKmMinor":100},{"upToMeters":null,"ratePerKmMinor":200}]`))
	if !valid {
		t.Fatal("invalid fixture")
	}
	p, replay, err := owner.ApplyCityDeliveryPolicy(ctx, "synthetic-operator", "sanaa", "checkout-tariff-003", 2, 120000, bands, "Reviewed synthetic tariff")
	if err != nil || replay || p.Version != 3 {
		t.Fatalf("delivery policy owner write: %+v %v %v", p, replay, err)
	}
	status, body = checkoutReviewRequest(t, h, "customer-a", delivery)
	assertCartStatus(t, status, 200, body)
	review = checkoutReviewResult{}
	if err := json.Unmarshal(body, &review); err != nil || review.DistanceFee == nil ||
		review.DistanceFee.PolicyVersion != 3 || review.DistanceFee.DistanceMetres != 111195 ||
		review.DistanceFee.FeeYER != "12239" || review.CheckoutReady || review.Delivery.Evidence.PolicyVersion != 3 {
		t.Fatalf("expected same-version exact non-payable estimate: %s %v", body, err)
	}
	if _, err := db.ExecContext(ctx, "UPDATE "+schema+".service_city_delivery_policies SET version=4,distance_bands=$1::jsonb WHERE city_id='sanaa'", `[{"upToMeters":null,"ratePerKmMinor":0}]`); err != nil {
		t.Fatal(err)
	}
	status, body = checkoutReviewRequest(t, h, "customer-a", delivery)
	assertCartStatus(t, status, 200, body)
	review = checkoutReviewResult{}
	if err := json.Unmarshal(body, &review); err != nil || review.DistanceFee != nil || review.CheckoutReady {
		t.Fatalf("invalid tariff must not produce an estimate: %s %v", body, err)
	}
	bands, valid = storeavailability.DecodeDistanceBands([]byte(`[{"upToMeters":null,"ratePerKmMinor":100}]`))
	if !valid {
		t.Fatal("invalid fixture")
	}
	p, replay, err = owner.ApplyCityDeliveryPolicy(ctx, "synthetic-operator", "sanaa", "checkout-tariff-005", 4, 30000, bands, "Reviewed synthetic radius")
	if err != nil || replay || p.Version != 5 {
		t.Fatalf("delivery radius owner write: %+v %v %v", p, replay, err)
	}
	status, body = checkoutReviewRequest(t, h, "customer-a", delivery)
	assertCartStatus(t, status, 200, body)
	review = checkoutReviewResult{}
	if err := json.Unmarshal(body, &review); err != nil || review.DistanceFee != nil || review.Delivery.Status != "UNSERVICEABLE" || review.CheckoutReady {
		t.Fatalf("out of range must not produce a fee: %s %v", body, err)
	}
	// Keep the fixture compatible with subsequent cart checks.
	if _, err := db.ExecContext(ctx, "UPDATE "+schema+".service_city_delivery_policies SET version=6,radius_metres=120000,distance_bands=NULL WHERE city_id='sanaa'"); err != nil {
		t.Fatal(err)
	}
	delivery["expectedAddressVersion"] = 1
	status, body = checkoutReviewRequest(t, h, "customer-a", delivery)
	assertCartStatus(t, status, 409, body)
	delivery["expectedAddressVersion"] = 2
	delivery["addressId"] = "addr-00000000000000000000000000000088"
	status, body = checkoutReviewRequest(t, h, "customer-a", delivery)
	assertCartStatus(t, status, 409, body)
	status, body = checkoutReviewRequest(t, h, "customer-b", pickup)
	assertCartStatus(t, status, 409, body)
	pickup["expectedCartVersion"] = 2
	status, body = checkoutReviewRequest(t, h, "customer-a", pickup)
	assertCartStatus(t, status, 409, body)
	var version, commands, lines int
	if err := db.QueryRowContext(ctx, "SELECT version FROM "+schema+".customer_carts WHERE actor_id='customer-a' AND store_id='store-a'").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".customer_cart_commands WHERE actor_id='customer-a' AND store_id='store-a'").Scan(&commands); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM "+schema+".customer_cart_lines WHERE actor_id='customer-a' AND store_id='store-a'").Scan(&lines); err != nil {
		t.Fatal(err)
	}
	if version != 1 || commands != 1 || lines != 1 {
		t.Fatal("review changed persistent cart")
	}
}
