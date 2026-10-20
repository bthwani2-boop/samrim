package postgres

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestStoreAccessRoleAdmissionCursorRejectsMalformedOrOversize(t *testing.T) {
	for _, token := range []string{"%", "not-a-json-token", strings.Repeat("A", 513), base64.RawURLEncoding.EncodeToString([]byte("{}"))} {
		if _, err := decodeStoreAccessRoleAdmissionCursor(token); err == nil {
			t.Fatalf("accepted malformed role admission page cursor %q", token[:min(len(token), 40)])
		}
	}
	if _, err := ListPendingStoreAccessRoleAdmissionsPage(context.Background(), nil, 25, ""); err == nil {
		t.Fatal("nil database should not yield a page")
	}
	if _, err := ListPendingStoreAccessRoleAdmissionsPage(context.Background(), nil, 51, ""); err == nil {
		t.Fatal("overwide page should be rejected")
	}
}

func TestStoreAccessRoleAdmissionCursorRoundTrip(t *testing.T) {
	at := time.Date(2026, time.October, 13, 4, 17, 29, 123456000, time.UTC)
	tokenBytes, err := json.Marshal(storeAccessRoleAdmissionCursor{At: at, ID: "grant-a"})
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := decodeStoreAccessRoleAdmissionCursor(base64.RawURLEncoding.EncodeToString(tokenBytes))
	if err != nil {
		t.Fatal(err)
	}
	if !parsed.At.Equal(at) || parsed.ID != "grant-a" {
		t.Fatalf("cursor mismatch: %#v", parsed)
	}
	first, err := decodeStoreAccessRoleAdmissionCursor("")
	if err != nil || !first.At.Equal(time.Unix(0, 0).UTC()) || first.ID != "" {
		t.Fatalf("unexpected initial page cursor: %#v, %v", first, err)
	}
}
