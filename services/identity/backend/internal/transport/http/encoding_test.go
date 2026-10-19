package identityhttp

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONUTF8Integrity(t *testing.T) {
	// JSON decoding normally replaces invalid UTF-8 bytes with U+FFFD without an error.
	// Reject malformed source bytes before a lossy decode reaches durable state.
	valid := []byte(`{"text":"المحفظة — نقدًا · Café · 中文 · Привет · 한글"}`)
	invalid := append([]byte(`{"text":"`), 0xff)
	invalid = append(invalid, []byte(`"}`)...)
	cases := []struct {
		name      string
		input     []byte
		wantValid bool
	}{
		{name: "multilingual UTF-8", input: valid, wantValid: true},
		{name: "invalid UTF-8", input: invalid},
		{name: "multiple JSON values", input: []byte(`{"text":"ok"} {"text":"extra"}`)},
		{name: "invalid JSON", input: []byte(`{"text":`)},
		{name: "over limit", input: []byte(`{"text":"` + strings.Repeat("x", 32768) + `"}`)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(tc.input))
			rec := httptest.NewRecorder()
			var got struct {
				Text string `json:"text"`
			}
			ok := decodeJSON(rec, req, &got)
			if ok != tc.wantValid {
				t.Fatalf("decodeJSON success = %t, want %t; status=%d", ok, tc.wantValid, rec.Code)
			}
			if ok && got.Text != "المحفظة — نقدًا · Café · 中文 · Привет · 한글" {
				t.Errorf("UTF-8 payload changed in transport: %q", got.Text)
			}
			if !ok {
				if rec.Code != http.StatusBadRequest {
					t.Errorf("status = %d, want 400", rec.Code)
				}
				if !strings.Contains(rec.Body.String(), "INVALID_REQUEST") {
					t.Errorf("missing existing API error code: %s", rec.Body.String())
				}
			}
		})
	}
}
