package main

import (
	"context"
	"crypto/tls"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
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
	verifyOnly := len(os.Args) == 2 && os.Args[1] == "verify-development-db"
	// Offline first-Operator registration is an explicit separate command,
	// never part of normal Identity server startup or an HTTP route.
	if len(os.Args) != 1 && !verifyOnly {
		if len(os.Args) == 2 && os.Args[1] == "issue-local-dev-root-ticket" {
			runIsolatedInitialOperatorTicket()
			return
		}
		log.Fatal("unknown Identity startup mode")
	}
	if err := runIdentity(verifyOnly); err != nil {
		log.Fatal(err)
	}
}

func runIdentity(verifyOnly bool) error {
	// Isolated development only. Direct Merchant admission still requires
	// a verified Customer session.
	schema := os.Getenv("IDENTITY_DB_SCHEMA")
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" ||
		!session.IsIsolatedTestSchema(schema) {
		return errors.New("Identity verifier denied outside isolated synthetic development")
	}
	databaseURL := os.Getenv("IDENTITY_TEST_DATABASE_URL")
	if databaseURL == "" {
		return errors.New("Identity isolated database connection unavailable")
	}
	address := os.Getenv("IDENTITY_DEV_LISTEN_ADDR")
	if address == "" {
		address = "127.0.0.1:3302"
	}
	if !allowedDevelopmentListen(address,
		os.Getenv("BTHWANI_ISOLATED_TEST_MODE"),
		os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE"), schema) {
		return errors.New("Identity development listener requires loopback or explicitly isolated Docker")
	}
	tlsConfig, err := isolatedVerifierTLS(
		os.Getenv("BTHWANI_ISOLATED_TEST_MODE"), os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE"), schema,
		os.Getenv("IDENTITY_ISOLATED_VERIFIER_TLS_CERT"), os.Getenv("IDENTITY_ISOLATED_VERIFIER_TLS_KEY"),
	)
	if err != nil {
		return err
	}

	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return errors.New("Identity database driver unavailable")
	}
	defer db.Close()
	db.SetMaxOpenConns(6)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	if err = db.PingContext(ctx); err != nil {
		return errors.New("Identity isolated database unreachable")
	}
	if os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE") == "true" || verifyOnly {
		if err = session.VerifyDevelopmentRuntime(ctx, db, schema); err != nil {
			return err
		}
	}
	if verifyOnly {
		fmt.Println("IDENTITY_DEVELOPMENT_DATABASE_PASS")
		return nil
	}
	reader, err := session.NewPostgresReader(db, schema)
	if err != nil {
		return errors.New("Identity scope invalid")
	}
	routes := http.NewServeMux()
	routes.Handle("/health", isolatedHealthHandler(db))
	if os.Getenv("IDENTITY_SYNTHETIC_PHONE_AUTH") == "true" {
		ca, err := os.ReadFile(os.Getenv("IDENTITY_SYNTHETIC_PHONE_SMTP_CA"))
		if err != nil {
			return errors.New("Identity synthetic phone SMTP trust unavailable")
		}
		phone, err := session.NewCustomerPhoneHandler(reader,
			os.Getenv("IDENTITY_SYNTHETIC_PHONE_HMAC_KEY"), os.Getenv("IDENTITY_SYNTHETIC_PHONE_SMTP"),
			os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE") == "true", os.Getenv("IDENTITY_SYNTHETIC_YEMEN_PHONES"), ca)
		if err != nil {
			return errors.New("Identity synthetic phone verification misconfigured")
		}
		routes.Handle(session.PhoneChallengePath, phone)
		routes.Handle(session.PhoneVerifyPath, phone)
	}
	if os.Getenv("IDENTITY_ENABLE_ISOLATED_CAPTAIN_ADMISSION") == "true" {
		var standing *session.CaptainStandingHTTP
		var err error
		if os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE") == "true" {
			standing, err = session.NewContainerCaptainStandingHTTP(os.Getenv("IDENTITY_DSH_CAPTAIN_STANDING_URL"), os.Getenv("IDENTITY_DSH_CAPTAIN_STANDING_CA"))
		} else {
			standing, err = session.NewCaptainStandingHTTP(os.Getenv("IDENTITY_DSH_CAPTAIN_STANDING_URL"))
		}
		if err != nil {
			return fmt.Errorf("Captain role admission requires a verified DSH standing owner: %w", err)
		}
		captain := session.NewCaptainHandler(session.NewCaptainAdmission(reader, standing))
		routes.Handle(session.CaptainAdmitPath, captain)
		routes.Handle(session.CaptainReentryPath, captain)
	}
	// Operator administration is an opt-in synthetic Identity owner endpoint.
	// A PATCH-specific mux pattern preserves the existing GET /operators/me permission read.
	// No original Operator is created or reactivated by enabling this route.
	if os.Getenv("IDENTITY_ENABLE_ISOLATED_OPERATOR_PERMISSION_ADMIN") == "true" {
		routes.Handle("GET /v1/operators/{actorId}/permissions",
			session.NewOperatorPermissionReviewHandler(reader))
		routes.Handle("PATCH /v1/operators/{actorId}/permissions/{permission}",
			session.NewOperatorPermissionManagementHandler(reader))
	}
	// Anonymous WebAuthn ceremony endpoints are deliberately unavailable unless
	// the isolated Identity owner opts in. No Operator account is provisioned,
	// and no protected original-owner credential can be enrolled through them.
	if os.Getenv("IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH") == "true" {
		policy := operatorPasskeyOriginPolicy()
		auth, err := session.NewOperatorPasskeyAuth(reader, policy, true)
		if err != nil {
			return errors.New("Operator WebAuthn isolated relying-party configuration rejected")
		}
		handler := session.NewOperatorPasskeyHandler(auth)
		routes.Handle(session.OperatorPasskeyOptionsPath, handler)
		routes.Handle(session.OperatorPasskeyFinishPath, handler)
		// Enrollment and recovery have separate opt-ins but one canonical
		// verified development owner. Neither route issues a recovery proof.
		if os.Getenv("IDENTITY_ENABLE_ISOLATED_OPERATOR_BOOTSTRAP") == "true" {
			if !policy.AllowsInitialOperatorBootstrap() ||
				os.Getenv("IDENTITY_ENABLE_LOCAL_DEV_FIRST_OPERATOR") != "true" ||
				os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE") != "true" ||
				!isLocalDevelopmentFirstOperatorDatabase(ctx, db, schema) {
				return errors.New("initial Operator bootstrap requires exact authorized development Identity owner and origin")
			}
			if err := auth.AllowLocalDevelopmentFirstOwner(); err != nil {
				return errors.New("local First Operator guard refused")
			}
			initial := session.NewOperatorInitialRegistrationHandler(auth)
			routes.Handle(session.OperatorInitialRegistrationOptionsPath, initial)
			routes.Handle(session.OperatorInitialRegistrationFinishPath, initial)
		}
		if os.Getenv("IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_RECOVERY") == "true" {
			if !policy.AllowsInitialOperatorBootstrap() ||
				os.Getenv("BTHWANI_ISOLATED_CONTAINER_MODE") != "true" ||
				!isLocalDevelopmentFirstOperatorDatabase(ctx, db, schema) {
				return errors.New("Operator recovery requires exact authorized development Identity owner and origin")
			}
			recovery := session.NewOperatorPasskeyRecoveryHandler(auth)
			routes.Handle(session.OperatorPasskeyRecoveryOptionsPath, recovery)
			routes.Handle(session.OperatorPasskeyRecoveryFinishPath, recovery)
		}
	} else if os.Getenv("IDENTITY_ENABLE_ISOLATED_OPERATOR_BOOTSTRAP") == "true" ||
		os.Getenv("IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_RECOVERY") == "true" {
		return errors.New("Operator bootstrap/recovery requires the isolated WebAuthn owner")
	}
	// Persistent device sessions are issued and rotated only by canonical Identity.
	persistent := session.NewPersistentSessionHandler(reader)
	routes.Handle(session.PersistentStartPath, persistent)
	routes.Handle(session.PersistentRefreshPath, persistent)
	verifier := session.NewHandler(session.NewVerifier(reader))
	routes.Handle("/", verifier)
	server := &http.Server{
		Addr: address, Handler: routes,
		ReadHeaderTimeout: 4 * time.Second, ReadTimeout: 6 * time.Second, WriteTimeout: 6 * time.Second,
		IdleTimeout: 20 * time.Second, MaxHeaderBytes: 8192,
	}
	servers := []*http.Server{server}
	if tlsConfig != nil {
		// The private TLS listener exposes only the two existing verifier reads.
		secureRoutes := http.NewServeMux()
		secureRoutes.Handle("GET /v1/sessions/current", verifier)
		secureRoutes.Handle("GET /v1/operators/me/permissions/{permission}", verifier)
		servers = append(servers, &http.Server{
			Addr: "0.0.0.0:3343", Handler: secureRoutes, TLSConfig: tlsConfig,
			ReadHeaderTimeout: 4 * time.Second, ReadTimeout: 6 * time.Second, WriteTimeout: 6 * time.Second,
			IdleTimeout: 20 * time.Second, MaxHeaderBytes: 8192,
		})
	}
	// A single process owns both listeners and retains the database until
	// both have drained. Compose's default stop deadline is ten seconds.
	lifetime, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	endpoints, err := bindIdentityListeners(lifetime, servers)
	if err != nil {
		return err
	}
	log.Printf("Identity isolated session verifier listening (no production admission)")
	return serveIdentityListeners(lifetime, endpoints, 8*time.Second)
}

