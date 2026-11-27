package main

import (
	"net/http"
	"slices"
	"strings"
)

// privateOwnerCORS is the sole browser transport for private DSH routes.
// Native ServeMux routes determine preflight admission directly; the Captain
// handlers retain their existing explicitly declared method surface.
// A preflight never invokes an owner or authenticates a request.
func privateOwnerCORS(next http.Handler, origins map[string]bool, methods ...string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		headers := w.Header()
		headers.Set("Cache-Control", "no-store")
		headers.Set("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers")

		supplied := r.Header.Values("Origin")
		if len(supplied) == 0 {
			next.ServeHTTP(w, r)
			return
		}
		if len(supplied) != 1 || supplied[0] == "" || supplied[0] == "null" || !origins[supplied[0]] {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		headers.Set("Access-Control-Allow-Origin", supplied[0])
		if r.Method != http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}

		requested := r.Header.Values("Access-Control-Request-Method")
		if len(requested) != 1 {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		method := requested[0]
		allowed := false
		if method == http.MethodGet || method == http.MethodPatch || method == http.MethodPost {
			if mux, ok := next.(*http.ServeMux); ok {
				probe := r.Clone(r.Context())
				probe.Method = method
				_, pattern := mux.Handler(probe)
				allowed = strings.HasPrefix(pattern, method+" ")
			} else {
				allowed = slices.Contains(methods, method)
			}
		}
		if !allowed {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		for _, value := range r.Header.Values("Access-Control-Request-Headers") {
			for _, part := range strings.Split(value, ",") {
				switch strings.ToLower(strings.TrimSpace(part)) {
				case "authorization", "content-type":
				default:
					w.WriteHeader(http.StatusForbidden)
					return
				}
			}
		}
		headers.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		headers.Set("Access-Control-Allow-Methods", method)
		w.WriteHeader(http.StatusNoContent)
	})
}
