package postgres_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func studioFixture(t *testing.T) json.RawMessage {
	t.Helper()
	ids := []string{"hero", "benefits", "services", "stores", "products", "curated", "banners", "topSellers", "promotions", "testimonials", "brands", "trust"}
	sections := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		sections = append(sections, map[string]any{"id": id, "visible": id == "hero", "title": "قسم " + id, "description": "محتوى توضيحي", "count": 4})
	}
	document := map[string]any{
		"schemaVersion": 2, "sections": sections,
		"heroOptions": map[string]any{"height": "regular", "align": "start", "showDescription": true, "showButton": true, "showDots": true},
		"palette":     map[string]string{"navy": "#102B4E", "orange": "#F36B21", "white": "#FFFFFF", "turquoise": "#83DDF3", "burgundy": "#7B1E3A"},
		"slides":      []map[string]any{{"id": "slide-1", "title": "بثواني", "description": "صنعاء", "buttonLabel": "استكشف"}},
		"autoplay":    true, "intervalSeconds": 5,
	}
	raw, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestStudioDocumentValidationNoDatabaseSideEffects(t *testing.T) {
	base := studioFixture(t)
	if validated, err := postgres.ValidateStudioDocument(base); err != nil || len(validated) == 0 {
		t.Fatalf("expected valid typed draft: %v", err)
	}

	tests := []struct {
		name string
		edit func(map[string]any)
	}{
		{"bad schema", func(m map[string]any) { m["schemaVersion"] = 10 }},
		{"duplicate sections", func(m map[string]any) { m["sections"].([]any)[1].(map[string]any)["id"] = "hero" }},
		{"section omitted", func(m map[string]any) { m["sections"] = m["sections"].([]any)[:11] }},
		{"section extra property", func(m map[string]any) { m["sections"].([]any)[0].(map[string]any)["unsafe"] = true }},
		{"unbounded text", func(m map[string]any) { m["sections"].([]any)[0].(map[string]any)["title"] = strings.Repeat("ط", 81) }},
		{"bad number", func(m map[string]any) { m["sections"].([]any)[0].(map[string]any)["count"] = 0 }},
		{"bad palette", func(m map[string]any) { m["palette"].(map[string]any)["navy"] = "url(javascript:alert(1))" }},
		{"palette injection", func(m map[string]any) { m["palette"].(map[string]any)["shellCss"] = "color:red" }},
		{"unknown motion", func(m map[string]any) { m["heroOptions"].(map[string]any)["height"] = "10000px" }},
		{"extra hero property", func(m map[string]any) { m["heroOptions"].(map[string]any)["executeJs"] = true }},
		{"invalid slides", func(m map[string]any) { m["slides"] = []any{} }},
		{"duplicate slides", func(m map[string]any) { m["slides"] = []any{m["slides"].([]any)[0], m["slides"].([]any)[0]} }},
		{"invalid interval", func(m map[string]any) { m["intervalSeconds"] = 1 }},
		{"unrecognized top key", func(m map[string]any) { m["publish"] = true }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var input map[string]any
			if err := json.Unmarshal(base, &input); err != nil {
				t.Fatal(err)
			}
			tc.edit(input)
			invalid, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := postgres.ValidateStudioDocument(invalid); !errors.Is(err, postgres.ErrStudioDraftInvalid) {
				t.Fatalf("expected validation rejection; got %v", err)
			}
			if _, replayed, err := postgres.SetStudioDraft(context.Background(), nil, invalid, 1, "operator", "correlation-01", "idempotency-01"); !errors.Is(err, postgres.ErrStudioDraftInvalid) || replayed {
				t.Fatalf("unexpected database access on rejected document: replayed=%v err=%v", replayed, err)
			}
		})
	}
	if _, _, err := postgres.SetStudioDraft(context.Background(), nil, base, 0, "operator", "correlation-01", "idempotency-01"); !errors.Is(err, postgres.ErrStudioDraftInvalid) {
		t.Fatalf("missing version must fail before SQL: %v", err)
	}
}

