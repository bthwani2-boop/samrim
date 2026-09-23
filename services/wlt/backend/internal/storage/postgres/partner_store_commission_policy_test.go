package postgres

import "testing"

func TestPartnerStoreCommissionModeIsBoundedToGovernedModes(t *testing.T) {
	for _, test := range []struct {
		mode string
		want bool
	}{
		{mode: "BTHWANI_CAPTAIN", want: true},
		{mode: "PARTNER_CAPTAIN", want: true},
		{mode: "CUSTOMER_PICKUP", want: true},
		{mode: "PARTNER_DELIVERY", want: false},
		{mode: "partner_captain", want: false},
		{mode: "", want: false},
	} {
		t.Run(test.mode, func(t *testing.T) {
			if got := isPartnerStoreCommissionMode(test.mode); got != test.want {
				t.Fatalf("isPartnerStoreCommissionMode(%q) = %t, want %t", test.mode, got, test.want)
			}
		})
	}
}

func TestPartnerCommissionUsesAllocationSnapshotRate(t *testing.T) {
	snapshot := &PartnerStoreCommissionSnapshot{RateBps: 1000, PolicyVersion: 1, ProfileID: "profile-original", ProfileVersion: 1, RoundingUnitMinor: 50, SettlementPeriod: "WEEKLY"}
	got, err := partnerCommissionFromSnapshot(10000, snapshot)
	if err != nil || got != 1000 {
		t.Fatalf("partnerCommissionFromSnapshot() = (%d, %v), want (1000, nil)", got, err)
	}

	changedSnapshot := *snapshot
	changedSnapshot.RateBps = 2500
	got, err = partnerCommissionFromSnapshot(10000, &changedSnapshot)
	if err != nil || got != 2500 {
		t.Fatalf("commission calculation for a distinct order snapshot = (%d, %v), want (2500, nil)", got, err)
	}
}

func TestPartnerCommissionRejectsMissingOrInvalidSnapshot(t *testing.T) {
	if _, err := partnerCommissionFromSnapshot(10000, nil); err != ErrPartnerCommissionSnapshotMissing {
		t.Fatalf("missing snapshot error = %v, want %v", err, ErrPartnerCommissionSnapshotMissing)
	}
	invalid := &PartnerStoreCommissionSnapshot{RateBps: 1000, PolicyVersion: 0, ProfileID: "profile", ProfileVersion: 1, RoundingUnitMinor: 50, SettlementPeriod: "WEEKLY"}
	if _, err := partnerCommissionFromSnapshot(10000, invalid); err != ErrPartnerCommissionSnapshotMissing {
		t.Fatalf("invalid snapshot error = %v, want %v", err, ErrPartnerCommissionSnapshotMissing)
	}
}
