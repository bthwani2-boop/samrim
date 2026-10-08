package actor

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/identity/backend/internal/domain"
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
	for _, permission := range domain.OperatorPermissions() {
		if _, err := db.ExecContext(ctx, `INSERT INTO identity_operator_permissions(actor_id,role,permission,enabled,version,changed_by_actor_id,reason)
			VALUES($1,'operator',$2,true,1,$1,'initial operator bootstrap')`, adminID, permission); err != nil {
			t.Fatalf("establish canonical operator permission fixture %s: %v", permission, err)
		}
	}

	for index, suffix := range []string{"first", "second"} {
		if _, err := db.ExecContext(ctx, `INSERT INTO identity_operator_profiles(id,full_name_ar,phone_e164,job_title,department,state,version,created_by_actor_id,created_at)
			VALUES($1,$2,$3,'مشرف اختبار','العمليات','pending_review',1,$4,clock_timestamp()+($5::int * interval '1 second'))`, "profile_"+suffix, "مشغل "+suffix, fmt.Sprintf("+9677700099%02d", index+2), adminID, index); err != nil {
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

	created, err := service.CreateOperatorProfile(ctx, "control-panel", adminID, "operator-details-correlation-create", "operator-details-idempotency-create", domain.OperatorProfileCreateRequest{
		FullNameAr: "مشغل اختبار التفاصيل", PhoneE164: "+967770009999", JobTitle: "محلل عمليات", Department: "العمليات",
	})
	if err != nil || created.Profile.JobTitle != "محلل عمليات" || created.Profile.Department != "العمليات" {
		t.Fatalf("operator creation did not persist required job details: profile=%+v err=%v", created.Profile, err)
	}
	if _, err := service.ApproveOperatorProfile(ctx, "control-panel", adminID, "operator-details-correlation-approve", "operator-details-idempotency-approve", created.Profile.ID, created.Profile.Version); err != nil {
		t.Fatalf("approve operator profile: %v", err)
	}
	approved, err := service.ReadOperatorProfile(ctx, "control-panel", adminID, created.Profile.ID)
	if err != nil {
		t.Fatalf("read approved operator profile: %v", err)
	}
	granted, err := service.GrantOperatorProfile(ctx, "control-panel", adminID, "operator-details-correlation-grant", "operator-details-idempotency-grant", approved.ID, approved.Version)
	if err != nil || granted.Role.JobTitle != "محلل عمليات" || granted.Role.Department != "العمليات" {
		t.Fatalf("operator role did not receive the reviewed job details: role=%+v err=%v", granted.Role, err)
	}
	if granted.Profile.JobTitle != granted.Role.JobTitle || granted.Profile.Department != granted.Role.Department {
		t.Fatalf("canonical admitted profile did not read the role-owned details: profile=%+v role=%+v", granted.Profile, granted.Role)
	}

	updated, err := service.UpdateOperatorRoleDetails(ctx, "control-panel", adminID, "operator-details-correlation-update", granted.Role.ActorID, domain.OperatorRoleDetailsUpdateRequest{
		JobTitle: "قائد العمليات", Department: "مركز العمليات", ExpectedVersion: granted.Role.RoleVersion,
	})
	if err != nil || updated.JobTitle != "قائد العمليات" || updated.Department != "مركز العمليات" || updated.RoleVersion != granted.Role.RoleVersion+1 {
		t.Fatalf("operator role detail update/readback failed: role=%+v err=%v", updated, err)
	}
	if _, err := service.UpdateOperatorRoleDetails(ctx, "control-panel", adminID, "operator-details-correlation-stale", granted.Role.ActorID, domain.OperatorRoleDetailsUpdateRequest{
		JobTitle: "قديم", Department: "قديم", ExpectedVersion: granted.Role.RoleVersion,
	}); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("stale operator role version was not rejected: %v", err)
	}
	var audited bool
	if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM identity_security_audit WHERE subject_actor_id=$1 AND event_type='operator.details_updated' AND correlation_id=$2)", granted.Role.ActorID, "operator-details-correlation-update").Scan(&audited); err != nil || !audited {
		t.Fatalf("operator details update was not audited: audited=%v err=%v", audited, err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO identity_sessions(id,actor_id,role,access_token_hash,refresh_token_hash,client_instance_id_hash,access_expires_at,refresh_expires_at,absolute_expires_at,created_at)
		VALUES('operator-details-search-session',$1,'operator',repeat('a',64),repeat('b',64),repeat('c',64),clock_timestamp()+interval '15 minutes',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours',clock_timestamp()-interval '5 minutes')`, granted.Role.ActorID); err != nil {
		t.Fatalf("create operator session readback fixture: %v", err)
	}
	search, err := service.Search(ctx, "control-panel", domain.ActorSearchInput{Role: "operator", Query: "مركز العمليات", Limit: 25})
	if err != nil || len(search.Items) != 1 || search.Items[0].ActorID != granted.Role.ActorID || search.Items[0].FullNameAr != "مشغل اختبار التفاصيل" || search.Items[0].JobTitle != "قائد العمليات" || search.Items[0].Department != "مركز العمليات" || search.Items[0].CreatedAt.IsZero() || search.Items[0].LastAuthenticatedAt == nil {
		t.Fatalf("operator directory search did not find the canonical department: result=%+v err=%v", search, err)
	}
	longArabicSearch, err := service.Search(ctx, "control-panel", domain.ActorSearchInput{Role: "operator", Query: strings.Repeat("م", 51), Limit: 25})
	if err != nil {
		t.Fatalf("operator directory search rejected a 51-character Arabic query: %v", err)
	}
	if len(longArabicSearch.Items) != 0 {
		t.Fatalf("long Arabic query unexpectedly matched operators: %+v", longArabicSearch.Items)
	}
}
