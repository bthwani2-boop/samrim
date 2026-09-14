package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestLocationCoreIntegrity(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the fresh Location Core proof")
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
		if len(records) != postgres.SchemaVersion || records[6].Name != "007_location_core.sql" {
			t.Fatalf("Location Core migration is not the canonical schema tail: len=%d last=%q", len(records), records[len(records)-1].Name)
		}
		if err := postgres.Migrate(ctx, db, records, migrationSQL); err != nil {
			t.Fatalf("apply Location Core migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify Location Core schema: %v", err)
		}
		if err := postgres.Migrate(ctx, db, records, migrationSQL); err != nil {
			t.Fatalf("rerun Location Core migrations: %v", err)
		}

		const (
			clientActorID  = "act_client_location_v7"
			otherClientID  = "act_other_client_location_v7"
			partnerActorID = "act_partner_location_v7"
			storeID        = "store_location_v7"
		)
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.stores(id, partner_actor_id, name) VALUES($1,$2,$3)", storeID, partnerActorID, "Location Core Store"); err != nil {
			t.Fatalf("insert canonical Store fixture: %v", err)
		}

		created, err := postgres.CreateDeliveryAddress(ctx, db, clientActorID, "شارع التحرير، صنعاء", 15.3694457, 44.1910064, "idem-location-create-v7", postgres.HashDeliveryAddressCreateRequest(clientActorID, "شارع التحرير، صنعاء", 15.3694457, 44.1910064), "corr-location-create-v7")
		if err != nil || created.Replayed || created.Address.Version != 1 || created.Address.Latitude != 15.369446 || created.Address.Longitude != 44.191006 {
			t.Fatalf("create canonical delivery address failed: %+v err=%v", created, err)
		}
		replay, err := postgres.CreateDeliveryAddress(ctx, db, clientActorID, "شارع التحرير، صنعاء", 15.3694457, 44.1910064, "idem-location-create-v7", postgres.HashDeliveryAddressCreateRequest(clientActorID, "شارع التحرير، صنعاء", 15.3694457, 44.1910064), "corr-location-create-replay-v7")
		if err != nil || !replay.Replayed || replay.Address.ID != created.Address.ID || replay.Address.Version != 1 {
			t.Fatalf("delivery address replay failed: %+v err=%v", replay, err)
		}
		if _, err := postgres.CreateDeliveryAddress(ctx, db, clientActorID, "شارع آخر، صنعاء", 15.4, 44.2, "idem-location-create-v7", postgres.HashDeliveryAddressCreateRequest(clientActorID, "شارع آخر، صنعاء", 15.4, 44.2), "corr-location-create-conflict-v7"); !errors.Is(err, postgres.ErrDeliveryAddressIdempotency) {
			t.Fatalf("expected delivery address idempotency conflict, got %v", err)
		}
		addresses, err := postgres.ListDeliveryAddresses(ctx, db, clientActorID, 50)
		if err != nil || len(addresses) != 1 || addresses[0].ID != created.Address.ID {
			t.Fatalf("owned delivery address list failed: %+v err=%v", addresses, err)
		}
		otherAddresses, err := postgres.ListDeliveryAddresses(ctx, db, otherClientID, 50)
		if err != nil || len(otherAddresses) != 0 {
			t.Fatalf("delivery address ownership read leaked records: %+v err=%v", otherAddresses, err)
		}

		updated, err := postgres.UpdateDeliveryAddress(ctx, db, created.Address.ID, clientActorID, "شارع التحرير، صنعاء، مبنى 5", 15.369446, 44.191006, 1, "idem-location-update-v7", postgres.HashDeliveryAddressUpdateRequest(created.Address.ID, clientActorID, "شارع التحرير، صنعاء، مبنى 5", 15.369446, 44.191006, 1), "corr-location-update-v7")
		if err != nil || updated.Replayed || updated.Address.Version != 2 || updated.Address.AddressText != "شارع التحرير، صنعاء، مبنى 5" {
			t.Fatalf("update canonical delivery address failed: %+v err=%v", updated, err)
		}
		if _, err := postgres.UpdateDeliveryAddress(ctx, db, created.Address.ID, clientActorID, "عنوان قديم", 15.3, 44.1, 1, "idem-location-stale-v7", postgres.HashDeliveryAddressUpdateRequest(created.Address.ID, clientActorID, "عنوان قديم", 15.3, 44.1, 1), "corr-location-stale-v7"); !errors.Is(err, postgres.ErrDeliveryAddressVersion) {
			t.Fatalf("expected delivery address version conflict, got %v", err)
		}

		addressConcurrency := runAddressUpdates(ctx, db, created.Address.ID, clientActorID, 2)
		if addressConcurrency.successes != 1 || addressConcurrency.versionConflicts != 1 {
			t.Fatalf("delivery address concurrency was not serialized: %+v", addressConcurrency)
		}
		finalAddress, err := postgres.ReadDeliveryAddress(ctx, db, created.Address.ID, clientActorID)
		if err != nil || finalAddress.Version != 3 {
			t.Fatalf("delivery address canonical readback failed: %+v err=%v", finalAddress, err)
		}

		origin, err := postgres.SetStoreDeliveryOrigin(ctx, db, storeID, partnerActorID, 15.369446, 44.191006, 1, "idem-origin-v7", postgres.HashStoreDeliveryOriginRequest(storeID, partnerActorID, 15.369446, 44.191006, 1), "corr-origin-v7")
		if err != nil || origin.Replayed || origin.Origin.StoreVersion != 2 || origin.Origin.Latitude != 15.369446 || origin.Origin.Longitude != 44.191006 {
			t.Fatalf("set canonical Store delivery origin failed: %+v err=%v", origin, err)
		}
		originReplay, err := postgres.SetStoreDeliveryOrigin(ctx, db, storeID, partnerActorID, 15.369446, 44.191006, 1, "idem-origin-v7", postgres.HashStoreDeliveryOriginRequest(storeID, partnerActorID, 15.369446, 44.191006, 1), "corr-origin-replay-v7")
		if err != nil || !originReplay.Replayed || originReplay.Origin.StoreVersion != 2 {
			t.Fatalf("Store delivery origin replay failed: %+v err=%v", originReplay, err)
		}
		if _, err := postgres.SetStoreDeliveryOrigin(ctx, db, storeID, partnerActorID, 15.4, 44.2, 1, "idem-origin-v7", postgres.HashStoreDeliveryOriginRequest(storeID, partnerActorID, 15.4, 44.2, 1), "corr-origin-conflict-v7"); !errors.Is(err, postgres.ErrStoreOriginIdempotency) {
			t.Fatalf("expected Store delivery origin idempotency conflict, got %v", err)
		}
		if _, err := postgres.SetStoreDeliveryOrigin(ctx, db, storeID, partnerActorID, 15.4, 44.2, 1, "idem-origin-stale-v7", postgres.HashStoreDeliveryOriginRequest(storeID, partnerActorID, 15.4, 44.2, 1), "corr-origin-stale-v7"); !errors.Is(err, postgres.ErrStoreOriginVersion) {
			t.Fatalf("expected Store delivery origin version conflict, got %v", err)
		}

		originConcurrency := runOriginUpdates(ctx, db, storeID, partnerActorID, 2)
		if originConcurrency.successes != 1 || originConcurrency.versionConflicts != 1 {
			t.Fatalf("Store delivery origin concurrency was not serialized: %+v", originConcurrency)
		}
		readOrigin, available, err := postgres.ReadStoreDeliveryOrigin(ctx, db, storeID)
		if err != nil || !available || readOrigin.StoreVersion != 3 {
			t.Fatalf("Store delivery origin canonical readback failed: %+v available=%t err=%v", readOrigin, available, err)
		}

		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.delivery_addresses(id, client_actor_id, address_text, latitude, longitude) VALUES('invalid-location-v7',$1,'Bad',91,44)", clientActorID); err == nil {
			t.Fatal("database accepted an out-of-range delivery address latitude")
		}
		var addressAudits, originAudits int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.delivery_address_audit").Scan(&addressAudits); err != nil {
			t.Fatalf("read delivery address audit count: %v", err)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.store_origin_audit").Scan(&originAudits); err != nil {
			t.Fatalf("read Store origin audit count: %v", err)
		}
		if addressAudits != 3 || originAudits != 2 {
			t.Fatalf("unexpected Location Core audit count: addresses=%d origins=%d", addressAudits, originAudits)
		}
	})
}

