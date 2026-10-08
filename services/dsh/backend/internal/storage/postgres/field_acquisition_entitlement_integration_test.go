package postgres_test

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	joiningcaseservice "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/joiningcase"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
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
		runFieldRewardPublicationOutboxScenario(t, ctx, db, records, migrationSQL)
	})
}

type fieldRewardOutboxScenario struct {
	t             *testing.T
	ctx           context.Context
	db            *sql.DB
	serviceCityID string
	verticalID    string
	storeTypeID   string
}

func runFieldRewardPublicationOutboxScenario(t *testing.T, ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
	t.Helper()
	scenario := fieldRewardOutboxScenario{
		t: t, ctx: ctx, db: db,
		serviceCityID: "field-reward-outbox-city",
		verticalID:    "field-reward-outbox-food",
		storeTypeID:   "field-reward-outbox-restaurant",
	}
	scenario.prepareSchema(records, migrationSQL)
	scenario.insertClassification()
	fieldStoreID := scenario.approveJoiningCase(true, "field")
	scenario.publishStore(fieldStoreID, "field")
	controlStoreID := scenario.approveJoiningCase(false, "control")
	scenario.publishStore(controlStoreID, "control")
	item := scenario.readPendingFieldPublication(fieldStoreID)
	scenario.verifyDeferrals(item.ID)
	scenario.verifyRetryAndPostLifecycle(item.ID)
}

func (s fieldRewardOutboxScenario) prepareSchema(records []postgres.MigrationRecord, migrationSQL []string) {
	if err := postgres.Migrate(s.ctx, s.db, records, migrationSQL, testDeliveryProofKeyring(s.t)); err != nil {
		s.t.Fatalf("apply canonical DSH migrations: %v", err)
	}
	if err := postgres.VerifySchema(s.ctx, s.db, records); err != nil {
		s.t.Fatalf("verify canonical DSH schema: %v", err)
	}
}

func (s fieldRewardOutboxScenario) insertClassification() {
	if _, err := s.db.ExecContext(s.ctx, "INSERT INTO dsh.service_cities(id,display_name_ar) VALUES($1,$2)", s.serviceCityID, "مدينة المكافآت"); err != nil {
		s.t.Fatalf("insert Service City fixture: %v", err)
	}
	if _, err := s.db.ExecContext(s.ctx, "INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES($1,$2,$3)", s.verticalID, "مطاعم المكافآت", "Reward Restaurants"); err != nil {
		s.t.Fatalf("insert Commerce Vertical fixture: %v", err)
	}
	if _, err := s.db.ExecContext(s.ctx, "INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES($1,$2,$3,$4)", s.storeTypeID, s.verticalID, "مطعم المكافآت", "Reward Restaurant"); err != nil {
		s.t.Fatalf("insert commercial Store Type fixture: %v", err)
	}
}

var fieldRewardTinyPNG = []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0B, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0x0F, 0x04, 0x00, 0x09, 0xFB, 0x03, 0xFD, 0xFB, 0x5E, 0x6B, 0x2B, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82}

