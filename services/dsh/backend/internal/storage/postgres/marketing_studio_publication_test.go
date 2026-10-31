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

func TestStudioPublishedPaletteValidation(t *testing.T) {
	palette := map[string]string{
		"navy":      "#102B4E",
		"orange":    "#F36B21",
		"white":     "#FFFFFF",
		"turquoise": "#83DDF3",
		"burgundy":  "#7B1E3A",
	}
	valid, err := json.Marshal(palette)
	if err != nil {
		t.Fatal(err)
	}
	if value, err := postgres.ValidateStudioPublishedPalette(valid); err != nil ||
		value.Navy != "#102B4E" || value.Orange != "#F36B21" {
		t.Fatalf("compiled palette must pass: %+v %v", value, err)
	}
	for _, tc := range []struct {
		name   string
		change func(map[string]string)
	}{
		{"white surface becomes dark", func(p map[string]string) { p["white"] = "#080808" }},
		{"text and surface no contrast", func(p map[string]string) { p["navy"] = "#FFFFFF" }},
		{"burgundy text contrast", func(p map[string]string) { p["burgundy"] = "#FFFFFF" }},
		{"turquoise contrast", func(p map[string]string) { p["turquoise"] = "#102B4E" }},
		{"css injection", func(p map[string]string) { p["orange"] = "var(--x)" }},
		{"missing palette role", func(p map[string]string) { delete(p, "white") }},
		{"unknown palette role", func(p map[string]string) { p["malicious"] = "#FFFFFF" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			edited := make(map[string]string, len(palette)+1)
			for k, v := range palette {
				edited[k] = v
			}
			tc.change(edited)
			raw, err := json.Marshal(edited)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := postgres.ValidateStudioPublishedPalette(raw); !errors.Is(err, postgres.ErrStudioPublicationInvalid) {
				t.Fatalf("must reject invalid palette: %v", err)
			}
		})
	}
}

func TestStudioPublishedPalettePersistenceRollbackAndConcurrency(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("requires isolated PostgreSQL test URL")
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
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		initial, err := postgres.ReadStudioPublication(ctx, db)
		if err != nil || initial.Version != 1 || initial.Palette != nil {
			t.Fatalf("compiled default publication expected: %+v %v", initial, err)
		}
		doc := studioFixture(t)
		draft, replayed, err := postgres.SetStudioDraft(ctx, db, doc, 1, "marketing-operator-a", "studio-pub-draft-correlation", "studio-pub-draft-key")
		if err != nil || replayed || draft.Version != 2 {
			t.Fatalf("save draft: %+v replay=%v err=%v", draft, replayed, err)
		}
		pub, replayed, err := postgres.SetStudioPublication(ctx, db, "ACTIVATE_DRAFT", 1, 2, 0, "marketing-operator-a", "studio-pub-correlation-01", "studio-pub-activate-key")
		if err != nil || replayed || pub.Version != 2 || pub.Palette == nil || pub.Palette.Navy != "#102B4E" {
			t.Fatalf("publish saved draft palette: %+v replay=%v err=%v", pub, replayed, err)
		}
		actual, err := postgres.ReadStudioPublication(ctx, db)
		if err != nil || actual.Version != 2 || actual.PublishedByActorID != "marketing-operator-a" || actual.Palette == nil {
			t.Fatalf("public canonical readback: %+v err=%v", actual, err)
		}
		prior, replayed, err := postgres.SetStudioPublication(ctx, db, "ACTIVATE_DRAFT", 1, 2, 0, "marketing-operator-a", "studio-pub-correlation-02", "studio-pub-activate-key")
		if err != nil || !replayed || prior.Version != 2 {
			t.Fatalf("original idempotent replay: %+v replay=%v err=%v", prior, replayed, err)
		}
		_, _, err = postgres.SetStudioPublication(ctx, db, "ACTIVATE_DRAFT", 1, 3, 0, "marketing-operator-a", "studio-pub-correlation-03", "studio-pub-activate-key")
		if !errors.Is(err, postgres.ErrStudioPublicationConflict) {
			t.Fatalf("same key changed facts accepted: %v", err)
		}
		_, _, err = postgres.SetStudioPublication(ctx, db, "ACTIVATE_DRAFT", 1, 2, 0, "marketing-operator-b", "studio-pub-correlation-04", "studio-pub-other-key")
		if !errors.Is(err, postgres.ErrStudioPublicationConflict) {
			t.Fatalf("stale publication was accepted: %v", err)
		}
		restored, _, err := postgres.SetStudioPublication(ctx, db, "RESTORE_DEFAULTS", 2, 0, 0, "marketing-operator-a", "studio-pub-correlation-05", "studio-pub-restore-key")
		if err != nil || restored.Version != 3 || restored.Palette != nil {
			t.Fatalf("restore code defaults: %+v err=%v", restored, err)
		}
		rollback, _, err := postgres.SetStudioPublication(ctx, db, "ROLLBACK", 3, 0, 2, "marketing-operator-a", "studio-pub-correlation-06", "studio-pub-rollback-key")
		if err != nil || rollback.Version != 4 || rollback.Palette == nil {
			t.Fatalf("rollback to version 2: %+v err=%v", rollback, err)
		}
		base, _, err := postgres.SetStudioPublication(ctx, db, "ROLLBACK", 4, 0, 1, "marketing-operator-a", "studio-pub-correlation-07", "studio-pub-rollback-base")
		if err != nil || base.Version != 5 || base.Palette != nil {
			t.Fatalf("rollback to compiled defaults: %+v err=%v", base, err)
		}
		type outcome struct {
			version int
			err     error
		}
		results := make(chan outcome, 2)
		go func() {
			v, _, e := postgres.SetStudioPublication(ctx, db, "ACTIVATE_DRAFT", 5, 2, 0, "marketing-operator-b", "studio-pub-concurrent-a", "studio-pub-concurrent-a")
			results <- outcome{v.Version, e}
		}()
		go func() {
			v, _, e := postgres.SetStudioPublication(ctx, db, "RESTORE_DEFAULTS", 5, 0, 0, "marketing-operator-c", "studio-pub-concurrent-b", "studio-pub-concurrent-b")
			results <- outcome{v.Version, e}
		}()
		success, conflicts := 0, 0
		for i := 0; i < 2; i++ {
			result := <-results
			switch {
			case result.err == nil && result.version == 6:
				success++
			case errors.Is(result.err, postgres.ErrStudioPublicationConflict):
				conflicts++
			default:
				t.Fatalf("unexpected concurrent publication outcome: %+v", result)
			}
		}
		if success != 1 || conflicts != 1 {
			t.Fatalf("concurrent publications: success=%d conflict=%d", success, conflicts)
		}
		history, err := postgres.ReadStudioPublicationHistory(ctx, db)
		if err != nil || len(history) != 5 || history[0].Version != 6 || history[len(history)-1].Version != 2 {
			t.Fatalf("audited publication history: %+v err=%v", history, err)
		}
		retained, replayed, err := postgres.SetStudioPublication(ctx, db, "ACTIVATE_DRAFT", 1, 2, 0, "marketing-operator-a", "studio-pub-replay-after-change", "studio-pub-activate-key")
		if err != nil || !replayed || retained.Version != 2 || retained.Palette == nil {
			t.Fatalf("historical replay must preserve version 2: %+v replay=%v err=%v", retained, replayed, err)
		}
	})
}
