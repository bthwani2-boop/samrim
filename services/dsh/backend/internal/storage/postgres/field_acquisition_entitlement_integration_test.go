package postgres_test

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestFieldAcquisitionRewardPublicationOutboxLifecycle(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for Field reward publication proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open DSH test PostgreSQL: %v", err)
	}
	t.Cleanup(func() {
		if err := rootDB.Close(); err != nil {
			t.Errorf("close DSH test PostgreSQL: %v", err)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	t.Cleanup(cancel)
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("connect DSH test PostgreSQL: %v", err)
	}

	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply canonical DSH migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify canonical DSH schema: %v", err)
		}

		const (
			serviceCityID = "field-reward-outbox-city"
			verticalID    = "field-reward-outbox-food"
			storeTypeID   = "field-reward-outbox-restaurant"
		)
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar) VALUES($1,$2)", serviceCityID, "مدينة المكافآت"); err != nil {
			t.Fatalf("insert Service City fixture: %v", err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES($1,$2,$3)", verticalID, "مطاعم المكافآت", "Reward Restaurants"); err != nil {
			t.Fatalf("insert Commerce Vertical fixture: %v", err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES($1,$2,$3,$4)", storeTypeID, verticalID, "مطعم المكافآت", "Reward Restaurant"); err != nil {
			t.Fatalf("insert commercial Store Type fixture: %v", err)
		}

		fieldStoreID := approveJoiningCaseForRewardOutbox(t, ctx, db, true, serviceCityID, verticalID, storeTypeID, "field")
		publishStoreForRewardOutbox(t, ctx, db, fieldStoreID, "field")
		controlStoreID := approveJoiningCaseForRewardOutbox(t, ctx, db, false, serviceCityID, verticalID, storeTypeID, "control")
		publishStoreForRewardOutbox(t, ctx, db, controlStoreID, "control")

		items, err := postgres.ListPendingFieldAcquisitionRewardPublications(ctx, db, 100)
		if err != nil || len(items) != 1 {
			t.Fatalf("pending publication list = %+v, error=%v; want only the Field-originated store", items, err)
		}
		item := items[0]
		if item.StoreID != fieldStoreID || item.JoiningCaseID == "" || item.PartnerActorID == "" || item.FieldActorID == "" || item.VerticalID != verticalID || item.CommercialStoreTypeID != storeTypeID || item.IdempotencyKey == "" || item.RequestHash == "" || item.CorrelationID == "" || item.Attempts != 0 {
			t.Fatalf("outbox did not preserve Field acquisition provenance: %+v", item)
		}

		if err := postgres.DeferFieldAcquisitionPublication(ctx, db, item.ID, false, true); err != nil {
			t.Fatalf("defer publication until commercial classification exists: %v", err)
		}
		assertFieldRewardOutboxState(t, ctx, db, item.ID, "WAITING_CLASSIFICATION", "the acquired store has no canonical commercial type", 0)
		if pending, err := postgres.ListPendingFieldAcquisitionRewardPublications(ctx, db, 100); err != nil || len(pending) != 0 {
			t.Fatalf("classification-blocked publication remained claimable: %+v, error=%v", pending, err)
		}

		if err := postgres.DeferFieldAcquisitionPublication(ctx, db, item.ID, true, false); err != nil {
			t.Fatalf("defer publication until reward policy exists: %v", err)
		}
		assertFieldRewardOutboxState(t, ctx, db, item.ID, "WAITING_POLICY", "no active reward policy for the store category", 0)
		if _, err := db.ExecContext(ctx, "UPDATE dsh.field_acquisition_entitlement_outbox SET next_attempt_at=clock_timestamp() WHERE id=$1", item.ID); err != nil {
			t.Fatalf("make policy-waiting publication eligible for its state readback: %v", err)
		}
		pending, err := postgres.ListPendingFieldAcquisitionRewardPublications(ctx, db, 100)
		if err != nil || len(pending) != 1 || pending[0].ID != item.ID {
			t.Fatalf("policy-waiting publication was not retryable: %+v, error=%v", pending, err)
		}

		if err := postgres.DeferFieldAcquisitionPublication(ctx, db, item.ID, false, false); err != nil {
			t.Fatalf("defer publication while customer-visible facts are incomplete: %v", err)
		}
		assertFieldRewardOutboxState(t, ctx, db, item.ID, "PENDING", "customer-visible publication is not currently true", 0)
		if err := postgres.MarkFieldAcquisitionRewardPublicationFailure(ctx, db, item.ID, "WLT temporarily unavailable"); err != nil {
			t.Fatalf("record WLT publication failure: %v", err)
		}
		assertFieldRewardOutboxState(t, ctx, db, item.ID, "FAILED", "WLT temporarily unavailable", 1)
		if _, err := db.ExecContext(ctx, "UPDATE dsh.field_acquisition_entitlement_outbox SET next_attempt_at=clock_timestamp() WHERE id=$1", item.ID); err != nil {
			t.Fatalf("make failed publication available for retry: %v", err)
		}
		pending, err = postgres.ListPendingFieldAcquisitionRewardPublications(ctx, db, 100)
		if err != nil || len(pending) != 1 || pending[0].ID != item.ID || pending[0].Attempts != 1 {
			t.Fatalf("failed publication did not preserve retry attempt: %+v, error=%v", pending, err)
		}
		if err := postgres.MarkFieldAcquisitionRewardPublicationFailure(ctx, db, item.ID, ""); err != nil {
			t.Fatalf("record a retry without an error message: %v", err)
		}
		assertFieldRewardOutboxState(t, ctx, db, item.ID, "FAILED", "", 2)
		if err := postgres.MarkFieldAcquisitionRewardPublicationPosted(ctx, db, item.ID); err != nil {
			t.Fatalf("mark published entitlement posted: %v", err)
		}
		assertFieldRewardOutboxState(t, ctx, db, item.ID, "POSTED", "", 3)
		if pending, err := postgres.ListPendingFieldAcquisitionRewardPublications(ctx, db, 100); err != nil || len(pending) != 0 {
			t.Fatalf("posted publication remained pending: %+v, error=%v", pending, err)
		}
	})
}