func (s fieldRewardOutboxScenario) approveJoiningCase(fieldOrigin bool, suffix string) string {
	fieldActorID := "reward-field-" + suffix
	partnerActorID := "reward-partner-" + suffix
	phone := "+967700000192"
	if fieldOrigin {
		phone = "+967700000191"
	}
	request := postgres.JoiningCaseRequest{
		Phone: phone, OwnerFullName: "مالك المكافأة " + suffix, BusinessName: "نشاط المكافأة " + suffix, FirstStoreName: "متجر المكافأة " + suffix,
		FirstStoreAddress: "شارع المكافآت", FirstStoreWorkingHours: []byte(`{"intervals":[{"dayOfWeek":1,"opensAt":"09:00","closesAt":"17:00","closesNextDay":false}]}`),
		FirstStoreProofType: "COMMERCIAL_REGISTRATION", FirstStoreProofNumber: "12345678" + suffixDigits(suffix), WalletProviderKey: "provider-test",
		ServiceCityID: s.serviceCityID, VerticalID: s.verticalID, CommercialTypeID: s.storeTypeID,
		Latitude: 15.369445, Longitude: 44.191006, FulfillmentModes: []string{postgres.FulfillmentModeBthwaniCaptain},
	}
	evidenceKeys := testJoiningCaseEvidenceKeyring(s.t)
	input := postgres.CreateJoiningCaseInput{
		IdempotencyKey: "reward-case-create-" + suffix, RequestHash: postgres.HashJoiningCaseRequest(request),
		ActingActorID: "reward-creator-" + suffix, CorrelationID: "reward-case-correlation-" + suffix, EvidenceKeyring: evidenceKeys, Request: request,
	}
	var created postgres.JoiningCaseResult
	var err error
	if fieldOrigin {
		input.ActingActorID = fieldActorID
		created, err = postgres.CreateJoiningCaseForField(s.ctx, s.db, input)
	} else {
		created, err = postgres.CreateJoiningCase(s.ctx, s.db, input)
	}
	if err != nil {
		s.t.Fatalf("create %s-originated Joining Case: %v", suffix, err)
	}
	current := created
	profileProvenance := media.Provenance{Creator: "مالك المكافأة", SourceDescription: "صورة من المالك", RightsStatement: "إذن الاستخدام للمتجر", RightsAttested: true}
	profileDigest := strings.Repeat("a", 64)
	mediaInput := postgres.StoreProfileMediaAssetInput{ID: "reward-profile-image-" + suffix, JoiningCaseID: created.Case.ID, IdempotencyKey: "reward-profile-media-" + suffix, RequestHash: postgres.HashStoreProfileMediaUploadRequest(created.Case.ID, profileDigest, created.Case.Version, profileProvenance), ExpectedCaseVersion: created.Case.Version, ObjectKey: "store-profile-media/reward-profile-image-" + suffix + ".png", URI: "https://media.example/reward-profile-image-" + suffix + ".png", ContentSHA256: profileDigest, ContentType: "image/png", ByteSize: int64(len(fieldRewardTinyPNG)), ActingActorID: fieldActorID, CorrelationID: "reward-profile-correlation-" + suffix, Provenance: profileProvenance}
	if _, replayed, err := postgres.RegisterStoreProfileMediaAssetPending(s.ctx, s.db, mediaInput); err != nil || replayed {
		s.t.Fatalf("register %s store-profile image: replayed=%t error=%v", suffix, replayed, err)
	}
	if _, err := postgres.ActivateStoreProfileMediaAsset(s.ctx, s.db, mediaInput.ID, created.Case.ID, created.Case.Version, mediaInput.IdempotencyKey, mediaInput.RequestHash, fieldActorID, mediaInput.CorrelationID); err != nil {
		s.t.Fatalf("activate %s store-profile image: %v", suffix, err)
	}
	current, err = postgres.ReadJoiningCase(s.ctx, s.db, created.Case.ID)
	if err != nil {
		s.t.Fatalf("read %s joining case after store-profile image: %v", suffix, err)
	}
	proofAuthorityActor, proofAuthoritySource := fieldActorID, "field"
	if !fieldOrigin {
		proofAuthorityActor, proofAuthoritySource = "reward-operator-"+suffix, "operator"
	}
	proofImage, err := joiningcaseservice.UploadPrivateProofImage(s.ctx, s.db, evidenceKeys, created.Case.ID, proofAuthorityActor, proofAuthoritySource, "reward-proof-image-upload", "reward-proof-image-"+suffix, "reward-proof-correlation-"+suffix, current.Case.Version, "image/png", fieldRewardTinyPNG)
	if err != nil || !proofImage.Case.FirstStoreProofImageUploaded {
		s.t.Fatalf("upload %s private proof image: case=%+v error=%v", suffix, proofImage.Case, err)
	}
	current = proofImage
	if fieldOrigin {
		current, err = postgres.RequestFieldJoiningCaseAdmission(s.ctx, s.db, created.Case.ID, fieldActorID, current.Case.Version, "reward-admission-"+suffix, postgres.HashFieldJoiningCaseAdmission(created.Case.ID, fieldActorID, current.Case.Version), "reward-admission-correlation-"+suffix)
		if err != nil || current.Case.State != "admission_requested" || current.Case.OriginatingFieldActorID != fieldActorID {
			s.t.Fatalf("request Field admission before submission: case=%+v error=%v", current.Case, err)
		}
	}
	submitted, err := postgres.SubmitJoiningCase(s.ctx, s.db, created.Case.ID, partnerActorID, current.Case.Version, "reward-submit-"+suffix, postgres.HashJoiningCaseSubmit(created.Case.ID, partnerActorID, current.Case.Version), "reward-operator-"+suffix, "reward-submit-correlation-"+suffix)
	if err != nil || submitted.Case.State != "submitted" || submitted.Case.PartnerActorID != partnerActorID {
		s.t.Fatalf("submit %s-originated Joining Case: case=%+v error=%v", suffix, submitted.Case, err)
	}
	approved, err := postgres.ReviewJoiningCase(s.ctx, s.db, postgres.ReviewJoiningCaseInput{
		CaseID: created.Case.ID, Decision: "approved", SettlementPeriod: "WEEKLY", TermsPolicyVersion: "partner-financial-terms:v1",
		ExpectedVersion: submitted.Case.Version, IdempotencyKey: "reward-review-" + suffix,
		RequestHash:   postgres.HashJoiningCaseReviewWithFinancialTerms(created.Case.ID, "approved", "", submitted.Case.Version, "WEEKLY", "partner-financial-terms:v1"),
		ActingActorID: "reward-reviewer-" + suffix, CorrelationID: "reward-review-correlation-" + suffix,
	})
	if err != nil || approved.Case.State != "approved" || approved.Case.StoreID == "" || approved.Case.Origin != created.Case.Origin {
		s.t.Fatalf("approve %s-originated Joining Case: case=%+v error=%v", suffix, approved.Case, err)
	}
	if fieldOrigin {
		admissionID := "catalog-auth-admission-" + suffix
		if _, err := s.db.ExecContext(s.ctx, `INSERT INTO dsh.field_admissions(id,actor_id,full_name_ar,all_service_cities,state,requires_profile_review,version)
			VALUES($1,$2,$3,true,'eligible',false,1)`, admissionID, fieldActorID, "مندوب اختبار الكتالوج"); err != nil {
			s.t.Fatalf("create eligible Field admission for catalog authorization proof: %v", err)
		}
		scope, authErr := postgres.AuthorizeFieldCatalogCase(s.ctx, s.db, approved.Case.ID, fieldActorID)
		if authErr != nil || scope.StoreID != approved.Case.StoreID || scope.StoreName == "" || scope.VerticalID != s.verticalID || scope.VerticalNameAr == "" {
			s.t.Fatalf("eligible Field case lost its human-readable unpublished catalog authority: scope=%+v error=%v", scope, authErr)
		}
		if _, err := s.db.ExecContext(s.ctx, "UPDATE dsh.field_admissions SET requires_profile_review=true WHERE id=$1", admissionID); err != nil {
			s.t.Fatalf("mark the fixture admission as requiring profile review: %v", err)
		}
		if _, authErr = postgres.AuthorizeFieldCatalogCase(s.ctx, s.db, approved.Case.ID, fieldActorID); authErr != postgres.ErrFieldCatalogAuthority {
			s.t.Fatalf("Field catalog authority error for an admission requiring profile review = %v, want ErrFieldCatalogAuthority", authErr)
		}
		if _, err := s.db.ExecContext(s.ctx, "UPDATE dsh.field_admissions SET requires_profile_review=false WHERE id=$1", admissionID); err != nil {
			s.t.Fatalf("restore the isolated Field admission proof fixture: %v", err)
		}
	}
	return approved.Case.StoreID
}

