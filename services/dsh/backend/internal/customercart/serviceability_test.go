package customercart

import (
	"context"
	"database/sql"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDeliveryDistanceAndPolicy(t *testing.T) {
	for _, tc := range []struct {
		name                   string
		storeCity, addressCity string
		lat, lon, alat, alon   float64
		radius                 int64
		want                   string
	}{
		{"same point", "sanaa", "sanaa", 15.3, 44.2, 15.3, 44.2, 1, "SERVICEABLE"},
		{"outside configured radius", "sanaa", "sanaa", 0, 0, 0, 1, 1000, "UNSERVICEABLE"},
		{"inside configured radius", "sanaa", "sanaa", 0, 0, 0, 1, 120000, "SERVICEABLE"},
		{"city mismatch", "sanaa", "aden", 15.3, 44.2, 15.3, 44.2, 30000, "UNSERVICEABLE"},
		{"missing policy", "sanaa", "sanaa", 15.3, 44.2, 15.3, 44.2, 0, "UNAVAILABLE"},
		{"invalid coordinates", "sanaa", "sanaa", 91, 0, 0, 0, 30000, "UNAVAILABLE"},
		{"nonfinite", "sanaa", "sanaa", math.NaN(), 0, 0, 0, 30000, "UNAVAILABLE"},
		{"date line", "sanaa", "sanaa", 0, 179.999, 0, -179.999, 300, "SERVICEABLE"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, _ := evaluateDeliveryDistance(tc.storeCity, tc.addressCity, tc.lat, tc.lon, tc.alat, tc.alon, tc.radius)
			if got != tc.want {
				t.Fatalf("got %s want %s", got, tc.want)
			}
		})
	}
}

func verifyServiceabilityOnRealPostgres(t *testing.T, ctx context.Context, db *sql.DB, schema string, h http.Handler, sessions *testSession) {
	t.Helper()
	const serviceAddressID = "addr-00000000000000000000000000000099"
	body, err := json.Marshal(addressInput())
	if err != nil {
		t.Fatal(err)
	}
	created := httptest.NewRecorder()
	h.ServeHTTP(created, addressRequest("PUT", "/v1/addresses/"+serviceAddressID, "customer-a", body))
	if created.Code != http.StatusOK {
		t.Fatalf("create address: %d %s", created.Code, created.Body.String())
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	read := func(actor, path string, want int) DeliveryServiceability {
		t.Helper()
		w := httptest.NewRecorder()
		h.ServeHTTP(w, addressRequest("GET", path, actor, nil))
		if w.Code != want || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("serviceability %d want %d: %s", w.Code, want, w.Body.String())
		}
		var result DeliveryServiceability
		if want == 200 {
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.ActorID != actor || result.StoreID != "store-a" || result.AddressID != serviceAddressID {
				t.Fatalf("wrong context: %+v", result)
			}
			if result.Status == "UNAVAILABLE" && result.Evidence != nil {
				t.Fatal("unavailable read disclosed evidence")
			}
		}
		return result
	}
	path := "/v1/carts/store-a/serviceability?addressId=" + serviceAddressID
	status := func(actor, want string) DeliveryServiceability {
		t.Helper()
		v := read(actor, path, 200)
		if v.Status != want {
			t.Fatalf("got %s want %s", v.Status, want)
		}
		return v
	}
	exec("UPDATE " + schema + ".stores SET latitude=15.3,longitude=44.2 WHERE id='store-a'")
	status("customer-a", "UNAVAILABLE") // missing policy
	exec("INSERT INTO " + schema + ".service_city_delivery_policies(city_id,version,radius_metres) VALUES ('sanaa',1,30000)")
	v := status("customer-a", "SERVICEABLE")
	if v.Evidence == nil || v.Evidence.PolicyVersion != 1 || v.Evidence.AddressVersion != 1 || v.Evidence.StoreCityID != "sanaa" {
		t.Fatalf("missing version evidence: %+v", v)
	}
	status("customer-b", "UNAVAILABLE")
	read("merchant-a", path, 403)
	read("", path, 401)
	read("customer-a", path+"&addressId="+serviceAddressID, 400)
	read("customer-a", path+"&actorId=customer-b", 400)
	exec("UPDATE "+schema+".customer_addresses SET latitude=16.3,version=version+1 WHERE actor_id='customer-a' AND id=$1", serviceAddressID)
	v = status("customer-a", "UNSERVICEABLE")
	if v.Evidence == nil || v.Evidence.AddressVersion != 2 || v.Evidence.DistanceMetres <= 30000 {
		t.Fatal("stale or wrong evidence")
	}
	exec("UPDATE " + schema + ".service_city_delivery_policies SET radius_metres=120000,version=2 WHERE city_id='sanaa'")
	v = status("customer-a", "SERVICEABLE")
	if v.Evidence.PolicyVersion != 2 {
		t.Fatal("stale policy")
	}
	exec("INSERT INTO " + schema + ".service_cities(id,active) VALUES ('aden',true)")
	exec("UPDATE "+schema+".customer_addresses SET city_id='aden' WHERE actor_id='customer-a' AND id=$1", serviceAddressID)
	status("customer-a", "UNSERVICEABLE")
	exec("UPDATE " + schema + ".service_cities SET active=false WHERE id='aden'")
	status("customer-a", "UNAVAILABLE")
	exec("UPDATE "+schema+".customer_addresses SET city_id='sanaa' WHERE actor_id='customer-a' AND id=$1", serviceAddressID)
	exec("UPDATE " + schema + ".stores SET published=false WHERE id='store-a'")
	status("customer-a", "UNAVAILABLE")
	exec("UPDATE " + schema + ".stores SET published=true,latitude=NULL,longitude=NULL WHERE id='store-a'")
	status("customer-a", "UNAVAILABLE")
	sessions.mu.Lock()
	sessions.revoked = true
	sessions.mu.Unlock()
	read("customer-a", path, 401)
	sessions.mu.Lock()
	sessions.revoked = false
	sessions.mu.Unlock()
}
