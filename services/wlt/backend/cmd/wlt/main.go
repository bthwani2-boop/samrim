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

func checkDatabase(ctx context.Context, db *sql.DB) error {
	var safe bool
	err := db.QueryRowContext(ctx, `SELECT current_database() = 'bthwani_wlt_test'
		AND NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)
		AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = reader.oid)
		AND NOT has_database_privilege(current_database(), 'CREATE')
		AND has_schema_privilege('wlt', 'USAGE')
		AND NOT has_schema_privilege('wlt', 'CREATE,USAGE WITH GRANT OPTION')
		AND NOT has_function_privilege('wlt.post_sandbox_customer_funding(text,text,bigint)'::regprocedure, 'EXECUTE')
		AND NOT has_function_privilege('wlt.reverse_sandbox_customer_funding(text,text)'::regprocedure, 'EXECUTE')
		AND NOT COALESCE(has_function_privilege(to_regprocedure('wlt.append_commercial_agreement_proposal(text,bigint,text,text,text,text,integer,bigint,integer,text[],timestamptz,text,text)'), 'EXECUTE'), false)
		AND NOT COALESCE(has_function_privilege(to_regprocedure('wlt.record_commercial_agreement_decision(text,bigint,text,text,text,text,text)'), 'EXECUTE'), false)
		AND NOT COALESCE(has_function_privilege(to_regprocedure('wlt.reserve_order_wallet(text,text,text,text,text,bigint,bigint)'), 'EXECUTE'), false)
		AND NOT COALESCE(has_function_privilege(to_regprocedure('wlt.release_order_wallet(text,text,text,text)'), 'EXECUTE'), false)
		AND NOT COALESCE(has_function_privilege(to_regprocedure('wlt.available_order_wallet_yer(text)'), 'EXECUTE'), false)
		AND NOT EXISTS (
			SELECT 1
			FROM (VALUES
				('wlt.customer_funding_journal'::regclass, false),
				('wlt.customer_funding_entries'::regclass, false),
				('wlt.customer_wallet_balances'::regclass, true),
				('wlt.customer_funding_history'::regclass, true),
				(to_regclass('wlt.store_commercial_agreement_proposals'), false),
				(to_regclass('wlt.store_commercial_agreement_decisions'), false),
				(to_regclass('wlt.commercial_agreement_review_states'), false),
				(to_regclass('wlt.order_wallet_reservations'), false),
				(to_regclass('wlt.order_wallet_releases'), false)
			) AS relation(id, readable)
			JOIN pg_class ON pg_class.oid = relation.id
			WHERE relowner = reader.oid
				OR has_table_privilege(id, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN,SELECT WITH GRANT OPTION')
				OR has_any_column_privilege(id, 'INSERT,UPDATE,REFERENCES,SELECT WITH GRANT OPTION')
				OR (readable AND NOT has_table_privilege(id, 'SELECT'))
				OR (NOT readable AND has_any_column_privilege(id, 'SELECT'))
		)
		FROM pg_roles AS reader
		WHERE rolname = current_user AND rolname = 'bthwani_wlt_reader'`).Scan(&safe)
	if err != nil || !safe {
		return errors.New("WLT requires the isolated read-only role and applied journal migration")
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
		handler, err = wallet.NewContainerHandler(db, identityOrigin)
	} else {
		handler, err = wallet.NewHandler(db, identityOrigin)
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
