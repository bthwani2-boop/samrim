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
	"time"

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
	self := `{"expectedCartVersion":1,"salesChannel":"DIRECT","recipientPurpose":"SELF","fulfillmentMode":"CUSTOMER_PICKUP"}`
	delivery := `{"expectedCartVersion":1,"salesChannel":"DIRECT","recipientPurpose":"OTHER","fulfillmentMode":"BTHWANI_CAPTAIN","addressId":"addr-00000000000000000000000000000001","expectedAddressVersion":1,"recipientName":"Synthetic recipient","recipientPhone":"+967700000001"}`
	for _, tc := range []struct {
		name, body, actor string
		status            int
	}{
		{"valid self requires identity", self, "", 401},
		{"valid other requires identity", delivery, "", 401},
		{"missing channel", strings.Replace(self, "\"salesChannel\":\"DIRECT\",", "", 1), "", 400},
		{"unknown channel", strings.Replace(self, "DIRECT", "UNKNOWN", 1), "", 400},
		{"duplicate channel", strings.Replace(self, "{", "{\"salesChannel\":\"MARKETPLACE\",", 1), "", 400},
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
	pickup := map[string]any{"expectedCartVersion": 1, "salesChannel": "DIRECT", "recipientPurpose": "SELF", "fulfillmentMode": "CUSTOMER_PICKUP"}
	status, body := checkoutReviewRequest(t, h, "customer-a", pickup)
	assertCartStatus(t, status, 200, body)
	var review checkoutReviewResult
	if err := json.Unmarshal(body, &review); err != nil {
		t.Fatal(err)
	}
	if review.ActorID != "customer-a" || review.StoreID != "store-a" || review.CartVersion != 1 || review.Merchandise.MerchandiseSubtotalYER != "1100" || review.CheckoutReady || review.Delivery != nil || len(review.Blockers) != 3 {
		t.Fatalf("wrong pickup review: %s", body)
	}
	if review.CityFulfillment != (storeavailability.CityFulfillmentEvidence{StoreRelation: "MARKETPLACE", Status: "DENIED_BY_CITY_POLICY", Version: 1}) {
		t.Fatalf("Direct channel must respect the actual Marketplace policy: %s", body)
	}
	owner, err := storeavailability.NewPostgresPolicySource(db, schema)
	if err != nil {
		t.Fatal(err)
	}
	policy, replay, err := owner.ApplyCityFulfillmentPolicy(ctx, "synthetic-operator", "sanaa", "MARKETPLACE",
		"checkout-mode-002", 1, []string{"CUSTOMER_PICKUP"}, "Synthetic checkout mode")
	if err != nil || replay || policy.Version != 2 {
		t.Fatalf("fixture policy successor: %+v %v %v", policy, replay, err)
	}
	// Both channels may review the same MARKETPLACE Store and the same cart.
	for _, relation := range []string{"MARKETPLACE", "DIRECT"} {
		if _, err := db.ExecContext(ctx, "UPDATE "+schema+".stores SET relation=$1 WHERE id='store-a'", relation); err != nil {
			t.Fatal(err)
		}
		for _, channel := range []string{"DIRECT", "MARKETPLACE"} {
			pickup["salesChannel"] = channel
			status, body = checkoutReviewRequest(t, h, "customer-a", pickup)
			if relation == "DIRECT" && channel == "MARKETPLACE" {
				assertCartStatus(t, status, 409, body)
				if !strings.Contains(string(body), "SALES_CHANNEL_NOT_ELIGIBLE") {
					t.Fatalf("forbidden channel did not fail closed: %s", body)
				}
				continue
			}
			assertCartStatus(t, status, 200, body)
			var accepted checkoutReviewResult
			want := "DENIED_BY_CITY_POLICY"
			if relation == "MARKETPLACE" {
				want = "ALLOWED_BY_CITY_POLICY"
			}
			if err := json.Unmarshal(body, &accepted); err != nil || accepted.SalesChannel != channel || accepted.CheckoutReady ||
				accepted.CityFulfillment != (storeavailability.CityFulfillmentEvidence{StoreRelation: relation, Status: want, Version: 2}) ||
				strings.Contains(string(body), "Synthetic checkout mode") {
				t.Fatalf("invalid channel evidence: %s (%v)", body, err)
			}
		}
	}
	if _, err := db.ExecContext(ctx, "UPDATE "+schema+".stores SET relation='MARKETPLACE' WHERE id='store-a'"); err != nil {
		t.Fatal(err)
	}
	pickup["salesChannel"] = "DIRECT"
	if review.StoreSchedule.Status != "UNAVAILABLE" || review.StoreSchedule.Version != 0 {
		t.Fatalf("unconfigured schedule fabricated evidence: %s", body)
	}
	var pauseEnd time.Time
	if err := db.QueryRowContext(ctx, "INSERT INTO "+schema+".store_operational_availability(store_id,store_timezone,paused_until,preparation_minutes,changed_by_actor,change_reason) VALUES ('store-a','UTC',transaction_timestamp()+interval '1 hour',15,'synthetic-operator','checkout test') RETURNING paused_until").Scan(&pauseEnd); err != nil {
		t.Fatal(err)
	}
	status, body = checkoutReviewRequest(t, h, "customer-a", pickup)
	assertCartStatus(t, status, 200, body)
	review = checkoutReviewResult{}
	if err := json.Unmarshal(body, &review); err != nil || review.StoreSchedule.Status != "PAUSED" || review.StoreSchedule.Version != 1 ||
		review.StoreSchedule.PausedUntil == nil || !review.StoreSchedule.PausedUntil.Equal(pauseEnd) || review.CheckoutReady {
		t.Fatalf("pause must be read from owner: %s %v", body, err)
	}
	// A Store cannot remain orderable after its vertical is disabled. The
	// shared schedule query must preserve the cart's fail-closed boundary.
	if _, err := db.ExecContext(ctx, "UPDATE "+schema+".verticals SET active=false WHERE id='grocery'"); err != nil {
		t.Fatal(err)
	}
	status, body = checkoutReviewRequest(t, h, "customer-a", pickup)
	if _, err := db.ExecContext(ctx, "UPDATE "+schema+".verticals SET active=true WHERE id='grocery'"); err != nil {
		t.Fatal(err)
	}
	assertCartStatus(t, status, 409, body)
	if !strings.Contains(string(body), "CART_LINE_UNAVAILABLE") {
		t.Fatalf("disabled vertical did not fail closed: %s", body)
	}
	delivery := map[string]any{"expectedCartVersion": 1, "salesChannel": "DIRECT", "recipientPurpose": "OTHER", "fulfillmentMode": "BTHWANI_CAPTAIN", "addressId": addressID, "expectedAddressVersion": 2, "recipientName": "Synthetic recipient", "recipientPhone": "+967700000001"}
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

func TestCheckoutReviewRejectsAmbiguousHTTPEnvelope(t *testing.T) {
	const body = `{"expectedCartVersion":1,"salesChannel":"DIRECT","recipientPurpose":"SELF","fulfillmentMode":"CUSTOMER_PICKUP"}`
	for _, tc := range []struct {
		name            string
		media, encoding []string
		valid           bool
	}{
		{"plain JSON", []string{"application/json"}, nil, true},
		{"UTF8 JSON", []string{"application/json; charset=UTF-8"}, nil, true},
		{"duplicate media", []string{"application/json", "application/json"}, nil, false},
		{"conflicting media", []string{"application/json", "text/plain"}, nil, false},
		{"hidden encoding", []string{"application/json"}, []string{"", "gzip"}, false},
		{"unsupported charset", []string{"application/json; charset=iso-8859-1"}, nil, false},
		{"encoded body", []string{"application/json"}, []string{"gzip"}, false},
		{"missing media", nil, nil, false},
		{"wrong media", []string{"text/plain"}, nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/v1/carts/store-a/checkout-review", strings.NewReader(body))
			req.SetPathValue("storeID", "store-a")
			for _, value := range tc.media {
				req.Header.Add("Content-Type", value)
			}
			for _, value := range tc.encoding {
				req.Header.Add("Content-Encoding", value)
			}
			_, valid := decodeCheckoutReview(httptest.NewRecorder(), req)
			if valid != tc.valid {
				t.Fatalf("admitted=%v want=%v", valid, tc.valid)
			}
		})
	}
}