func approveJoiningCaseForRewardOutbox(t *testing.T, ctx context.Context, db *sql.DB, fieldOrigin bool, serviceCityID, verticalID, storeTypeID, suffix string) string {
	t.Helper()
	fieldActorID := "reward-field-" + suffix
	partnerActorID := "reward-partner-" + suffix
	phone := "+967700000192"
	if fieldOrigin {
		phone = "+967700000191"
	}
	request := postgres.JoiningCaseRequest{
		Phone:        phone,
		BusinessName: "نشاط المكافأة " + suffix, FirstStoreName: "متجر المكافأة " + suffix,
		ServiceCityID: serviceCityID, VerticalID: verticalID, CommercialTypeID: storeTypeID,
		Latitude: 15.369445, Longitude: 44.191006, FulfillmentModes: []string{postgres.FulfillmentModeBthwaniCaptain},
	}
	input := postgres.CreateJoiningCaseInput{
		IdempotencyKey: "reward-case-create-" + suffix, RequestHash: postgres.HashJoiningCaseRequest(request),
		ActingActorID: "reward-creator-" + suffix, CorrelationID: "reward-case-correlation-" + suffix, Request: request,
	}
	var created postgres.JoiningCaseResult
	var err error
	if fieldOrigin {
		created, err = postgres.CreateJoiningCaseForField(ctx, db, postgres.CreateJoiningCaseInput{IdempotencyKey: input.IdempotencyKey, RequestHash: input.RequestHash, ActingActorID: fieldActorID, CorrelationID: input.CorrelationID, Request: input.Request})
	} else {
		created, err = postgres.CreateJoiningCase(ctx, db, input)
	}
	if err != nil {
		t.Fatalf("create %s-originated Joining Case: %v", suffix, err)
	}
	current := created
	if fieldOrigin {
		current, err = postgres.RequestFieldJoiningCaseAdmission(ctx, db, created.Case.ID, fieldActorID, created.Case.Version, "reward-admission-"+suffix, postgres.HashFieldJoiningCaseAdmission(created.Case.ID, fieldActorID, created.Case.Version), "reward-admission-correlation-"+suffix)
		if err != nil || current.Case.State != "admission_requested" || current.Case.OriginatingFieldActorID != fieldActorID {
			t.Fatalf("request Field admission before submission: case=%+v error=%v", current.Case, err)
		}
	}
	submitted, err := postgres.SubmitJoiningCase(ctx, db, created.Case.ID, partnerActorID, current.Case.Version, "reward-submit-"+suffix, postgres.HashJoiningCaseSubmit(created.Case.ID, partnerActorID, current.Case.Version), "reward-operator-"+suffix, "reward-submit-correlation-"+suffix)
	if err != nil || submitted.Case.State != "submitted" || submitted.Case.PartnerActorID != partnerActorID {
		t.Fatalf("submit %s-originated Joining Case: case=%+v error=%v", suffix, submitted.Case, err)
	}
	approved, err := postgres.ReviewJoiningCase(ctx, db, postgres.ReviewJoiningCaseInput{
		CaseID: created.Case.ID, Decision: "approved", SettlementPeriod: "WEEKLY", TermsPolicyVersion: "partner-financial-terms:v1",
		ExpectedVersion: submitted.Case.Version, IdempotencyKey: "reward-review-" + suffix,
		RequestHash:   postgres.HashJoiningCaseReviewWithFinancialTerms(created.Case.ID, "approved", "", submitted.Case.Version, "WEEKLY", "partner-financial-terms:v1"),
		ActingActorID: "reward-reviewer-" + suffix, CorrelationID: "reward-review-correlation-" + suffix,
	})
	if err != nil || approved.Case.State != "approved" || approved.Case.StoreID == "" || approved.Case.Origin != created.Case.Origin {
		t.Fatalf("approve %s-originated Joining Case: case=%+v error=%v", suffix, approved.Case, err)
	}
	return approved.Case.StoreID
}

