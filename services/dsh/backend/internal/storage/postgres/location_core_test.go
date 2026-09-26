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
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured postgres is not reachable: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if len(records) != postgres.SchemaVersion || records[8].Name != "009_service_city_scope.sql" {
			t.Fatalf("Location Core migration is not the canonical schema tail: len=%d last=%q", len(records), records[len(records)-1].Name)
		}
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply Location Core migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify Location Core schema: %v", err)
		}
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("rerun Location Core migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify rerun Location Core schema: %v", err)
		}
		for _, column := range []string{
			"dsh.delivery_address_mutation_idempotency.result_version",
			"dsh.delivery_address_audit.address_text",
			"dsh.delivery_address_audit.latitude",
			"dsh.delivery_address_audit.longitude",
			"dsh.store_origin_mutation_idempotency.result_version",
			"dsh.store_origin_mutation_idempotency.result_latitude",
			"dsh.store_origin_mutation_idempotency.result_longitude",
			"dsh.store_origin_mutation_idempotency.result_updated_at",
			"dsh.store_origin_audit.latitude",
			"dsh.store_origin_audit.longitude",
		} {
			if columnExists(t, ctx, db, column) {
				t.Fatalf("precise or dead Location Core column remains after corrective cutover: %s", column)
			}
		}

		const (
			clientActorID  = "act_client_location_v8"
			otherClientID  = "act_other_client_location_v8"
			pagerClientID  = "act_pager_location_v8"
			partnerActorID = "act_partner_location_v8"
			foreignPartner = "act_foreign_partner_location_v8"
			storeID        = "store_location_v8"
		)
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.stores(id, partner_actor_id, name) VALUES($1,$2,$3)", storeID, partnerActorID, "Location Core Store"); err != nil {
			t.Fatalf("insert canonical Store fixture: %v", err)
		}

		created, err := postgres.CreateDeliveryAddress(ctx, db, clientActorID, "شارع التحرير، صنعاء", 15.3694457, 44.1910064, "idem-location-create-v8", postgres.HashDeliveryAddressCreateRequest(clientActorID, "شارع التحرير، صنعاء", 15.3694457, 44.1910064), "corr-location-create-v8")
		if err != nil || created.Replayed || created.Address.Version != 1 || created.Address.Latitude != 15.369446 || created.Address.Longitude != 44.191006 {
			t.Fatalf("create canonical delivery address failed: %+v err=%v", created, err)
		}
		replay, err := postgres.CreateDeliveryAddress(ctx, db, clientActorID, "شارع التحرير، صنعاء", 15.3694457, 44.1910064, "idem-location-create-v8", postgres.HashDeliveryAddressCreateRequest(clientActorID, "شارع التحرير، صنعاء", 15.3694457, 44.1910064), "corr-location-create-replay-v8")
		if err != nil || !replay.Replayed || replay.Address.ID != created.Address.ID || replay.Address.Version != 1 {
			t.Fatalf("delivery address replay failed: %+v err=%v", replay, err)
		}
		if _, err := postgres.CreateDeliveryAddress(ctx, db, clientActorID, "شارع آخر، صنعاء", 15.4, 44.2, "idem-location-create-v8", postgres.HashDeliveryAddressCreateRequest(clientActorID, "شارع آخر، صنعاء", 15.4, 44.2), "corr-location-create-conflict-v8"); !errors.Is(err, postgres.ErrDeliveryAddressIdempotency) {
			t.Fatalf("expected delivery address idempotency conflict, got %v", err)
		}

		listed, err := postgres.ListDeliveryAddresses(ctx, db, clientActorID, 50, "")
		if err != nil || len(listed.Addresses) != 1 || listed.Addresses[0].ID != created.Address.ID || listed.NextCursor != "" {
			t.Fatalf("owned delivery address list failed: %+v err=%v", listed, err)
		}
		otherAddresses, err := postgres.ListDeliveryAddresses(ctx, db, otherClientID, 50, "")
		if err != nil || len(otherAddresses.Addresses) != 0 || otherAddresses.NextCursor != "" {
			t.Fatalf("delivery address ownership read leaked records: %+v err=%v", otherAddresses, err)
		}
		if _, err := postgres.ListDeliveryAddresses(ctx, db, clientActorID, 50, "not-a-valid-cursor"); !errors.Is(err, postgres.ErrDeliveryAddressInvalidCursor) {
			t.Fatalf("expected malformed delivery address cursor rejection, got %v", err)
		}

		updated, err := postgres.UpdateDeliveryAddress(ctx, db, created.Address.ID, clientActorID, "شارع التحرير، صنعاء، مبنى 5", 15.369446, 44.191006, 1, "idem-location-update-v8-1", postgres.HashDeliveryAddressUpdateRequest(created.Address.ID, clientActorID, "شارع التحرير، صنعاء، مبنى 5", 15.369446, 44.191006, 1), "corr-location-update-v8-1")
		if err != nil || updated.Replayed || updated.Address.Version != 2 || updated.Address.AddressText != "شارع التحرير، صنعاء، مبنى 5" {
			t.Fatalf("update canonical delivery address failed: %+v err=%v", updated, err)
		}
		if delayedCreateReplay, err := postgres.CreateDeliveryAddress(ctx, db, clientActorID, "شارع التحرير، صنعاء", 15.3694457, 44.1910064, "idem-location-create-v8", postgres.HashDeliveryAddressCreateRequest(clientActorID, "شارع التحرير، صنعاء", 15.3694457, 44.1910064), "corr-location-create-delayed-replay-v8"); err != nil || !delayedCreateReplay.Replayed || delayedCreateReplay.Address.Version != 2 {
			t.Fatalf("delayed delivery address create replay did not read current canonical address: %+v err=%v", delayedCreateReplay, err)
		}
		updatedAgain, err := postgres.UpdateDeliveryAddress(ctx, db, created.Address.ID, clientActorID, "شارع التحرير، صنعاء، مبنى 6", 15.369447, 44.191007, 2, "idem-location-update-v8-2", postgres.HashDeliveryAddressUpdateRequest(created.Address.ID, clientActorID, "شارع التحرير، صنعاء، مبنى 6", 15.369447, 44.191007, 2), "corr-location-update-v8-2")
		if err != nil || updatedAgain.Address.Version != 3 {
			t.Fatalf("second delivery address update failed: %+v err=%v", updatedAgain, err)
		}
		if delayedUpdateReplay, err := postgres.UpdateDeliveryAddress(ctx, db, created.Address.ID, clientActorID, "شارع التحرير، صنعاء، مبنى 5", 15.369446, 44.191006, 1, "idem-location-update-v8-1", postgres.HashDeliveryAddressUpdateRequest(created.Address.ID, clientActorID, "شارع التحرير، صنعاء، مبنى 5", 15.369446, 44.191006, 1), "corr-location-update-delayed-replay-v8"); err != nil || !delayedUpdateReplay.Replayed || delayedUpdateReplay.Address.Version != 3 || delayedUpdateReplay.Address.AddressText != updatedAgain.Address.AddressText {
			t.Fatalf("delayed delivery address update replay did not read current canonical address: %+v err=%v", delayedUpdateReplay, err)
		}
		if _, err := postgres.UpdateDeliveryAddress(ctx, db, created.Address.ID, clientActorID, "عنوان stale", 15.3, 44.1, 1, "idem-location-stale-v8", postgres.HashDeliveryAddressUpdateRequest(created.Address.ID, clientActorID, "عنوان stale", 15.3, 44.1, 1), "corr-location-stale-v8"); !errors.Is(err, postgres.ErrDeliveryAddressVersion) {
			t.Fatalf("expected delivery address version conflict, got %v", err)
		}

		addressConcurrency := runAddressUpdates(ctx, db, created.Address.ID, clientActorID, 3)
		if addressConcurrency.successes != 1 || addressConcurrency.versionConflicts != 1 {
			t.Fatalf("delivery address concurrency was not serialized: %+v", addressConcurrency)
		}
		finalAddress, err := postgres.ReadDeliveryAddress(ctx, db, created.Address.ID, clientActorID)
		if err != nil || finalAddress.Version != 4 {
			t.Fatalf("delivery address canonical readback failed: %+v err=%v", finalAddress, err)
		}

		originBefore, available, err := postgres.ReadStoreDeliveryOrigin(ctx, db, storeID, partnerActorID)
		if err != nil || available || originBefore.OriginVersion != 0 {
			t.Fatalf("empty Store delivery origin readback failed: %+v available=%t err=%v", originBefore, available, err)
		}
		storeBeforeOrigin, err := postgres.ReadStore(ctx, db, storeID)
		if err != nil || storeBeforeOrigin.Version != 1 {
			t.Fatalf("Store version baseline readback failed: %+v err=%v", storeBeforeOrigin, err)
		}
		origin, err := postgres.SetStoreDeliveryOrigin(ctx, db, storeID, partnerActorID, 15.369446, 44.191006, 0, "idem-origin-v8-1", postgres.HashStoreDeliveryOriginRequest(storeID, partnerActorID, 15.369446, 44.191006, 0), "corr-origin-v8-1")
		if err != nil || origin.Replayed || origin.Origin.OriginVersion != 1 || origin.Origin.Latitude != 15.369446 || origin.Origin.Longitude != 44.191006 {
			t.Fatalf("set canonical Store delivery origin failed: %+v err=%v", origin, err)
		}
		storeAfterOrigin, err := postgres.ReadStore(ctx, db, storeID)
		if err != nil || storeAfterOrigin.Version != storeBeforeOrigin.Version {
			t.Fatalf("Store version changed during origin write: before=%+v after=%+v err=%v", storeBeforeOrigin, storeAfterOrigin, err)
		}
		originReplay, err := postgres.SetStoreDeliveryOrigin(ctx, db, storeID, partnerActorID, 15.369446, 44.191006, 0, "idem-origin-v8-1", postgres.HashStoreDeliveryOriginRequest(storeID, partnerActorID, 15.369446, 44.191006, 0), "corr-origin-replay-v8-1")
		if err != nil || !originReplay.Replayed || originReplay.Origin.OriginVersion != 1 {
			t.Fatalf("Store delivery origin replay failed: %+v err=%v", originReplay, err)
		}
		originSecond, err := postgres.SetStoreDeliveryOrigin(ctx, db, storeID, partnerActorID, 15.4, 44.2, 1, "idem-origin-v8-2", postgres.HashStoreDeliveryOriginRequest(storeID, partnerActorID, 15.4, 44.2, 1), "corr-origin-v8-2")
		if err != nil || originSecond.Origin.OriginVersion != 2 {
			t.Fatalf("second Store delivery origin write failed: %+v err=%v", originSecond, err)
		}
		if delayedOriginReplay, err := postgres.SetStoreDeliveryOrigin(ctx, db, storeID, partnerActorID, 15.369446, 44.191006, 0, "idem-origin-v8-1", postgres.HashStoreDeliveryOriginRequest(storeID, partnerActorID, 15.369446, 44.191006, 0), "corr-origin-delayed-replay-v8"); err != nil || !delayedOriginReplay.Replayed || delayedOriginReplay.Origin.OriginVersion != 2 || delayedOriginReplay.Origin.Latitude != 15.4 || delayedOriginReplay.Origin.Longitude != 44.2 {
			t.Fatalf("delayed Store origin replay did not read current canonical origin: %+v err=%v", delayedOriginReplay, err)
		}
		if _, err := postgres.SetStoreDeliveryOrigin(ctx, db, storeID, partnerActorID, 15.4, 44.2, 1, "idem-origin-stale-v8", postgres.HashStoreDeliveryOriginRequest(storeID, partnerActorID, 15.4, 44.2, 1), "corr-origin-stale-v8"); !errors.Is(err, postgres.ErrStoreOriginVersion) {
			t.Fatalf("expected Store delivery origin version conflict, got %v", err)
		}
		originConcurrency := runOriginUpdates(ctx, db, storeID, partnerActorID, 2)
		if originConcurrency.successes != 1 || originConcurrency.versionConflicts != 1 {
			t.Fatalf("Store delivery origin concurrency was not serialized: %+v", originConcurrency)
		}
		readOrigin, available, err := postgres.ReadStoreDeliveryOrigin(ctx, db, storeID, partnerActorID)
		if err != nil || !available || readOrigin.OriginVersion != 3 {
			t.Fatalf("Store delivery origin canonical readback failed: %+v available=%t err=%v", readOrigin, available, err)
		}
		if _, err := postgres.SetStorePublication(ctx, db, storeID, "published", 1, "idem-publication-location-v8", postgres.HashStorePublicationRequest(storeID, "published", 1), testOperatorActorID, "corr-publication-location-v8"); err != nil {
			t.Fatalf("Store publication fixture write failed: %v", err)
		}
		storeAfterPublication, err := postgres.ReadStore(ctx, db, storeID)
		if err != nil || storeAfterPublication.Version != 2 {
			t.Fatalf("Store publication did not own Store version: %+v err=%v", storeAfterPublication, err)
		}
		originAfterPublication, available, err := postgres.ReadStoreDeliveryOrigin(ctx, db, storeID, partnerActorID)
		if err != nil || !available || originAfterPublication.OriginVersion != readOrigin.OriginVersion {
			t.Fatalf("Store publication changed delivery-origin version: before=%+v after=%+v available=%t err=%v", readOrigin, originAfterPublication, available, err)
		}

		if _, _, err := postgres.ReadStoreDeliveryOrigin(ctx, db, storeID, foreignPartner); !errors.Is(err, postgres.ErrStoreOriginNotFound) {
			t.Fatalf("foreign Store origin lookup was distinguishable: %v", err)
		}
		if _, _, err := postgres.ReadStoreDeliveryOrigin(ctx, db, "unknown-store-location-v8", partnerActorID); !errors.Is(err, postgres.ErrStoreOriginNotFound) {
			t.Fatalf("unknown Store origin lookup was not a canonical not-found: %v", err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.delivery_addresses(id, client_actor_id, address_text, latitude, longitude) VALUES('invalid-location-v8',$1,'Bad',91,44)", clientActorID); err == nil {
			t.Fatal("database accepted an out-of-range delivery address latitude")
		}

		for index := 0; index < 51; index++ {
			text := fmt.Sprintf("عنوان ترقيم %02d، صنعاء", index)
			key := fmt.Sprintf("idem-location-page-v8-%02d", index)
			latitude := 15.0 + float64(index)/1000
			longitude := 44.0 + float64(index)/1000
			if _, err := postgres.CreateDeliveryAddress(ctx, db, pagerClientID, text, latitude, longitude, key, postgres.HashDeliveryAddressCreateRequest(pagerClientID, text, latitude, longitude), fmt.Sprintf("corr-location-page-v8-%02d", index)); err != nil {
				t.Fatalf("create paginated address %d: %v", index, err)
			}
		}
		seen := map[string]bool{}
		cursor := ""
		for page := 0; page < 10; page++ {
			result, err := postgres.ListDeliveryAddresses(ctx, db, pagerClientID, 10, cursor)
			if err != nil || len(result.Addresses) > 10 {
				t.Fatalf("paginated address page %d failed: %+v err=%v", page, result, err)
			}
			for _, address := range result.Addresses {
				if seen[address.ID] {
					t.Fatalf("paginated address repeated id: %s", address.ID)
				}
				seen[address.ID] = true
			}
			if result.NextCursor == "" {
				break
			}
			cursor = result.NextCursor
			if page == 9 {
				t.Fatal("paginated address list did not terminate")
			}
		}
		if len(seen) != 51 {
			t.Fatalf("paginated address list lost or duplicated records: got=%d want=51", len(seen))
		}

		var addressAudits, originAudits int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.delivery_address_audit WHERE client_actor_id=$1", clientActorID).Scan(&addressAudits); err != nil {
			t.Fatalf("read delivery address audit count: %v", err)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.store_origin_audit WHERE store_id=$1", storeID).Scan(&originAudits); err != nil {
			t.Fatalf("read Store origin audit count: %v", err)
		}
		if addressAudits != 4 || originAudits != 3 {
			t.Fatalf("unexpected Location Core audit count: addresses=%d origins=%d", addressAudits, originAudits)
		}

		verifyStoreFulfillmentModes(t, ctx, db)
		verifyStoreCaptainMembership(t, ctx, db)
	})
}

