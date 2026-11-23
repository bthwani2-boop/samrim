package session

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestInitialOperatorTicketProofRejectsMalformedOrAmbiguousValues(t *testing.T) {
	proof := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x77}, 32))
	if len(proof) != 43 {
		t.Fatal("test fixture must encode 256 bits")
	}
	for _, candidate := range []string{"", "short", proof + "=", proof + "a",
		"../" + proof, "A" + strings.Repeat("~", 42)} {
		if candidate == proof {
			continue
		}
		if _, valid := decodeInitialProof(candidate); valid {
			t.Errorf("accepted invalid one-time proof")
		}
	}
	if _, valid := decodeInitialProof(proof); !valid {
		t.Fatal("valid 32-byte proof rejected")
	}
	if (*OperatorPasskeyAuth)(nil).initialOwnerAvailable() {
		t.Fatal("nil owner must never authorize Root enrollment")
	}
	if (&OperatorPasskeyAuth{}).initialOwnerAvailable() {
		t.Fatal("unconfigured owner must never authorize Root enrollment")
	}
}

func TestInitialOperatorBootstrapStrictRequestAndNoOwnerFallback(t *testing.T) {
	proof := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x77}, 32))
	ceremony := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x88}, 32))
	good := fmt.Sprintf(`{"proof":"%s"}`, proof)
	for _, tt := range []struct {
		raw    string
		finish bool
		denied bool
	}{
		{good, false, false},
		{fmt.Sprintf(`{"proof":"%s","ceremonyId":"%s","credential":{"type":"public-key"}}`, proof, ceremony), true, false},
		{fmt.Sprintf(`{"proof":"%s","proof":"%s"}`, proof, proof), false, true},
		{fmt.Sprintf(`{"proof":"%s","role":"operator"}`, proof), false, true},
		{fmt.Sprintf(`{"proof":"%s","actorId":"root"}`, proof), false, true},
		{fmt.Sprintf(`{"proof":"%s","ceremonyId":"%s"}`, proof, ceremony), false, true},
		{fmt.Sprintf(`{"proof":"%s","ceremonyId":"%s"}`, proof, ceremony), true, true},
		{fmt.Sprintf(`{"proof":"%s","ceremonyId":"%s","credential":null}`, proof, ceremony), true, true},
		{fmt.Sprintf(`{"proof":"%s","ceremonyId":"%s","credential":{}}{"root":true}`, proof, ceremony), true, true},
		{`{"proof":null}`, false, true},
		{`{"proof":"not-base64"}`, false, true},
		{`[]`, false, true},
	} {
		_, _, _, err := parseInitialRegistrationBody(strings.NewReader(tt.raw), tt.finish)
		if (err != nil) != tt.denied {
			t.Errorf("finish=%v denied=%v: err=%v", tt.finish, tt.denied, err)
		}
	}
	handler := NewOperatorInitialRegistrationHandler(nil)
	for _, tt := range []struct {
		path, method, body, contentType string
		code                            int
	}{
		{OperatorInitialRegistrationOptionsPath, "GET", "", "", 405},
		{OperatorInitialRegistrationOptionsPath, "POST", good, "application/json", 503},
		{OperatorInitialRegistrationOptionsPath, "POST", good, "text/plain", 400},
		{OperatorInitialRegistrationOptionsPath + "?role=operator", "POST", good, "application/json", 400},
		{"/v1/operators/passkey/bootstrap/unknown", "POST", good, "application/json", 404},
	} {
		req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
		if tt.contentType != "" {
			req.Header.Set("Content-Type", tt.contentType)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != tt.code {
			t.Errorf("%s %s: got %d want %d", tt.method, tt.path, rec.Code, tt.code)
		}
		if rec.Header().Get("Cache-Control") != "no-store" {
			t.Errorf("response must never cache bootstrap")
		}
		if strings.Contains(rec.Body.String(), proof) {
			t.Error("enrollment proof leaked in Owner response")
		}
	}
}
