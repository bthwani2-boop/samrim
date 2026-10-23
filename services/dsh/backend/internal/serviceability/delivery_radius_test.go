package serviceability

import (
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestServiceabilityRejectsOutOfRadiusEvenInSameCity(t *testing.T) {
	base := postgres.ServiceabilityFacts{
		StoreOriginAvailable: true, AddressFound: true,
		StoreOriginLatitude: 15.3694457, StoreOriginLongitude: 44.1910064,
		AddressLatitude: 15.37, AddressLongitude: 44.19,
	}
	if !withinDeliveryCoverage(base) {
		t.Fatal("nearby address must be eligible")
	}
	base.AddressLatitude = 16.63 // about 140 km despite sharing the same service city
	if withinDeliveryCoverage(base) {
		t.Fatal("must reject 140 km as ordinary city delivery")
	}
	base.AddressLatitude = 15.3694457
	base.AddressLongitude = 44.1910064
	if !withinDeliveryCoverage(base) {
		t.Fatal("identical origin and destination must be eligible")
	}
	base.StoreOriginAvailable = false
	if withinDeliveryCoverage(base) {
		t.Fatal("missing origin cannot pass")
	}
	base.StoreOriginAvailable = true
	base.AddressLatitude = 91
	if withinDeliveryCoverage(base) {
		t.Fatal("invalid coordinates cannot pass")
	}
}