type concurrencyResult struct {
	successes        int
	versionConflicts int
}

func runAddressUpdates(ctx context.Context, db *sql.DB, addressID, actorID string, expectedVersion int) concurrencyResult {
	var wait sync.WaitGroup
	results := make(chan error, 2)
	for index := 0; index < 2; index++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			text := fmt.Sprintf("شارع التغيير %d", index)
			_, err := postgres.UpdateDeliveryAddress(ctx, db, addressID, actorID, text, 15.5+float64(index)/100, 44.3+float64(index)/100, expectedVersion, fmt.Sprintf("idem-location-concurrent-v7-%d", index), postgres.HashDeliveryAddressUpdateRequest(addressID, actorID, text, 15.5+float64(index)/100, 44.3+float64(index)/100, expectedVersion), fmt.Sprintf("corr-location-concurrent-v7-%d", index))
			results <- err
		}(index)
	}
	wait.Wait()
	close(results)
	var outcome concurrencyResult
	for err := range results {
		if err == nil {
			outcome.successes++
		} else if errors.Is(err, postgres.ErrDeliveryAddressVersion) {
			outcome.versionConflicts++
		}
	}
	return outcome
}

func runOriginUpdates(ctx context.Context, db *sql.DB, storeID, partnerActorID string, expectedVersion int) concurrencyResult {
	var wait sync.WaitGroup
	results := make(chan error, 2)
	for index := 0; index < 2; index++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			latitude := 15.6 + float64(index)/100
			longitude := 44.4 + float64(index)/100
			_, err := postgres.SetStoreDeliveryOrigin(ctx, db, storeID, partnerActorID, latitude, longitude, expectedVersion, fmt.Sprintf("idem-origin-concurrent-v7-%d", index), postgres.HashStoreDeliveryOriginRequest(storeID, partnerActorID, latitude, longitude, expectedVersion), fmt.Sprintf("corr-origin-concurrent-v7-%d", index))
			results <- err
		}(index)
	}
	wait.Wait()
	close(results)
	var outcome concurrencyResult
	for err := range results {
		if err == nil {
			outcome.successes++
		} else if errors.Is(err, postgres.ErrStoreOriginVersion) {
			outcome.versionConflicts++
		}
	}
	return outcome
}
