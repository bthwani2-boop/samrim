package postgres_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// Runs only with the existing disposable-DB test connection. Never changes an
// existing Store, payment, or customer database; withFreshDatabase creates and
// drops a uniquely named database for this proof.
func TestStoreRelationFreshBootstrapAndV171Upgrade(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if dsn == "" {
		t.Skip("isolated DSH_DATABASE_URL is required for migration persistence proof")
	}
	root, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	pingCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := root.PingContext(pingCtx); err != nil {
		t.Fatal(err)
	}
	for _, baseline := range []int{0, 171} {
		t.Run(fmt.Sprintf("from-v%d", baseline), func(t *testing.T) {
			withFreshDatabase(t, root, dsn, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
				if baseline == 171 {
					tx, err := db.BeginTx(ctx, nil)
					if err != nil {
						t.Fatal(err)
					}
					if _, err := tx.ExecContext(ctx, `CREATE SCHEMA dsh;
						CREATE TABLE dsh.schema_migrations (version integer PRIMARY KEY, name text NOT NULL, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`); err != nil {
						_ = tx.Rollback()
						t.Fatal(err)
					}
					for i := 0; i < baseline; i++ {
						if _, err := tx.ExecContext(ctx, migrations[i]); err != nil {
							_ = tx.Rollback()
							t.Fatalf("bootstrap v%d: %v", i+1, err)
						}
						row := records[i]
						if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.schema_migrations (version,name,sha256) VALUES($1,$2,$3)", row.Version, row.Name, row.SHA256); err != nil {
							_ = tx.Rollback()
							t.Fatal(err)
						}
					}
					if _, err := tx.ExecContext(ctx, "INSERT INTO dsh.stores (id,partner_actor_id,name) VALUES ('existing-v171','partner-v171','Existing store')"); err != nil {
						_ = tx.Rollback()
						t.Fatal(err)
					}
					if err := tx.Commit(); err != nil {
						t.Fatal(err)
					}
				}
				if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
					t.Fatal(err)
				}
				if err := postgres.VerifySchema(ctx, db, records); err != nil {
					t.Fatal(err)
				}
				if baseline == 171 {
					var relation string
					if err := db.QueryRowContext(ctx, "SELECT relation_model FROM dsh.stores WHERE id='existing-v171'").Scan(&relation); err != nil || relation != postgres.StoreRelationBThwaniPartner {
						t.Fatalf("existing Store relation was not preserved: %s %v", relation, err)
					}
				}
				if _, err := db.ExecContext(ctx, "INSERT INTO dsh.stores (id,partner_actor_id,name) VALUES ('new-v172','partner-v172','New Store')"); err != nil {
					t.Fatal(err)
				}
				store, err := postgres.ReadStore(ctx, db, "new-v172")
				if err != nil || store.RelationModel != postgres.StoreRelationBThwaniPartner {
					t.Fatalf("new Store must default to marketplace relation: %+v %v", store, err)
				}
				if _, err := db.ExecContext(ctx, "UPDATE dsh.stores SET relation_model='INDEPENDENT_STORE' WHERE id='new-v172'"); err != nil {
					t.Fatalf("an unpublished Store may change its relationship only in this isolated schema proof: %v", err)
				}
				if _, err := db.ExecContext(ctx, "UPDATE dsh.stores SET publication_state='published' WHERE id='new-v172'"); err == nil || !strings.Contains(err.Error(), "stores_independent_market_publication_chk") {
					t.Fatalf("independent Store must never become marketplace-published: %v", err)
				}
				if _, err := db.ExecContext(ctx, "UPDATE dsh.stores SET relation_model='INVALID' WHERE id='new-v172'"); err == nil || !strings.Contains(err.Error(), "stores_relation_model_chk") {
					t.Fatalf("unsupported Store relation must be rejected: %v", err)
				}
				// The validations are separate committed transactions and remain
				// idempotent on an already migrated database.
				if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
					t.Fatalf("replay migration: %v", err)
				}
			})
		})
	}
}
