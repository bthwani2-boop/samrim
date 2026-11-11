package postgres

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/opsafety"
)

func canonicalFreshBaseline(t *testing.T) ([]byte, []MigrationRecord, []string) {
	t.Helper()
	root := filepath.Join("..", "..", "..", "..", "database")
	baseline, err := os.ReadFile(filepath.Join(root, "fresh-baseline.sql"))
	if err != nil {
		t.Fatal(err)
	}
	records, sqls, err := LoadMigrations(filepath.Join(root, "migrations"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(baseline), "GENERATED WLT clean fresh-install schema") {
		t.Fatal("fresh baseline lost generated/provenance warning")
	}
	pattern := regexp.MustCompile("(?m)^INSERT INTO wlt\\.schema_migrations\\(version,name,sha256\\) VALUES\\((\\d+),'([^']+)','([0-9a-f]{64})'\\);\\r?$")
	matches := pattern.FindAllStringSubmatch(string(baseline), -1)
	if len(matches) != len(records) {
		t.Fatalf("fresh baseline provenance has %d records, canonical SQL has %d", len(matches), len(records))
	}
	for index, record := range records {
		match := matches[index]
		version, err := strconv.Atoi(match[1])
		if err != nil || version != record.Version || match[2] != record.Name || match[3] != record.SHA256 {
			t.Fatalf("fresh baseline diverges from canonical migration v%d: got %v", record.Version, match)
		}
	}
	return baseline, records, sqls
}

// A derived baseline must never silently diverge from the canonical SQL files.
func TestFreshBaselineProvenanceMatchesCanonicalMigrations(t *testing.T) {
	canonicalFreshBaseline(t)
}

// Only a task-owned, empty PostgreSQL instance is permitted for this test.
func TestFreshBaselineBootstrapsCanonicalWLT(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WLT_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("disposable WLT_TEST_DATABASE_URL required")
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(databaseURL, os.Getenv); err != nil {
		t.Fatalf("reject unsafe schema-test target: %v", err)
	}
	baseline, records, sqls := canonicalFreshBaseline(t)
	db, err := Open(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	var alreadyExists bool
	if err := db.QueryRowContext(ctx, "SELECT to_regnamespace('wlt') IS NOT NULL").Scan(&alreadyExists); err != nil {
		t.Fatal(err)
	}
	if alreadyExists {
		t.Fatal("fresh baseline refuses to overwrite an existing WLT owner")
	}
	if _, err := db.ExecContext(ctx, string(baseline)); err != nil {
		t.Fatalf("apply fresh-only canonical SQL baseline: %v", err)
	}
	if err := VerifySchema(ctx, db, records); err != nil {
		t.Fatalf("fresh baseline canonical schema mismatch: %v", err)
	}
	var deliveryPolicies, creditPolicies int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM wlt.delivery_fee_policies").Scan(&deliveryPolicies); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM wlt.partner_commission_credit_policies").Scan(&creditPolicies); err != nil {
		t.Fatal(err)
	}
	if deliveryPolicies != 1 || creditPolicies != 1 {
		t.Fatalf("missing canonical bootstrap policy rows: delivery=%d commission_credit=%d", deliveryPolicies, creditPolicies)
	}
	if err := Migrate(ctx, db, records, sqls); err != nil {
		t.Fatalf("existing versioned migrator rejected fresh baseline: %v", err)
	}
	if err := VerifySchema(ctx, db, records); err != nil {
		t.Fatalf("baseline readback after canonical migrator: %v", err)
	}
}
