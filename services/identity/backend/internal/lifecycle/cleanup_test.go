package lifecycle

import (
	"bytes"
	"context"
	"database/sql"
	"log"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/lib/pq"
)

func TestConfigFromEnvironmentRequiresGovernedProductionValues(t *testing.T) {
	values := map[string]string{
		"IDENTITY_RETENTION_CHALLENGE_DAYS":           "30",
		"IDENTITY_RETENTION_PASSWORD_ATTEMPT_DAYS":    "30",
		"IDENTITY_RETENTION_OPERATOR_ENROLLMENT_DAYS": "30",
		"IDENTITY_RETENTION_SESSION_DAYS":             "90",
		"IDENTITY_RETENTION_AUDIT_DAYS":               "365",
		"IDENTITY_RETENTION_BATCH_SIZE":               "500",
	}
	getenv := func(key string) string { return values[key] }
	config, err := ConfigFromEnvironment(getenv, true)
	if err != nil {
		t.Fatal(err)
	}
	if config.BatchSize != 500 || config.Session.Hours() != 90*24 || config.Audit.Hours() != 365*24 {
		t.Fatalf("unexpected retention config: %+v", config)
	}
	delete(values, "IDENTITY_RETENTION_AUDIT_DAYS")
	if _, err := ConfigFromEnvironment(getenv, true); err == nil {
		t.Fatal("production retention accepted a missing governed class")
	}
}

func TestConfigFromEnvironmentRejectsUnboundedBatch(t *testing.T) {
	values := map[string]string{"IDENTITY_RETENTION_BATCH_SIZE": "10001"}
	if _, err := ConfigFromEnvironment(func(key string) string { return values[key] }, false); err == nil {
		t.Fatal("retention accepted an unbounded batch size")
	}
}

func TestRetentionCleanupDrainsBacklogInBoundedBatches(t *testing.T) {
	if os.Getenv("IDENTITY_RETENTION_INTEGRATION") != "1" {
		t.Skip("set IDENTITY_RETENTION_INTEGRATION=1 for local PostgreSQL saturation proof")
	}
	if os.Getenv("BTHWANI_ENV") != "development" {
		t.Fatal("retention integration proof requires BTHWANI_ENV=development")
	}
	databaseURL := os.Getenv("IDENTITY_RETENTION_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("IDENTITY_RETENTION_TEST_DATABASE_URL is required for retention integration proof")
	}

	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	if err := db.PingContext(ctx); err != nil {
		t.Fatal(err)
	}

	const (
		batchSize = 3
		rowCount  = batchSize*2 + 1
	)
	marker := "retention-integration-" + time.Now().UTC().Format("20060102150405.000000000")
	if _, err := db.ExecContext(ctx, `INSERT INTO identity_security_audit(event_type, principal, outcome, correlation_id, metadata, created_at)
SELECT 'retention_test', $1, 'success', $1, '{}'::jsonb, clock_timestamp() - INTERVAL '2 days'
FROM generate_series(1, $2)`, marker, rowCount); err != nil {
		t.Fatal(err)
	}
	defer db.ExecContext(ctx, `DELETE FROM identity_security_audit WHERE principal=$1`, marker)

	count := func() int {
		var value int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM identity_security_audit WHERE principal=$1`, marker).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}

	cleaner := New(db, RetentionConfig{
		Challenge:          24 * time.Hour,
		PasswordAttempt:    24 * time.Hour,
		OperatorEnrollment: 24 * time.Hour,
		Session:            24 * time.Hour,
		Audit:              24 * time.Hour,
		BatchSize:          batchSize,
	})
	var logs bytes.Buffer
	previousLogWriter := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(previousLogWriter)
	if err := cleaner.runOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if output := logs.String(); !strings.Contains(output, "batch_size=3") ||
		!strings.Contains(output, "limit_reached=security_audit") ||
		!strings.Contains(output, "backlog_remaining=security_audit") {
		t.Fatalf("bounded cleanup observability missing limit/backlog evidence: %q", output)
	}
	if got := count(); got != rowCount-batchSize {
		t.Fatalf("first cleanup did not stop at batch size: got %d want %d", got, rowCount-batchSize)
	}
	if err := cleaner.runOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if got := count(); got != 1 {
		t.Fatalf("second cleanup did not drain the next bounded batch: got %d want 1", got)
	}
	if err := cleaner.runOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if got := count(); got != 0 {
		t.Fatalf("cleanup did not eventually drain the eligible backlog: got %d", got)
	}
}
