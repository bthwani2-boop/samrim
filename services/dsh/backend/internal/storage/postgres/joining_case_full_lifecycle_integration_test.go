package postgres_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	_ "github.com/lib/pq"
)

func TestSelfServiceCorrectionApprovalAndFinanceIsolationPostgres(t *testing.T) {
	// This integration proof must never share the durable development DB.
	raw := strings.TrimSpace(os.Getenv("DSH_JOINING_QA_DATABASE_URL"))
	if raw == "" {
		t.Skip("dedicated joining QA database is not configured")
	}
	if os.Getenv("BTHWANI_JOINING_QA_ISOLATED") != "1" ||
		!strings.Contains(raw, "127.0.0.1:15440/dsh_qa") {
		t.Fatal("refusing non-isolated joining database")
	}
	root, err := sql.Open("postgres", raw)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Close() })
	withFreshDatabase(t, root, raw, func(ctx context.Context, db *sql.DB, records []postgres.MigrationRecord, statements []string) {
		if err := postgres.Migrate(ctx, db, records, statements, testDeliveryProofKeyring(t)); err != nil {
			t.Fatalf("migrate DSH QA: %v", err)
		}
		if err := postgres.VerifySchema(ctx, db, records); err != nil {
			t.Fatalf("verify DSH QA: %v", err)
		}
		for _, query := range []string{
			"INSERT INTO dsh.service_cities(id,display_name_ar,active) VALUES('qa-sanaa','Test Sanaa',true)",
			"INSERT INTO dsh.commerce_verticals(id,name_ar,name_en) VALUES('qa-grocery','Groceries','QA Groceries')",
			"INSERT INTO dsh.commercial_store_types(id,vertical_id,name_ar,name_en) VALUES('qa-shop','qa-grocery','Grocery Shop','QA Grocery Shop')",
		} {
			if _, err := db.ExecContext(ctx, query); err != nil {
				t.Fatalf("seed isolated reference: %v", err)
			}
		}
		keys, err := postgres.NewJoiningCaseEvidenceKeyring("qa-v1", map[string]string{"qa-v1": "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="})
		if err != nil {
			t.Fatal(err)
		}
		input := postgres.JoiningCaseRequest{
			Phone: "+967700000010", OwnerFullName: "QA Partner Owner", BusinessName: "QA Grocery Business",
			FirstStoreName: "QA Grocery Store", FirstStoreAddress: "Sanaa isolated test street",
			FirstStoreWorkingHours: json.RawMessage(`{"intervals":[{"dayOfWeek":1,"opensAt":"09:00","closesAt":"18:00"}]}`),
			FirstStoreProofType:    "IDENTITY_DOCUMENT", FirstStoreProofNumber: "TEST-DOCUMENT-ONLY",
			ServiceCityID: "qa-sanaa", VerticalID: "qa-grocery", CommercialTypeID: "qa-shop",
			Latitude: 15.36, Longitude: 44.20,
			FulfillmentModes: []string{"BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"},
		}
		create := postgres.CreateJoiningCaseInput{Request: input, Origin: "self_service",
			ActingActorID: "qa-applicant", EvidenceKeyring: keys,
			IdempotencyKey: "qa-create-unique", RequestHash: postgres.HashJoiningCaseRequest(input),
			CorrelationID: "qa-create-correlation"}
		first, err := postgres.CreateSelfServiceJoiningCase(ctx, db, create)
		if err != nil || first.Replayed || first.Case.State != "draft" {
			t.Fatalf("self-service create: %+v err=%v", first, err)
		}
		replay, err := postgres.CreateSelfServiceJoiningCase(ctx, db, create)
		if err != nil || !replay.Replayed || replay.Case.ID != first.Case.ID {
			t.Fatalf("self-service replay: %+v err=%v", replay, err)
		}
		changed := create
		changed.IdempotencyKey = "qa-create-duplicate"
		if _, err := postgres.CreateSelfServiceJoiningCase(ctx, db, changed); !errors.Is(err, postgres.ErrJoiningCaseExists) {
			t.Fatalf("duplicate phone not rejected: %v", err)
		}
		actual, err := postgres.ReadSelfServiceJoiningCase(ctx, db, "qa-applicant", input.Phone)
		if err != nil || actual.Case.ID != first.Case.ID {
			t.Fatalf("owner read failed: %v", err)
		}
		if _, err := postgres.ReadSelfServiceJoiningCase(ctx, db, "qa-other-client", input.Phone); !errors.Is(err, postgres.ErrJoiningCaseNotFound) {
			t.Fatalf("cross-account read was allowed: %v", err)
		}

		submitted, err := postgres.SubmitJoiningCase(ctx, db, first.Case.ID, "qa-partner", first.Case.Version,
			"qa-submit-unique", postgres.HashJoiningCaseSubmit(first.Case.ID, "qa-partner", first.Case.Version), "qa-operator", "qa-submit-correlation")
		if err != nil || submitted.Case.State != "submitted" {
			t.Fatalf("submission: %+v err=%v", submitted, err)
		}
		correction := postgres.ReviewJoiningCaseInput{CaseID: first.Case.ID, Decision: "needs_correction",
			CorrectionReason: "Improve the registered store address", ExpectedVersion: submitted.Case.Version,
			IdempotencyKey: "qa-review-correction", ActingActorID: "qa-reviewer", CorrelationID: "qa-review-correction-correlation"}
		correction.RequestHash = postgres.HashJoiningCaseReviewWithFinancialTerms(first.Case.ID, correction.Decision, correction.CorrectionReason, correction.ExpectedVersion, "", "")
		pending, err := postgres.ReviewJoiningCase(ctx, db, correction)
		if err != nil || pending.Case.State != "needs_correction" {
			t.Fatalf("needs correction: %+v err=%v", pending, err)
		}
		fix := postgres.CorrectJoiningCaseInput{
			CaseID: first.Case.ID, ActorID: "qa-partner", OwnerFullName: input.OwnerFullName,
			BusinessName: input.BusinessName, FirstStoreName: input.FirstStoreName,
			FirstStoreAddress: "Corrected QA street", FirstStoreWorkingHours: input.FirstStoreWorkingHours,
			FirstStoreProofType: input.FirstStoreProofType,
			ServiceCityID:       input.ServiceCityID, VerticalID: input.VerticalID, CommercialTypeID: input.CommercialTypeID,
			Latitude: input.Latitude, Longitude: input.Longitude, FulfillmentModes: input.FulfillmentModes,
			ExpectedVersion: pending.Case.Version, IdempotencyKey: "qa-correct-resubmit", CorrelationID: "qa-correct-resubmit-corr",
		}
		fix.RequestHash = postgres.HashJoiningCaseCorrectAndResubmit(fix)
		corrected, err := postgres.CorrectAndResubmitJoiningCase(ctx, db, fix)
		if err != nil || corrected.Case.State != "submitted" {
			t.Fatalf("correct/resubmit: %+v err=%v", corrected, err)
		}
		approved := postgres.ReviewJoiningCaseInput{CaseID: first.Case.ID, Decision: "approved",
			ExpectedVersion: corrected.Case.Version, IdempotencyKey: "qa-approve-joining",
			ActingActorID: "qa-reviewer", CorrelationID: "qa-approve-correlation"}
		approved.RequestHash = postgres.HashJoiningCaseReviewWithFinancialTerms(first.Case.ID, "approved", "", corrected.Case.Version, "", "")
		if _, err := postgres.ReviewJoiningCase(ctx, db, postgres.ReviewJoiningCaseInput{
			CaseID: first.Case.ID, Decision: "approved", ExpectedVersion: corrected.Case.Version,
			IdempotencyKey: "qa-self-approval", RequestHash: approved.RequestHash,
			ActingActorID: "qa-partner", CorrelationID: "qa-self-approval-corr",
		}); !errors.Is(err, postgres.ErrJoiningCaseSelfReview) {
			t.Fatalf("self approval allowed: %v", err)
		}
		done, err := postgres.ReviewJoiningCase(ctx, db, approved)
		if err != nil || done.Case.State != "approved" || done.Case.StoreID == "" || done.Case.FinancialProfileState != "REQUIRED" {
			t.Fatalf("joining approval and finance isolation: %+v err=%v", done, err)
		}
		var rows int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.joining_case_financial_profile_outbox WHERE case_id=$1", first.Case.ID).Scan(&rows); err != nil || rows != 0 {
			t.Fatalf("joining approval must not send finance outbox rows=%d err=%v", rows, err)
		}
		again, err := postgres.ReviewJoiningCase(ctx, db, approved)
		if err != nil || !again.Replayed || again.Case.StoreID != done.Case.StoreID {
			t.Fatalf("approval replay: %+v err=%v", again, err)
		}
		policy := "partner-financial-terms:v1"
		financial := postgres.BindJoiningCaseFinancialTermsInput{CaseID: first.Case.ID, SettlementPeriod: "WEEKLY",
			TermsPolicyVersion: policy, ExpectedVersion: done.Case.Version,
			IdempotencyKey: "qa-bind-financial", CorrelationID: "qa-bind-correlation", ActingActorID: "qa-finance"}
		financial.RequestHash = postgres.HashJoiningCaseReviewWithFinancialTerms(first.Case.ID, "bind-financial-terms", "", done.Case.Version, "WEEKLY", policy)
		bound, err := postgres.BindApprovedJoiningCaseFinancialTerms(ctx, db, financial)
		if err != nil || bound.Case.FinancialProfileState != "PENDING_BINDING" {
			t.Fatalf("finance bind: %+v err=%v", bound, err)
		}
		replayBound, err := postgres.BindApprovedJoiningCaseFinancialTerms(ctx, db, financial)
		if err != nil || !replayBound.Replayed {
			t.Fatalf("finance bind replay: %+v err=%v", replayBound, err)
		}
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.joining_case_financial_profile_outbox WHERE case_id=$1", first.Case.ID).Scan(&rows); err != nil || rows != 1 {
			t.Fatalf("financial bind must create exactly one outbox row: %d err=%v", rows, err)
		}
		if _, err := postgres.BindApprovedJoiningCaseFinancialTerms(ctx, db, postgres.BindJoiningCaseFinancialTermsInput{
			CaseID: first.Case.ID, SettlementPeriod: "WEEKLY", TermsPolicyVersion: policy,
			ExpectedVersion: done.Case.Version, IdempotencyKey: "qa-rebind-other", RequestHash: "different",
			CorrelationID: "qa-rebind-other-corr", ActingActorID: "qa-finance",
		}); !errors.Is(err, postgres.ErrJoiningCaseVersion) {
			t.Fatalf("stale separate binding should fail: %v", err)
		}
		var storeCount int
		if err := db.QueryRowContext(ctx, "SELECT count(*) FROM dsh.stores WHERE partner_actor_id='qa-partner'").Scan(&storeCount); err != nil || storeCount != 1 {
			t.Fatalf("one canonical Store required count=%d err=%v", storeCount, err)
		}

		// Operator-assisted intake is a separate admitted origin. The retired
		// Field actor cannot become its origin through a caller-supplied value.
		operatorInput := input
		operatorInput.Phone = "+967700000011"
		operatorInput.OwnerFullName = "QA Operator-Assisted Owner"
		operatorInput.BusinessName = "QA Operator-Assisted Business"
		operatorInput.FirstStoreName = "QA Operator-Assisted Store"
		operatorInput.FirstStoreWorkingHours = nil // optional at intake, closed until configured
		operatorCreate := postgres.CreateJoiningCaseInput{
			Request: operatorInput, Origin: "field", OriginatingFieldActorID: "retired-field",
			ActingActorID: "qa-operator-creator", EvidenceKeyring: keys,
			IdempotencyKey: "qa-operator-create", RequestHash: postgres.HashJoiningCaseRequest(operatorInput),
			CorrelationID: "qa-operator-create-correlation",
		}
		operatorDraft, err := postgres.CreateJoiningCase(ctx, db, operatorCreate)
		if err != nil || operatorDraft.Case.State != "draft" || operatorDraft.Case.Origin != "control_panel" || operatorDraft.Case.OriginatingFieldActorID != "" {
			t.Fatalf("operator intake must ignore retired Field origin: %+v err=%v", operatorDraft, err)
		}
		operatorSubmitted, err := postgres.SubmitJoiningCase(ctx, db, operatorDraft.Case.ID, "qa-operator-partner", operatorDraft.Case.Version,
			"qa-operator-submit", postgres.HashJoiningCaseSubmit(operatorDraft.Case.ID, "qa-operator-partner", operatorDraft.Case.Version),
			"qa-operator-creator", "qa-operator-submit-correlation")
		if err != nil || operatorSubmitted.Case.State != "submitted" {
			t.Fatalf("operator-submitted intake: %+v err=%v", operatorSubmitted, err)
		}
		operatorApproval := postgres.ReviewJoiningCaseInput{
			CaseID: operatorDraft.Case.ID, Decision: "approved", ExpectedVersion: operatorSubmitted.Case.Version,
			IdempotencyKey: "qa-operator-approve", ActingActorID: "qa-reviewer",
			CorrelationID: "qa-operator-approval-correlation",
		}
		operatorApproval.RequestHash = postgres.HashJoiningCaseReviewWithFinancialTerms(
			operatorDraft.Case.ID, "approved", "", operatorSubmitted.Case.Version, "", "")
		operatorApproved, err := postgres.ReviewJoiningCase(ctx, db, operatorApproval)
		if err != nil || operatorApproved.Case.State != "approved" || operatorApproved.Case.StoreID == "" ||
			operatorApproved.Case.FinancialProfileState != "REQUIRED" {
			t.Fatalf("operator approval must create one non-financial Store: %+v err=%v", operatorApproved, err)
		}
		var mode, schedule string
		if err := db.QueryRowContext(ctx, "SELECT schedule_mode,weekly_schedule::text FROM dsh.store_operational_availability WHERE store_id=$1",
			operatorApproved.Case.StoreID).Scan(&mode, &schedule); err != nil || mode != "WEEKLY" || schedule != "[]" {
			t.Fatalf("omitted operator hours must leave Store closed: mode=%q schedule=%q err=%v", mode, schedule, err)
		}
		var publication string
		if err := db.QueryRowContext(ctx, "SELECT publication_state FROM dsh.stores WHERE id=$1",
			operatorApproved.Case.StoreID).Scan(&publication); err != nil || publication == "published" {
			t.Fatalf("Store must not auto-publish before agreement and readiness: %q err=%v", publication, err)
		}
	}, 5*60*1000000000)
}