type identityListener struct {
	server *http.Server
	socket net.Listener
}

// All sockets must bind before any serving goroutine is started.
func bindIdentityListeners(ctx context.Context, servers []*http.Server) ([]identityListener, error) {
	endpoints := make([]identityListener, 0, len(servers))
	var lc net.ListenConfig
	for _, server := range servers {
		socket, err := lc.Listen(ctx, "tcp", server.Addr)
		if err != nil {
			for _, endpoint := range endpoints {
				_ = endpoint.socket.Close()
			}
			return nil, fmt.Errorf("Identity listener unavailable: %w", err)
		}
		endpoints = append(endpoints, identityListener{server: server, socket: socket})
	}
	return endpoints, nil
}

func serveIdentityListeners(ctx context.Context, endpoints []identityListener, grace time.Duration) error {
	results := make(chan error, len(endpoints))
	for _, endpoint := range endpoints {
		go func() {
			if endpoint.server.TLSConfig != nil {
				results <- endpoint.server.ServeTLS(endpoint.socket, "", "")
			} else {
				results <- endpoint.server.Serve(endpoint.socket)
			}
		}()
	}
	remaining := len(endpoints)
	var failure error
	select {
	case <-ctx.Done():
	case err := <-results:
		remaining--
		// No shutdown has been requested by this owner yet.
		failure = fmt.Errorf("Identity listener exited unexpectedly: %w", err)
	}
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
		failure = errors.Join(failure, <-shutdown)
	}
	for range remaining {
		if err := <-results; !errors.Is(err, http.ErrServerClosed) {
			failure = errors.Join(failure, err)
		}
	}
	return failure
}
