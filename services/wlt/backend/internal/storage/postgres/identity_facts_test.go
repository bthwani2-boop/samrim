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
