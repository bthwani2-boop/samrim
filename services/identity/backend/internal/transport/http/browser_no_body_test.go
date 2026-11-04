package identityhttp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBrowserSessionAndLogoutRejectUnexpectedRequestBodies(t *testing.T) {
	handler := New(nil, nil, nil, nil, nil, Config{
		AllowedOrigins: map[string]bool{
			"http://localhost:18101": true,
			"http://localhost:18102": true,
		},
		ClientWebOrigins:  map[string]bool{"http://localhost:18101": true},
		PartnerWebOrigins: map[string]bool{"http://localhost:18102": true},
		Development:       true,
	})
	for _, tc := range []struct{ path, origin string }{
		{"/auth/web/client/session", "http://localhost:18101"},
		{"/auth/web/client/logout", "http://localhost:18101"},
		{"/auth/web/partner/session", "http://localhost:18102"},
		{"/auth/web/partner/logout", "http://localhost:18102"},
	} {
		for _, streaming := range []bool{false, true} {
			t.Run(tc.path+"/"+map[bool]string{false: "content-length", true: "chunked"}[streaming], func(t *testing.T) {
				req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader("{}"))
				req.Header.Set("Origin", tc.origin)
				if streaming {
					req.ContentLength = -1
					req.TransferEncoding = []string{"chunked"}
				}
				rec := httptest.NewRecorder()
				handler.ServeHTTP(rec, req)
				if rec.Code != http.StatusBadRequest {
					t.Fatalf("nonempty browser auth request body accepted: status=%d path=%s", rec.Code, tc.path)
				}
			})
		}
	}
}
