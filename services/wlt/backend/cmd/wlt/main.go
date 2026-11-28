package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/wallet"
	_ "github.com/lib/pq"
)

type servingConfiguration struct {
	address, databaseURL, identityOrigin, dshOrigin string
	containerMode                                   bool
}

// Resolve one mode before accepting any database or peer configuration.
// A local preview cannot satisfy the container admission, or vice versa.
func admitServingConfiguration(getenv func(string) string) (servingConfiguration, error) {
	c := servingConfiguration{
		address:        getenv("WLT_DEV_LISTEN_ADDR"),
		databaseURL:    getenv("WLT_TEST_DATABASE_URL"),
		identityOrigin: getenv("WLT_TEST_IDENTITY_ORIGIN"),
		dshOrigin:      getenv("WLT_TEST_DSH_ORIGIN"),
	}
	denied := errors.New("WLT requires an explicit isolated local or container configuration")
	if getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		return servingConfiguration{}, denied
	}
	switch getenv("BTHWANI_ISOLATED_CONTAINER_MODE") {
	case "", "false":
		host, port, err := net.SplitHostPort(c.address)
		if err != nil || host != "127.0.0.1" || !validPort(port) ||
			!isolatedDatabaseURL(c.databaseURL, "bthwani_wlt_reader") {
			return servingConfiguration{}, denied
		}
	case "true":
		c.containerMode = true
		u := parseIsolatedDatabaseURL(c.databaseURL, "bthwani_wlt_reader")
		if c.address != "0.0.0.0:8080" || u == nil || u.Host != "postgres:5432" {
			return servingConfiguration{}, denied
		}
	default:
		return servingConfiguration{}, denied
	}
	return c, nil
}

func parseIsolatedDatabaseURL(databaseURL, role string) *url.URL {
	u, err := url.Parse(databaseURL)
	if err != nil || u.Scheme != "postgres" || u.User == nil || u.User.Username() != role ||
		u.Path != "/bthwani_wlt_test" || u.RawQuery != "sslmode=disable" ||
		u.Fragment != "" || u.Opaque != "" || u.String() != databaseURL {
		return nil
	}
	return u
}

// The separate sandbox command also uses this exact loopback boundary.
func isolatedDatabaseURL(databaseURL, role string) bool {
	u := parseIsolatedDatabaseURL(databaseURL, role)
	return u != nil && u.Hostname() == "127.0.0.1" && validPort(u.Port())
}

func validPort(port string) bool {
	value, err := strconv.ParseUint(port, 10, 16)
	return err == nil && value > 0
}

// Both canonical constructors validate their peer origins without I/O.
// Construct the handler before querying the database admission contract.
func (c servingConfiguration) handler(db *sql.DB) (http.Handler, error) {
	if c.containerMode {
		return wallet.NewContainerHandler(db, c.identityOrigin, c.dshOrigin)
	}
	return wallet.NewHandler(db, c.identityOrigin, c.dshOrigin)
}

// Required owner objects and actual effective grants are distinct invariants.
// The catalog scan covers future owner objects as well as today's projection
// contract. Unlike the fresh-bootstrap proof, this admission permits retained
// journal data and checks the identity of the connected runtime principal.
const readerAdmissionSQL = `
WITH
  owner_schema AS (
    SELECT oid, nspowner FROM pg_catalog.pg_namespace WHERE nspname = 'wlt'
  ),
  owner_objects AS (
    SELECT c.oid, c.relname, c.relkind::text AS kind, c.relowner
    FROM pg_catalog.pg_class c JOIN owner_schema s ON s.oid = c.relnamespace
    WHERE c.relkind IN ('r','p','v','m','f','S')
  ),
  required_relations(name, kind, readable) AS (
    VALUES
      ('customer_funding_journal','r',false),
      ('customer_funding_entries','v',false),
      ('customer_wallet_balances','v',true),
      ('customer_wallet_availability','v',true),
      ('customer_funding_history','v',true),
      ('store_commercial_agreement_proposals','r',false),
      ('store_commercial_agreement_decisions','r',false),
      ('commercial_agreement_review_states','v',false),
      ('latest_commercial_agreement_reviews','v',true),
      ('customer_order_payment_readback','v',true),
      ('order_payment_allocations','r',false),
      ('order_payment_releases','r',false)
  ),
  required_commands(signature) AS (
    VALUES
      ('wlt.post_sandbox_customer_funding(text,text,bigint)'),
      ('wlt.reverse_sandbox_customer_funding(text,text)'),
      ('wlt.append_commercial_agreement_proposal(text,bigint,text,text,text,text,integer,bigint,integer,text[],timestamptz,text,text)'),
      ('wlt.record_commercial_agreement_decision(text,bigint,text,text,text,text,text)'),
      ('wlt.allocate_order_payment(text,text,text,text,text,bigint,bigint)'),
      ('wlt.release_order_payment(text,text,text,text)'),
      ('wlt.available_order_wallet_yer(text)')
  )
SELECT
  current_database() = 'bthwani_wlt_test'
  AND session_user = current_user
  AND reader.rolcanlogin
  AND NOT (reader.rolsuper OR reader.rolcreaterole OR reader.rolcreatedb OR reader.rolreplication OR reader.rolbypassrls OR reader.rolinherit)
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = reader.oid)
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname=current_database() AND pg_get_userbyid(datdba)='bthwani_wlt_owner')
  AND has_database_privilege(current_database(), 'CONNECT')
  AND NOT has_database_privilege(current_database(), 'CREATE,TEMP,CONNECT WITH GRANT OPTION')
  AND EXISTS (SELECT 1 FROM owner_schema WHERE pg_get_userbyid(nspowner)='bthwani_wlt_owner')
  AND has_schema_privilege('wlt', 'USAGE')
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE has_schema_privilege(oid,'CREATE'))
  AND NOT has_schema_privilege('wlt','USAGE WITH GRANT OPTION')
  AND NOT EXISTS (
    SELECT 1 FROM required_relations r LEFT JOIN owner_objects o ON o.relname=r.name AND o.kind=r.kind
    WHERE o.oid IS NULL OR (r.readable AND NOT has_table_privilege(o.oid,'SELECT'))
  )
  AND NOT EXISTS (
    SELECT 1 FROM required_commands r WHERE to_regprocedure(r.signature) IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM owner_objects o LEFT JOIN required_relations r ON r.name=o.relname AND r.kind=o.kind
    WHERE pg_get_userbyid(o.relowner)<>'bthwani_wlt_owner'
       OR CASE WHEN o.kind='S' THEN has_sequence_privilege(o.oid,'USAGE,SELECT,UPDATE')
         ELSE has_table_privilege(o.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN,SELECT WITH GRANT OPTION')
           OR has_any_column_privilege(o.oid,'INSERT,UPDATE,REFERENCES,SELECT WITH GRANT OPTION')
           OR (NOT COALESCE(r.readable,false) AND has_any_column_privilege(o.oid,'SELECT'))
         END
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN owner_schema s ON s.oid=p.pronamespace
    WHERE pg_get_userbyid(p.proowner)<>'bthwani_wlt_owner'
       OR (p.prorettype<>'trigger'::regtype AND has_function_privilege(p.oid,'EXECUTE'))
  )
FROM pg_catalog.pg_roles reader
WHERE reader.rolname=current_user AND reader.rolname='bthwani_wlt_reader'
`

