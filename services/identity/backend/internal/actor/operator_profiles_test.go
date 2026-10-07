package actor

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	_ "github.com/lib/pq"
)

func TestListOperatorProfilesKeysetDatabase(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("IDENTITY_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("IDENTITY_DATABASE_URL is required for operator profile pagination proof")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open Identity PostgreSQL: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("Identity PostgreSQL is not reachable: %v", err)
	}

	databaseName := fmt.Sprintf("identity_operator_profiles_%d", time.Now().UnixNano())
	if _, err := rootDB.ExecContext(ctx, "CREATE DATABASE "+databaseName); err != nil {
		t.Fatalf("create isolated Identity database: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		if _, err := rootDB.ExecContext(cleanupCtx, "DROP DATABASE IF EXISTS "+databaseName+" WITH (FORCE)"); err != nil {
			t.Errorf("drop isolated Identity database: %v", err)
		}
	})

	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse Identity database URL: %v", err)
	}
	parsedURL.Path = "/" + databaseName
	db, err := sql.Open("postgres", parsedURL.String())
	if err != nil {
		t.Fatalf("open isolated Identity database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	migrationDirectory := filepath.Join("..", "..", "..", "database", "migrations")
	entries, err := os.ReadDir(migrationDirectory)
	if err != nil {
		t.Fatalf("read Identity migrations: %v", err)
	}
	var migrations []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			migrations = append(migrations, entry.Name())
		}
	}
	sort.Strings(migrations)
	for _, name := range migrations {
		script, err := os.ReadFile(filepath.Join(migrationDirectory, name))
		if err != nil {
			t.Fatalf("read Identity migration %s: %v", name, err)
		}
		if _, err := db.ExecContext(ctx, string(script)); err != nil {
			t.Fatalf("apply Identity migration %s: %v", name, err)
		}
	}

	const adminID = "actor_operator_profile_page_admin"
	if _, err := db.ExecContext(ctx, "INSERT INTO identity_actors(id,phone_e164) VALUES($1,$2)", adminID, "+967770009901"); err != nil {
		t.Fatalf("insert operator administrator: %v", err)
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO identity_actor_roles(actor_id,role,enabled) VALUES($1,'operator',true)", adminID); err != nil {
		t.Fatalf("insert operator administrator role: %v", err)
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO identity_bootstrap_state(id,bootstrap_completed_at,initial_operator_actor_id) VALUES(1,clock_timestamp(),$1)", adminID); err != nil {
		t.Fatalf("establish operator profile administrator authority fixture: %v", err)
	}

	for index, suffix := range []string{"first", "second"} {
		if _, err := db.ExecContext(ctx, `INSERT INTO identity_operator_profiles(id,full_name_ar,phone_e164,state,version,created_by_actor_id,created_at)
			VALUES($1,$2,$3,'pending_review',1,$4,clock_timestamp()+($5::int * interval '1 second'))`, "profile_"+suffix, "مشغل "+suffix, fmt.Sprintf("+9677700099%02d", index+2), adminID, index); err != nil {
			t.Fatalf("insert operator profile fixture %s: %v", suffix, err)
		}
	}

	service := New(db, "")
	first, err := service.ListOperatorProfiles(ctx, "control-panel", adminID, "", "all", "created_asc", 1, "")
	if err != nil || len(first.Items) != 1 || first.NextCursor == "" {
		t.Fatalf("operator profile first page failed: %+v err=%v", first, err)
	}
	second, err := service.ListOperatorProfiles(ctx, "control-panel", adminID, "", "all", "created_asc", 1, first.NextCursor)
	if err != nil || len(second.Items) != 1 || second.NextCursor != "" || second.Items[0].ID == first.Items[0].ID {
		t.Fatalf("operator profile cursor failed: first=%+v second=%+v err=%v", first, second, err)
	}
	filtered, err := service.ListOperatorProfiles(ctx, "control-panel", adminID, "first", "pending_review", "created_desc", 25, "")
	if err != nil || len(filtered.Items) != 1 || filtered.Items[0].ID != first.Items[0].ID {
		t.Fatalf("operator profile state/search filters failed: %+v err=%v", filtered, err)
	}
}
