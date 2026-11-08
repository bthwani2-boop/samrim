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
	_ "github.com/lib/pq"
)

// Uses only a fresh isolated child database. Never changes a live Store.
func TestStoreJoiningAdmissionPolicyControlsCreationPostgres(t *testing.T) {
	raw := strings.TrimSpace(os.Getenv("DSH_JOINING_QA_DATABASE_URL"))
	if raw == "" {
		t.Skip("isolated joining QA database required")
	}
	if !joiningQADatabaseIsolated(raw, os.Getenv) {
		t.Fatal("non-isolated target forbidden")
	}
	root, err := sql.Open("postgres", raw)
	if err != nil {
		t.Fatal(err)
	}
	// withFreshDatabase registers cleanup of its child database; close the
	// administrator connection only after that cleanup has completed.
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, raw, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, sqls []string) {
		if err := postgres.Migrate(ctx, db, records, sqls, testDeliveryProofKeyring(t)); err != nil {
			t.Fatal(err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatal(err)
		}
		policies, err := postgres.ReadStoreJoiningPolicies(ctx, db)
		if err != nil || len(policies) != 2 || !policies[0].EnrollmentEnabled || !policies[1].EnrollmentEnabled {
			t.Fatalf("initial policy defaults incorrect: %+v %v", policies, err)
		}
		for _, stmt := range []string{
			"INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('join-policy-city','QA City',true)",
			"INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES('join-policy-vertical','QA Vertical','QA Vertical')",
			"INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES('join-policy-type','join-policy-vertical','QA Store','QA Store')",
		} {
			if _, err = db.ExecContext(ctx, stmt); err != nil {
				t.Fatal(err)
			}
		}
		independent := postgres.SelfStoreInput{
			RelationModel: postgres.StoreRelationIndependent, Name: "Policy Independent Store",
			ServiceCityID: "join-policy-city", VerticalID: "join-policy-vertical", CommercialTypeID: "join-policy-type",
			Address: "Synthetic policy address", Latitude: 15.36, Longitude: 44.20, FulfillmentModes: []string{"CUSTOMER_PICKUP"},
		}
		disabled, err := postgres.SetStoreJoiningPolicy(ctx, db, postgres.StoreRelationIndependent, false, 1,
			"qa-operator", "Temporarily close independent enrollment", "qa-policy-disable-0001")
		if err != nil || disabled.EnrollmentEnabled || disabled.Version != 2 {
			t.Fatalf("disable failed: %+v %v", disabled, err)
		}
		replay, err := postgres.SetStoreJoiningPolicy(ctx, db, postgres.StoreRelationIndependent, false, 1,
			"qa-operator", "Temporarily close independent enrollment", "qa-policy-disable-0001")
		if err != nil || replay.Version != 2 {
			t.Fatalf("idempotent replay failed: %+v %v", replay, err)
		}
		if _, err = postgres.SetStoreJoiningPolicy(ctx, db, postgres.StoreRelationIndependent, true, 1,
			"qa-operator", "Alter policy with old version", "qa-policy-stale-0001"); !errors.Is(err, postgres.ErrStoreJoiningPolicyVersion) {
			t.Fatalf("stale policy write permitted: %v", err)
		}
		if _, err = postgres.SetStoreJoiningPolicy(ctx, db, postgres.StoreRelationIndependent, true, 1,
			"qa-operator", "Different payload on reused key", "qa-policy-disable-0001"); !errors.Is(err, postgres.ErrStoreJoiningPolicyIdempotency) {
			t.Fatalf("idempotency reuse permitted: %v", err)
		}
		if _, _, err = postgres.CreateFirstStoreForPartner(ctx, db, "qa-closed-independent", independent); !errors.Is(err, postgres.ErrStoreJoiningClosed) {
			t.Fatalf("closed enrollment allowed Store creation: %v", err)
		}
		var count int
		if err = db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.stores WHERE partner_actor_id='qa-closed-independent'").Scan(&count); err != nil || count != 0 {
			t.Fatalf("closed enrollment persisted Store: %d %v", count, err)
		}
		marketplace := independent
		marketplace.RelationModel = "" // Legacy callers cannot bypass the marketplace admission policy.
		marketplace.FulfillmentModes = []string{"BTHWANI_CAPTAIN"}
		if _, _, err = postgres.CreateFirstStoreForPartner(ctx, db, "qa-open-market", marketplace); err != nil {
			t.Fatalf("other model should remain available: %v", err)
		}
		reopened, err := postgres.SetStoreJoiningPolicy(ctx, db, postgres.StoreRelationIndependent, true, 2,
			"qa-operator", "Reopen independent draft enrollment", "qa-policy-enable-0001")
		if err != nil || !reopened.EnrollmentEnabled || reopened.Version != 3 {
			t.Fatalf("reopen failed: %+v %v", reopened, err)
		}
		created, replayFlag, err := postgres.CreateFirstStoreForPartner(ctx, db, "qa-independent-owner", independent)
		if err != nil || replayFlag || created.PublicationState != "unpublished" {
			t.Fatalf("new Store invalid: %+v %v", created, err)
		}
		if _, err = postgres.SetStoreJoiningPolicy(ctx, db, postgres.StoreRelationIndependent, false, 3,
			"qa-operator", "Close after independent first Store", "qa-policy-disable-0002"); err != nil {
			t.Fatal(err)
		}
		again, replayed, err := postgres.CreateFirstStoreForPartner(ctx, db, "qa-independent-owner", independent)
		if err != nil || !replayed || again.ID != created.ID {
			t.Fatalf("exact replay must work after closure: %+v %t %v", again, replayed, err)
		}
		if _, _, err = postgres.CreateFirstStoreForPartner(ctx, db, "qa-second-independent", independent); !errors.Is(err, postgres.ErrStoreJoiningClosed) {
			t.Fatalf("new applicant bypassed closure: %v", err)
		}
		// Disable market and confirm omitted relationModel cannot bypass closure.
		if _, err = postgres.SetStoreJoiningPolicy(ctx, db, postgres.StoreRelationBThwaniPartner, false, 1,
			"qa-operator", "Pause new marketplace enrollment", "qa-policy-market-off-0001"); err != nil {
			t.Fatal(err)
		}
		if _, _, err = postgres.CreateFirstStoreForPartner(ctx, db, "qa-legacy-market", marketplace); !errors.Is(err, postgres.ErrStoreJoiningClosed) {
			t.Fatalf("legacy caller bypassed marketplace policy: %v", err)
		}
		if _, err = db.QueryContext(ctx, "SELECT * FROM dsh.store_joining_policy_events"); err != nil {
			t.Fatal(err)
		}
	}, 5*time.Minute)
}