func columnExists(t *testing.T, ctx context.Context, db *sql.DB, qualified string) bool {
	t.Helper()
	parts := strings.Split(qualified, ".")
	if len(parts) != 3 {
		t.Fatalf("invalid qualified column fixture: %s", qualified)
	}
	var exists bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (
		SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3
	)`, parts[0], parts[1], parts[2]).Scan(&exists); err != nil {
		t.Fatalf("read column existence for %s: %v", qualified, err)
	}
	return exists
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
			latitude := 15.5 + float64(index)/100
			longitude := 44.3 + float64(index)/100
			_, err := postgres.UpdateDeliveryAddress(ctx, db, addressID, actorID, text, latitude, longitude, expectedVersion, fmt.Sprintf("idem-location-concurrent-v8-%d", index), postgres.HashDeliveryAddressUpdateRequest(addressID, actorID, text, latitude, longitude, expectedVersion), fmt.Sprintf("corr-location-concurrent-v8-%d", index))
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
			_, err := postgres.SetStoreDeliveryOrigin(ctx, db, storeID, partnerActorID, latitude, longitude, expectedVersion, fmt.Sprintf("idem-origin-concurrent-v8-%d", index), postgres.HashStoreDeliveryOriginRequest(storeID, partnerActorID, latitude, longitude, expectedVersion), fmt.Sprintf("corr-origin-concurrent-v8-%d", index))
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
