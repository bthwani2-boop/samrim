package postgres_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	joiningcaseservice "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/joiningcase"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestFieldJoiningCaseDraftCreateUpdateOwnershipIdempotencyAndMedia(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DSH_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("DSH_DATABASE_URL is required for isolated joining-case draft persistence proof")
	}
	rootDB, err := sql.Open("postgres", databaseURL)
	if err != nil {
		t.Fatalf("open Postgres: %v", err)
	}
	t.Cleanup(func() { _ = rootDB.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if err := rootDB.PingContext(ctx); err != nil {
		t.Fatalf("configured Postgres is not reachable: %v", err)
	}
	withFreshDatabase(t, rootDB, databaseURL, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, migrationSQL []string) {
		if err := postgres.Migrate(ctx, db, records, migrationSQL, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("apply DSH migrations: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify DSH schema: %v", err)
		}
		keys := testJoiningCaseEvidenceKeyring(t)
		const fieldActor = "act_field_draft_owner"
		request := postgres.JoiningCaseRequest{Phone: "+967700000171", FirstStoreProofType: "COMMERCIAL_REGISTRATION", FirstStoreProofNumber: "123456789"}
		createHash := "field-draft-create-hash"
		created, err := postgres.CreateFieldJoiningCaseDraft(ctx, db, postgres.CreateJoiningCaseInput{
			IdempotencyKey: "idem-field-draft-create", RequestHash: createHash, ActingActorID: fieldActor,
			CorrelationID: "corr-field-draft-create", EvidenceKeyring: keys, Request: request,
		})
		if err != nil || created.Case.State != "draft" || created.Case.OriginatingFieldActorID != fieldActor || created.Case.BusinessName != "" || created.Case.FirstStoreLatitude != nil {
			t.Fatalf("partial draft create failed or invented fields: case=%+v err=%v", created.Case, err)
		}
		replay, err := postgres.CreateFieldJoiningCaseDraft(ctx, db, postgres.CreateJoiningCaseInput{
			IdempotencyKey: "idem-field-draft-create", RequestHash: createHash, ActingActorID: fieldActor,
			CorrelationID: "corr-field-draft-retry", EvidenceKeyring: keys, Request: request,
		})
		if err != nil || !replay.Replayed || replay.Case.ID != created.Case.ID {
			t.Fatalf("create retry was not idempotent: replay=%+v err=%v", replay, err)
		}

		provenance := media.Provenance{Creator: "مالك المتجر", SourceDescription: "صورة من المالك", RightsStatement: "إذن الاستخدام للمتجر", RightsAttested: true}
		mediaDigest := strings.Repeat("a", 64)
		mediaInput := postgres.StoreProfileMediaAssetInput{
			ID: "field-draft-profile-image", JoiningCaseID: created.Case.ID, IdempotencyKey: "idem-draft-profile-image",
			RequestHash:         postgres.HashStoreProfileMediaUploadRequest(created.Case.ID, mediaDigest, created.Case.Version, provenance),
			ExpectedCaseVersion: created.Case.Version, ObjectKey: "store-profile-media/field-draft-profile-image.png",
			URI: "https://media.example/field-draft-profile-image.png", ContentSHA256: mediaDigest, ContentType: "image/png",
			ByteSize: 1, ActingActorID: fieldActor, CorrelationID: "corr-draft-profile-image", Provenance: provenance,
		}
		if _, replayed, err := postgres.RegisterStoreProfileMediaAssetPending(ctx, db, mediaInput); err != nil || replayed {
			t.Fatalf("register draft profile image failed: replayed=%t err=%v", replayed, err)
		}
		imageVersion, err := postgres.ActivateStoreProfileMediaAsset(ctx, db, mediaInput.ID, created.Case.ID, created.Case.Version, mediaInput.IdempotencyKey, mediaInput.RequestHash, fieldActor, mediaInput.CorrelationID)
		if err != nil {
			t.Fatalf("activate draft profile image: %v", err)
		}
		proofResult, err := joiningcaseservice.UploadPrivateProofImage(ctx, db, keys, created.Case.ID, fieldActor, "field", "field-proof-image-upload", "idem-draft-proof-image", "corr-draft-proof-image", imageVersion, "image/png", tinyPNG)
		if err != nil || !proofResult.Case.FirstStoreProofImageUploaded {
			t.Fatalf("upload proof image before other draft fields failed: case=%+v err=%v", proofResult.Case, err)
		}

		updatedRequest := postgres.JoiningCaseRequest{
			Phone: request.Phone, OwnerFullName: "مالك المتجر", BusinessName: "نشاط المتجر", FirstStoreName: "متجر الاختبار",
			WalletProviderKey: "provider-test", FirstStoreAddress: "الشارع الرئيسي", FirstStoreWorkingHours: []byte(`{"intervals":[{"dayOfWeek":1,"opensAt":"09:00","closesAt":"17:00","closesNextDay":false}]}`),
			FirstStoreProofType: "COMMERCIAL_REGISTRATION", FirstStoreProofNumber: "", FirstStoreNotes: "ملاحظات", Latitude: 15.369445, Longitude: 44.191006,
			FulfillmentModes: []string{postgres.FulfillmentModeBthwaniCaptain},
		}
		update := postgres.UpdateFieldJoiningCaseDraftInput{
			CaseID: created.Case.ID, FieldActorID: fieldActor, IdempotencyKey: "idem-field-draft-update",
			CorrelationID: "corr-field-draft-update", ExpectedVersion: proofResult.Case.Version,
			EvidenceKeyring: keys, PreserveProofNumber: true, Request: updatedRequest,
		}
		update.RequestHash = hashDraftUpdate(t, keys, update)
		updated, err := postgres.UpdateFieldJoiningCaseDraft(ctx, db, update)
		if err != nil || updated.Case.Version != proofResult.Case.Version+1 || updated.Case.FirstStoreServiceCityID != "" || updated.Case.FirstStoreLatitude == nil || *updated.Case.FirstStoreLatitude != 15.369445 || !updated.Case.FirstStoreProofNumberPresent || !updated.Case.FirstStoreProofImageUploaded || updated.Case.StoreProfileImage == nil || updated.Case.StoreProfileImage.ID != mediaInput.ID {
			t.Fatalf("draft update failed to preserve private number/images or omitted facts: case=%+v err=%v", updated.Case, err)
		}
		preserveUpdate := update
		preserveUpdate.ExpectedVersion = updated.Case.Version
		preserveUpdate.IdempotencyKey = "idem-field-draft-preserve"
		preserveUpdate.CorrelationID = "corr-field-draft-preserve"
		preserveUpdate.PreserveProofNumber = true
		preserveUpdate.Request.FirstStoreProofNumber = ""
		preserveUpdate.RequestHash = hashDraftUpdate(t, keys, preserveUpdate)
		preserved, err := postgres.UpdateFieldJoiningCaseDraft(ctx, db, preserveUpdate)
		if err != nil || preserved.Case.Version != updated.Case.Version+1 || !preserved.Case.FirstStoreProofNumberPresent || !preserved.Case.FirstStoreProofImageUploaded || preserved.Case.StoreProfileImage == nil || preserved.Case.StoreProfileImage.ID != mediaInput.ID {
			t.Fatalf("omitted private number or images were not preserved: case=%+v err=%v", preserved.Case, err)
		}
		replayUpdate, err := postgres.UpdateFieldJoiningCaseDraft(ctx, db, preserveUpdate)
		if err != nil || !replayUpdate.Replayed || replayUpdate.Case.Version != preserved.Case.Version {
			t.Fatalf("draft update retry was not idempotent: case=%+v err=%v", replayUpdate.Case, err)
		}
		// Repeating the exact encrypted proof number must not invalidate an
		// already uploaded image or re-encrypt the unchanged number.
		sameNumber := preserveUpdate
		sameNumber.ExpectedVersion = preserved.Case.Version
		sameNumber.IdempotencyKey = "idem-field-draft-same-proof-number"
		sameNumber.CorrelationID = "corr-field-draft-same-proof-number"
		sameNumber.PreserveProofNumber = false
		sameNumber.Request.FirstStoreProofNumber = "123456789"
		sameNumber.RequestHash = hashDraftUpdate(t, keys, sameNumber)
		sameNumberSaved, err := postgres.UpdateFieldJoiningCaseDraft(ctx, db, sameNumber)
		if err != nil || !sameNumberSaved.Case.FirstStoreProofNumberPresent || !sameNumberSaved.Case.FirstStoreProofImageUploaded {
			t.Fatalf("unchanged encrypted proof number must retain its image: case=%+v err=%v", sameNumberSaved.Case, err)
		}
		stale := preserveUpdate
		stale.IdempotencyKey = "idem-field-draft-stale"
		stale.RequestHash = hashDraftUpdate(t, keys, stale)
		if _, err := postgres.UpdateFieldJoiningCaseDraft(ctx, db, stale); !errors.Is(err, postgres.ErrJoiningCaseVersion) {
			t.Fatalf("stale draft update error = %v, want version conflict", err)
		}
		wrongOwner := preserveUpdate
		wrongOwner.FieldActorID = "act_field_draft_other"
		wrongOwner.IdempotencyKey = "idem-field-draft-owner"
		wrongOwner.ExpectedVersion = preserved.Case.Version
		wrongOwner.RequestHash = hashDraftUpdate(t, keys, wrongOwner)
		if _, err := postgres.UpdateFieldJoiningCaseDraft(ctx, db, wrongOwner); !errors.Is(err, postgres.ErrJoiningCasePartnerAccess) {
			t.Fatalf("foreign actor draft update error = %v, want ownership denial", err)
		}
		// Correcting private proof details makes the previously uploaded image stale.
		changedProof := preserveUpdate
		changedProof.ExpectedVersion = sameNumberSaved.Case.Version
		changedProof.IdempotencyKey = "idem-field-draft-proof-change"
		changedProof.CorrelationID = "corr-field-draft-proof-change"
		changedProof.PreserveProofNumber = false
		changedProof.Request.FirstStoreProofNumber = "987654321"
		changedProof.RequestHash = hashDraftUpdate(t, keys, changedProof)
		changed, err := postgres.UpdateFieldJoiningCaseDraft(ctx, db, changedProof)
		if err != nil || !changed.Case.FirstStoreProofNumberPresent || changed.Case.FirstStoreProofImageUploaded {
			t.Fatalf("new proof number did not invalidate existing image: case=%+v err=%v", changed.Case, err)
		}
		refreshed, err := joiningcaseservice.UploadPrivateProofImage(ctx, db, keys, created.Case.ID, fieldActor, "field", "field-proof-image-upload", "idem-draft-proof-refresh", "corr-draft-proof-refresh", changed.Case.Version, "image/png", tinyPNG)
		if err != nil || !refreshed.Case.FirstStoreProofImageUploaded {
			t.Fatalf("fresh proof image could not restore readiness: case=%+v err=%v", refreshed.Case, err)
		}
		changedType := changedProof
		changedType.ExpectedVersion = refreshed.Case.Version
		changedType.IdempotencyKey = "idem-field-draft-type-change"
		changedType.CorrelationID = "corr-field-draft-type-change"
		changedType.PreserveProofNumber = true
		changedType.Request.FirstStoreProofNumber = ""
		changedType.Request.FirstStoreProofType = "IDENTITY_DOCUMENT"
		changedType.RequestHash = hashDraftUpdate(t, keys, changedType)
		typeUpdated, err := postgres.UpdateFieldJoiningCaseDraft(ctx, db, changedType)
		if err != nil || typeUpdated.Case.FirstStoreProofImageUploaded {
			t.Fatalf("changed proof type retained stale image: case=%+v err=%v", typeUpdated.Case, err)
		}
		// The first submission gate is the now-invalidated private image, not the city.
		if _, err := postgres.RequestFieldJoiningCaseAdmission(ctx, db, created.Case.ID, fieldActor, typeUpdated.Case.Version, "idem-field-draft-incomplete-submit", postgres.HashFieldJoiningCaseAdmission(created.Case.ID, fieldActor, typeUpdated.Case.Version), "corr-draft-incomplete-submit"); !errors.Is(err, postgres.ErrJoiningCaseState) {
			t.Fatalf("incomplete draft submit error = %v, want missing-proof-image rejection", err)
		}
		proofAfterTypeChange, err := joiningcaseservice.UploadPrivateProofImage(ctx, db, keys, created.Case.ID, fieldActor, "field", "field-proof-image-upload", "idem-draft-proof-type-refresh", "corr-draft-proof-type-refresh", typeUpdated.Case.Version, "image/png", tinyPNG)
		if err != nil || !proofAfterTypeChange.Case.FirstStoreProofImageUploaded {
			t.Fatalf("new proof type image not saved: %+v error=%v", proofAfterTypeChange.Case, err)
		}
		if _, err := postgres.RequestFieldJoiningCaseAdmission(ctx, db, created.Case.ID, fieldActor, proofAfterTypeChange.Case.Version, "idem-field-draft-missing-city", postgres.HashFieldJoiningCaseAdmission(created.Case.ID, fieldActor, proofAfterTypeChange.Case.Version), "corr-draft-missing-city"); !errors.Is(err, postgres.ErrJoiningCaseServiceCity) {
			t.Fatalf("complete proof without city error = %v, want missing-city rejection", err)
		}
	})
}

func hashDraftUpdate(t *testing.T, keys *postgres.JoiningCaseEvidenceKeyring, input postgres.UpdateFieldJoiningCaseDraftInput) string {
	t.Helper()
	hash, err := joiningcaseservice.HashFieldDraftUpdateRequest(keys, input.FieldActorID, input.CaseID, input.ExpectedVersion, input.PreserveProofNumber, input.Request)
	if err != nil {
		t.Fatalf("hash Field joining-case draft update: %v", err)
	}
	return hash
}