func checkDatabase(ctx context.Context, db *sql.DB) error {
	var safe bool
	if err := db.QueryRowContext(ctx, readerAdmissionSQL).Scan(&safe); err != nil || !safe {
		return errors.New("WLT requires the isolated read-only principal and complete owner baseline")
	}
	return nil
}

func developmentHealth(db *sql.DB, identityOrigin string, containerMode bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		// One shared deadline bounds both dependency observations.
		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		if db == nil || db.PingContext(ctx) != nil ||
			(containerMode && wallet.CheckDevelopmentIdentityHealth(ctx, identityOrigin) != nil) || ctx.Err() != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}

// The Compose default stop grace is ten seconds. Leave two seconds for
// process cleanup after the bounded HTTP drain.
const servingDrainTimeout = 8 * time.Second

// Own the entire listener lifetime. A stop closes admission first, lets
// in-flight HTTP requests finish, and closes unfinished connections only
// after the drain deadline. A listener failure also drains other requests
// before returning its error to the process owner.
func serveDevelopment(ctx context.Context, server *http.Server, listener net.Listener, grace time.Duration) error {
	if ctx.Err() != nil {
		return listener.Close()
	}
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()

	var serveErr error
	stopping := false
	select {
	case <-ctx.Done():
		stopping = true
	case serveErr = <-served:
	}

	// The signal context is already cancelled; it must not be the drain
	// context. Existing request contexts remain live during graceful shutdown.
	drain, cancel := context.WithTimeout(context.Background(), grace)
	defer cancel()
	drainErr := server.Shutdown(drain)
	if drainErr != nil {
		drainErr = errors.Join(drainErr, server.Close())
	}
	if stopping {
		serveErr = <-served
		if errors.Is(serveErr, http.ErrServerClosed) {
			serveErr = nil
		}
	}
	return errors.Join(serveErr, drainErr)
}

func runDevelopment(ctx context.Context, getenv func(string) string) error {
	config, err := admitServingConfiguration(getenv)
	if err != nil {
		return err
	}
	// sql.Open creates a lazy pool; the first database operation is below.
	db, err := sql.Open("postgres", config.databaseURL)
	if err != nil {
		return errors.New("WLT database connection rejected")
	}
	defer db.Close()
	handler, err := config.handler(db)
	if err != nil {
		return err
	}
	db.SetMaxOpenConns(6)
	db.SetConnMaxLifetime(5 * time.Minute)
	admission, cancel := context.WithTimeout(ctx, 4*time.Second)
	err = checkDatabase(admission, db)
	cancel()
	if err != nil {
		return err
	}
	if ctx.Err() != nil {
		return nil
	}
	mux := http.NewServeMux()
	mux.Handle("/v1/", handler)
	mux.HandleFunc("/health", developmentHealth(db, config.identityOrigin, config.containerMode))
	server := &http.Server{
		Addr: config.address, Handler: mux, ReadHeaderTimeout: 3 * time.Second,
		ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second,
		IdleTimeout: 20 * time.Second, MaxHeaderBytes: 8192,
	}
	listener, err := net.Listen("tcp", config.address)
	if err != nil {
		return errors.New("WLT development listener unavailable")
	}
	return serveDevelopment(ctx, server, listener, servingDrainTimeout)
}

func main() {
	// Sandbox commands keep their separately bounded, one-shot lifecycle.
	if len(os.Args) > 1 {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		err := runSandboxFunding(ctx, os.Args[1], os.Args[2:], os.Stdin, os.Stdout, os.Getenv)
		cancel()
		if err != nil {
			log.Fatal(err)
		}
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	err := runDevelopment(ctx, os.Getenv)
	stop()
	if err != nil {
		log.Fatal(err)
	}
}
