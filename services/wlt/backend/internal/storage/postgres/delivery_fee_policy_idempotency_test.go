package postgres

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

func TestDeliveryFeePolicyHashBindsActingOperatorAndPreservesLegacy(t *testing.T) {
	base := CreateDeliveryFeePolicyInput{
		ServiceCityID: "sanaa", BaseFeeMinor: 100,
		DistanceUnitMeters: 500, DistanceRateMinor: 50,
		OrderSizeUnitBaseUnits: 2, OrderSizeRateMinor: 25,
		ZoneSurchargeMinor: 0, RoundingUnitMinor: 50,
		ExpectedVersion: 0, Reason: "standard delivery pricing",
		ActingActorID: "operator-a",
	}
	initialHash := HashDeliveryFeePolicyRequest(base)
	retry := base
	if HashDeliveryFeePolicyRequest(retry) != initialHash {
		t.Fatal("unchanged operator replay must retain its hash")
	}
	other := base
	other.ActingActorID = "operator-b"
	if HashDeliveryFeePolicyRequest(other) == initialHash {
		t.Fatal("different operator incorrectly reuses the payment policy fingerprint")
	}
	historic := []string{
		"delivery-fee-policy", "sanaa", "100", "500", "50", "2",
		"25", "0", "50", "0", "standard delivery pricing",
	}
	legacySHA := sha256.Sum256([]byte(strings.Join(historic, "\x00")))
	expectedLegacy := hex.EncodeToString(legacySHA[:])
	if hashDeliveryFeePolicyRequest(base, false) != expectedLegacy ||
		hashDeliveryFeePolicyRequest(other, false) != expectedLegacy {
		t.Fatal("historical request fingerprints changed and would break persisted replays")
	}
	if initialHash == expectedLegacy {
		t.Fatal("new policy requests are not versioned against historical unbound actor hashes")
	}
}
