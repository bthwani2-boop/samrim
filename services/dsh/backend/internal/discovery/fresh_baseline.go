package discovery

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var freshBaselineFilename = regexp.MustCompile(`^[0-9]{2}_[a-z][a-z0-9_]*\.sql$`)

// BootstrapFresh installs the current DSH domain definitions in one transaction,
// but only into a verified, entirely absent, isolated dsh_test_* schema.
// Existing schemas remain on the immutable reviewed migration/upgrade path.
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
	type sourceFile struct {
		name string
		sql  string
	}
	var files []sourceFile
	for _, entry := range entries {
		if entry.IsDir() || !freshBaselineFilename.MatchString(entry.Name()) ||
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
		if !strings.Contains(string(data), "__SCHEMA__") {
			return fmt.Errorf("missing scoped DSH baseline marker: %q", entry.Name())
		}
		files = append(files, sourceFile{name: entry.Name(), sql: strings.ReplaceAll(string(data), "__SCHEMA__", o.Schema)})
	}
	if len(files) < 7 || files[0].name != "00_marketplace.sql" {
		return errors.New("incomplete DSH owner-domain baseline")
	}

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
	return tx.Commit()
}
