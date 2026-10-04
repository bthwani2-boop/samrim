package postgres

import "testing"

func validIdentityFactsFixture() IdentityFacts {
	return IdentityFacts{
		ActorType: "partner", ActorID: "partner-1", PhoneE164: "+967777000001", ActorVersion: 8,
		RoleVersion: 4, RoleEnabled: true, SecurityEnabled: true, OfficialName: "Canonical Partner",
		OfficialNameVersion: 3, OfficialNameStatus: "VERIFIED",
	}
}

func TestIdentityFactsRequireMatchingCanonicalActorAndCurrentVerifiedState(t *testing.T) {
	base := validIdentityFactsFixture()
	if !base.validFor("partner", "partner-1") {
		t.Fatal("valid canonical Identity facts rejected")
	}
	if !base.validFor(" PARTNER ", " partner-1 ") {
		t.Fatal("normalized actor identity rejected")
	}
	cases := []struct {
		name   string
		mutate func(*IdentityFacts)
	}{
		{name: "actor type mismatch", mutate: func(facts *IdentityFacts) { facts.ActorType = "captain" }},
		{name: "actor id mismatch", mutate: func(facts *IdentityFacts) { facts.ActorID = "partner-2" }},
		{name: "invalid phone", mutate: func(facts *IdentityFacts) { facts.PhoneE164 = "7777000001" }},
		{name: "missing actor version", mutate: func(facts *IdentityFacts) { facts.ActorVersion = 0 }},
		{name: "missing role version", mutate: func(facts *IdentityFacts) { facts.RoleVersion = 0 }},
		{name: "role disabled", mutate: func(facts *IdentityFacts) { facts.RoleEnabled = false }},
		{name: "security disabled", mutate: func(facts *IdentityFacts) { facts.SecurityEnabled = false }},
		{name: "missing official name", mutate: func(facts *IdentityFacts) { facts.OfficialName = " " }},
		{name: "missing official name version", mutate: func(facts *IdentityFacts) { facts.OfficialNameVersion = 0 }},
		{name: "unverified official name", mutate: func(facts *IdentityFacts) { facts.OfficialNameStatus = "PENDING" }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			facts := base
			test.mutate(&facts)
			if facts.validFor("partner", "partner-1") {
				t.Fatal("noncanonical Identity facts accepted")
			}
		})
	}
}

func TestLegacyCustomerWithdrawalSnapshotRequiresCurrentMatchingIdentity(t *testing.T) {
	facts := validIdentityFactsFixture()
	facts.ActorType = "customer"
	facts.ActorID = "customer-legacy-withdrawal"
	if !facts.matchesLegacyCustomerWithdrawalSnapshot(facts.ActorID, facts.PhoneE164, facts.OfficialName, facts.OfficialNameVersion) {
		t.Fatal("current verified facts matching the preserved legacy request were rejected")
	}
	changedPhone := facts
	changedPhone.PhoneE164 = "+967777000009"
	if changedPhone.matchesLegacyCustomerWithdrawalSnapshot(facts.ActorID, facts.PhoneE164, facts.OfficialName, facts.OfficialNameVersion) {
		t.Fatal("legacy request accepted a changed verified phone")
	}
	changedName := facts
	changedName.OfficialNameVersion++
	if changedName.matchesLegacyCustomerWithdrawalSnapshot(facts.ActorID, facts.PhoneE164, facts.OfficialName, facts.OfficialNameVersion) {
		t.Fatal("legacy request accepted a newer official name version")
	}
	if facts.matchesLegacyCustomerWithdrawalSnapshot("another-customer", facts.PhoneE164, facts.OfficialName, facts.OfficialNameVersion) {
		t.Fatal("legacy request accepted a different customer actor")
	}
}

