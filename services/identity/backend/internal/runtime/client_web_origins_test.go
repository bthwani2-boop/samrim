package runtime

import (
	"strings"
	"testing"
)

func TestClientWebOriginMustBeApprovedAndHTTPSInProduction(t *testing.T) {
	for _, tc := range []struct {
		name, allowed, client string
		wantError             bool
	}{
		{"valid https client", "https://client.example.com", "https://client.example.com", false},
		{"unapproved client origin", "https://client.example.com", "https://evil.example.com", true},
		{"non-https client origin", "http://client.example.com", "http://client.example.com", true},
		{"trailing slash is not a browser Origin", "https://client.example.com/", "https://client.example.com/", true},
		{"path is not a browser Origin", "https://client.example.com/app", "https://client.example.com/app", true},
		{"query is not a browser Origin", "https://client.example.com?foo=1", "https://client.example.com?foo=1", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setRuntimeConfigBaseline(t)
			t.Setenv("IDENTITY_CORS_ALLOWED_ORIGINS", tc.allowed)
			t.Setenv("IDENTITY_CLIENT_WEB_ORIGINS", tc.client)
			t.Setenv("IDENTITY_WEBAUTHN_RP_ID", "client.example.com")
			t.Setenv("IDENTITY_WEBAUTHN_ALLOWED_ORIGINS", "https://client.example.com")
			got, err := loadConfig("8082")
			if tc.wantError {
				if err == nil || !strings.Contains(err.Error(), "IDENTITY_CLIENT_WEB_ORIGINS") {
					t.Fatalf("untrusted browser origin not rejected: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("valid origin rejected: %v", err)
			}
			if !got.clientWebOrigins[tc.client] {
				t.Fatal("expected approved client origin in config")
			}
		})
	}
}
