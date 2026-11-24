package customercart

import (
	"math"
	"testing"
)

func TestDistanceFeeEstimateExactBands(t *testing.T) {
	bands := []byte(`[{"upToMeters":2000,"ratePerKmMinor":300},{"upToMeters":4000,"ratePerKmMinor":200},{"upToMeters":null,"ratePerKmMinor":150}]`)
	for _, tc := range []struct {
		distance float64
		want     string
	}{
		{0, "0"}, {0.49, "0"}, {0.5, "1"}, {1000, "300"}, {2000, "600"}, {2001, "601"}, {3000, "800"}, {4000, "1000"}, {4001, "1001"}, {5000, "1150"}, {30000, "4900"},
	} {
		e := DeliveryEvidence{StoreCityID: "sanaa", AddressCityID: "sanaa", PolicyVersion: 7, RadiusMetres: 30000, DistanceMetres: tc.distance}
		got := estimateDistanceFee(DeliveryServiceability{Status: "SERVICEABLE", Evidence: &e}, bands)
		if got == nil || got.FeeYER != tc.want || got.PolicyVersion != 7 || got.DistanceMetres != int64(math.Round(tc.distance)) {
			t.Fatalf("distance %v: got %+v, expected %s", tc.distance, got, tc.want)
		}
	}
}

func TestDistanceFeeFailsClosed(t *testing.T) {
	valid := []byte(`[{"upToMeters":null,"ratePerKmMinor":300}]`)
	e := DeliveryEvidence{StoreCityID: "sanaa", AddressCityID: "sanaa", PolicyVersion: 2, RadiusMetres: 30000, DistanceMetres: 1000}
	service := DeliveryServiceability{Status: "SERVICEABLE", Evidence: &e}
	for _, raw := range []string{"", "null", "[]", `[{"ratePerKmMinor":300}]`,
		`[{"upToMeters":1000,"ratePerKmMinor":300}]`,
		`[{"upToMeters":null,"ratePerKmMinor":0}]`,
		`[{"upToMeters":null,"ratePerKmMinor":1.5}]`,
		`[{"upToMeters":null,"ratePerKmMinor":100000001}]`,
		`[{"upToMeters":null,"ratePerKmMinor":300,"extra":1}]`,
		`[{"upToMeters":2000,"ratePerKmMinor":300},{"upToMeters":1000,"ratePerKmMinor":200},{"upToMeters":null,"ratePerKmMinor":150}]`,
		`[{"upToMeters":null,"ratePerKmMinor":300},{"upToMeters":null,"ratePerKmMinor":150}]`,
		`[{"upToMeters":null,"ratePerKmMinor":300}] {}`,
	} {
		if got := estimateDistanceFee(service, []byte(raw)); got != nil {
			t.Fatalf("malformed policy %s: %+v", raw, got)
		}
	}
	for _, status := range []string{"UNAVAILABLE", "UNSERVICEABLE"} {
		service.Status = status
		if estimateDistanceFee(service, valid) != nil {
			t.Fatal("ineligible delivery priced")
		}
	}
	service.Status = "SERVICEABLE"
	for _, distance := range []float64{-1, 30000.00001, math.NaN(), math.Inf(1)} {
		e.DistanceMetres = distance
		if estimateDistanceFee(service, valid) != nil {
			t.Fatal("invalid distance priced")
		}
	}
	e.DistanceMetres = 1000
	e.AddressCityID = "aden"
	if estimateDistanceFee(service, valid) != nil {
		t.Fatal("foreign city priced")
	}
	e.AddressCityID = "sanaa"
	e.PolicyVersion = 0
	if estimateDistanceFee(service, valid) != nil {
		t.Fatal("unversioned policy priced")
	}
	service.Evidence = nil
	if estimateDistanceFee(service, valid) != nil {
		t.Fatal("missing evidence priced")
	}
}