func TestIdentityFactsFingerprintBindsCanonicalIdentityAndVersions(t *testing.T) {
	base := validIdentityFactsFixture()
	normalized := base
	normalized.ActorType = " PARTNER "
	normalized.ActorID = " partner-1 "
	normalized.PhoneE164 = " +967777000001 "
	normalized.OfficialName = " Canonical Partner "
	normalized.OfficialNameStatus = " verified "
	if base.fingerprint() != normalized.fingerprint() {
		t.Fatal("fingerprint changed after canonical whitespace/case normalization")
	}
	cases := []struct {
		name   string
		mutate func(*IdentityFacts)
	}{
		{name: "phone", mutate: func(facts *IdentityFacts) { facts.PhoneE164 = "+967777000002" }},
		{name: "actor version", mutate: func(facts *IdentityFacts) { facts.ActorVersion++ }},
		{name: "role version", mutate: func(facts *IdentityFacts) { facts.RoleVersion++ }},
		{name: "role enabled", mutate: func(facts *IdentityFacts) { facts.RoleEnabled = false }},
		{name: "security enabled", mutate: func(facts *IdentityFacts) { facts.SecurityEnabled = false }},
		{name: "official name", mutate: func(facts *IdentityFacts) { facts.OfficialName = "Different Name" }},
		{name: "official name version", mutate: func(facts *IdentityFacts) { facts.OfficialNameVersion++ }},
		{name: "official name status", mutate: func(facts *IdentityFacts) { facts.OfficialNameStatus = "PENDING" }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			facts := base
			test.mutate(&facts)
			if facts.fingerprint() == base.fingerprint() {
				t.Fatal("Identity fact mutation was not bound into the request fingerprint")
			}
		})
	}
}

func TestDestinationIdentitySnapshotStateAllowsOnlyExplicitLifecycleGate(t *testing.T) {
	cases := []struct {
		name               string
		status             string
		verificationStatus string
		requireActive      bool
		want               bool
	}{
		{name: "pending candidate can be independently verified", status: "CANDIDATE", verificationStatus: "PENDING_VERIFICATION", want: true},
		{name: "verified destination can be approved", status: "PENDING_APPROVAL", verificationStatus: "VERIFIED", want: true},
		{name: "active destination is eligible for payout", status: "ACTIVE_FOR_PAYOUT", verificationStatus: "VERIFIED", requireActive: true, want: true},
		{name: "pending destination is not eligible for payout", status: "PENDING_APPROVAL", verificationStatus: "VERIFIED", requireActive: true},
		{name: "candidate is not eligible for payout", status: "CANDIDATE", verificationStatus: "PENDING_VERIFICATION", requireActive: true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := destinationStateMatchesIdentitySnapshot(test.status, test.verificationStatus, test.requireActive); got != test.want {
				t.Fatalf("destinationStateMatchesIdentitySnapshot(%q, %q, %t) = %t, want %t", test.status, test.verificationStatus, test.requireActive, got, test.want)
			}
		})
	}
}

func TestIdentityFactsMustMatchEveryImmutablePayoutSnapshotField(t *testing.T) {
	facts := validIdentityFactsFixture()
	snapshot := PayoutSnapshotRecord{
		ActorType: "partner", ActorID: "partner-1", BeneficiaryName: facts.OfficialName,
		BeneficiaryIdentityVersion: facts.OfficialNameVersion, IdentityActorVersion: facts.ActorVersion,
		IdentityRoleVersion: facts.RoleVersion, RoleEnabled: facts.RoleEnabled,
		SecurityEnabled: facts.SecurityEnabled, OfficialNameStatus: facts.OfficialNameStatus,
		IdentitySnapshotKnown: true,
	}
	if !snapshot.matchesIdentityFacts(facts) {
		t.Fatal("matching current Identity facts rejected against payout snapshot")
	}
	if (PayoutSnapshotRecord{}).matchesIdentityFacts(facts) {
		t.Fatal("payout snapshot with unknown historical Identity facts accepted")
	}
	cases := []struct {
		name   string
		mutate func(*IdentityFacts)
	}{
		{name: "actor id", mutate: func(facts *IdentityFacts) { facts.ActorID = "partner-2" }},
		{name: "official name", mutate: func(facts *IdentityFacts) { facts.OfficialName = "Changed Name" }},
		{name: "official name version", mutate: func(facts *IdentityFacts) { facts.OfficialNameVersion++ }},
		{name: "actor version", mutate: func(facts *IdentityFacts) { facts.ActorVersion++ }},
		{name: "role version", mutate: func(facts *IdentityFacts) { facts.RoleVersion++ }},
		{name: "role enabled", mutate: func(facts *IdentityFacts) { facts.RoleEnabled = false }},
		{name: "security enabled", mutate: func(facts *IdentityFacts) { facts.SecurityEnabled = false }},
		{name: "official name status", mutate: func(facts *IdentityFacts) { facts.OfficialNameStatus = "PENDING" }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			changed := facts
			test.mutate(&changed)
			if snapshot.matchesIdentityFacts(changed) {
				t.Fatal("changed current Identity facts matched frozen payout snapshot")
			}
		})
	}
}

