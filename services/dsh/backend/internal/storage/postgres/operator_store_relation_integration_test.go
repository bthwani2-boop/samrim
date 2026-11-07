package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// Uses only a disposable PostgreSQL database. DSH filters relationships
// before pagination, rather than dropping marketplace rows in the UI.
func TestOperatorStoreRelationScopedList(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("DSH_DATABASE_URL is required for isolated Store relation registry proof")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		for _, item := range []struct{ id, owner string }{
			{"market-registry-store", "market-registry-owner"},
			{"independent-registry-1", "independent-registry-owner"},
			{"independent-registry-2", "independent-registry-owner"},
		} {
			insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
				ID: item.id, PartnerActorID: item.owner, Name: item.id,
			})
		}
		if _, err := db.ExecContext(ctx, `UPDATE dsh.stores SET relation_model='INDEPENDENT_STORE'
			WHERE id IN ('independent-registry-1','independent-registry-2')`); err != nil {
			t.Fatal(err)
		}
		first, err := postgres.ListStoresForOperator(ctx, db, "", "", "", "contains", "updated_desc", 1, "", postgres.StoreRelationIndependent)
		if err != nil || len(first.Stores) != 1 || first.NextCursor == "" || first.Stores[0].RelationModel != postgres.StoreRelationIndependent {
			t.Fatalf("first independent page must have exactly one owned Store and a cursor: %+v err=%v", first, err)
		}
		second, err := postgres.ListStoresForOperator(ctx, db, "", "", "", "contains", "updated_desc", 1, first.NextCursor, postgres.StoreRelationIndependent)
		if err != nil || len(second.Stores) != 1 || second.Stores[0].RelationModel != postgres.StoreRelationIndependent || second.Stores[0].ID == first.Stores[0].ID || second.NextCursor != "" {
			t.Fatalf("last independent page must not repeat a Store or include marketplace rows: %+v err=%v", second, err)
		}
		if _, err := postgres.ListStoresForOperator(ctx, db, "", "", "", "contains", "updated_desc", 1, first.NextCursor, postgres.StoreRelationBThwaniPartner); !errors.Is(err, postgres.ErrOperatorStoreInvalidCursor) {
			t.Fatalf("cross-relation cursor must fail closed: %v", err)
		}
		market, err := postgres.ListStoresForOperator(ctx, db, "", "", "", "contains", "updated_desc", 25, "", postgres.StoreRelationBThwaniPartner)
		if err != nil || len(market.Stores) != 1 || market.Stores[0].ID != "market-registry-store" {
			t.Fatalf("marketplace registry must exclude both independent Stores: %+v err=%v", market, err)
		}
		all, err := postgres.ListStoresForOperator(ctx, db, "", "", "", "contains", "updated_desc", 25, "", "")
		if err != nil || len(all.Stores) != 3 {
			t.Fatalf("existing unfiltered operator consumers must retain all Stores: %+v err=%v", all, err)
		}
		if _, err := postgres.ListStoresForOperator(ctx, db, "", "", "", "contains", "updated_desc", 25, "", "UNTRUSTED"); !errors.Is(err, postgres.ErrOperatorStoreInvalidQuery) {
			t.Fatalf("invalid Store relation must fail closed: %v", err)
		}
	})
}
