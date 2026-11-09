package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

// Verifies Store owner isolation and publication safety against a disposable
// migrated PostgreSQL database. Never runs against shared durable data.
func TestDirectPartnerFirstStoreUnpublishedAndIdempotentPostgres(t *testing.T) {
	raw := strings.TrimSpace(os.Getenv("DSH_JOINING_QA_DATABASE_URL"))
	if raw == "" {
		t.Skip("dedicated DSH QA database unavailable")
	}
	if !joiningQADatabaseIsolated(raw, os.Getenv) {
		t.Fatal("non-isolated target forbidden")
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
		for _, stmt := range []string{
			"INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('qa-direct-city','QA City',true)",
			"INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES('qa-direct-vertical','QA Vertical','QA Vertical')",
			"INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES('qa-direct-type','qa-direct-vertical','QA Store','QA Store')",
		} {
			if _, err := db.ExecContext(ctx, stmt); err != nil {
				t.Fatal(err)
			}
		}
		input := postgres.SelfStoreInput{
			Name: "Synthetic First Store", ServiceCityID: "qa-direct-city",
			VerticalID: "qa-direct-vertical", CommercialTypeID: "qa-direct-type",
			Address: "Synthetic QA address", Latitude: 15.36, Longitude: 44.20,
			FulfillmentModes: []string{"BTHWANI_CAPTAIN"},
		}
		const owner = "qa-direct-partner"
		// The same caller may retry concurrently; exactly one first Store is created.
		const callers = 10
		type outcome struct {
			id     string
			replay bool
			err    error
		}
		results := make(chan outcome, callers)
		var wg sync.WaitGroup
		for i := 0; i < callers; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				store, replay, err := postgres.CreateFirstStoreForPartner(ctx, db, owner, input, "idem-qa-owner-concurrent-0001")
				results <- outcome{id: store.ID, replay: replay, err: err}
			}()
		}
		wg.Wait()
		close(results)
		storeID := ""
		created := 0
		replayed := 0
		for result := range results {
			if result.err != nil {
				t.Fatalf("concurrent first Store failed: %v", result.err)
			}
			if storeID == "" {
				storeID = result.id
			}
			if result.id != storeID || storeID == "" {
				t.Fatal("same owner received different first Stores")
			}
			if result.replay {
				replayed++
			} else {
				created++
			}
		}
		if created != 1 || replayed != callers-1 {
			t.Fatalf("created=%d replayed=%d, want 1/%d", created, replayed, callers-1)
		}
		var count int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.stores WHERE partner_actor_id=$1", owner).Scan(&count); err != nil || count != 1 {
			t.Fatalf("store count=%d err=%v", count, err)
		}
		var state string
		var paused bool
		var schedule string
		if err := db.QueryRowContext(ctx, `SELECT s.publication_state,a.paused,a.weekly_schedule::text
			FROM dsh.stores s JOIN dsh.store_operational_availability a ON a.store_id=s.id
			WHERE s.id=$1`, storeID).Scan(&state, &paused, &schedule); err != nil {
			t.Fatal(err)
		}
		if state != "unpublished" || paused || schedule != "[]" {
			t.Fatalf("new Store orderable or publicly visible: state=%s paused=%t schedule=%s", state, paused, schedule)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.joining_cases WHERE applicant_actor_id=$1 OR partner_actor_id=$1", owner).Scan(&count); err != nil || count != 0 {
			t.Fatalf("unexpected joining cases count=%d err=%v", count, err)
		}
		if _, err := postgres.ReadStoreOwnedByPartner(ctx, db, storeID, "other-partner"); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("other actor accessed Store: %v", err)
		}
		if store, err := postgres.ReadStoreOwnedByPartner(ctx, db, storeID, owner); err != nil || store.PublicationState != "unpublished" {
			t.Fatalf("owner readback failed: %v", err)
		}
		different := input
		different.Name = "Changed Store"
		if _, _, err := postgres.CreateFirstStoreForPartner(ctx, db, owner, different, "idem-qa-owner-changed-0001"); !errors.Is(err, postgres.ErrSelfStoreExists) {
			t.Fatalf("second first Store allowed: %v", err)
		}
		malformed := input
		malformed.Name = ""
		if _, _, err := postgres.CreateFirstStoreForPartner(ctx, db, "new-owner", malformed, "idem-qa-invalid-fields-0001"); !errors.Is(err, postgres.ErrSelfStoreInput) {
			t.Fatalf("invalid payload was accepted: %v", err)
		}
		// The independent merchant is the same canonical Store writer, but may
		// only use merchant fulfillment and stays invisible to the marketplace.
		independentInput := input
		independentInput.RelationModel = postgres.StoreRelationIndependent
		independentInput.FulfillmentModes = []string{"PARTNER_CAPTAIN", "CUSTOMER_PICKUP"}
		independentOwner := "qa-independent-partner"
		independentStore, independentReplay, err := postgres.CreateFirstStoreForPartner(ctx, db, independentOwner, independentInput, "idem-qa-independent-first-0001")
		if err != nil || independentReplay || independentStore.RelationModel != postgres.StoreRelationIndependent || independentStore.PublicationState != "unpublished" {
			t.Fatalf("independent first Store invalid: %+v replay=%v err=%v", independentStore, independentReplay, err)
		}
		independentAgain, independentReplayed, err := postgres.CreateFirstStoreForPartner(ctx, db, independentOwner, independentInput, "idem-qa-independent-first-0001")
		if err != nil || !independentReplayed || independentAgain.ID != independentStore.ID {
			t.Fatalf("independent exact retry changed Store: %+v replay=%v err=%v", independentAgain, independentReplayed, err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.stores SET publication_state='published' WHERE id=$1", independentStore.ID); err == nil {
			t.Fatal("independent Store must not publish through marketplace field")
		}
		// Even an authorized operator cannot grant BThwani dispatch to an independent Store.
		if _, err := postgres.SetStoreFulfillmentModes(ctx, db, independentStore.ID, "qa-authorized-operator", []string{"BTHWANI_CAPTAIN"}, independentStore.Version, "idem-independent-gate-123", "corr-independent-gate-123"); !errors.Is(err, postgres.ErrFulfillmentModesInvalid) {
			t.Fatalf("operator could enable platform Captain for independent Store: %v", err)
		}
		invalidRelation := independentInput
		invalidRelation.RelationModel = "NOT_A_STORE_RELATION"
		if _, _, err := postgres.CreateFirstStoreForPartner(ctx, db, "qa-invalid-relation", invalidRelation, "idem-qa-invalid-relation-0001"); !errors.Is(err, postgres.ErrSelfStoreInput) {
			t.Fatalf("unsupported relation must fail closed: %v", err)
		}
		invalidIndependent := independentInput
		invalidIndependent.FulfillmentModes = []string{"BTHWANI_CAPTAIN"}
		if _, _, err := postgres.CreateFirstStoreForPartner(ctx, db, "qa-invalid-independent", invalidIndependent, "idem-qa-invalid-independent-0001"); !errors.Is(err, postgres.ErrSelfStoreInput) {
			t.Fatalf("independent must reject BThwani Captain: %v", err)
		}
		if _, _, err := postgres.CreateFirstStoreForPartner(ctx, db, independentOwner, input, "idem-qa-independent-changed-0001"); !errors.Is(err, postgres.ErrSelfStoreExists) {
			t.Fatalf("independent Store may not be recreated as marketplace: %v", err)
		}
		if _, _, err := postgres.CreateFirstStoreForPartner(ctx, db, "qa-cross-actor", independentInput, "idem-qa-independent-first-0001"); !errors.Is(err, postgres.ErrSelfStoreIdempotency) {
			t.Fatalf("cross-actor reuse of an idempotency key was accepted: %v", err)
		}
		if _, _, err := postgres.CreateFirstStoreForPartner(ctx, db, independentOwner, input, "idem-qa-independent-first-0001"); !errors.Is(err, postgres.ErrSelfStoreIdempotency) {
			t.Fatalf("same key was reused for different first Store facts: %v", err)
		}
		var attemptCount int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.first_store_create_idempotency WHERE partner_actor_id=$1", independentOwner).Scan(&attemptCount); err != nil || attemptCount != 1 {
			t.Fatalf("unexpected persisted idempotency attempts: %d %v", attemptCount, err)
		}
		if _, err := postgres.ReadStoreOwnedByPartner(ctx, db, independentStore.ID, owner); !errors.Is(err, postgres.ErrStoreNotFound) {
			t.Fatalf("cross-owner independent Store was readable: %v", err)
		}
		t.Log("direct Partner Stores: single writer, exact replays, relationship isolation, no joining case, unpublished")
	}, 5*time.Minute)
}
