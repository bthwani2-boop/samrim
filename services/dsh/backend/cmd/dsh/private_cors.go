package main

import (
	"net/http"
	"strings"
)

// Private browser transport derives preflight admission from the actual
// mounted owner. Handlers that cannot prove a route never admit preflight.
type ownerRouteAdmission interface {
	AllowsMethod(*http.Request, string) bool
}

func admitsOwnerMethod(next http.Handler, r *http.Request, method string) bool {
	switch method {
	case http.MethodGet, http.MethodPatch, http.MethodPost:
	default:
		return false
	}
	switch owner := next.(type) {
	case *http.ServeMux:
		probe := r.Clone(r.Context())
		probe.Method = method
		_, pattern := owner.Handler(probe)
		return strings.HasPrefix(pattern, method+" ")
	case ownerRouteAdmission:
		return owner.AllowsMethod(r, method)
	default:
		return false
	}
}

func privateOwnerCORS(next http.Handler, origins map[string]bool) http.Handler {
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
		if len(requested) != 1 || !admitsOwnerMethod(next, r, requested[0]) {
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
		headers.Set("Access-Control-Allow-Methods", requested[0])
		w.WriteHeader(http.StatusNoContent)
	})
}