func TestStudioMigrationRegistered(t *testing.T) {
	records, statements, err := postgres.LoadMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != postgres.SchemaVersion ||
		records[165].Name != "166_marketing_studio_draft.sql" ||
		records[166].Name != "167_marketing_studio_publication.sql" ||
		records[167].Name != "168_store_public_contact.sql" ||
		records[168].Name != "169_marketing_studio_layout.sql" {
		t.Fatalf("unexpected Studio/Store contact migration history: loaded %d records", len(records))
	}
	if len(statements) != postgres.SchemaVersion || !strings.Contains(statements[165], "marketing_studio_draft_events") || !strings.Contains(statements[166], "marketing_studio_publication_events") || !strings.Contains(statements[167], "store_public_contacts") || !strings.Contains(statements[168], "marketing_studio_layout_events") {
		t.Fatal("Studio or Store contact migration SQL missing")
	}
}

// This test works only in an isolated throwaway PostgreSQL database managed by withFreshDatabase.
// No existing local actor/account/store or active session is changed.
func TestStudioDraftPersistenceVersionReplayAndIsolation(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated PostgreSQL connection is not configured")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if err := root.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if os.Getenv("STUDIO_SCHEMA_ONLY_TEST") == "1" {
			if _, err := db.ExecContext(ctx, "CREATE SCHEMA dsh"); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, migrations[165]); err != nil {
				t.Fatal(err)
			}
		} else if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		first, err := postgres.ReadStudioDraft(ctx, db)
		if err != nil || first.Version != 1 || len(first.Document) != 0 {
			t.Fatalf("expected empty first draft, version 1: %+v, %v", first, err)
		}
		doc := studioFixture(t)
		saved, replayed, err := postgres.SetStudioDraft(ctx, db, doc, 1, "marketing-operator-a", "studio-correlation-01", "studio-idempotency-01")
		if err != nil || replayed || saved.Version != 2 {
			t.Fatalf("save failed: %+v replayed=%v err=%v", saved, replayed, err)
		}
		same, replayed, err := postgres.SetStudioDraft(ctx, db, doc, 1, "marketing-operator-a", "studio-correlation-02", "studio-idempotency-01")
		if err != nil || !replayed || same.Version != 2 {
			t.Fatalf("same-key replay failed: %+v replayed=%v err=%v", same, replayed, err)
		}
		_, _, err = postgres.SetStudioDraft(ctx, db, doc, 1, "marketing-operator-b", "studio-correlation-03", "studio-idempotency-02")
		if !errors.Is(err, postgres.ErrStudioDraftConflict) {
			t.Fatalf("stale concurrent writer was accepted: %v", err)
		}
		_, _, err = postgres.SetStudioDraft(ctx, db, doc, 1, "marketing-operator-a", "studio-correlation-04", "studio-idempotency-01-changed")
		if !errors.Is(err, postgres.ErrStudioDraftConflict) {
			t.Fatalf("stale write must conflict: %v", err)
		}
		changed := studioFixture(t)
		var payload map[string]any
		_ = json.Unmarshal(changed, &payload)
		payload["intervalSeconds"] = 6
		changed, _ = json.Marshal(payload)
		_, _, err = postgres.SetStudioDraft(ctx, db, changed, 1, "marketing-operator-a", "studio-correlation-05", "studio-idempotency-01")
		if !errors.Is(err, postgres.ErrStudioDraftConflict) {
			t.Fatalf("same key, changed payload should conflict: %v", err)
		}
		stored, err := postgres.ReadStudioDraft(ctx, db)
		if err != nil || stored.Version != 2 || stored.UpdatedByActorID != "marketing-operator-a" {
			t.Fatalf("canonical readback failed: %+v %v", stored, err)
		}
		var count int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.marketing_studio_draft_events").Scan(&count); err != nil || count != 1 {
			t.Fatalf("expected one audit row, count=%d err=%v", count, err)
		}

		// Two concurrent edits from version 2 must serialize and accept exactly one.
		type result struct {
			version int
			err     error
		}
		results := make(chan result, 2)
		for index, seconds := range []int{6, 7} {
			var next map[string]any
			if err := json.Unmarshal(doc, &next); err != nil {
				t.Fatal(err)
			}
			next["intervalSeconds"] = seconds
			input, err := json.Marshal(next)
			if err != nil {
				t.Fatal(err)
			}
			actor := "marketing-operator-" + string(rune('c'+index))
			key := "studio-concurrent-idempotency-" + string(rune('a'+index))
			go func() {
				output, _, err := postgres.SetStudioDraft(ctx, db, input, 2, actor, "studio-concurrent-correlation", key)
				results <- result{version: output.Version, err: err}
			}()
		}
		accepted, conflicts := 0, 0
		for i := 0; i < 2; i++ {
			outcome := <-results
			switch {
			case outcome.err == nil && outcome.version == 3:
				accepted++
			case errors.Is(outcome.err, postgres.ErrStudioDraftConflict):
				conflicts++
			default:
				t.Fatalf("unexpected concurrent studio write result: %+v", outcome)
			}
		}
		if accepted != 1 || conflicts != 1 {
			t.Fatalf("concurrent writes: accepted=%d conflicts=%d", accepted, conflicts)
		}
		latest, err := postgres.ReadStudioDraft(ctx, db)
		if err != nil || latest.Version != 3 {
			t.Fatalf("concurrent readback is inconsistent: %+v err=%v", latest, err)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.marketing_studio_draft_events").Scan(&count); err != nil || count != 2 {
			t.Fatalf("concurrent write audit count=%d err=%v", count, err)
		}
		old, replayed, err := postgres.SetStudioDraft(ctx, db, doc, 1, "marketing-operator-a", "studio-correlation-after-updates", "studio-idempotency-01")
		if err != nil || !replayed || old.Version != 2 {
			t.Fatalf("historical replay returned another version: %+v replayed=%v err=%v", old, replayed, err)
		}
	})
}

