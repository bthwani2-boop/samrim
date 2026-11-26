package discovery

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
)

// Reviewed bytes, not a filename or schema marker, authorize SQL execution.
// Update only with the corresponding owner-domain SQL review and integration proof.
var reviewedFreshBaseline = map[string]string{
	"00_marketplace.sql":        "97581dcfc79cee6e152963d8eb7ec1492699c9664b1c089b232113f5cd55b1a7",
	"10_catalog.sql":            "7755db5222aaf4c510d526c4eaea589bbc5dbd70bff2db47a768aedbabf931a6",
	"20_store_operations.sql":   "495590b5646c825bd0f2739937c98803e26e22f3c342c0787d47096c3b22c227",
	"30_store_registration.sql": "19f35f438f2ccc3e1b2abb00db6a8c30652130be9cc3956c8e1b47dc052e71d5",
	"40_customer_cart.sql":      "2ca899bf205e32b92a4bc9b69c7917dce6b71a45c4c1aad8bd8f6f691f2bcaa7",
	"45_customer_addresses.sql": "8412124b163e0fc611a75b395f8c2da861e2f5c38e4ef2aae8d4569003ec2836",
	"50_captains.sql":           "d0ac2ed5b35c4fb1cd1013429b46e6e37b6b3050cfc38454f51288af276bb169",
	"60_employees.sql":          "99a6c71c41edd1fc7cd8135f940fabe5ad1ad10c6b8cb6c84d0bd29617de6a0f",
}

type freshBaselineSource struct{ name, sql string }

// BootstrapFresh installs the current DSH domain definitions in one transaction,
// but only into a verified, entirely absent, isolated dsh_test_* schema.
// Existing schemas are never changed by this command.
// baselineDirectory is the current owner's source-controlled database/schema dir.
func (o *Owner) BootstrapFresh(ctx context.Context, baselineDirectory string) error {
	if !o.isIsolatedTestOwner() {
		return errors.New("fresh DSH baseline requires an isolated owner")
	}
	dir, err := filepath.Abs(baselineDirectory)
	if err != nil {
		return fmt.Errorf("resolve DSH baseline directory: %w", err)
	}
	dir = filepath.Clean(dir)
	ownerDir := filepath.ToSlash(dir)
	if !strings.HasSuffix(ownerDir, "/services/dsh/database/schema") &&
		ownerDir != "/app/database/schema" {
		return errors.New("fresh DSH baseline must come from owner database/schema")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read DSH baseline directory: %w", err)
	}
	if len(entries) != len(reviewedFreshBaseline) {
		return errors.New("incomplete or unexpected DSH owner-domain baseline")
	}
	var files []freshBaselineSource
	for _, entry := range entries {
		digest, reviewed := reviewedFreshBaseline[entry.Name()]
		if entry.IsDir() || !reviewed ||
			entry.Type()&os.ModeSymlink != 0 || !entry.Type().IsRegular() {
			return fmt.Errorf("unapproved DSH baseline entry: %q", entry.Name())
		}
		name := filepath.Join(dir, entry.Name())
		info, err := os.Lstat(name)
		if err != nil || !info.Mode().IsRegular() || info.Size() > 512*1024 {
			return fmt.Errorf("unsafe DSH baseline file: %q", entry.Name())
		}
		data, err := os.ReadFile(name)
		if err != nil {
			return fmt.Errorf("read DSH baseline file %s: %w", entry.Name(), err)
		}
		if fmt.Sprintf("%x", sha256.Sum256(data)) != digest {
			return fmt.Errorf("unreviewed DSH baseline bytes: %q", entry.Name())
		}
		if !strings.Contains(string(data), "__SCHEMA__") {
			return fmt.Errorf("missing scoped DSH baseline marker: %q", entry.Name())
		}
		text := string(data)
		if entry.Name() == "00_marketplace.sql" {
			// A strict CREATE protects against a concurrent creator after the
			// namespace check; never silently overlay an existing schema.
			text = strings.Replace(text, "CREATE SCHEMA IF NOT EXISTS __SCHEMA__;", "CREATE SCHEMA __SCHEMA__;", 1)
		}
		files = append(files, freshBaselineSource{name: entry.Name(), sql: strings.ReplaceAll(text, "__SCHEMA__", o.Schema)})
	}
	return o.applyFreshBaseline(ctx, files)
}

// Internal transaction primitive; only the reviewed loader calls this in production.
func (o *Owner) applyFreshBaseline(ctx context.Context, files []freshBaselineSource) error {
	tx, err := o.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := requireRefoundationDatabase(ctx, tx); err != nil {
		return fmt.Errorf("fresh DSH baseline denied: %w", err)
	}
	var alreadyExists bool
	if err := tx.QueryRowContext(ctx,
		"SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1)",
		o.Schema).Scan(&alreadyExists); err != nil {
		return fmt.Errorf("cannot verify empty DSH baseline target: %w", err)
	}
	if alreadyExists {
		return errors.New("fresh DSH baseline refuses an existing schema")
	}
	for _, file := range files {
		if _, err := tx.ExecContext(ctx, file.sql); err != nil {
			return fmt.Errorf("fresh DSH baseline %s failed: %w", file.name, err)
		}
	}
	if os.Getenv("DSH_BOOTSTRAP_SYNTHETIC_REGISTRATION") == "true" {
		if err := storeavailability.SeedFreshSyntheticRegistration(ctx, tx, o.Schema); err != nil {
			return fmt.Errorf("fresh synthetic Store registration: %w", err)
		}
	}
	return tx.Commit()
}
