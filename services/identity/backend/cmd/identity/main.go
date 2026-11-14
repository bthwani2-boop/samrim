package main

import (
	"context"
	"database/sql"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/session"
	_ "github.com/lib/pq"
)

func main() {
	// This initial verifier is isolated development only; there is no live
	// issuer, WebAuthn admission or authenticated DSH gateway yet.
	schema := os.Getenv("IDENTITY_DB_SCHEMA")
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		!strings.HasPrefix(schema, "identity_test_") {
		log.Fatal("Identity verifier denied outside isolated synthetic development")
	}
	databaseURL := os.Getenv("IDENTITY_TEST_DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("Identity isolated database connection unavailable")
	}
	address := os.Getenv("IDENTITY_DEV_LISTEN_ADDR")
	if address == "" {
		address = "127.0.0.1:3302"
	}
	host, _, err := net.SplitHostPort(address)
	if err != nil || host != "127.0.0.1" {
		log.Fatal("Identity development listener must bind IPv4 loopback only")
	}

	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		log.Fatal("Identity database driver unavailable")
	}
	defer db.Close()
	db.SetMaxOpenConns(6)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	if err = db.PingContext(ctx); err != nil {
		log.Fatal("Identity isolated database unreachable")
	}
	reader, err := session.NewPostgresReader(db, schema)
	if err != nil {
		log.Fatal("Identity scope invalid")
	}
	server := &http.Server{
		Addr: address, Handler: session.NewHandler(session.NewVerifier(reader)),
		ReadHeaderTimeout: 4 * time.Second, WriteTimeout: 6 * time.Second,
		IdleTimeout: 20 * time.Second, MaxHeaderBytes: 8192,
	}
	log.Printf("Identity isolated verifier listening on loopback (no production admission)")
	log.Fatal(server.ListenAndServe())
}