func TestCheckoutReviewStrictWireAndBoundedBody(t *testing.T) {
	const self = `{"expectedCartVersion":1,"salesChannel":"DIRECT","recipientPurpose":"SELF","fulfillmentMode":"CUSTOMER_PICKUP"}`
	const other = `{"expectedCartVersion":1,"salesChannel":"MARKETPLACE","recipientPurpose":"OTHER","fulfillmentMode":"PARTNER_CAPTAIN","addressId":"addr-00000000000000000000000000000001","expectedAddressVersion":2,"recipientName":"Synthetic","recipientPhone":"+967700000001","deliveryInstructions":"Front door"}`
	cases := []struct {
		name, body string
		valid      bool
	}{
		{"self", self, true},
		{"other delivery", other, true},
		{"missing purpose", strings.Replace(self, `"recipientPurpose":"SELF",`, "", 1), false},
		{"unknown purpose", strings.Replace(self, "SELF", "UNKNOWN", 1), false},
		{"wrong case", strings.Replace(self, "salesChannel", "SalesChannel", 1), false},
		{"escaped duplicate", strings.Replace(self, "{", `{"sales\u0043hannel":"DIRECT",`, 1), false},
		{"null required", strings.Replace(self, ":1,", ":null,", 1), false},
		{"null address", strings.Replace(other, `"addr-00000000000000000000000000000001"`, "null", 1), false},
		{"null instructions", strings.Replace(other, `"Front door"`, " null ", 1), false},
		{"wrong optional type", strings.Replace(other, `"Front door"`, "42", 1), false},
		{"unpaired surrogate", strings.Replace(other, "Synthetic", `\ud800`, 1), false},
		{"invalid UTF8", strings.Replace(other, "Synthetic", string([]byte{0xff}), 1), false},
		{"unsafe version", strings.Replace(self, ":1,", ":9007199254740992,", 1), false},
		{"unknown selector", strings.Replace(self, "{", `{"storeId":"store-b",`, 1), false},
		{"exact limit", self + strings.Repeat(" ", checkoutReviewMaxBody-len(self)), true},
		{"oversized", self + strings.Repeat(" ", checkoutReviewMaxBody-len(self)+1), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/v1/carts/store-a/checkout-review", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			req.SetPathValue("storeID", "store-a")
			// Exercise the streaming size cap, not merely Content-Length admission.
			req.ContentLength = -1
			_, ok := decodeCheckoutReview(httptest.NewRecorder(), req)
			if ok != tc.valid {
				t.Fatalf("admitted=%v want=%v", ok, tc.valid)
			}
		})
	}
}
