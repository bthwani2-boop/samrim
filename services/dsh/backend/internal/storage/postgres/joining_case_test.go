package postgres_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	joiningcaseservice "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/joiningcase"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

var tinyPNG = []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0B, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0x0F, 0x04, 0x00, 0x09, 0xFB, 0x03, 0xFD, 0xFB, 0x5E, 0x6B, 0x2B, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82}

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

	withFreshCanonicalDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.MigrateCanonical(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply DSH migrations: %v", err)
		}
		if err := postgres.VerifyCanonicalSchema(ctx, db, records); err != nil {
			t.Fatalf("verify DSH schema: %v", err)
		}

		const (
			fieldActorID  = "act_field_join_fix"
			partnerActor  = "act_partner_join_fix"
			otherPartner  = "act_other_join_fix"
			operatorActor = "act_operator_join_fix"
			serviceCityID = "join-correction-city"
			verticalID    = "join-correction-food"
			storeTypeID   = "join-correction-butcher"
		)
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.service_cities(id,display_name_ar) VALUES($1,$2)", serviceCityID, "مدينة التصحيح"); err != nil {
			t.Fatalf("insert Service City fixture: %v", err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES($1,$2,$3)", verticalID, "مطاعم التصحيح", "Correction Restaurants"); err != nil {
			t.Fatalf("insert Commerce Vertical fixture: %v", err)
		}
		if _, err := db.ExecContext(ctx, "INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES($1,$2,$3,$4)", storeTypeID, verticalID, "مطعم الاختبار", "Test Restaurant"); err != nil {
			t.Fatalf("insert commercial store type fixture: %v", err)
		}

		initialModes := []string{postgres.FulfillmentModeBthwaniCaptain}
		workHours := []byte(`{"intervals":[{"dayOfWeek":1,"opensAt":"09:00","closesAt":"17:00","closesNextDay":false}]}`)
		evidenceKeys := testJoiningCaseEvidenceKeyring(t)
		createRequest := postgres.JoiningCaseRequest{Phone: "+967700000101", WalletProviderKey: "provider-test", OwnerFullName: "مالك بحث مميز", BusinessName: "نشاط التصحيح", FirstStoreName: "متجر التصحيح", FirstStoreAddress: "الشارع الرئيسي", FirstStoreWorkingHours: workHours, FirstStoreProofType: "COMMERCIAL_REGISTRATION", FirstStoreProofNumber: "123456789", ServiceCityID: serviceCityID, VerticalID: verticalID, CommercialTypeID: storeTypeID, Latitude: 15.369445, Longitude: 44.191006, FulfillmentModes: initialModes}
		createHash := postgres.HashJoiningCaseRequest(createRequest)
		created, err := postgres.CreateJoiningCaseForField(ctx, db, postgres.CreateJoiningCaseInput{IdempotencyKey: "idem-join-field-create", RequestHash: createHash, ActingActorID: fieldActorID, CorrelationID: "corr-join-field-create", EvidenceKeyring: evidenceKeys, Request: createRequest})
		if err != nil || created.Case.Origin != "field" || created.Case.PartnerActorID != "" {
			t.Fatalf("create Field-originated joining case failed: %+v err=%v", created, err)
		}
		provenance := media.Provenance{Creator: "مالك المتجر", SourceDescription: "صورة من المالك", RightsStatement: "إذن الاستخدام للمتجر", RightsAttested: true}
		mediaDigest := strings.Repeat("a", 64)
		mediaInput := postgres.StoreProfileMediaAssetInput{ID: "join-case-profile-image", JoiningCaseID: created.Case.ID, IdempotencyKey: "idem-join-case-profile", RequestHash: postgres.HashStoreProfileMediaUploadRequest(created.Case.ID, mediaDigest, created.Case.Version, provenance), ExpectedCaseVersion: created.Case.Version, ObjectKey: "store-profile-media/join-case-profile-image.png", URI: "https://media.example/join-case-profile-image.png", ContentSHA256: mediaDigest, ContentType: "image/png", ByteSize: 1, ActingActorID: fieldActorID, CorrelationID: "corr-join-case-profile", Provenance: provenance}
		if _, replayed, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, db, mediaInput); err != nil || replayed {
			t.Fatalf("register initial store-profile image failed: replayed=%t err=%v", replayed, err)
		}
		if version, err := postgres.ActivateStoreProfileMediaAsset(ctx, db, mediaInput.ID, created.Case.ID, created.Case.Version, mediaInput.IdempotencyKey, mediaInput.RequestHash, fieldActorID, mediaInput.CorrelationID); err != nil || version != created.Case.Version+1 {
			t.Fatalf("activate initial store-profile image: version=%d err=%v", version, err)
		}
		created, err = postgres.ReadJoiningCase(ctx, db, created.Case.ID)
		if err != nil {
			t.Fatalf("read joining case after store-profile image: %v", err)
		}
		fieldProofImage, err := joiningcaseservice.UploadPrivateProofImage(ctx, db, evidenceKeys, created.Case.ID, fieldActorID, "field", "field-proof-image-upload", "idem-field-proof-image", "corr-field-proof-image", created.Case.Version, "image/png", tinyPNG)
		if err != nil || !fieldProofImage.Case.FirstStoreProofImageUploaded {
			t.Fatalf("upload private Field proof image failed: %+v err=%v", fieldProofImage, err)
		}
		if err := postgres.VerifyJoiningCaseEvidenceKeyring(ctx, db, evidenceKeys); err != nil {
			t.Fatalf("configured evidence keyring cannot read retained proof evidence: %v", err)
		}
		fieldProofCase := fieldProofImage.Case
		admissionHash := postgres.HashFieldJoiningCaseAdmission(fieldProofCase.ID, fieldActorID, fieldProofCase.Version)
		admission, err := postgres.RequestFieldJoiningCaseAdmission(ctx, db, fieldProofCase.ID, fieldActorID, fieldProofCase.Version, "idem-join-field-request", admissionHash, "corr-join-field-request")
		if err != nil || admission.Replayed || admission.Case.State != "admission_requested" || admission.Case.PartnerActorID != "" || admission.Case.Version != fieldProofCase.Version+1 {
			t.Fatalf("Field admission request failed or provisioned identity: %+v err=%v", admission, err)
		}
		admissionReplay, err := postgres.RequestFieldJoiningCaseAdmission(ctx, db, fieldProofCase.ID, fieldActorID, admission.Case.Version, "idem-join-field-request", admissionHash, "corr-join-field-request-replay")
		if err != nil || !admissionReplay.Replayed || admissionReplay.Case.State != "admission_requested" || admissionReplay.Case.Version != admission.Case.Version {
			t.Fatalf("Field admission request did not recover its canonical result: %+v err=%v", admissionReplay, err)
		}
		fieldSearch, err := postgres.ListJoiningCasesForField(ctx, db, fieldActorID, "مالك بحث مميز", 50, "")
		if err != nil || len(fieldSearch.Cases) != 1 || fieldSearch.Cases[0].ID != created.Case.ID {
			t.Fatalf("Field owner-name search did not return its own joining case: %+v err=%v", fieldSearch, err)
		}
		operatorSearch, err := postgres.ListJoiningCases(ctx, db, "admission_requested", "مالك بحث مميز", "created_desc", 50, "")
		if err != nil || len(operatorSearch.Cases) != 1 || operatorSearch.Cases[0].ID != created.Case.ID {
			t.Fatalf("operator owner-name search did not return the joining case: %+v err=%v", operatorSearch, err)
		}
		submittedHash := postgres.HashJoiningCaseSubmit(created.Case.ID, partnerActor, admission.Case.Version)
		submitted, err := postgres.SubmitJoiningCase(ctx, db, created.Case.ID, partnerActor, admission.Case.Version, "idem-join-field-submit", submittedHash, operatorActor, "corr-join-field-submit")
		if err != nil || submitted.Case.PartnerActorID != partnerActor || submitted.Case.State != "submitted" {
			t.Fatalf("Operator admission, Identity binding and submission failed: %+v err=%v", submitted, err)
		}
		submittedReplay, err := postgres.SubmitJoiningCase(ctx, db, created.Case.ID, partnerActor, admission.Case.Version, "idem-join-field-submit", submittedHash, operatorActor, "corr-join-field-submit-replay")
		if err != nil || !submittedReplay.Replayed || submittedReplay.Case.PartnerActorID != partnerActor || submittedReplay.Case.State != "submitted" {
			t.Fatalf("Operator submission did not recover its canonical result: %+v err=%v", submittedReplay, err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.service_cities SET active=false WHERE id=$1", serviceCityID); err != nil {
			t.Fatalf("deactivate Service City before correction decision: %v", err)
		}
		returned, err := postgres.ReviewJoiningCase(ctx, db, postgres.ReviewJoiningCaseInput{CaseID: created.Case.ID, Decision: "needs_correction", CorrectionReason: "تصحيح بيانات المتجر", ExpectedVersion: submitted.Case.Version, IdempotencyKey: "idem-join-field-review", RequestHash: postgres.HashJoiningCaseReviewWithFinancialTerms(created.Case.ID, "needs_correction", "تصحيح بيانات المتجر", submitted.Case.Version, "", ""), ActingActorID: operatorActor, CorrelationID: "corr-join-field-review"})
		if err != nil || returned.Case.State != "needs_correction" || returned.Case.PartnerActorID != partnerActor {
			t.Fatalf("inactive Service City prevented return to Partner correction: %+v err=%v", returned, err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.service_cities SET active=true WHERE id=$1", serviceCityID); err != nil {
			t.Fatalf("reactivate Service City before Partner correction: %v", err)
		}
		partnerProofImage, err := joiningcaseservice.UploadPrivateProofImage(ctx, db, evidenceKeys, created.Case.ID, partnerActor, "partner", "partner-proof-image-upload", "idem-partner-proof-image", "corr-partner-proof-image", returned.Case.Version, "image/png", tinyPNG)
		if err != nil || !partnerProofImage.Case.FirstStoreProofImageUploaded {
			t.Fatalf("upload fresh Partner proof image failed: %+v err=%v", partnerProofImage, err)
		}

		correction := postgres.CorrectJoiningCaseInput{CaseID: created.Case.ID, ActorID: partnerActor, OwnerFullName: "مالك مصحح", BusinessName: "نشاط مصحح", FirstStoreName: "متجر مصحح", FirstStoreAddress: "الشارع الرئيسي المصحح", FirstStoreWorkingHours: workHours, FirstStoreProofType: "COMMERCIAL_REGISTRATION", FirstStoreProofNumber: "987654321", EvidenceKeyring: evidenceKeys, ExpectedVersion: partnerProofImage.Case.Version, ServiceCityID: serviceCityID, VerticalID: verticalID, CommercialTypeID: storeTypeID, Latitude: 15.4, Longitude: 44.2, FulfillmentModes: initialModes}
		requestHash := postgres.HashJoiningCaseCorrectAndResubmit(correction)
		for _, actorID := range []string{fieldActorID, otherPartner} {
			unauthorized := correction
			unauthorized.ActorID = actorID
			unauthorized.IdempotencyKey = "idem-join-unauthorized-" + actorID
			unauthorized.RequestHash = requestHash
			unauthorized.CorrelationID = "corr-join-unauthorized-" + actorID
			_, err := postgres.CorrectAndResubmitJoiningCase(ctx, db, unauthorized)
			if !errors.Is(err, postgres.ErrJoiningCasePartnerAccess) {
				t.Fatalf("unbound actor %s correction error = %v, want Partner access denial", actorID, err)
			}
		}

		correction.IdempotencyKey = "idem-join-partner-correct"
		correction.RequestHash = requestHash
		correction.CorrelationID = "corr-join-partner-correct"
		corrected, err := postgres.CorrectAndResubmitJoiningCase(ctx, db, correction)
		if err != nil || corrected.Replayed || corrected.Case.State != "submitted" || corrected.Case.Version != partnerProofImage.Case.Version+1 || corrected.Case.Origin != "field" || corrected.Case.PartnerActorID != partnerActor || corrected.Case.BusinessName != "نشاط مصحح" || corrected.Case.FirstStoreName != "متجر مصحح" || corrected.Case.FirstStoreLatitude == nil || *corrected.Case.FirstStoreLatitude != 15.4 || corrected.Case.FirstStoreLongitude == nil || *corrected.Case.FirstStoreLongitude != 44.2 || !equalStoreFulfillmentModes(corrected.Case.FirstStoreFulfillmentModes, initialModes) {
			t.Fatalf("bound Partner did not atomically correct Field-originated case: %+v err=%v", corrected, err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.service_cities SET active=false WHERE id=$1", serviceCityID); err != nil {
			t.Fatalf("deactivate Service City for idempotency recovery proof: %v", err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_verticals SET active=false WHERE id=$1", verticalID); err != nil {
			t.Fatalf("deactivate Commerce Vertical for idempotency recovery proof: %v", err)
		}

		correction.CorrelationID = "corr-join-partner-correct-replay"
		replay, err := postgres.CorrectAndResubmitJoiningCase(ctx, db, correction)
		if err != nil || !replay.Replayed || replay.Case.Version != corrected.Case.Version || !equalStoreFulfillmentModes(replay.Case.FirstStoreFulfillmentModes, initialModes) {
			t.Fatalf("Partner correction idempotent replay failed: %+v err=%v", replay, err)
		}

		conflictingCorrection := correction
		conflictingCorrection.FirstStoreName = "اسم مختلف"
		conflictingCorrection.RequestHash = postgres.HashJoiningCaseCorrectAndResubmit(conflictingCorrection)
		conflictingCorrection.CorrelationID = "corr-join-partner-conflict"
		if _, err := postgres.CorrectAndResubmitJoiningCase(ctx, db, conflictingCorrection); !errors.Is(err, postgres.ErrJoiningCaseIdempotency) {
			t.Fatalf("changed correction facts did not affect correction idempotency: %v", err)
		}
		createReplay, err := postgres.CreateJoiningCaseForField(ctx, db, postgres.CreateJoiningCaseInput{IdempotencyKey: "idem-join-field-create", RequestHash: createHash, ActingActorID: fieldActorID, CorrelationID: "corr-join-field-create-replay", EvidenceKeyring: evidenceKeys, Request: createRequest})
		if err != nil || !createReplay.Replayed || createReplay.Case.ID != created.Case.ID {
			t.Fatalf("Field create replay did not return its canonical case after option deactivation: %+v err=%v", createReplay, err)
		}

		if _, err := db.ExecContext(ctx, "UPDATE dsh.service_cities SET active=true WHERE id=$1", serviceCityID); err != nil {
			t.Fatalf("reactivate Service City for validation proof: %v", err)
		}
		verticalRequest := postgres.JoiningCaseRequest{Phone: "+967700000102", WalletProviderKey: "provider-test", BusinessName: "نشاط غير نشط", FirstStoreName: "متجر غير نشط", ServiceCityID: serviceCityID, VerticalID: verticalID, CommercialTypeID: storeTypeID, Latitude: 15.369445, Longitude: 44.191006, FulfillmentModes: initialModes}
		verticalHash := postgres.HashJoiningCaseRequest(verticalRequest)
		if _, err := postgres.CreateJoiningCase(ctx, db, postgres.CreateJoiningCaseInput{IdempotencyKey: "idem-join-inactive-vertical", RequestHash: verticalHash, ActingActorID: operatorActor, CorrelationID: "corr-join-inactive-vertical", Request: verticalRequest}); !errors.Is(err, postgres.ErrCatalogVerticalNotFound) {
			t.Fatalf("new joining case with inactive vertical error = %v, want inactive vertical", err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.commerce_verticals SET active=true WHERE id=$1", verticalID); err != nil {
			t.Fatalf("reactivate Commerce Vertical for validation proof: %v", err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.service_cities SET active=false WHERE id=$1", serviceCityID); err != nil {
			t.Fatalf("deactivate Service City for validation proof: %v", err)
		}
		cityRequest := postgres.JoiningCaseRequest{Phone: "+967700000103", WalletProviderKey: "provider-test", BusinessName: "مدينة غير نشطة", FirstStoreName: "متجر غير نشط", ServiceCityID: serviceCityID, VerticalID: verticalID, CommercialTypeID: storeTypeID, Latitude: 15.369445, Longitude: 44.191006, FulfillmentModes: initialModes}
		cityHash := postgres.HashJoiningCaseRequest(cityRequest)
		if _, err := postgres.CreateJoiningCase(ctx, db, postgres.CreateJoiningCaseInput{IdempotencyKey: "idem-join-inactive-city", RequestHash: cityHash, ActingActorID: operatorActor, CorrelationID: "corr-join-inactive-city", Request: cityRequest}); !errors.Is(err, postgres.ErrJoiningCaseServiceCity) {
			t.Fatalf("new joining case with inactive service city error = %v, want inactive city", err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.service_cities SET active=true WHERE id=$1", serviceCityID); err != nil {
			t.Fatalf("reactivate Service City for approval gate proof: %v", err)
		}
		approvalRequest := postgres.JoiningCaseRequest{Phone: "+967700000104", WalletProviderKey: "provider-test", OwnerFullName: "مالك بوابة الاعتماد", BusinessName: "نشاط المدينة الموقوفة", FirstStoreName: "متجر المدينة الموقوفة", FirstStoreAddress: "شارع بوابة الاعتماد", FirstStoreWorkingHours: workHours, FirstStoreProofType: "COMMERCIAL_REGISTRATION", FirstStoreProofNumber: "456123789", ServiceCityID: serviceCityID, VerticalID: verticalID, CommercialTypeID: storeTypeID, Latitude: 15.369445, Longitude: 44.191006, FulfillmentModes: initialModes}
		approvalCase, err := postgres.CreateJoiningCase(ctx, db, postgres.CreateJoiningCaseInput{IdempotencyKey: "idem-join-approval-city-create", RequestHash: postgres.HashJoiningCaseRequest(approvalRequest), ActingActorID: operatorActor, CorrelationID: "corr-join-approval-city-create", EvidenceKeyring: evidenceKeys, Request: approvalRequest})
		if err != nil {
			t.Fatalf("create approval-gate joining case: %v", err)
		}
		approvalMediaDigest := strings.Repeat("b", 64)
		approvalMedia := postgres.StoreProfileMediaAssetInput{ID: "approval-gate-profile-image", JoiningCaseID: approvalCase.Case.ID, IdempotencyKey: "idem-approval-gate-profile", RequestHash: postgres.HashStoreProfileMediaUploadRequest(approvalCase.Case.ID, approvalMediaDigest, approvalCase.Case.Version, provenance), ExpectedCaseVersion: approvalCase.Case.Version, ObjectKey: "store-profile-media/approval-gate-profile-image.png", URI: "https://media.example/approval-gate-profile-image.png", ContentSHA256: approvalMediaDigest, ContentType: "image/png", ByteSize: int64(len(tinyPNG)), ActingActorID: operatorActor, CorrelationID: "corr-approval-gate-profile", Provenance: provenance}
		if _, replayed, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, db, approvalMedia); err != nil || replayed {
			t.Fatalf("register approval-gate store-profile image: replayed=%t error=%v", replayed, err)
		}
		if _, err := postgres.ActivateStoreProfileMediaAsset(ctx, db, approvalMedia.ID, approvalCase.Case.ID, approvalCase.Case.Version, approvalMedia.IdempotencyKey, approvalMedia.RequestHash, operatorActor, approvalMedia.CorrelationID); err != nil {
			t.Fatalf("activate approval-gate store-profile image: %v", err)
		}
		approvalCurrent, err := postgres.ReadJoiningCase(ctx, db, approvalCase.Case.ID)
		if err != nil {
			t.Fatalf("read approval-gate joining case after store-profile image: %v", err)
		}
		approvalProof, err := joiningcaseservice.UploadPrivateProofImage(ctx, db, evidenceKeys, approvalCase.Case.ID, operatorActor, "operator", "approval-gate-proof-image-upload", "idem-approval-gate-proof-image", "corr-approval-gate-proof-image", approvalCurrent.Case.Version, "image/png", tinyPNG)
		if err != nil || !approvalProof.Case.FirstStoreProofImageUploaded {
			t.Fatalf("upload approval-gate proof image failed: %+v err=%v", approvalProof, err)
		}
		approvalSubmitted, err := postgres.SubmitJoiningCase(ctx, db, approvalCase.Case.ID, "act_partner_inactive_city_approval", approvalProof.Case.Version, "idem-join-approval-city-submit", postgres.HashJoiningCaseSubmit(approvalCase.Case.ID, "act_partner_inactive_city_approval", approvalProof.Case.Version), operatorActor, "corr-join-approval-city-submit")
		if err != nil {
			t.Fatalf("submit approval-gate joining case: %v", err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE dsh.service_cities SET active=false WHERE id=$1", serviceCityID); err != nil {
			t.Fatalf("deactivate Service City before approval: %v", err)
		}
		approvalHash := postgres.HashJoiningCaseReviewWithFinancialTerms(approvalCase.Case.ID, "approved", "", approvalSubmitted.Case.Version, "WEEKLY", "partner-financial-terms:v1")
		if _, err := postgres.ReviewJoiningCase(ctx, db, postgres.ReviewJoiningCaseInput{CaseID: approvalCase.Case.ID, Decision: "approved", SettlementPeriod: "WEEKLY", TermsPolicyVersion: "partner-financial-terms:v1", ExpectedVersion: approvalSubmitted.Case.Version, IdempotencyKey: "idem-join-approval-city-review", RequestHash: approvalHash, ActingActorID: operatorActor, CorrelationID: "corr-join-approval-city-review"}); !errors.Is(err, postgres.ErrJoiningCaseServiceCity) {
			t.Fatalf("approval with inactive Service City error = %v, want inactive city", err)
		}
	})
}

func testJoiningCaseEvidenceKeyring(t *testing.T) *postgres.JoiningCaseEvidenceKeyring {
	t.Helper()
	encoded := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x42}, 32))
	keyring, err := postgres.NewJoiningCaseEvidenceKeyring("test-v1", map[string]string{"test-v1": encoded})
	if err != nil {
		t.Fatalf("create joining-case evidence keyring: %v", err)
	}
	return keyring
}
