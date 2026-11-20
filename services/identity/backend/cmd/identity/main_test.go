package main

import "testing"

func TestIsolatedVerifierTLSRequiresExplicitFilesAndScope(t *testing.T) {
	if cfg, err := isolatedVerifierTLS("", "", "", "", ""); err != nil || cfg != nil {
		t.Fatal("omitting both files must leave the private listener disabled")
	}
	for _, tc := range [][5]string{
		{"true", "true", "identity_test_local", "cert-only", ""},
		{"true", "", "identity_test_local", "cert", "key"},
		{"", "true", "identity_test_local", "cert", "key"},
		{"true", "true", "identity", "cert", "key"},
		{"true", "true", "identity_test_local", "missing-cert", "missing-key"},
	} {
		cfg, err := isolatedVerifierTLS(tc[0], tc[1], tc[2], tc[3], tc[4])
		if err == nil || cfg != nil {
			t.Fatalf("accepted invalid TLS scope or material: %v", tc)
		}
	}
}

func TestIsolatedDevelopmentListenerGate(t *testing.T) {
	for _, tc := range []struct {
		name, address, isolated, container, schema string
		allowed                                    bool
	}{
		{"local default", "127.0.0.1:3302", "true", "", "identity_test_agent03", true},
		{"local custom port", "127.0.0.1:3303", "true", "", "identity_test_agent03", true},
		{"container explicit", "0.0.0.0:3302", "true", "true", "identity_test_agent03", true},
		{"container not opted in", "0.0.0.0:3302", "true", "", "identity_test_agent03", false},
		{"non synthetic", "0.0.0.0:3302", "", "true", "identity_test_agent03", false},
		{"wrong schema", "0.0.0.0:3302", "true", "true", "dsh_test_agent03", false},
		{"empty suffix", "0.0.0.0:3302", "true", "true", "identity_test_", false},
		{"malformed schema", "0.0.0.0:3302", "true", "true", "identity_test_A", false},
		{"non default exposed port", "0.0.0.0:3303", "true", "true", "identity_test_agent03", false},
		{"IPv6 wildcard", "[::]:3302", "true", "true", "identity_test_agent03", false},
		{"hostname", "localhost:3302", "true", "true", "identity_test_agent03", false},
		{"public address", "192.0.2.4:3302", "true", "true", "identity_test_agent03", false},
		{"local without isolation", "127.0.0.1:3302", "", "", "identity_test_agent03", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if actual := allowedDevelopmentListen(tc.address, tc.isolated, tc.container, tc.schema); actual != tc.allowed {
				t.Fatalf("listener gate got %t want %t", actual, tc.allowed)
			}
		})
	}
}
