package postgres_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// A selected store must not inherit the four-item cap used by the public
// discovery carousel. The test uses only a disposable, isolated PostgreSQL DB.
func TestPublicPromotionsListAllEligibleForSelectedStore(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("isolated PostgreSQL connection is not configured")
	}
	root, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 7; i++ {
			_, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_promotions
                (id,code,name_ar,kind,value_minor,funding_source,state,starts_at,ends_at,created_by_actor_id,discount_budget_limit_minor)
                VALUES($1,$2,'عرض معتمد','PERCENTAGE',10,'BTHWANI','PUBLISHED',now()-interval '1 hour',now()+interval '1 day','test-operator',50000)`,
				fmt.Sprintf("isolated-promotion-%d", i), fmt.Sprintf("ISOLATED%d", i))
			if err != nil {
				t.Fatalf("fixture %d: %v", i, err)
			}
		}
		// A draft must never leak into a public list.
		_, err := db.ExecContext(ctx, `INSERT INTO dsh.commerce_promotions
            (id,code,name_ar,kind,value_minor,funding_source,state,starts_at,created_by_actor_id)
            VALUES('isolated-draft','ISODRAFT','عرض تجريبي','PERCENTAGE',10,'BTHWANI','DRAFT',now()-interval '1 hour','test-operator')`)
		if err != nil {
			t.Fatal(err)
		}
		storeItems, err := postgres.ListPromotions(ctx, db, true, "city-any", "selected-store")
		if err != nil {
			t.Fatal(err)
		}
		if len(storeItems) != 7 {
			t.Fatalf("selected store must see all seven eligible offers; got %d", len(storeItems))
		}
		for _, item := range storeItems {
			if item.State != "PUBLISHED" {
				t.Fatalf("nonpublished offer leaked: %q", item.ID)
			}
		}
		feedItems, err := postgres.ListPromotions(ctx, db, true, "city-any", "")
		if err != nil {
			t.Fatal(err)
		}
		if len(feedItems) != 4 {
			t.Fatalf("public discovery feed must remain four items, got %d", len(feedItems))
		}
	})
}