func publishStoreForRewardOutbox(t *testing.T, ctx context.Context, db *sql.DB, storeID, suffix string) {
	t.Helper()
	result, err := postgres.SetStorePublication(ctx, db, storeID, "published", 1, "reward-publication-"+suffix, postgres.HashStorePublicationRequest(storeID, "published", 1), "reward-publisher-"+suffix, "reward-publication-correlation-"+suffix)
	if err != nil || result.Store.PublicationState != "published" || result.Store.Version != 2 {
		t.Fatalf("publish canonical store %s: result=%+v error=%v", suffix, result, err)
	}
}

func assertFieldRewardOutboxState(t *testing.T, ctx context.Context, db *sql.DB, outboxID, wantState, wantError string, wantAttempts int) {
	t.Helper()
	var gotState string
	var gotError sql.NullString
	var gotAttempts int
	err := db.QueryRowContext(ctx, "SELECT state,last_error,attempts FROM dsh.field_acquisition_entitlement_outbox WHERE id=$1", outboxID).Scan(&gotState, &gotError, &gotAttempts)
	if err != nil {
		t.Fatalf("read Field reward outbox state: %v", err)
	}
	if gotState != wantState || gotError.String != wantError || gotAttempts != wantAttempts {
		t.Fatalf("Field reward outbox state = %q/%q/attempts %d, want %q/%q/attempts %d", gotState, gotError.String, gotAttempts, wantState, wantError, wantAttempts)
	}
}

func TestFieldAcquisitionRewardOutboxRejectsInvalidInputs(t *testing.T) {
	ctx := context.Background()
	if _, err := postgres.ListPendingFieldAcquisitionRewardPublications(ctx, nil, 1); err == nil {
		t.Fatal("pending publication list accepted a nil database")
	}
	if _, err := postgres.ListPendingFieldAcquisitionRewardPublications(ctx, nil, 0); err == nil {
		t.Fatal("pending publication list accepted an invalid limit")
	}
	if err := postgres.DeferFieldAcquisitionPublication(ctx, nil, "outbox", false, false); err == nil {
		t.Fatal("publication defer accepted a nil database")
	}
	if err := postgres.MarkFieldAcquisitionRewardPublicationPosted(ctx, nil, "outbox"); err == nil {
		t.Fatal("posted transition accepted a nil database")
	}
	if err := postgres.MarkFieldAcquisitionRewardPublicationFailure(ctx, nil, "outbox", "failed"); err == nil {
		t.Fatal("failed transition accepted a nil database")
	}
}
