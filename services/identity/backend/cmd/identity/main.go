package main

import (
	"context"
	"crypto/tls"
	"database/sql"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
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

func isolatedVerifierTLS(isolated, container, schema, certPath, keyPath string) (*tls.Config, error) {
	if certPath == "" && keyPath == "" {
		return nil, nil
	}
	if isolated != "true" || container != "true" || !session.IsIsolatedTestSchema(schema) ||
		certPath == "" || keyPath == "" {
		return nil, errors.New("Identity verifier TLS requires isolated Docker and both certificate files")
	}
	pair, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, errors.New("Identity verifier TLS certificate or key is invalid")
	}
	return &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{pair}}, nil
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
	tlsConfig, err := isolatedVerifierTLS(
		os.Getenv("BTHWANI_ISOLATED_TEST_MODE"), os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE"), schema,
		os.Getenv("IDENTITY_ISOLATED_VERIFIER_TLS_CERT"), os.Getenv("IDENTITY_ISOLATED_VERIFIER_TLS_KEY"),
	)
	if err != nil {
		log.Fatal(err)
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
	// Operator administration is an opt-in synthetic Identity owner endpoint.
	// A PATCH-specific mux pattern preserves the existing GET /operators/me permission read.
	// No original Operator is created or reactivated by enabling this route.
	if os.Getenv("IDENTITY_ENABLE_ISOLATED_OPERATOR_PERMISSION_ADMIN") == "true" {
		routes.Handle("PATCH /v1/operators/{actorId}/permissions/{permission}",
			session.NewOperatorPermissionManagementHandler(reader))
	}
	// Anonymous WebAuthn ceremony endpoints are deliberately unavailable unless
	// the isolated Identity owner opts in. No Operator account is provisioned,
	// and no protected original-owner credential can be enrolled through them.
	if os.Getenv("IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH") == "true" {
		policy := session.OperatorPasskeyOriginPolicy{
			RPID:    os.Getenv("IDENTITY_OPERATOR_PASSKEY_RPID"),
			Origins: strings.Split(os.Getenv("IDENTITY_OPERATOR_PASSKEY_ORIGINS"), ","),
		}
		auth, err := session.NewOperatorPasskeyAuth(reader, policy, true)
		if err != nil {
			log.Fatal("Operator WebAuthn isolated relying-party configuration rejected")
		}
		handler := session.NewOperatorPasskeyHandler(auth)
		routes.Handle(session.OperatorPasskeyOptionsPath, handler)
		routes.Handle(session.OperatorPasskeyFinishPath, handler)
	}
	verifier := session.NewHandler(session.NewVerifier(reader))
	routes.Handle("/", verifier)
	if tlsConfig != nil {
		// Only the owner-to-owner session read is needed on the private TLS port.
		secureRoutes := http.NewServeMux()
		secureRoutes.Handle("GET /v1/sessions/current", verifier)
		secureServer := &http.Server{
			Handler: secureRoutes, TLSConfig: tlsConfig,
			ReadHeaderTimeout: 4 * time.Second, ReadTimeout: 6 * time.Second, WriteTimeout: 6 * time.Second,
			IdleTimeout: 20 * time.Second, MaxHeaderBytes: 8192,
		}
		listener, err := net.Listen("tcp", "0.0.0.0:3343")
		if err != nil {
			log.Fatal("Identity isolated TLS listener unavailable")
		}
		go func() {
			log.Fatal(secureServer.ServeTLS(listener, "", ""))
		}()
	}
	server := &http.Server{
		Addr: address, Handler: routes,
		ReadHeaderTimeout: 4 * time.Second, ReadTimeout: 6 * time.Second, WriteTimeout: 6 * time.Second,
		IdleTimeout: 20 * time.Second, MaxHeaderBytes: 8192,
	}
	log.Printf("Identity isolated session verifier listening (no production admission)")
	log.Fatal(server.ListenAndServe())
}
