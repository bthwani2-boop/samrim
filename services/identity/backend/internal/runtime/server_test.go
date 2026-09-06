package runtime

import (
	"strings"
	"testing"
)

func setRuntimeConfigBaseline(t *testing.T) {
	t.Helper()
	t.Setenv("IDENTITY_DATABASE_URL", "postgres://identity:test@db.example.com:5432/identity?sslmode=verify-full")
	t.Setenv("IDENTITY_CHALLENGE_HMAC_SECRET", "01234567890123456789012345678901")
	t.Setenv("IDENTITY_ABUSE_HMAC_SECRET", "abcdefghijklmnopqrstuvwxyz123456")
	t.Setenv("IDENTITY_DSH_SERVICE_TOKEN", "dsh-service-token-01234567890123456789")
	t.Setenv("IDENTITY_PLATFORM_CONTROL_SERVICE_TOKEN", "platform-control-token-0123456789")
	t.Setenv("IDENTITY_PLATFORM_BOOTSTRAP_SECRET", "")
	t.Setenv("IDENTITY_CORS_ALLOWED_ORIGINS", "https://control.example.com")
	t.Setenv("IDENTITY_CHALLENGE_DELIVERY_MODE", "webhook")
	t.Setenv("IDENTITY_CHALLENGE_WEBHOOK_URL", "https://challenge.example.com/deliver")
	t.Setenv("IDENTITY_CHALLENGE_WEBHOOK_TOKEN", "webhook-token-01234567890123456789")
	t.Setenv("IDENTITY_AUTO_MIGRATE", "false")
	t.Setenv("BTHWANI_ENV", "production")
}

func TestProductionRejectsMailpit(t *testing.T) {
	setRuntimeConfigBaseline(t)
	t.Setenv("IDENTITY_CHALLENGE_DELIVERY_MODE", "mailpit")
	if _, err := loadConfig("8082"); err == nil || !strings.Contains(err.Error(), "mailpit") {
		t.Fatalf("production mailpit configuration was accepted: %v", err)
	}
}

func TestProductionRejectsAutoMigrate(t *testing.T) {
	setRuntimeConfigBaseline(t)
	t.Setenv("IDENTITY_AUTO_MIGRATE", "true")
	if _, err := loadConfig("8082"); err == nil || !strings.Contains(err.Error(), "AUTO_MIGRATE") {
		t.Fatalf("production auto-migrate configuration was accepted: %v", err)
	}
}

func TestProductionRejectsBootstrapSecret(t *testing.T) {
	setRuntimeConfigBaseline(t)
	t.Setenv("IDENTITY_PLATFORM_BOOTSTRAP_SECRET", "bootstrap-secret-01234567890123456789")
	if _, err := loadConfig("8082"); err == nil || !strings.Contains(err.Error(), "BOOTSTRAP_SECRET") {
		t.Fatalf("production bootstrap secret configuration was accepted: %v", err)
	}
}

func TestProductionRejectsInsecureDatabaseTransport(t *testing.T) {
	setRuntimeConfigBaseline(t)
	t.Setenv("IDENTITY_DATABASE_URL", "postgres://identity:test@db.example.com:5432/identity?sslmode=disable")
	if _, err := loadConfig("8082"); err == nil || !strings.Contains(err.Error(), "sslmode=verify-full") {
		t.Fatalf("production accepted an insecure database transport: %v", err)
	}
}
