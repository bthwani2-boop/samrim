// Package testfixture initializes only dedicated, disposable owner test schemas.
// Production bootstrap remains owned by discovery.
package testfixture

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
	"unicode/utf8"
)

var schemaName = regexp.MustCompile("^[a-z][a-z0-9_]{0,62}$")
var domainFile = regexp.MustCompile("^[0-9]{2}_[a-z][a-z0-9_]*[.]sql$")

const maxFixtureSQL = 512 * 1024

type fixtureSource struct {
	name string
	sql  string
}

// Prepare the entire bounded source before touching PostgreSQL. The fixture
// consumes current owner baseline files, not a second baseline or migration
// history. The callers continue to own the exact source checkout and test DB.
func prepareFixture(owner, schema, directory string) ([]fixtureSource, error) {
	if (owner != "dsh" && owner != "identity") || !schemaName.MatchString(schema) ||
		!strings.HasPrefix(schema, owner+"_test_") || len(schema) == len(owner+"_test_") {
		return nil, errors.New("unsafe owner fixture schema")
	}
	dir, err := filepath.Abs(directory)
	if err != nil || !strings.HasSuffix(filepath.ToSlash(dir), "/services/"+owner+"/database/schema") {
		return nil, errors.New("canonical owner schema directory required")
	}
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return nil, errors.New("fixture baseline directory unavailable")
	}
	samePath := resolved == dir
	if runtime.GOOS == "windows" {
		samePath = strings.EqualFold(resolved, dir)
	}
	if !samePath {
		return nil, errors.New("fixture baseline directory must not be redirected")
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("fixture baseline directory not regular")
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, errors.New("fixture baseline root unavailable")
	}
	defer root.Close()
	opened, err := root.Stat(".")
	if err != nil || !os.SameFile(info, opened) {
		return nil, errors.New("fixture baseline root changed")
	}
	directoryHandle, err := root.Open(".")
	if err != nil {
		return nil, errors.New("owner baseline unavailable")
	}
	entries, readErr := directoryHandle.ReadDir(-1)
	closeErr := directoryHandle.Close()
	if readErr != nil || closeErr != nil || len(entries) == 0 {
		return nil, errors.New("owner baseline unavailable")
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	files := make([]fixtureSource, 0, len(entries))
	for _, entry := range entries {
		if !entry.Type().IsRegular() || !domainFile.MatchString(entry.Name()) {
			return nil, fmt.Errorf("unexpected baseline entry %s", entry.Name())
		}
		before, err := root.Lstat(entry.Name())
		if err != nil || !before.Mode().IsRegular() || before.Size() < 1 || before.Size() > maxFixtureSQL {
			return nil, fmt.Errorf("unsafe baseline file %s", entry.Name())
		}
		file, err := root.Open(entry.Name())
		if err != nil {
			return nil, fmt.Errorf("cannot open baseline file %s", entry.Name())
		}
		current, statErr := file.Stat()
		if statErr != nil || !current.Mode().IsRegular() || !os.SameFile(before, current) {
			file.Close()
			return nil, fmt.Errorf("baseline file changed %s", entry.Name())
		}
		data, readErr := io.ReadAll(io.LimitReader(file, maxFixtureSQL+1))
		closeErr := file.Close()
		if readErr != nil || closeErr != nil || len(data) > maxFixtureSQL ||
			int64(len(data)) != current.Size() || !utf8.Valid(data) || strings.ContainsRune(string(data), 0) ||
			!strings.Contains(string(data), "__SCHEMA__") {
			return nil, fmt.Errorf("invalid baseline %s", entry.Name())
		}
		text := strings.ReplaceAll(string(data), "CREATE SCHEMA IF NOT EXISTS __SCHEMA__;", "CREATE SCHEMA __SCHEMA__;")
		count := strings.Count(text, "CREATE SCHEMA __SCHEMA__;")
		// The first domain file creates the namespace, all later files consume it.
		if (len(files) == 0 && (count != 1 || !strings.HasPrefix(entry.Name(), "00_"))) || (len(files) > 0 && count != 0) {
			return nil, errors.New("fixture baseline must create exactly one fresh namespace")
		}
		files = append(files, fixtureSource{name: entry.Name(), sql: strings.ReplaceAll(text, "__SCHEMA__", schema)})
	}

	return files, nil
}

func Fresh(t testing.TB, ctx context.Context, db *sql.DB, owner, schema, directory string) {
	t.Helper()
	if os.Getenv("BTHWANI_ISOLATED_TEST_MODE") != "true" {
		t.Fatal("isolated fixture opt-in required")
	}
	files, err := prepareFixture(owner, schema, directory)
	if err != nil {
		t.Fatal(err)
	}
	if db == nil {
		t.Fatal("isolated fixture database required")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	// Verify the actual TCP session and role on the transaction that creates
	// the namespace. Callers own the existing loopback endpoint admission
	// (including Windows-forwarded fixture ports). The PostgreSQL server
	// address can differ from the caller's loopback address through a forward.
	// No retained development database or elevated identity is admitted.
	var database, user, sessionUser string
	var localOwner bool
	err = tx.QueryRowContext(ctx, `SELECT current_database(), current_user, session_user,
   pg_catalog.inet_server_addr() IS NOT NULL
   AND d.datdba = r.oid AND r.rolcanlogin
   AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
   AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid)
   FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_database d ON d.datname = current_database()
   WHERE r.rolname = current_user`).Scan(&database, &user, &sessionUser, &localOwner)
	allowed := map[string]string{"orderability_agent02": "bthwani_agent02", "merchant_agent01": "bthwani_session01", "refoundation_captain_agent02": "bt_cap_s02"}
	if err != nil || !localOwner || user != sessionUser || allowed[database] == "" || allowed[database] != user {
		t.Fatal("fixture database and role not admitted")
	}
	var exists bool
	if err = tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1)", schema).Scan(&exists); err != nil || exists {
		t.Fatal("fresh fixture requires an absent schema")
	}
	for _, file := range files {
		if _, err = tx.ExecContext(ctx, file.sql); err != nil {
			t.Fatalf("owner baseline %s: %v", file.name, err)
		}
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
}
