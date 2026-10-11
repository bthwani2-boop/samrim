package postgres_test

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestStoreTrashUpgradeFrom112PreservesExistingStores(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated DSH_DATABASE_URL required")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	for i := 0; i < 20; i++ {
		err = root.PingContext(ctx)
		if err == nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, scripts []string) {
		if err := applyMigrationPrefix(ctx, db, records, scripts, 112); err != nil {
			t.Fatal(err)
		}
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{ID: "legacy_store_recovery", PartnerActorID: "legacy_owner", Name: "متجر قديم محفوظ", PublicationState: "published"})
		if err := postgres.Migrate(ctx, db, records, scripts, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		var name, owner, state string
		var deleted sql.NullTime
		if err := db.QueryRowContext(ctx, "SELECT name,partner_actor_id,publication_state,deleted_at FROM dsh.stores WHERE id='legacy_store_recovery'").Scan(&name, &owner, &state, &deleted); err != nil {
			t.Fatal(err)
		}
		if name != "متجر قديم محفوظ" || owner != "legacy_owner" || state != "published" || deleted.Valid {
			t.Fatalf("migration modified legacy store: %q %q %q %v", name, owner, state, deleted)
		}
	})
}
