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
	u, err := url.Parse(databaseURL)
	return err == nil && u.Scheme == "postgres" && u.Hostname() == "127.0.0.1" &&
		validPort(u.Port()) && u.User != nil && u.User.Username() == "bthwani_wlt_reader" &&
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
		AND current_user = 'bthwani_wlt_reader'
		AND NOT has_table_privilege('wlt.customer_funding_journal', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
		AND has_table_privilege('wlt.customer_wallet_balances', 'SELECT')`).Scan(&safe)
	if err != nil || !safe {
		return errors.New("WLT requires the isolated read-only role and applied journal migration")
	}
	return nil
}

func main() {
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
