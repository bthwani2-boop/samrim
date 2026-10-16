package http

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
				if !strings.Contains(rec.Body.String(), "INVALID_INPUT") {
					t.Errorf("missing existing API error code: %s", rec.Body.String())
				}
			}
		})
	}
}

func TestDecodeJSONWithLimitPreservesSizeBoundary(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"text":"long"}`))
	rec := httptest.NewRecorder()
	var got struct {
		Text string `json:"text"`
	}
	if decodeJSONWithLimit(rec, req, &got, 8) || rec.Code != http.StatusBadRequest {
		t.Fatalf("oversized request accepted: status=%d", rec.Code)
	}
}

func TestDecodeOptionalJSONPreservesEmptyAndRejectsDamagedInput(t *testing.T) {
	for _, tc := range []struct {
		name  string
		body  []byte
		valid bool
	}{
		{name: "empty allowed", body: nil, valid: true},
		{name: "whitespace allowed", body: []byte("  \n\t"), valid: true},
		{name: "valid Unicode", body: []byte(`{"text":"المحفظة"}`), valid: true},
		{name: "malformed byte rejected", body: append([]byte(`{"text":"`), append([]byte{0xff}, []byte(`"}`)...)...)},
		{name: "invalid JSON rejected", body: []byte("{")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(tc.body))
			w := httptest.NewRecorder()
			var input struct {
				Text string `json:"text"`
			}
			ok := decodeOptionalJSON(w, r, &input)
			if ok != tc.valid {
				t.Fatalf("got %v status %d", ok, w.Code)
			}
			if tc.name == "valid Unicode" && input.Text != "المحفظة" {
				t.Fatalf("text changed")
			}
			if !tc.valid && w.Code != http.StatusBadRequest {
				t.Fatalf("status %d", w.Code)
			}
		})
	}
}
