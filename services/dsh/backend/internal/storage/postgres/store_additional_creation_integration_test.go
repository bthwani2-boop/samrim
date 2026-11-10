package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// This uses ONLY the isolated QA allowlist and a new disposable child DB.
// It never writes a Store or Store policy to a retained development database.
func TestCanonicalAdditionalStoreWriterPostgres(t *testing.T) {
	raw := strings.TrimSpace(os.Getenv("DSH_JOINING_QA_DATABASE_URL"))
	if raw == "" {
		t.Skip("isolated DSH joining QA database is not configured")
	}
	if !joiningQADatabaseIsolated(raw, os.Getenv) {
		t.Fatal("refusing non-isolated database for Store creation proof")
	}
	root, err := sql.Open("postgres", raw)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, raw, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrations []string) {
		if err := postgres.Migrate(ctx, db, records, migrations, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		var table, retired sql.NullString
		if err := db.QueryRowContext(ctx, `SELECT to_regclass('dsh.store_create_idempotency')::text,
            to_regclass('dsh.first_store_create_idempotency')::text`).Scan(&table, &retired); err != nil {
			t.Fatal(err)
		}
		if !table.Valid || table.String != "dsh.store_create_idempotency" || retired.Valid {
			t.Fatalf("single canonical Store creation ledger missing: current=%v former=%v", table, retired)
		}
		for _, command := range []string{
			"INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('qa-multi-city','QA City',true)",
			"INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES('qa-multi-vertical','QA Vertical','QA Vertical')",
			"INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES('qa-multi-type','qa-multi-vertical','QA Type','QA Type')",
		} {
			if _, err := db.ExecContext(ctx, command); err != nil {
				t.Fatal(err)
			}
		}
		const owner = "qa-multi-owner"
		firstInput := postgres.SelfStoreInput{
			RelationModel: postgres.StoreRelationBThwaniPartner, Name: "Synthetic First Shop",
			ServiceCityID: "qa-multi-city", VerticalID: "qa-multi-vertical", CommercialTypeID: "qa-multi-type",
			Address: "QA synthetic street", Latitude: 15.36, Longitude: 44.20,
			FulfillmentModes: []string{"CUSTOMER_PICKUP"},
		}
		first, replayed, err := postgres.CreateFirstStoreForPartner(ctx, db, owner, firstInput, "qa-multi-first-creation-0001")
		if err != nil || replayed {
			t.Fatalf("first Store: %+v replay=%v err=%v", first, replayed, err)
		}
		independent := firstInput
		independent.RelationModel = postgres.StoreRelationIndependent
		independent.Name = "Synthetic Second Shop"
		const key = "qa-multi-additional-creation-0001"

		type outcome struct {
			store    postgres.StoreRecord
			replayed bool
			err      error
		}
		results := make(chan outcome, 8)
		var wg sync.WaitGroup
		for range 8 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				item, replayed, err := postgres.CreateAdditionalStoreForPartner(ctx, db, owner, independent, key)
				results <- outcome{item, replayed, err}
			}()
		}
		wg.Wait()
		close(results)
		created, repeats := 0, 0
		storeID := ""
		for result := range results {
			if result.err != nil {
				t.Fatalf("additional concurrent Store failed: %v", result.err)
			}
			if result.store.ID == first.ID || result.store.ID == "" || (storeID != "" && result.store.ID != storeID) {
				t.Fatalf("second Store ID must be unique and stable: first=%s second=%s observed=%s", first.ID, storeID, result.store.ID)
			}
			storeID = result.store.ID
			if result.replayed {
				repeats++
			} else {
				created++
			}
		}
		if created != 1 || repeats != 7 {
			t.Fatalf("concurrent outcomes created=%d replayed=%d", created, repeats)
		}
		var count int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.stores WHERE partner_actor_id=$1", owner).Scan(&count); err != nil || count != 2 {
			t.Fatalf("exactly two owner Stores required: %d %v", count, err)
		}
		var publicationState, schedule string
		if err := db.QueryRowContext(ctx, `SELECT s.publication_state,a.weekly_schedule::text
            FROM dsh.stores s JOIN dsh.store_operational_availability a ON a.store_id=s.id
            WHERE s.id=$1`, storeID).Scan(&publicationState, &schedule); err != nil {
			t.Fatal(err)
		}
		if publicationState != "unpublished" || schedule != "[]" {
			t.Fatalf("additional Store inherited publication or availability: %s %s", publicationState, schedule)
		}
		if _, err := postgres.ReadStoreOwnedByPartner(ctx, db, storeID, "other-owner"); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("cross-owner Store read allowed: %v", err)
		}
		changed := independent
		changed.Name = "Changed Replay"
		if _, _, err := postgres.CreateAdditionalStoreForPartner(ctx, db, owner, changed, key); !errors.Is(err, postgres.ErrSelfStoreIdempotency) {
			t.Fatalf("same key modified the Store: %v", err)
		}
		if _, _, err := postgres.CreateAdditionalStoreForPartner(ctx, db, "different-owner", independent, key); !errors.Is(err, postgres.ErrSelfStoreIdempotency) {
			t.Fatalf("another Merchant replayed owner key: %v", err)
		}
		if _, _, err := postgres.CreateFirstStoreForPartner(ctx, db, owner, independent, "qa-multi-second-first-attempt"); !errors.Is(err, postgres.ErrSelfStoreExists) {
			t.Fatalf("first-Store legacy guard broken: %v", err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.store_joining_policies SET enrollment_enabled=false WHERE relation_model=$1", postgres.StoreRelationIndependent); err != nil {
			t.Fatal(err)
		}
		if _, _, err := postgres.CreateAdditionalStoreForPartner(ctx, db, owner, independent, "qa-multi-paused-creation-0002"); !errors.Is(err, postgres.ErrStoreJoiningClosed) {
			t.Fatalf("paused independent admission bypassed: %v", err)
		}
		if _, _, err := postgres.CreateAdditionalStoreForPartner(ctx, db, owner, independent, key); err != nil {
			t.Fatalf("exact committed replay must remain readable while relation is paused: %v", err)
		}
		// Operator administration is attributed to its actual acting Operator,
		// not the owning Merchant; the same canonical idempotency ledger records it.
		operatorInput := firstInput
		operatorInput.Name = "Synthetic Operator Assisted Shop"
		const operatorID, correlation, operatorKey = "qa-operator-1", "qa-store-correlation-001", "qa-operator-store-idempotency-001"
		operatorStore, operatorReplay, err := postgres.CreateAdditionalStoreForOperator(ctx, db, owner, operatorID, correlation, operatorInput, operatorKey)
		if err != nil || operatorReplay || operatorStore.ID == first.ID || operatorStore.ID == storeID {
			t.Fatalf("attributed operator Store: %+v replay=%v err=%v", operatorStore, operatorReplay, err)
		}
		// Operational availability must attribute each initial write to the
		// actual actor, not to a Merchant on whose behalf an Operator acted.
		for _, created := range []struct{ storeID, actingActorID string }{
			{first.ID, owner}, {storeID, owner}, {operatorStore.ID, operatorID},
		} {
			var persistedActor string
			if err := db.QueryRowContext(ctx, `SELECT updated_by_actor_id FROM dsh.store_operational_availability WHERE store_id=$1`, created.storeID).Scan(&persistedActor); err != nil || persistedActor != created.actingActorID {
				t.Fatalf("Store %s availability actor=%q, expected=%q, err=%v", created.storeID, persistedActor, created.actingActorID, err)
			}
		}
		var persistedOperator, persistedCorrelation string
		if err := db.QueryRowContext(ctx, `SELECT operator_actor_id,correlation_id
			FROM dsh.store_create_idempotency WHERE store_id=$1`, operatorStore.ID).
			Scan(&persistedOperator, &persistedCorrelation); err != nil ||
			persistedOperator != operatorID || persistedCorrelation != correlation {
			t.Fatalf("Operator evidence not retained: operator=%q correlation=%q err=%v", persistedOperator, persistedCorrelation, err)
		}
		if _, replay, err := postgres.CreateAdditionalStoreForOperator(ctx, db, owner, operatorID, correlation, operatorInput, operatorKey); err != nil || !replay {
			t.Fatalf("identical Operator replay failed: replay=%v err=%v", replay, err)
		}
		if _, _, err := postgres.CreateAdditionalStoreForOperator(ctx, db, owner, "different-operator", correlation, operatorInput, operatorKey); !errors.Is(err, postgres.ErrSelfStoreIdempotency) {
			t.Fatalf("cross-Operator replay accepted: %v", err)
		}
		if _, _, err := postgres.CreateAdditionalStoreForPartner(ctx, db, owner, operatorInput, operatorKey); !errors.Is(err, postgres.ErrSelfStoreIdempotency) {
			t.Fatalf("self-service adopted Operator creation: %v", err)
		}
		if _, _, err := postgres.CreateAdditionalStoreForOperator(ctx, db, owner, operatorID, "bad", operatorInput, "different-attribution-key"); !errors.Is(err, postgres.ErrSelfStoreInput) {
			t.Fatalf("unattributed Operator mutation admitted: %v", err)
		}
	})
}
