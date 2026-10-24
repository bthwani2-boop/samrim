package postgres

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestStoreAccessTeamCursorValidation(t *testing.T) {
	for _, token := range []string{"bad!", strings.Repeat("a", 513), base64.RawURLEncoding.EncodeToString([]byte("{}"))} {
		if _, err := decodeStoreAccessTeamCursor(token); err == nil {
			t.Fatalf("invalid cursor accepted: %q", token)
		}
	}
	if _, err := ListStoreAccessTeamPage(t.Context(), nil, "owner", "", 25, ""); err == nil {
		t.Fatal("nil db should fail")
	}
}
func TestStoreAccessTeamCursorRoundTrip(t *testing.T) {
	want := storeAccessTeamCursor{At: time.Now().UTC().Truncate(time.Second), ID: "grant-a"}
	b, _ := json.Marshal(want)
	got, err := decodeStoreAccessTeamCursor(base64.RawURLEncoding.EncodeToString(b))
	if err != nil || got.ID != want.ID || !got.At.Equal(want.At) {
		t.Fatalf("cursor failed: %+v %v", got, err)
	}
}
