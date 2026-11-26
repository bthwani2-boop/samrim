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
	"strconv"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/wallet"
	_ "github.com/lib/pq"
)

func validIsolation(mode, address, databaseURL string) bool {
	host, port, err := net.SplitHostPort(address)
	if mode != "true" || err != nil || host != "127.0.0.1" || !validPort(port) {
		return false
	}
	return isolatedDatabaseURL(databaseURL, "bthwani_wlt_reader")
}

func isolatedDatabaseURL(databaseURL, role string) bool {
	u, err := url.Parse(databaseURL)
	return err == nil && u.Scheme == "postgres" && u.Hostname() == "127.0.0.1" &&
		validPort(u.Port()) && u.User != nil && u.User.Username() == role &&
		u.Path == "/bthwani_wlt_test" && u.RawQuery == "sslmode=disable" &&
		u.Fragment == "" && u.String() == databaseURL
}

// Container mode is a separate explicit development admission. Local preview
// still requires loopback and never accepts a Docker host by implication.
func validContainerIsolation(mode, containerMode, address, databaseURL, identityOrigin string) bool {
	if mode != "true" || containerMode != "true" || address != "0.0.0.0:8080" ||
		identityOrigin != "http://identity:3302" {
		return false
	}
	u, err := url.Parse(databaseURL)
	return err == nil && u.Scheme == "postgres" && u.Host == "postgres:5432" &&
		u.User != nil && u.User.Username() == "bthwani_wlt_reader" &&
		u.Path == "/bthwani_wlt_test" && u.RawQuery == "sslmode=disable" &&
		u.Fragment == "" && u.Opaque == "" && u.String() == databaseURL
}

func validPort(port string) bool {
	value, err := strconv.ParseUint(port, 10, 16)
	return err == nil && value > 0
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
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		pingCtx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		if err := db.PingContext(pingCtx); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if containerMode {
			check, err := http.NewRequestWithContext(pingCtx, http.MethodGet, identityOrigin+"/health", nil)
			if err != nil {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			client := &http.Client{
				Timeout:       time.Second,
				CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
			}
			response, err := client.Do(check)
			if err != nil {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			_ = response.Body.Close()
			if response.StatusCode != http.StatusOK {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
	}
}

func main() {
	if len(os.Args) > 1 {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		err := runSandboxFunding(ctx, os.Args[1], os.Args[2:], os.Stdin, os.Stdout, os.Getenv)
		cancel()
		if err != nil {
			log.Fatal(err)
		}
		return
	}
	address := os.Getenv("WLT_DEV_LISTEN_ADDR")
	dsn := os.Getenv("WLT_TEST_DATABASE_URL")
	containerMode := os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE") == "true"
	identityOrigin := os.Getenv("WLT_TEST_IDENTITY_ORIGIN")
	dshOrigin := os.Getenv("WLT_TEST_DSH_ORIGIN")
	if !validIsolation(os.Getenv("BTHWANI_ISOLATED_TEST_MODE"), address, dsn) &&
		!validContainerIsolation(os.Getenv("BTHWANI_ISOLATED_TEST_MODE"),
			os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE"), address, dsn, identityOrigin) {
		log.Fatal("WLT requires an explicit isolated local or container configuration")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatal("WLT database connection rejected")
	}
	defer db.Close()
	db.SetMaxOpenConns(6)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	err = checkDatabase(ctx, db)
	cancel()
	if err != nil {
		log.Fatal(err)
	}
	var handler http.Handler
	if containerMode {
		handler, err = wallet.NewContainerHandler(db, identityOrigin, dshOrigin)
	} else {
		handler, err = wallet.NewHandler(db, identityOrigin, dshOrigin)
	}
	if err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/v1/", handler)
	mux.HandleFunc("/health", developmentHealth(db, identityOrigin, containerMode))
	server := &http.Server{
		Addr: address, Handler: mux, ReadHeaderTimeout: 3 * time.Second,
		ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second,
		IdleTimeout: 20 * time.Second, MaxHeaderBytes: 8192,
	}
	log.Fatal(server.ListenAndServe())
}
