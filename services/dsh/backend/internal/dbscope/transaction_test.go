package dbscope

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	_ "github.com/lib/pq"
)

func TestDedicatedDevelopmentDatabaseAndCartPrincipal(t *testing.T) {
	for _, tc := range []struct {
		db, role string
		allowed  bool
	}{
		{DevelopmentDatabase, DevelopmentRuntimeRole, true},
		{DevelopmentDatabase, "bthwani_refoundation_admin", false},
		{DevelopmentDatabase, "bthwani_ci", false},
		{"bthwani_refoundation", DevelopmentRuntimeRole, false},
		{"bthwani_refoundation", "bthwani_ci", true},
		{"bthwani_refoundation", "bthwani_agent02", true},
		{"bthwani_refoundation", "bthwani_refoundation_admin", false},
		{"bthwani_dsh_dev_backup", DevelopmentRuntimeRole, false},
		{"bthwani_identity_dev", DevelopmentRuntimeRole, false},
		{"bthwani_wlt_test", DevelopmentRuntimeRole, false},
	} {
		if IsCartPrincipal(tc.db, tc.role) != tc.allowed {
			t.Fatalf("incorrect admission for %q / %q", tc.db, tc.role)
		}
	}
	if !IsDevelopmentDatabase(DevelopmentDatabase) || IsDevelopmentDatabase("bthwani_dsh_dev_backup") || IsDevelopmentDatabase("bthwani_identity_dev") {
		t.Fatal("unexpected database name admitted")
	}
}

// Launched only by the existing network-disabled PostgreSQL proof; the test
// refuses ordinary local/remote database configuration.
func TestDedicatedDevelopmentRuntimePostgres(t *testing.T) {
	if os.Getenv("BTHWANI_DSH_DEV_DB_PROOF") != "network-none-disposable" {
		t.Skip("NOT_RUN: requires disposable owner database proof")
	}
	const schema = "dsh_test_agent01"
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	db, err := sql.Open("postgres", "host=127.0.0.1 port=5432 dbname=bthwani_dsh_dev user=bthwani_dsh_runtime sslmode=disable connect_timeout=2")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := VerifyDevelopmentRuntime(ctx, db, schema); err != nil {
		t.Fatal(err)
	}
	if err := VerifyDevelopmentRuntime(ctx, db, "public"); err == nil {
		t.Fatal("public scope admitted")
	}
	var revision int64
	if err := db.QueryRowContext(ctx, "SELECT revision FROM dsh_test_agent01.public_revision WHERE singleton").Scan(&revision); err != nil || revision != 7 {
		t.Fatal("copied owner revision unavailable")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "INSERT INTO dsh_test_agent01.service_cities(id,active) VALUES ('runtime-proof',true)"); err != nil {
		t.Fatal("owner write denied")
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	tx, err = db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "CREATE TABLE dsh_test_agent01.unauthorized_ddl(id int)"); err == nil {
		t.Fatal("runtime can create schema objects")
	}
	_ = tx.Rollback()
	admin, err := sql.Open("postgres", "host=127.0.0.1 port=5432 dbname=bthwani_dsh_dev user=bthwani_agent01_admin sslmode=disable connect_timeout=2")
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	if err := admin.PingContext(ctx); err != nil {
		t.Fatal("disposable admin unavailable")
	}
	if err := VerifyDevelopmentRuntime(ctx, admin, schema); err == nil {
		t.Fatal("administrator admitted as runtime")
	}
	wrong, err := sql.Open("postgres", "host=127.0.0.1 port=5432 dbname=bthwani_agent01_synthetic user=bthwani_dsh_runtime sslmode=disable connect_timeout=2")
	if err != nil {
		t.Fatal(err)
	}
	defer wrong.Close()
	if err := VerifyDevelopmentRuntime(ctx, wrong, schema); err == nil {
		t.Fatal("shared fixture database admitted")
	}
}
