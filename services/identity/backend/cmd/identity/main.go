package main

import (
	"context"
	"database/sql"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/session"
	_ "github.com/lib/pq"
)

// An exposed container listener is only valid for the synthetic namespace
// and an explicit Docker-mode opt-in. Local development remains loopback-only.
func allowedDevelopmentListen(address, isolatedMode, containerMode, schema string) bool {
	if isolatedMode != "true" || !session.IsIsolatedTestSchema(schema) {
		return false
	}
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return false
	}
	return host == "127.0.0.1" ||
		(host == "0.0.0.0" && port == "3302" && containerMode == "true")
}

func main() {
	// Isolated development only. Direct Merchant admission still requires
	// a verified Customer session.
	schema := os.Getenv("IDENTITY_DB_SCHEMA")
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		!session.IsIsolatedTestSchema(schema) {
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
	if !allowedDevelopmentListen(address,
		os.Getenv("BTHWANI_ISOLATED_TEST_MODE"),
		os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE"), schema) {
		log.Fatal("Identity development listener requires loopback or explicitly isolated Docker")
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
	routes := http.NewServeMux()
	routes.Handle("/health", isolatedHealthHandler(db))
	if os.Getenv("IDENTITY_SYNTHETIC_PHONE_AUTH") == "true" {
		phone, err := session.NewCustomerPhoneHandler(reader,
			os.Getenv("IDENTITY_SYNTHETIC_PHONE_HMAC_KEY"), os.Getenv("IDENTITY_SYNTHETIC_PHONE_SMTP"),
			os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE") == "true")
		if err != nil {
			log.Fatal("Identity synthetic phone verification misconfigured")
		}
		routes.Handle(session.PhoneChallengePath, phone)
		routes.Handle(session.PhoneVerifyPath, phone)
	}
	if os.Getenv("IDENTITY_ENABLE_ISOLATED_CAPTAIN_ADMISSION") == "true" {
		standing, err := session.NewCaptainStandingHTTP(os.Getenv("IDENTITY_DSH_CAPTAIN_STANDING_URL"))
		if err != nil {
			log.Fatal("Captain role admission requires a verified DSH standing owner: ", err)
		}
		captain := session.NewCaptainHandler(session.NewCaptainAdmission(reader, standing))
		routes.Handle(session.CaptainAdmitPath, captain)
		routes.Handle(session.CaptainReentryPath, captain)
	}
	routes.Handle("/", session.NewHandler(session.NewVerifier(reader)))
	server := &http.Server{
		Addr: address, Handler: routes,
		ReadHeaderTimeout: 4 * time.Second, ReadTimeout: 6 * time.Second, WriteTimeout: 6 * time.Second,
		IdleTimeout: 20 * time.Second, MaxHeaderBytes: 8192,
	}
	log.Printf("Identity isolated session verifier listening (no production admission)")
	log.Fatal(server.ListenAndServe())
}
