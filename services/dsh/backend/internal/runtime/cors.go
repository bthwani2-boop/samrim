package runtime

import (
	"net/http"
	"strings"
)

// browserCORS enables explicitly configured web origins without changing native callers.
func browserCORS(next http.Handler, configured string) http.Handler {
	allowed := make(map[string]bool)
	for _, entry := range strings.Split(configured, ",") {
		origin := strings.TrimSpace(entry)
		if origin != "" && origin != "*" && origin != "null" {
			allowed[origin] = true
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" {
			w.Header().Add("Vary", "Origin")
			if !allowed[origin] {
				http.Error(w, "origin is not allowed", http.StatusForbidden)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, Idempotency-Key, X-Correlation-ID, X-Expected-Version")
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
