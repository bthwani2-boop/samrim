package identityhttp

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOperatorReasonHeaderSupportsArabicAndLegacyText(t *testing.T) {
	tests := []struct {
		name     string
		raw      string
		encoding string
		expected string
		status   int
	}{
		{"arabic", "%D8%A7%D8%B9%D8%AA%D9%85%D8%A7%D8%AF%20%D8%A7%D9%84%D9%88%D8%B5%D9%88%D9%84", "percent-utf8", "اعتماد الوصول", 200},
		{"legacy percent", "50% complete", "", "50% complete", 200},
		{"encoded percent", "50%25%20complete", "percent-utf8", "50% complete", 200},
		{"malformed", "%XX", "percent-utf8", "", 400},
		{"unsupported", "reason", "base64", "", 400},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest("PUT", "/internal/operators/actor/permissions/hr", nil)
			req.Header.Set("X-Reason", test.raw)
			if test.encoding != "" {
				req.Header.Set("X-Reason-Encoding", test.encoding)
			}
			writer := httptest.NewRecorder()
			got, ok := operatorReasonHeader(writer, req)
			if test.status == 200 && (!ok || got != test.expected) {
				t.Fatalf("got=%q ok=%v want=%q", got, ok, test.expected)
			}
			if test.status != 200 && (ok || writer.Code != http.StatusBadRequest) {
				t.Fatalf("malformed reason accepted: ok=%v status=%d", ok, writer.Code)
			}
		})
	}
}
