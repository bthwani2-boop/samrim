package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/customercart"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/dbscope"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/discovery"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityaccess"
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
		!isolatedDSHSchema.MatchString(schema) {
		return nil, fmt.Errorf("protected Store operations require a dedicated dsh_test_* database schema")
	}
	listen := os.Getenv("DSH_LISTEN_ADDR")
	if !isolatedAvailabilityTransport(listen, os.Getenv) {
		return nil, fmt.Errorf("isolated Store availability requires explicit loopback or the verified isolated container transport")
	}
	// An explicit container opt-in must also prove the real owner database and
	// required tables. A similarly named namespace or a missing audit does not
	// qualify, and no bootstrap/upgrade is run from the serving process.
	if listen == "0.0.0.0:8080" {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		if err := verifyAvailabilityContainerDatabase(ctx, db, schema); err != nil {
			return nil, err
		}
	}
	identity, err := identityaccess.NewIdentitySessionHTTP(os.Getenv("DSH_IDENTITY_VERIFIER_URL"))
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
	mux.Handle("/v1/stores/", privateOwnerCORS(private, allowedOrigins))
	mux.Handle("/v1/operators/cities/", privateOwnerCORS(policyRead, allowedOrigins))
	mux.Handle("/v1/operators/stores/{storeID}/financial-standing", storeavailability.NewOperatorFinancialStandingHandler(identity, grants))
	mux.Handle("/", public)
	return mux, nil
}

// The draft Cart is an isolated, owner-backed DSH capability. It can be
// exposed only on verified development loopback (including host-only Docker
// publishing) with the same current Identity session verifier.
// No Cart request is an Order, checkout or financial mutation.
func isolatedCustomerCartHandler(db *sql.DB, schema, address string, public http.Handler) (http.Handler, error) {
	if os.Getenv("DSH_ENABLE_ISOLATED_CUSTOMER_CART") != "true" {
		return public, nil
	}
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		!isolatedDSHSchema.MatchString(schema) || !isolatedAvailabilityTransport(address, os.Getenv) {
		return nil, fmt.Errorf("Customer Cart requires isolated DSH schema and loopback-only transport")
	}
	identity, err := identityaccess.NewIdentitySessionHTTP(os.Getenv("DSH_IDENTITY_VERIFIER_URL"))
	if err != nil {
		return nil, fmt.Errorf("current Identity verifier is required for Customer Cart: %w", err)
	}
	cart, err := customercart.NewHandler(db, schema, identity)
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.Handle("/v1/carts", cart)
	mux.Handle("/v1/carts/", cart)
	mux.Handle("/v1/customers/me/favorite-stores", cart)
	mux.Handle("/v1/customers/me/favorite-stores/", cart)
	mux.Handle("/v1/addresses", cart)
	mux.Handle("/v1/addresses/", cart)
	mux.Handle("/", public)
	return mux, nil
}

// Compose's default stop grace is ten seconds; use a single shorter
// deadline for both HTTP servers, leaving time for the owner DB to close.
const servingDrainTimeout = 8 * time.Second

type servingEndpoint struct {
	server   *http.Server
	listener net.Listener
	secure   bool
}

// Bind the complete admitted listener set before serving either endpoint.
func bindDSHServers(public, private *http.Server) ([]servingEndpoint, error) {
	listener, err := net.Listen("tcp", public.Addr)
	if err != nil {
		return nil, errors.New("DSH public listener unavailable")
	}
	endpoints := []servingEndpoint{{server: public, listener: listener}}
	if private != nil {
		secure, err := net.Listen("tcp", private.Addr)
		if err != nil {
			listener.Close()
			return nil, errors.New("DSH private Captain standing TLS listener unavailable")
		}
		endpoints = append(endpoints, servingEndpoint{server: private, listener: secure, secure: true})
	}
	return endpoints, nil
}

