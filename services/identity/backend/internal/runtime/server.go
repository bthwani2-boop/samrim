package runtime

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/actor"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/challenge"
	challengedelivery "github.com/bthwani2-boop/samrim/services/identity/backend/internal/integrations/challenge"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/lifecycle"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/session"
	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/storage/postgres"
	identityhttp "github.com/bthwani2-boop/samrim/services/identity/backend/internal/transport/http"
	_ "github.com/lib/pq"
)

type config struct {
	port            string
	databaseURL     string
	autoMigrate     bool
	migrationDir    string
	challengeSecret []byte
	abuseIPSecret   []byte
	trustedProxies  map[string]bool
	internalTokens  map[string]string
	allowedOrigins  map[string]bool
	delivery        challengedelivery.Sender
}

func Run(_, _, defaultPort string) error {
	cfg, err := loadConfig(defaultPort)
	if err != nil {
		return err
	}
	db, err := sql.Open("postgres", cfg.databaseURL)
	if err != nil {
		return fmt.Errorf("open identity database: %w", err)
	}
	defer func() { _ = db.Close() }()
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(30 * time.Minute)
	if cfg.autoMigrate {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := applyMigrations(ctx, db, cfg.migrationDir); err != nil {
			return err
		}
	}
	actors := actor.New(db)
	sessions := session.New(db)
	challenges := challenge.New(db, actors, sessions, cfg.challengeSecret, cfg.delivery)
	cleaner := lifecycle.New(db)
	readiness := func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		return postgres.Ready(ctx, db)
	}
	handler := identityhttp.New(actors, challenges, sessions, identityhttp.Config{InternalServiceTokens: cfg.internalTokens, AllowedOrigins: cfg.allowedOrigins, AbuseIPSecret: cfg.abuseIPSecret, TrustedProxies: cfg.trustedProxies, Readiness: readiness})
	server := &http.Server{Addr: ":" + cfg.port, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	serverErrCh := make(chan error, 1)
	deliveryErrCh := make(chan error, 1)
	go func() {
		log.Printf("identity API listening on %s", server.Addr)
		serverErrCh <- server.ListenAndServe()
	}()
	go func() { deliveryErrCh <- challenges.RunDeliveryWorker(ctx) }()
	go cleaner.Run(ctx)
	shutdown := func() error {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	}
	select {
	case <-ctx.Done():
		return shutdown()
	case err := <-serverErrCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case err := <-deliveryErrCh:
		if err == nil && ctx.Err() != nil {
			return shutdown()
		}
		_ = shutdown()
		if err == nil {
			return errors.New("challenge delivery worker stopped unexpectedly")
		}
		return fmt.Errorf("challenge delivery worker: %w", err)
	}
}

