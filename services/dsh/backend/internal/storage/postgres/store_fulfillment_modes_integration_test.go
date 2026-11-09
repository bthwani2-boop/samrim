package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/lib/pq"
)

// A disposable DSH proof database is required for schema/fulfillment tests.
// Never auto-create or mutate the shared local development database.
func isolatedStoreFulfillmentQA(t *testing.T) string {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if os.Getenv("BTHWANI_DSH_QA_ISOLATED") != "1" || raw == "" {
		t.Skip("NOT_RUN: isolated DSH QA database is not authorized/available")
	}
	target, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if target.Scheme != "postgres" || target.Hostname() != "127.0.0.1" ||
		target.Port() != "19432" || strings.TrimPrefix(target.Path, "/") != "dsh_proof" ||
		target.User == nil || target.User.Username() != "postgres" ||
		target.RawQuery != "sslmode=disable" || target.Fragment != "" {
		t.Fatal("refuse QA against an unrecognized PostgreSQL target")
	}
	return raw
}

// Only the exact isolated QA endpoint may run this test. It uses the canonical
// disposable migrated database and never touches a shared DSH database.
func TestStoreFulfillmentModesIndependentScopeIsolatedPostgres(t *testing.T) {
	raw := isolatedStoreFulfillmentQA(t)
	root, err := sql.Open("postgres", raw)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, raw, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, statements []string) {
		if err := postgres.Migrate(ctx, db, records, statements, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}

		const independentID = "fulfillment-independent-a"
		const partnerID = "fulfillment-market-partner"
		const otherID = "fulfillment-other-partner"
		const independentOwner = "qa-independent-owner"
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
			ID: independentID, PartnerActorID: independentOwner, Name: "Independent QA",
		})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
			ID: partnerID, PartnerActorID: "qa-market-owner", Name: "Marketplace QA",
		})
		insertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{
			ID: otherID, PartnerActorID: "qa-other-owner", Name: "Other Partner QA",
		})
		// This fixture is a direct, isolated schema setup, NOT a lawful Store
		// conversion API. It is never used to activate public publication.
		if _, err := db.ExecContext(ctx, `UPDATE dsh.stores
			SET relation_model='INDEPENDENT_STORE',
				fulfillment_modes=ARRAY['PARTNER_CAPTAIN','CUSTOMER_PICKUP']::text[]
			WHERE id=$1`, independentID); err != nil {
			t.Fatal(err)
		}
		var independentVersion, partnerVersion int
		if err := db.QueryRowContext(ctx, `SELECT version FROM dsh.stores WHERE id=$1`, independentID).
			Scan(&independentVersion); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRowContext(ctx, `SELECT version FROM dsh.stores WHERE id=$1`, partnerID).
			Scan(&partnerVersion); err != nil {
			t.Fatal(err)
		}

		t.Run("crafted Captain and concurrent independent writes fail closed", func(t *testing.T) {
			for _, modes := range [][]string{
				{"BTHWANI_CAPTAIN"}, {"PARTNER_CAPTAIN", "BTHWANI_CAPTAIN"},
				{"CUSTOMER_PICKUP", "BTHWANI_CAPTAIN"},
			} {
				key := "independent-denied-" + strings.Join(modes, "-")
				if _, err := postgres.SetStoreFulfillmentModes(ctx, db, independentID,
					"qa-operator-one", modes, independentVersion, key, "qa-denied-correlation"); !errors.Is(err, postgres.ErrFulfillmentModesInvalid) {
					t.Fatalf("independent Store accepted forbidden BThwani Captain %v: %v", modes, err)
				}
			}
			type outcome struct{ err error }
			results := make([]outcome, 2)
			start := make(chan struct{})
			var wg sync.WaitGroup
			for i := range results {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					<-start
					_, results[i].err = postgres.SetStoreFulfillmentModes(ctx, db,
						independentID, "qa-operator-one",
						[]string{"BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"},
						independentVersion, "independent-race-"+string(rune('a'+i))+"-key",
						"qa-independent-race")
				}(i)
			}
			close(start)
			wg.Wait()
			for i := range results {
				if !errors.Is(results[i].err, postgres.ErrFulfillmentModesInvalid) {
					t.Fatalf("concurrent independent mutation %d did not fail closed: %v", i, results[i].err)
				}
			}
			var version, keys, audit int
			var modes pq.StringArray
			if err := db.QueryRowContext(ctx,
				`SELECT version,fulfillment_modes FROM dsh.stores WHERE id=$1`, independentID).
				Scan(&version, &modes); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRowContext(ctx,
				`SELECT count(*) FROM dsh.store_fulfillment_modes_idempotency WHERE store_id=$1`, independentID).Scan(&keys); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRowContext(ctx,
				`SELECT count(*) FROM dsh.store_fulfillment_modes_audit WHERE store_id=$1`, independentID).Scan(&audit); err != nil {
				t.Fatal(err)
			}
			if version != independentVersion || strings.Join(modes, ",") != "PARTNER_CAPTAIN,CUSTOMER_PICKUP" || keys != 0 || audit != 0 {
				t.Fatalf("denied attempts changed independent Store: v%d modes=%v idem=%d audit=%d",
					version, modes, keys, audit)
			}
		})

		t.Run("independent allowed modes bind replay, actor, version and Store", func(t *testing.T) {
			const key = "independent-valid-modes-key"
			const actor = "qa-authorized-operator-one"
			allowed := []string{"CUSTOMER_PICKUP"}
			record, err := postgres.SetStoreFulfillmentModes(ctx, db, independentID,
				actor, allowed, independentVersion, key, "qa-valid-correlation")
			if err != nil || record.Replayed || record.Version != independentVersion+1 ||
				strings.Join(record.FulfillmentModes, ",") != "CUSTOMER_PICKUP" {
				t.Fatalf("allowed independent mode update failed: %+v err=%v", record, err)
			}
			again, err := postgres.SetStoreFulfillmentModes(ctx, db, independentID,
				actor, allowed, independentVersion, key, "qa-replay-correlation")
			if err != nil || !again.Replayed || again.Version != record.Version ||
				strings.Join(again.FulfillmentModes, ",") != "CUSTOMER_PICKUP" {
				t.Fatalf("exact independent request replay failed: %+v err=%v", again, err)
			}
			for _, negative := range []struct {
				store string
				actor string
				modes []string
			}{
				{independentID, actor, []string{"PARTNER_CAPTAIN"}},
				{independentID, "qa-different-operator", allowed},
				{partnerID, actor, allowed},
				{otherID, actor, allowed},
			} {
				if _, err := postgres.SetStoreFulfillmentModes(ctx, db, negative.store, negative.actor,
					negative.modes, independentVersion, key, "qa-conflict-correlation"); !errors.Is(err, postgres.ErrStoreFulfillmentModesIdempotency) {
					t.Fatalf("same attempt key was reused across facts, actor or Store: %+v err=%v", negative, err)
				}
			}
			if _, err := postgres.SetStoreFulfillmentModes(ctx, db, independentID, actor,
				[]string{"PARTNER_CAPTAIN"}, independentVersion, "independent-stale-version", "qa-stale-correlation"); !errors.Is(err, postgres.ErrStoreFulfillmentModesVersion) {
				t.Fatalf("stale version accepted by independent Store: %v", err)
			}
			var auditActor, auditPartner, auditStore string
			var keys, audit int
			if err := db.QueryRowContext(ctx, `SELECT acting_actor_id,partner_actor_id,store_id
				FROM dsh.store_fulfillment_modes_audit WHERE idempotency_key=$1`, key).
				Scan(&auditActor, &auditPartner, &auditStore); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRowContext(ctx,
				`SELECT count(*) FROM dsh.store_fulfillment_modes_idempotency WHERE store_id=$1`, independentID).
				Scan(&keys); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRowContext(ctx,
				`SELECT count(*) FROM dsh.store_fulfillment_modes_audit WHERE store_id=$1`, independentID).
				Scan(&audit); err != nil {
				t.Fatal(err)
			}
			if auditActor != actor || auditPartner != independentOwner || auditStore != independentID ||
				keys != 1 || audit != 1 {
				t.Fatalf("canonical actor/Store audit or replay count wrong: actor=%q partner=%q store=%q idem=%d audit=%d",
					auditActor, auditPartner, auditStore, keys, audit)
			}
		})

		t.Run("marketplace Partner retains Captain and concurrent version semantics", func(t *testing.T) {
			type result struct {
				modes []string
				value postgres.StoreFulfillmentModesResult
				err   error
			}
			results := []result{
				{modes: []string{"BTHWANI_CAPTAIN", "PARTNER_CAPTAIN"}},
				{modes: []string{"BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"}},
			}
			start := make(chan struct{})
			var wg sync.WaitGroup
			for i := range results {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					<-start
					results[i].value, results[i].err = postgres.SetStoreFulfillmentModes(ctx, db,
						partnerID, "qa-market-operator", results[i].modes, partnerVersion,
						"market-race-attempt-"+string(rune('a'+i)), "qa-market-race-correlation")
				}(i)
			}
			close(start)
			wg.Wait()
			successes, stale := 0, 0
			var winner result
			for i, result := range results {
				if result.err == nil {
					if result.value.Replayed || result.value.Version != partnerVersion+1 {
						t.Fatalf("market partner success %d malformed: %+v", i, result)
					}
					successes++
					winner = result
				} else if errors.Is(result.err, postgres.ErrStoreFulfillmentModesVersion) {
					stale++
				} else {
					t.Fatalf("market Partner concurrent update %d failed unexpectedly: %v", i, result.err)
				}
			}
			if successes != 1 || stale != 1 {
				t.Fatalf("market Partner race must commit once and reject stale: %+v", results)
			}
			var version, keys, audit int
			var modes pq.StringArray
			if err := db.QueryRowContext(ctx,
				`SELECT version,fulfillment_modes FROM dsh.stores WHERE id=$1`, partnerID).
				Scan(&version, &modes); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRowContext(ctx, `SELECT count(*) FROM dsh.store_fulfillment_modes_idempotency WHERE store_id=$1`,
				partnerID).Scan(&keys); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRowContext(ctx, `SELECT count(*) FROM dsh.store_fulfillment_modes_audit WHERE store_id=$1`,
				partnerID).Scan(&audit); err != nil {
				t.Fatal(err)
			}
			if version != partnerVersion+1 || keys != 1 || audit != 1 ||
				strings.Join(modes, ",") != strings.Join(winner.value.FulfillmentModes, ",") {
				t.Fatalf("market Partner concurrency did not persist one valid version: v%d modes=%v idem=%d audit=%d winner=%+v",
					version, modes, keys, audit, winner)
			}
		})
	}, 5*time.Minute)
}
