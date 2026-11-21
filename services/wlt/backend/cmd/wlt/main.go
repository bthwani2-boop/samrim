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
		AND NOT EXISTS (
			SELECT 1
			FROM (VALUES
				('wlt.customer_funding_journal'::regclass, false),
				('wlt.customer_funding_entries'::regclass, false),
				('wlt.customer_wallet_balances'::regclass, true),
				('wlt.customer_funding_history'::regclass, true)
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
	if !validIsolation(os.Getenv("BTHWANI_ISOLATED_TEST_MODE"), address, dsn) {
		log.Fatal("WLT requires explicit isolated loopback configuration")
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
	handler, err := wallet.NewHandler(db, os.Getenv("WLT_TEST_IDENTITY_ORIGIN"))
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{
		Addr: address, Handler: handler, ReadHeaderTimeout: 3 * time.Second,
		ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second,
		IdleTimeout: 20 * time.Second, MaxHeaderBytes: 8192,
	}
	log.Fatal(server.ListenAndServe())
}