func TestLegacyPayoutSnapshotCanContinueOnlyForItsOriginalIdentityAndDestination(t *testing.T) {
	facts := validIdentityFactsFixture()
	snapshot := PayoutSnapshotRecord{
		ActorType: "partner", ActorID: "partner-1", BeneficiaryName: facts.OfficialName,
		BeneficiaryIdentityVersion: facts.OfficialNameVersion, ProviderKey: "YEMEN_MOBILE_WALLET",
		MaskedDestination: "••••1234", DestinationID: "destination-1", DestinationVersion: 3,
	}
	if snapshot.IdentitySnapshotKnown || !snapshot.matchesIdentityFacts(facts) {
		t.Fatal("legacy payout snapshot with unchanged canonical beneficiary facts was not preserved")
	}
	destination := OfficialWalletDestinationRecord{
		ID: snapshot.DestinationID, ActorType: snapshot.ActorType, ActorID: snapshot.ActorID,
		ProviderKey: snapshot.ProviderKey, WalletIdentifierMasked: snapshot.MaskedDestination,
		BeneficiaryName: snapshot.BeneficiaryName, BeneficiaryIdentityVersion: snapshot.BeneficiaryIdentityVersion,
		Version: snapshot.DestinationVersion, VerificationStatus: "VERIFIED", Status: "ACTIVE_FOR_PAYOUT",
	}
	if !snapshot.matchesDestination(destination) {
		t.Fatal("legacy payout snapshot no longer matches its reverified original destination")
	}
	cases := []struct {
		name   string
		mutate func(*OfficialWalletDestinationRecord)
	}{
		{name: "destination identity", mutate: func(destination *OfficialWalletDestinationRecord) { destination.ActorID = "partner-2" }},
		{name: "beneficiary name", mutate: func(destination *OfficialWalletDestinationRecord) { destination.BeneficiaryName = "Changed Name" }},
		{name: "provider", mutate: func(destination *OfficialWalletDestinationRecord) { destination.ProviderKey = "OTHER_PROVIDER" }},
		{name: "wallet number mask", mutate: func(destination *OfficialWalletDestinationRecord) {
			destination.WalletIdentifierMasked = "••••5678"
		}},
		{name: "destination id", mutate: func(destination *OfficialWalletDestinationRecord) { destination.ID = "destination-2" }},
		{name: "destination version", mutate: func(destination *OfficialWalletDestinationRecord) { destination.Version++ }},
		{name: "not verified", mutate: func(destination *OfficialWalletDestinationRecord) { destination.VerificationStatus = "STALE" }},
		{name: "not active", mutate: func(destination *OfficialWalletDestinationRecord) { destination.Status = "SUSPENDED" }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			changed := destination
			test.mutate(&changed)
			if snapshot.matchesDestination(changed) {
				t.Fatal("changed current destination matched immutable legacy payout snapshot")
			}
		})
	}
	for _, test := range []struct {
		name   string
		mutate func(*IdentityFacts)
	}{
		{name: "official name", mutate: func(facts *IdentityFacts) { facts.OfficialName = "Changed Name" }},
		{name: "official name version", mutate: func(facts *IdentityFacts) { facts.OfficialNameVersion++ }},
	} {
		t.Run("identity facts "+test.name, func(t *testing.T) {
			changed := facts
			test.mutate(&changed)
			if snapshot.matchesIdentityFacts(changed) {
				t.Fatal("changed current Identity facts matched immutable legacy payout snapshot")
			}
		})
	}
}