func TestStudioDraftMigrationUpgradeFromV165(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated PostgreSQL connection is not configured")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	check, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := root.PingContext(check); err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback() }()
		if _, err := tx.ExecContext(ctx, "CREATE SCHEMA dsh"); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.ExecContext(ctx, "CREATE TABLE dsh.schema_migrations (version integer PRIMARY KEY, name text NOT NULL, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())"); err != nil {
			t.Fatal(err)
		}
		for index := 0; index < 165; index++ {
			if _, err := tx.ExecContext(ctx, migrations[index]); err != nil {
				t.Fatalf("bootstrap old schema v%d: %v", index+1, err)
			}
			row := records[index]
			if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.schema_migrations(version,name,sha256) VALUES($1,$2,$3)", row.Version, row.Name, row.SHA256); err != nil {
				t.Fatalf("record old schema v%d: %v", row.Version, err)
			}
		}
		if _, err := tx.ExecContext(ctx, "UPDATE dsh.marketing_banner_presentation SET mode='CROSSFADE', interval_seconds=7, version=9 WHERE placement='HOME'"); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}

		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("upgrade from v165 to v169: %v", err)
		}
		var count, latest int
		if err := db.QueryRowContext(ctx, "SELECT count(*), max(version) FROM dsh.schema_migrations").Scan(&count, &latest); err != nil || count != 169 || latest != 169 {
			t.Fatalf("upgrade migration history: count=%d latest=%d err=%v", count, latest, err)
		}
		var contactTable, layoutEvents string
		if err := db.QueryRowContext(ctx, "SELECT to_regclass('dsh.store_public_contacts')::text, to_regclass('dsh.marketing_studio_layout_events')::text").Scan(&contactTable, &layoutEvents); err != nil ||
			contactTable != "dsh.store_public_contacts" || layoutEvents != "dsh.marketing_studio_layout_events" {
			t.Fatalf("v168 contact or v169 Studio layout missing after upgrade: contact=%q layout=%q err=%v", contactTable, layoutEvents, err)
		}
		previous, err := postgres.ReadBannerPresentation(ctx, db)
		if err != nil || previous.Mode != "CROSSFADE" || previous.IntervalSeconds != 7 || previous.Version != 9 {
			t.Fatalf("marketing banner state changed during Studio upgrade: %+v err=%v", previous, err)
		}
		studio, err := postgres.ReadStudioDraft(ctx, db)
		if err != nil || studio.Version != 1 || len(studio.Document) != 0 {
			t.Fatalf("Studio draft missing after upgrade: %+v err=%v", studio, err)
		}
	})
}