func (s fieldRewardOutboxScenario) publishStore(storeID, suffix string) {
	result, err := postgres.SetStorePublication(s.ctx, s.db, storeID, "published", 1, "reward-publication-"+suffix, postgres.HashStorePublicationRequest(storeID, "published", 1), "reward-publisher-"+suffix, "reward-publication-correlation-"+suffix)
	if err != nil || result.Store.PublicationState != "published" || result.Store.Version != 2 {
		s.t.Fatalf("publish canonical store %s: result=%+v error=%v", suffix, result, err)
	}
}

func (s fieldRewardOutboxScenario) readPendingFieldPublication(fieldStoreID string) postgres.FieldAcquisitionEntitlementOutbox {
	items, err := postgres.ListPendingFieldAcquisitionRewardPublications(s.ctx, s.db, 100)
	if err != nil || len(items) != 1 {
		s.t.Fatalf("pending publication list = %+v, error=%v; want only the Field-originated store", items, err)
	}
	item := items[0]
	if item.StoreID != fieldStoreID || item.JoiningCaseID == "" || item.PartnerActorID == "" || item.FieldActorID == "" || item.VerticalID != s.verticalID || item.CommercialStoreTypeID != s.storeTypeID || item.IdempotencyKey == "" || item.RequestHash == "" || item.CorrelationID == "" || item.Attempts != 0 {
		s.t.Fatalf("outbox did not preserve Field acquisition provenance: %+v", item)
	}
	return item
}

