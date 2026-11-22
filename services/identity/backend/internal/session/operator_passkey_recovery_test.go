package session

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOperatorRecoveryFailClosedWithoutApprovedProofOwner(t *testing.T) {
	proof := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x55}, 32))
	ceremony := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x66}, 32))
	if (&OperatorPasskeyAuth{}).recoveryAvailable() || (*OperatorPasskeyAuth)(nil).recoveryAvailable() {
		t.Fatal("unconfigured owner must never enable recovery")
	}
	if _, err := (&OperatorPasskeyAuth{}).BeginRecovery(t.Context(), proof); err == nil {
		t.Fatal("unconfigured owner began a recovery")
	}
	if err := (&OperatorPasskeyAuth{}).FinishRecovery(t.Context(), proof, ceremony, []byte("{}")); err == nil {
		t.Fatal("unconfigured owner finished a recovery")
	}
	handler := NewOperatorPasskeyRecoveryHandler(nil)
	for _, tt := range []struct {
		path, method, contentType, body string
		code                            int
	}{
		{OperatorPasskeyRecoveryOptionsPath, "GET", "", "", 405},
		{OperatorPasskeyRecoveryOptionsPath, "POST", "application/json", fmt.Sprintf(`{"proof":"%s"}`, proof), 503},
		{OperatorPasskeyRecoveryFinishPath, "POST", "application/json",
			fmt.Sprintf(`{"proof":"%s","ceremonyId":"%s","credential":{}}`, proof, ceremony), 503},
		{OperatorPasskeyRecoveryOptionsPath, "POST", "text/plain", fmt.Sprintf(`{"proof":"%s"}`, proof), 400},
		{OperatorPasskeyRecoveryOptionsPath, "POST", "application/json",
			fmt.Sprintf(`{"proof":"%s","actorId":"root"}`, proof), 503},
		{OperatorPasskeyRecoveryOptionsPath + "?actorId=any", "POST", "application/json", fmt.Sprintf(`{"proof":"%s"}`, proof), 400},
		{OperatorPasskeyRecoveryFinishPath, "POST", "application/json", "", 400},
		{"/v1/operators/passkey/recovery/unknown", "POST", "application/json", fmt.Sprintf(`{"proof":"%s"}`, proof), 404},
	} {
		req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
		if tt.contentType != "" {
			req.Header.Set("Content-Type", tt.contentType)
		}
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != tt.code {
			t.Errorf("%s %s got %d want %d", tt.method, tt.path, res.Code, tt.code)
		}
		if res.Header().Get("Cache-Control") != "no-store" {
			t.Error("recovery response must never be cached")
		}
		if strings.Contains(res.Body.String(), proof) || strings.Contains(res.Body.String(), ceremony) {
			t.Error("recovery proof or ceremony leaked")
		}
	}
	// A proxy or Go HTTP transport may stream a JSON body with an unknown
	// Content-Length (-1). MaxBytesReader still applies the hard size bound.
	streamed := httptest.NewRequest("POST", OperatorPasskeyRecoveryOptionsPath,
		strings.NewReader(fmt.Sprintf(`{"proof":"%s"}`, proof)))
	streamed.ContentLength = -1
	streamed.Header.Set("Content-Type", "application/json")
	streamedReply := httptest.NewRecorder()
	handler.ServeHTTP(streamedReply, streamed)
	if streamedReply.Code != 503 {
		t.Fatalf("streaming body rejected before unavailable owner check: got %d", streamedReply.Code)
	}
}

func TestOperatorRecoveryStrictRequestBody(t *testing.T) {
	proof := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x55}, 32))
	ceremony := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x66}, 32))
	for _, tt := range []struct {
		body   string
		finish bool
		deny   bool
	}{
		{fmt.Sprintf(`{"proof":"%s"}`, proof), false, false},
		{fmt.Sprintf(`{"proof":"%s","ceremonyId":"%s","credential":{"type":"public-key"}}`, proof, ceremony), true, false},
		{fmt.Sprintf(`{"proof":"%s","actorId":"other"}`, proof), false, true},
		{fmt.Sprintf(`{"proof":"%s","role":"operator"}`, proof), false, true},
		{fmt.Sprintf(`{"proof":"%s","proof":"%s"}`, proof, proof), false, true},
		{fmt.Sprintf(`{"proof":"%s","ceremonyId":"%s"}`, proof, ceremony), true, true},
		{fmt.Sprintf(`{"proof":"%s","ceremonyId":"%s","credential":null}`, proof, ceremony), true, true},
		{`{"proof":"invalid"}`, false, true},
		{`{"proof":null}`, false, true},
	} {
		_, _, _, err := parseInitialRegistrationBody(strings.NewReader(tt.body), tt.finish)
		if (err != nil) != tt.deny {
			t.Errorf("finish=%v deny=%v err=%v", tt.finish, tt.deny, err)
		}
	}
}

func TestRecoveryAcceptsCanonicalStoredHandleBounds(t *testing.T) {
	for _, size := range []int{0, 1, 15, 16, 31, 32, 33, 63, 64, 65, 1024} {
		want := size >= 16 && size <= 64
		if got := validRecoveryUserHandle(bytes.Repeat([]byte{0x7f}, size)); got != want {
			t.Errorf("stored Identity handle bytes=%d: accepted=%v want=%v", size, got, want)
		}
	}
}
