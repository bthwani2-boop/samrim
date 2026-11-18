package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/discovery"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
)

// isolatedStoreAvailabilityHandler keeps public discovery unchanged unless
// the dedicated synthetic development service is explicitly enabled.
// It never activates authenticated Store mutation on an unverified schema.
func isolatedStoreAvailabilityHandler(db *sql.DB, schema string, public http.Handler, allowedOrigins map[string]bool) (http.Handler, error) {
	if os.Getenv("DSH_ENABLE_ISOLATED_STORE_AVAILABILITY") != "true" {
		return public, nil
	}
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		!strings.HasPrefix(schema, "dsh_test_") || len(schema) <= len("dsh_test_") {
		return nil, fmt.Errorf("protected Store operations require a dedicated dsh_test_* database schema")
	}
	// A protected development endpoint must not inherit the public :8080
	// wildcard bind. This opt-in is loopback-only until a separately reviewed
	// container deployment with explicit network isolation exists.
	listenHost, _, parseErr := net.SplitHostPort(os.Getenv("DSH_LISTEN_ADDR"))
	if parseErr != nil || (listenHost != "127.0.0.1" && listenHost != "::1") {
		return nil, fmt.Errorf("isolated Store availability requires explicit loopback DSH_LISTEN_ADDR")
	}
	identity, err := storeavailability.NewIdentitySessionHTTP(os.Getenv("DSH_IDENTITY_VERIFIER_URL"))
	if err != nil {
		return nil, fmt.Errorf("current Identity verifier is required: %w", err)
	}
	grants, err := storeavailability.NewPostgresStoreGrants(db, schema)
	if err != nil {
		return nil, err
	}
	policies, err := storeavailability.NewPostgresPolicySource(db, schema)
	if err != nil {
		return nil, err
	}
	repository, err := storeavailability.NewPostgresRepository(db, schema)
	if err != nil {
		return nil, err
	}
	service, err := storeavailability.NewService(identity, grants, policies, repository)
	if err != nil {
		return nil, err
	}
	private, err := storeavailability.NewHandler(service)
	if err != nil {
		return nil, err
	}
	policyRead, err := storeavailability.NewCityPolicyHandler(identity, policies, policies)
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.Handle("/v1/stores/", storeAvailabilityCORS(private, allowedOrigins))
	mux.Handle("/v1/operators/cities/", storePolicyCORS(policyRead, allowedOrigins))
	mux.Handle("/", public)
	return mux, nil
}

// Store mutation is cross-origin only for exact configured development origins.
// Preflight never grants access to the Store; every real request still verifies
// Identity and DSH authority. No wildcard or credentialed-cookie CORS.
func storeAvailabilityCORS(next http.Handler, origins map[string]bool) http.Handler {
	return storeOperationalCORS(next, origins, true)
}

func storePolicyCORS(next http.Handler, origins map[string]bool) http.Handler {
	return storeOperationalCORS(next, origins, true)
}

func storeOperationalCORS(next http.Handler, origins map[string]bool, allowPatch bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers")
		origin := r.Header.Get("Origin")
		if origin == "" {
			next.ServeHTTP(w, r)
			return
		}
		if origin == "null" || !origins[origin] {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		if r.Method != http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}
		method := r.Header.Get("Access-Control-Request-Method")
		if method != http.MethodGet && !(allowPatch && method == http.MethodPatch) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		for _, requested := range strings.Split(r.Header.Get("Access-Control-Request-Headers"), ",") {
			key := strings.ToLower(strings.TrimSpace(requested))
			if key != "" && key != "authorization" && key != "content-type" {
				w.WriteHeader(http.StatusForbidden)
				return
			}
		}
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		if allowPatch {
			w.Header().Set("Access-Control-Allow-Methods", "GET, PATCH")
		} else {
			w.Header().Set("Access-Control-Allow-Methods", "GET")
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func main() {
	mode := flag.String("mode", "serve", "serve, migrate, or isolated-seed")
	migrations := flag.String("migration", "database/migrations/001_public_discovery.sql", "explicit reviewed SQL migration path")
	flag.Parse()
	schema := os.Getenv("DSH_DB_SCHEMA")
	if schema == "" {
		schema = "dsh"
	}
	db, err := discovery.OpenFromEnvironment()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(12)
	db.SetConnMaxLifetime(5 * time.Minute)
	owner, err := discovery.New(db, schema)
	if err != nil {
		log.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err = db.PingContext(ctx); err != nil {
		log.Fatal("DSH owner DB unavailable")
	}
	switch *mode {
	case "migrate":
		if !strings.HasPrefix(schema, "dsh_test_") {
			log.Fatal("migration denied: choose a verified isolated dsh_test_* schema for this development slice")
		}
		data, err := os.ReadFile(*migrations)
		if err != nil {
			log.Fatal(err)
		}
		if err = owner.Migrate(ctx, data); err != nil {
			log.Fatal(err)
		}
		fmt.Println("DSH_PUBLIC_MIGRATION_PASS schema=" + schema)
	case "isolated-seed":
		if err := owner.ImportSynthetic(ctx); err != nil {
			log.Fatal(err)
		}
		fmt.Println("DSH_ISOLATED_OWNER_IMPORT_PASS schema=" + schema)
	case "serve":
		origins := map[string]bool{}
		for _, origin := range strings.Split(os.Getenv("DSH_PUBLIC_CORS_ORIGINS"), ",") {
			if v := strings.TrimSpace(origin); v != "" {
				origins[v] = true
			}
		}
		addr := os.Getenv("DSH_LISTEN_ADDR")
		if addr == "" {
			addr = ":8080"
		}
		public := &discovery.Server{Owner: owner, AllowedOrigins: origins}
		handler, err := isolatedStoreAvailabilityHandler(db, schema, public, origins)
		if err != nil {
			log.Fatal("DSH protected Store availability cannot start: ", err)
		}
		handler, err = isolatedCaptainStandingHandler(db, schema, handler, origins)
		if err != nil {
			log.Fatal("DSH protected Captain standing cannot start: ", err)
		}
		server := &http.Server{
			Addr:              addr,
			Handler:           handler,
			ReadHeaderTimeout: 5 * time.Second,
			IdleTimeout:       30 * time.Second,
		}
		log.Printf("DSH public discovery listening on %s (schema %s)", addr, schema)
		log.Fatal(server.ListenAndServe())
	default:
		log.Fatal("unsupported mode")
	}
}