func (s fieldRewardOutboxScenario) verifyDeferrals(outboxID string) {
	if err := postgres.DeferFieldAcquisitionPublication(s.ctx, s.db, outboxID, false, true); err != nil {
		s.t.Fatalf("defer publication until commercial classification exists: %v", err)
	}
	assertFieldRewardOutboxState(s.t, s.ctx, s.db, outboxID, "WAITING_CLASSIFICATION", "the acquired store has no canonical commercial type", 0)
	assertFieldRewardPublicationPending(s.t, s.ctx, s.db, outboxID, 0, 0)

	if err := postgres.DeferFieldAcquisitionPublication(s.ctx, s.db, outboxID, true, false); err != nil {
		s.t.Fatalf("defer publication until reward policy exists: %v", err)
	}
	assertFieldRewardOutboxState(s.t, s.ctx, s.db, outboxID, "WAITING_POLICY", "no active reward policy for the store category", 0)
	if _, err := s.db.ExecContext(s.ctx, "UPDATE dsh.field_acquisition_entitlement_outbox SET next_attempt_at=clock_timestamp() WHERE id=$1", outboxID); err != nil {
		s.t.Fatalf("make policy-waiting publication eligible for its state readback: %v", err)
	}
	assertFieldRewardPublicationPending(s.t, s.ctx, s.db, outboxID, 1, 0)

	if err := postgres.DeferFieldAcquisitionPublication(s.ctx, s.db, outboxID, false, false); err != nil {
		s.t.Fatalf("defer publication while customer-visible facts are incomplete: %v", err)
	}
	assertFieldRewardOutboxState(s.t, s.ctx, s.db, outboxID, "PENDING", "customer-visible publication is not currently true", 0)
}

func (s fieldRewardOutboxScenario) verifyRetryAndPostLifecycle(outboxID string) {
	if err := postgres.MarkFieldAcquisitionRewardPublicationFailure(s.ctx, s.db, outboxID, "WLT temporarily unavailable"); err != nil {
		s.t.Fatalf("record WLT publication failure: %v", err)
	}
	assertFieldRewardOutboxState(s.t, s.ctx, s.db, outboxID, "FAILED", "WLT temporarily unavailable", 1)
	if _, err := s.db.ExecContext(s.ctx, "UPDATE dsh.field_acquisition_entitlement_outbox SET next_attempt_at=clock_timestamp() WHERE id=$1", outboxID); err != nil {
		s.t.Fatalf("make failed publication available for retry: %v", err)
	}
	assertFieldRewardPublicationPending(s.t, s.ctx, s.db, outboxID, 1, 1)
	if err := postgres.MarkFieldAcquisitionRewardPublicationFailure(s.ctx, s.db, outboxID, ""); err != nil {
		s.t.Fatalf("record a retry without an error message: %v", err)
	}
	assertFieldRewardOutboxState(s.t, s.ctx, s.db, outboxID, "FAILED", "", 2)
	if err := postgres.MarkFieldAcquisitionRewardPublicationPosted(s.ctx, s.db, outboxID); err != nil {
		s.t.Fatalf("mark published entitlement posted: %v", err)
	}
	assertFieldRewardOutboxState(s.t, s.ctx, s.db, outboxID, "POSTED", "", 3)
	assertFieldRewardPublicationPending(s.t, s.ctx, s.db, outboxID, 0, 0)
}

func assertFieldRewardPublicationPending(t *testing.T, ctx context.Context, db *sql.DB, outboxID string, wantCount, wantAttempts int) {
	t.Helper()
	pending, err := postgres.ListPendingFieldAcquisitionRewardPublications(ctx, db, 100)
	if err != nil || len(pending) != wantCount {
		t.Fatalf("pending publications = %+v, error=%v; want %d", pending, err, wantCount)
	}
	if wantCount == 1 && (pending[0].ID != outboxID || pending[0].Attempts != wantAttempts) {
		t.Fatalf("pending publication = %+v; want id %q and attempts %d", pending[0], outboxID, wantAttempts)
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

func suffixDigits(suffix string) string {
	digits := "01"
	for _, r := range suffix {
		if r >= '0' && r <= '9' {
			digits = digits[1:] + string(r)
		}
	}
	return digits[:2]
}