func loadConfig(defaultPort string) (config, error) {
	port := env("PORT", defaultPort)
	databaseURL := strings.TrimSpace(os.Getenv("IDENTITY_DATABASE_URL"))
	if databaseURL == "" {
		return config{}, errors.New("IDENTITY_DATABASE_URL is required")
	}
	secret := []byte(strings.TrimSpace(os.Getenv("IDENTITY_CHALLENGE_HMAC_SECRET")))
	if len(secret) < 32 {
		return config{}, errors.New("IDENTITY_CHALLENGE_HMAC_SECRET must contain at least 32 bytes")
	}
	abuseSecret := []byte(strings.TrimSpace(os.Getenv("IDENTITY_ABUSE_HMAC_SECRET")))
	if len(abuseSecret) < 32 {
		return config{}, errors.New("IDENTITY_ABUSE_HMAC_SECRET must contain at least 32 bytes")
	}
	tokens := map[string]string{"dsh": strings.TrimSpace(os.Getenv("IDENTITY_DSH_SERVICE_TOKEN")), "platform-control": strings.TrimSpace(os.Getenv("IDENTITY_PLATFORM_CONTROL_SERVICE_TOKEN"))}
	bootstrapToken := strings.TrimSpace(os.Getenv("IDENTITY_PLATFORM_BOOTSTRAP_SECRET"))
	if bootstrapToken != "" {
		tokens["platform-bootstrap"] = bootstrapToken
	}
	seen := map[string]string{}
	for caller, token := range tokens {
		if len(token) < 24 {
			return config{}, fmt.Errorf("identity internal token for %s is not configured strongly enough", caller)
		}
		if previous, exists := seen[token]; exists {
			return config{}, fmt.Errorf("identity internal token is shared by %s and %s", previous, caller)
		}
		seen[token] = caller
	}
	delivery, err := loadDelivery()
	if err != nil {
		return config{}, err
	}
	migrationDir := strings.TrimSpace(os.Getenv("IDENTITY_MIGRATION_DIR"))
	if migrationDir == "" {
		migrationDir = filepath.Clean("../database/migrations")
		if _, err := os.Stat(migrationDir); err != nil {
			migrationDir = "/app/migrations"
		}
	}
	origins := map[string]bool{}
	for _, origin := range strings.Split(env("IDENTITY_CORS_ALLOWED_ORIGINS", "http://localhost:13000"), ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			origins[origin] = true
		}
	}
	if len(origins) == 0 {
		return config{}, errors.New("IDENTITY_CORS_ALLOWED_ORIGINS is empty")
	}
	trustedProxies := map[string]bool{}
	for _, proxy := range strings.Split(os.Getenv("IDENTITY_TRUSTED_PROXY_IPS"), ",") {
		proxy = strings.TrimSpace(proxy)
		if proxy != "" {
			trustedProxies[proxy] = true
		}
	}
	return config{port: port, databaseURL: databaseURL, autoMigrate: strings.EqualFold(strings.TrimSpace(os.Getenv("IDENTITY_AUTO_MIGRATE")), "true"), migrationDir: migrationDir, challengeSecret: secret, abuseIPSecret: abuseSecret, trustedProxies: trustedProxies, internalTokens: tokens, allowedOrigins: origins, delivery: delivery}, nil
}

func loadDelivery() (challengedelivery.Sender, error) {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("IDENTITY_CHALLENGE_DELIVERY_MODE"))) {
	case "mailpit":
		addr := strings.TrimSpace(os.Getenv("IDENTITY_MAILPIT_SMTP_ADDR"))
		recipient := strings.TrimSpace(os.Getenv("IDENTITY_MAILPIT_RECIPIENT"))
		if addr == "" || recipient == "" {
			return nil, errors.New("mailpit challenge delivery is not configured")
		}
		return challengedelivery.Mailpit{SMTPAddr: addr, Recipient: recipient}, nil
	case "twilio":
		sid := strings.TrimSpace(os.Getenv("IDENTITY_TWILIO_ACCOUNT_SID"))
		token := strings.TrimSpace(os.Getenv("IDENTITY_TWILIO_AUTH_TOKEN"))
		from := strings.TrimSpace(os.Getenv("IDENTITY_TWILIO_FROM"))
		if sid == "" || token == "" || from == "" {
			return nil, errors.New("twilio challenge delivery is not configured")
		}
		return challengedelivery.Twilio{AccountSID: sid, AuthToken: token, From: from}, nil
	case "webhook":
		endpoint := strings.TrimSpace(os.Getenv("IDENTITY_CHALLENGE_WEBHOOK_URL"))
		token := strings.TrimSpace(os.Getenv("IDENTITY_CHALLENGE_WEBHOOK_TOKEN"))
		if !strings.HasPrefix(endpoint, "https://") || len(token) < 24 {
			return nil, errors.New("HTTPS challenge webhook is not configured")
		}
		return challengedelivery.Webhook{URL: endpoint, Token: token}, nil
	default:
		return nil, errors.New("IDENTITY_CHALLENGE_DELIVERY_MODE must be mailpit, twilio, or webhook")
	}
}

func env(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}