// One DSH process owns both public and private listeners. A signal or an
// unexpected listener failure ends admission across the whole set. Drain
// active requests concurrently, before releasing the shared database pool.
func serveDSH(ctx context.Context, endpoints []servingEndpoint, grace time.Duration) error {
	if len(endpoints) == 0 {
		return errors.New("DSH listener set missing")
	}
	for _, endpoint := range endpoints {
		defer endpoint.listener.Close()
	}
	if ctx.Err() != nil {
		return nil
	}
	served := make(chan error, len(endpoints))
	for _, endpoint := range endpoints {
		go func() {
			if endpoint.secure {
				served <- endpoint.server.ServeTLS(endpoint.listener, "", "")
			} else {
				served <- endpoint.server.Serve(endpoint.listener)
			}
		}()
	}
	var failures []error
	received := 0
	select {
	case <-ctx.Done():
	case err := <-served:
		received++
		failures = append(failures, err)
	}
	// The signal context is already cancelled. Use a fresh deadline so
	// existing request contexts remain live during the bounded drain.
	drain, cancel := context.WithTimeout(context.Background(), grace)
	defer cancel()
	shutdown := make(chan error, len(endpoints))
	for _, endpoint := range endpoints {
		go func() {
			err := endpoint.server.Shutdown(drain)
			if err != nil {
				err = errors.Join(err, endpoint.server.Close())
			}
			shutdown <- err
		}()
	}
	for range endpoints {
		failures = append(failures, <-shutdown)
	}
	for received < len(endpoints) {
		err := <-served
		received++
		if !errors.Is(err, http.ErrServerClosed) {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func runDSH(ctx context.Context, mode, seedProfile string) error {
	if seedProfile != "regression" && (mode != "isolated-seed" || (seedProfile != "discovery-demo" && seedProfile != "development-registration")) {
		return errors.New("invalid seed profile for mode")
	}
	schema := os.Getenv("DSH_DB_SCHEMA")
	if schema == "" {
		schema = "dsh"
	}
	db, err := discovery.OpenFromEnvironment()
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(12)
	db.SetConnMaxLifetime(5 * time.Minute)
	owner, err := discovery.New(db, schema)
	if err != nil {
		return err
	}
	startup, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err = db.PingContext(startup); err != nil {
		return errors.New("DSH owner DB unavailable")
	}

	switch mode {
	case "verify-development-db":
		if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
			return errors.New("DSH development database verification requires isolated mode")
		}
		if err := dbscope.VerifyDevelopmentRuntime(startup, db, schema); err != nil {
			return err
		}
		fmt.Println("DSH_DEVELOPMENT_DATABASE_PASS")
	case "bootstrap":
		if err := owner.BootstrapFresh(startup, "database/schema"); err != nil {
			return fmt.Errorf("fresh DSH baseline denied: %w", err)
		}
		fmt.Println("DSH_FRESH_BASELINE_PASS schema=" + schema)
	case "isolated-seed":
		switch seedProfile {
		case "discovery-demo":
			err = owner.ImportSyntheticDemo(startup)
		case "development-registration":
			err = storeavailability.SeedDevelopmentRegistration(startup, db, schema)
		default:
			err = owner.ImportSynthetic(startup)
		}
		if err != nil {
			return err
		}
		fmt.Println("DSH_ISOLATED_OWNER_IMPORT_PASS schema=" + schema)
	case "serve":
		if os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE") == "true" || os.Getenv("REF_POSTGRES_DB") == dbscope.DevelopmentDatabase {
			if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
				return errors.New("DSH development runtime requires isolated mode")
			}
			if err := dbscope.VerifyDevelopmentRuntime(startup, db, schema); err != nil {
				return err
			}
		}
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
		public := &discovery.Server{
			Owner: owner, AllowedOrigins: origins,
			StoreAvailabilityEnabled: os.Getenv("DSH_ENABLE_ISOLATED_STORE_AVAILABILITY") == "true",
		}
		handler, err := isolatedStoreAvailabilityHandler(db, schema, public, origins)
		if err != nil {
			return fmt.Errorf("DSH protected Store availability cannot start: %w", err)
		}
		handler, err = isolatedCaptainStandingHandler(db, schema, handler, origins)
		if err != nil {
			return fmt.Errorf("DSH protected Captain standing cannot start: %w", err)
		}
		handler, err = isolatedMerchantStandingHandler(db, schema, addr, handler)
		if err != nil {
			return fmt.Errorf("DSH protected Merchant standing cannot start: %w", err)
		}
		handler, err = isolatedCustomerCartHandler(db, schema, addr, handler)
		if err != nil {
			return fmt.Errorf("DSH Customer Cart cannot start: %w", err)
		}
		handler, err = isolatedEmployeeHandler(startup, db, schema, addr, handler)
		if err != nil {
			return fmt.Errorf("DSH employee directory cannot start: %w", err)
		}
		secureCaptain, err := isolatedCaptainTLS(schema, os.Getenv, handler)
		if err != nil {
			return fmt.Errorf("DSH private Captain standing TLS cannot start: %w", err)
		}
		cancel()
		if ctx.Err() != nil {
			return nil
		}
		server := &http.Server{
			Addr: addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second,
		}
		endpoints, err := bindDSHServers(server, secureCaptain)
		if err != nil {
			return err
		}
		log.Printf("DSH public discovery listening on %s (schema %s)", addr, schema)
		return serveDSH(ctx, endpoints, servingDrainTimeout)
	default:
		return errors.New("unsupported mode")
	}
	return nil
}

func main() {
	mode := flag.String("mode", "serve", "serve, bootstrap, isolated-seed, or verify-development-db")
	seedProfile := flag.String("seed-profile", "regression", "isolated-seed profile: regression, discovery-demo, or development-registration")
	flag.Parse()
	ctx := context.Background()
	stop := func() {}
	if *mode == "serve" {
		ctx, stop = signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	}
	err := runDSH(ctx, *mode, *seedProfile)
	stop()
	if err != nil {
		log.Fatal(err)
	}
}
