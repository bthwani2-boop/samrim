package session

import "testing"

func TestOperatorPasskeyOriginPolicyRejectsUntrustedRPBinding(t *testing.T) {
	valid := OperatorPasskeyOriginPolicy{
		RPID:    "bthwani.com",
		Origins: []string{"https://operator.bthwani.com"},
	}
	if err := validateOperatorPasskeyOriginPolicy(valid, false); err != nil {
		t.Fatalf("valid HTTPS Operator origin rejected: %v", err)
	}
	for _, tc := range []struct {
		name     string
		origin   string
		rpid     string
		isolated bool
	}{
		{"untrusted HTTP", "http://operator.bthwani.com", "bthwani.com", false},
		{"HTTP local outside isolated", "http://localhost:13000", "localhost", false},
		{"localhost root outside isolated", "https://localhost", "localhost", false},
		{"fake subdomain", "https://operator.bthwani.com.evil.example", "bthwani.com", false},
		{"prefix spoof", "https://evilbthwani.com", "bthwani.com", false},
		{"another root", "https://merchant.example", "bthwani.com", false},
		{"userinfo spoof", "https://operator.bthwani.com@evil.example", "bthwani.com", false},
		{"wildcard origin", "https://*.bthwani.com", "bthwani.com", false},
		{"origin query", "https://operator.bthwani.com?actorId=root", "bthwani.com", false},
		{"origin fragment", "https://operator.bthwani.com#root", "bthwani.com", false},
		{"origin path", "https://operator.bthwani.com/login", "bthwani.com", false},
		{"origin trailing slash", "https://operator.bthwani.com/", "bthwani.com", false},
		{"invalid port", "https://operator.bthwani.com:65536", "bthwani.com", false},
		{"port zero", "https://operator.bthwani.com:0", "bthwani.com", false},
		{"IP origin", "https://127.0.0.1", "bthwani.com", false},
		{"IP RP", "https://127.0.0.1", "127.0.0.1", false},
		{"insecure remote test", "http://localhost.evil.example", "localhost", true},
		{"lookalike local RP", "http://localhost", "localhosT", true},
		{"uppercase origin", "HTTPS://operator.bthwani.com", "bthwani.com", false},
		{"single-label public suffix", "https://example.com", "com", false},
		{"trailing-dot RP", "https://operator.bthwani.com", "bthwani.com.", false},
		{"disallowed null host", "https://", "bthwani.com", false},
		{"empty RP", "https://operator.bthwani.com", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := OperatorPasskeyOriginPolicy{RPID: tc.rpid, Origins: []string{tc.origin}}
			if err := validateOperatorPasskeyOriginPolicy(p, tc.isolated); err == nil {
				t.Fatalf("untrusted origin %q with RP %q accepted", tc.origin, tc.rpid)
			}
		})
	}
}
func TestOperatorPasskeyOriginPolicyRequiresExplicitUnambiguousOrigins(t *testing.T) {
	for _, origins := range [][]string{
		nil,
		{},
		{"https://operator.bthwani.com", "https://operator.bthwani.com"},
		{"https://operator.bthwani.com", "http://operator.bthwani.com"},
		{"https://operator.bthwani.com", ""},
		{"https://operator.bthwani.com", "https://ev.il"},
	} {
		if err := validateOperatorPasskeyOriginPolicy(OperatorPasskeyOriginPolicy{
			RPID: "bthwani.com", Origins: origins,
		}, false); err == nil {
			t.Fatalf("untrusted origin set accepted: %v", origins)
		}
	}
	if err := validateOperatorPasskeyOriginPolicy(OperatorPasskeyOriginPolicy{
		RPID: "localhost", Origins: []string{"http://localhost:13000"},
	}, true); err != nil {
		t.Fatalf("isolated local authenticator origin rejected: %v", err)
	}
	if err := validateOperatorPasskeyOriginPolicy(OperatorPasskeyOriginPolicy{
		RPID: "bthwani.com", Origins: []string{"https://operator.bthwani.com", "https://operator2.bthwani.com:443"},
	}, false); err != nil {
		t.Fatalf("strict multiple HTTPS hosts rejected: %v", err)
	}
}
