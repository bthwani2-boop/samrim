package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestWalletProviderRegistryMutationLifecycle(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for isolated wallet provider persistence proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured postgres is not reachable: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply DSH migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify DSH schema: %v", err)
		}
		const key = "wallet_provider_registry_test"
		const createID = "wallet-provider-registry-create-v1"
		const name = "محفظة اختبار السجل"
		createHash := postgres.HashWalletProviderMutation(key, name, true, 0)
		created, err := postgres.MutateWalletProvider(ctx, db, key, name, true, 0, createID, createHash, testOperatorActorID, "wallet-provider-create-correlation")
		if err != nil || created.Replayed || created.Provider.Version != 1 || !created.Provider.Active {
			t.Fatalf("create wallet provider: result=%#v err=%v", created, err)
		}
		replayed, err := postgres.MutateWalletProvider(ctx, db, key, name, true, 0, createID, createHash, testOperatorActorID, "wallet-provider-create-replay")
		if err != nil || !replayed.Replayed || replayed.Provider.Key != key {
			t.Fatalf("replay wallet provider create: result=%#v err=%v", replayed, err)
		}
		if _, err := postgres.MutateWalletProvider(ctx, db, key, name, false, 0, createID, postgres.HashWalletProviderMutation(key, name, false, 0), testOperatorActorID, "wallet-provider-create-conflict"); !errors.Is(err, postgres.ErrWalletProviderIdempotency) {
			t.Fatalf("conflicting create replay error = %v; want idempotency conflict", err)
		}

		updatedName := "محفظة اختبار محدثة"
		updateID := "wallet-provider-registry-update-v1"
		updated, err := postgres.MutateWalletProvider(ctx, db, key, updatedName, true, 1, updateID, postgres.HashWalletProviderMutation(key, updatedName, true, 1), testOperatorActorID, "wallet-provider-update-correlation")
		if err != nil || updated.Replayed || updated.Provider.Version != 2 || updated.Provider.DisplayNameAr != updatedName {
			t.Fatalf("update wallet provider: result=%#v err=%v", updated, err)
		}
		if _, err := postgres.MutateWalletProvider(ctx, db, key, updatedName, true, 1, "wallet-provider-stale-version-v1", postgres.HashWalletProviderMutation(key, updatedName, true, 1), testOperatorActorID, "wallet-provider-stale-correlation"); !errors.Is(err, postgres.ErrWalletProviderVersion) {
			t.Fatalf("stale update error = %v; want version conflict", err)
		}

		deactivated, err := postgres.MutateWalletProvider(ctx, db, key, updatedName, false, 2, "wallet-provider-registry-deactivate-v1", postgres.HashWalletProviderMutation(key, updatedName, false, 2), testOperatorActorID, "wallet-provider-deactivate-correlation")
		if err != nil || deactivated.Provider.Version != 3 || deactivated.Provider.Active {
			t.Fatalf("deactivate wallet provider: result=%#v err=%v", deactivated, err)
		}
		replayedCreate, err := postgres.MutateWalletProvider(ctx, db, key, name, true, 0, createID, createHash, testOperatorActorID, "wallet-provider-create-after-update")
		if err != nil || !replayedCreate.Replayed || replayedCreate.Provider.DisplayNameAr != name || !replayedCreate.Provider.Active || replayedCreate.Provider.Version != 1 {
			t.Fatalf("replay original wallet provider create after later updates: result=%#v err=%v", replayedCreate, err)
		}
		replayedUpdate, err := postgres.MutateWalletProvider(ctx, db, key, updatedName, true, 1, updateID, postgres.HashWalletProviderMutation(key, updatedName, true, 1), testOperatorActorID, "wallet-provider-update-after-deactivation")
		if err != nil || !replayedUpdate.Replayed || replayedUpdate.Provider.DisplayNameAr != updatedName || !replayedUpdate.Provider.Active || replayedUpdate.Provider.Version != 2 {
			t.Fatalf("replay original wallet provider update after deactivation: result=%#v err=%v", replayedUpdate, err)
		}
		active, err := postgres.ListWalletProviders(ctx, db, true)
		if err != nil {
			t.Fatalf("list active wallet providers: %v", err)
		}
		all, err := postgres.ListWalletProviders(ctx, db, false)
		if err != nil {
			t.Fatalf("list all wallet providers: %v", err)
		}
		activeFound, allFound := false, false
		for _, provider := range active {
			activeFound = activeFound || provider.Key == key
		}
		for _, provider := range all {
			allFound = allFound || provider.Key == key && !provider.Active && provider.Version == 3
		}
		if activeFound || !allFound {
			t.Fatalf("provider active/all listing mismatch: activeFound=%v allFound=%v", activeFound, allFound)
		}
		var auditCount, idempotencyCount int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM dsh.wallet_provider_audit WHERE provider_key=$1`, key).Scan(&auditCount); err != nil {
			t.Fatalf("read wallet provider audit: %v", err)
		}
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM dsh.wallet_provider_mutation_idempotency WHERE provider_key=$1`, key).Scan(&idempotencyCount); err != nil {
			t.Fatalf("read wallet provider idempotency: %v", err)
		}
		if auditCount != 3 || idempotencyCount != 3 {
			t.Fatalf("wallet provider mutation records: audit=%d idempotency=%d; want 3 each", auditCount, idempotencyCount)
		}
	})
}
