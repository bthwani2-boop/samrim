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

func TestPartnerCorrectionForFieldOriginatedJoiningCase(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for the fresh joining-case correction proof")
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
		if err := postgres.Migrate(ctx, db, records, migrationSQL); err != nil {
			t.Fatalf("apply DSH migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify DSH schema: %v", err)
		}

		const (
			fieldActorID  = "act_field_join_fix"
			partnerActor  = "act_partner_join_fix"
			otherPartner  = "act_other_join_fix"
			operatorActor = "act_operator_join_fix"
			serviceCityID = "join-correction-city"
			verticalID    = "join-correction-food"
		)
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar) VALUES($1,$2)", serviceCityID, "مدينة التصحيح"); err != nil {
			t.Fatalf("insert Service City fixture: %v", err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES($1,$2,$3)", verticalID, "مطاعم التصحيح", "Correction Restaurants"); err != nil {
			t.Fatalf("insert Commerce Vertical fixture: %v", err)
		}

		initialModes := []string{postgres.FulfillmentModeBthwaniCaptain}
		created, err := postgres.CreateJoiningCaseForField(ctx, db, "idem-join-field-create", postgres.HashJoiningCaseRequest("+967700000101", "نشاط التصحيح", "متجر التصحيح", serviceCityID, verticalID, 15.369445, 44.191006, initialModes), fieldActorID, "corr-join-field-create", "+967700000101", "نشاط التصحيح", "متجر التصحيح", serviceCityID, verticalID, 15.369445, 44.191006, initialModes)
		if err != nil || created.Case.Origin != "field" || created.Case.PartnerActorID != "" {
			t.Fatalf("create Field-originated joining case failed: %+v err=%v", created, err)
		}
		submitted, err := postgres.SubmitJoiningCase(ctx, db, created.Case.ID, partnerActor, created.Case.Version, "idem-join-field-submit", postgres.HashJoiningCaseSubmit(created.Case.ID, partnerActor, created.Case.Version), fieldActorID, "corr-join-field-submit")
		if err != nil || submitted.Case.PartnerActorID != partnerActor || submitted.Case.State != "submitted" {
			t.Fatalf("bind and submit joining case failed: %+v err=%v", submitted, err)
		}
		returned, err := postgres.ReviewJoiningCase(ctx, db, created.Case.ID, "needs_correction", "تصحيح بيانات المتجر", 0, "", submitted.Case.Version, "idem-join-field-review", postgres.HashJoiningCaseReview(created.Case.ID, "needs_correction", "تصحيح بيانات المتجر", submitted.Case.Version), operatorActor, "corr-join-field-review")
		if err != nil || returned.Case.State != "needs_correction" || returned.Case.PartnerActorID != partnerActor {
			t.Fatalf("return joining case for Partner correction failed: %+v err=%v", returned, err)
		}

		correctedModes := []string{postgres.FulfillmentModeCustomerPickup}
		requestHash := postgres.HashJoiningCaseCorrectAndResubmit(created.Case.ID, partnerActor, "نشاط مصحح", "متجر مصحح", returned.Case.Version, serviceCityID, verticalID, 15.4, 44.2, correctedModes)
		for _, actorID := range []string{fieldActorID, otherPartner} {
			_, err := postgres.CorrectAndResubmitJoiningCase(ctx, db, created.Case.ID, actorID, "نشاط مصحح", "متجر مصحح", returned.Case.Version, "idem-join-unauthorized-"+actorID, requestHash, "corr-join-unauthorized-"+actorID, serviceCityID, verticalID, 15.4, 44.2, correctedModes)
			if !errors.Is(err, postgres.ErrJoiningCasePartnerAccess) {
				t.Fatalf("unbound actor %s correction error = %v, want Partner access denial", actorID, err)
			}
		}

		corrected, err := postgres.CorrectAndResubmitJoiningCase(ctx, db, created.Case.ID, partnerActor, "نشاط مصحح", "متجر مصحح", returned.Case.Version, "idem-join-partner-correct", requestHash, "corr-join-partner-correct", serviceCityID, verticalID, 15.4, 44.2, correctedModes)
		if err != nil || corrected.Replayed || corrected.Case.State != "submitted" || corrected.Case.Version != returned.Case.Version+1 || corrected.Case.Origin != "field" || corrected.Case.PartnerActorID != partnerActor || corrected.Case.BusinessName != "نشاط مصحح" || corrected.Case.FirstStoreName != "متجر مصحح" || corrected.Case.FirstStoreLatitude == nil || *corrected.Case.FirstStoreLatitude != 15.4 || corrected.Case.FirstStoreLongitude == nil || *corrected.Case.FirstStoreLongitude != 44.2 || !equalStoreFulfillmentModes(corrected.Case.FirstStoreFulfillmentModes, correctedModes) {
			t.Fatalf("bound Partner did not atomically correct Field-originated case: %+v err=%v", corrected, err)
		}

		replay, err := postgres.CorrectAndResubmitJoiningCase(ctx, db, created.Case.ID, partnerActor, "نشاط مصحح", "متجر مصحح", returned.Case.Version, "idem-join-partner-correct", requestHash, "corr-join-partner-correct-replay", serviceCityID, verticalID, 15.4, 44.2, correctedModes)
		if err != nil || !replay.Replayed || replay.Case.Version != corrected.Case.Version || !equalStoreFulfillmentModes(replay.Case.FirstStoreFulfillmentModes, correctedModes) {
			t.Fatalf("Partner correction idempotent replay failed: %+v err=%v", replay, err)
		}

		conflictingHash := postgres.HashJoiningCaseCorrectAndResubmit(created.Case.ID, partnerActor, "نشاط مصحح", "متجر مصحح", returned.Case.Version, serviceCityID, verticalID, 15.4, 44.2, initialModes)
		if _, err := postgres.CorrectAndResubmitJoiningCase(ctx, db, created.Case.ID, partnerActor, "نشاط مصحح", "متجر مصحح", returned.Case.Version, "idem-join-partner-correct", conflictingHash, "corr-join-partner-conflict", serviceCityID, verticalID, 15.4, 44.2, initialModes); !errors.Is(err, postgres.ErrJoiningCaseIdempotency) {
			t.Fatalf("fulfillment-mode change did not affect correction idempotency: %v", err)
		}
	})
}
