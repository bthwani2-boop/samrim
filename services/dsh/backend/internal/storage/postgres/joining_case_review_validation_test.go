package postgres

import (
	"errors"
	"testing"
)

func TestValidateJoiningCaseReviewRequiresSubmittedCanonicalCase(t *testing.T) {
	base := validReviewJoiningCase()
	valid := ReviewJoiningCaseInput{Decision: "needs_correction", ExpectedVersion: 4, ActingActorID: "operator-1"}
	tests := []struct {
		name    string
		current JoiningCaseRecord
		input   ReviewJoiningCaseInput
		want    error
	}{
		{name: "stale version", current: changeReviewCase(base, func(c *JoiningCaseRecord) { c.Version = 3 }), input: valid, want: ErrJoiningCaseVersion},
		{name: "case is not submitted", current: changeReviewCase(base, func(c *JoiningCaseRecord) { c.State = "needs_correction" }), input: valid, want: ErrJoiningCaseState},
		{name: "case is not bound to partner", current: changeReviewCase(base, func(c *JoiningCaseRecord) { c.PartnerActorID = "" }), input: valid, want: ErrJoiningCaseState},
		{name: "service city missing", current: changeReviewCase(base, func(c *JoiningCaseRecord) { c.FirstStoreServiceCityID = "" }), input: valid, want: ErrJoiningCaseServiceCity},
		{name: "vertical missing", current: changeReviewCase(base, func(c *JoiningCaseRecord) { c.FirstStoreVerticalID = "" }), input: valid, want: ErrCatalogVerticalNotFound},
		{name: "business name missing", current: changeReviewCase(base, func(c *JoiningCaseRecord) { c.BusinessName = "" }), input: valid, want: ErrJoiningCaseState},
		{name: "store name missing", current: changeReviewCase(base, func(c *JoiningCaseRecord) { c.FirstStoreName = "" }), input: valid, want: ErrJoiningCaseState},
		{name: "commercial type missing", current: changeReviewCase(base, func(c *JoiningCaseRecord) { c.FirstStoreCommercialTypeID = "" }), input: valid, want: ErrCommercialStoreTypeNotFound},
		{name: "fulfillment mode missing", current: changeReviewCase(base, func(c *JoiningCaseRecord) { c.FirstStoreFulfillmentModes = nil }), input: valid, want: ErrJoiningCaseState},
		{name: "wallet provider missing", current: changeReviewCase(base, func(c *JoiningCaseRecord) { c.WalletProviderKey = "" }), input: valid, want: ErrJoiningCaseState},
		{name: "store origin incomplete", current: changeReviewCase(base, func(c *JoiningCaseRecord) { c.FirstStoreLatitude = nil }), input: valid, want: ErrJoiningCaseStoreOrigin},
		{name: "partner cannot review own case", current: base, input: changeReviewInput(valid, func(i *ReviewJoiningCaseInput) { i.ActingActorID = "partner-1" }), want: ErrJoiningCaseSelfReview},
		{name: "unsupported decision", current: base, input: changeReviewInput(valid, func(i *ReviewJoiningCaseInput) { i.Decision = "approve" }), want: ErrJoiningCaseInvalidDecision},
		{name: "approval requires bound financial terms", current: base, input: changeReviewInput(valid, func(i *ReviewJoiningCaseInput) { i.Decision = "approved" }), want: ErrJoiningCaseState},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := validateJoiningCaseReview(tc.current, tc.input)
			if !errors.Is(err, tc.want) {
				t.Fatalf("review validation error = %v, want %v", err, tc.want)
			}
		})
	}
}

func TestValidateJoiningCaseSubmissionReadinessRequiresCompleteIntakeBeforeAdmission(t *testing.T) {
	base := validReviewJoiningCase()
	base.Origin = "control_panel"
	base.State = "draft"
	base.BusinessName = "Business"
	base.FirstStoreName = "Store"
	base.FirstStoreCommercialTypeID = "type-1"
	base.FirstStoreFulfillmentModes = []string{FulfillmentModeBthwaniCaptain}
	base.FirstStoreWorkingHours = []byte(`{"intervals":[{"dayOfWeek":1,"opensAt":"09:00","closesAt":"17:00","closesNextDay":false}]}`)
	valid := base
	tests := []struct {
		name    string
		current JoiningCaseRecord
		version int
		want    error
	}{
		{name: "complete intake", current: valid, version: valid.Version},
		{name: "stale version", current: valid, version: valid.Version - 1, want: ErrJoiningCaseVersion},
		{name: "not an admission state", current: changeReviewCase(valid, func(c *JoiningCaseRecord) { c.State = "needs_correction" }), version: valid.Version, want: ErrJoiningCaseState},
		{name: "missing owner", current: changeReviewCase(valid, func(c *JoiningCaseRecord) { c.OwnerFullName = " " }), version: valid.Version, want: ErrJoiningCaseState},
		{name: "missing wallet provider", current: changeReviewCase(valid, func(c *JoiningCaseRecord) { c.WalletProviderKey = " " }), version: valid.Version, want: ErrJoiningCaseState},
		{name: "missing proof number", current: changeReviewCase(valid, func(c *JoiningCaseRecord) { c.FirstStoreProofNumberPresent = false }), version: valid.Version, want: ErrJoiningCaseState},
		{name: "no proof image needed", current: changeReviewCase(valid, func(c *JoiningCaseRecord) { c.FirstStoreProofImageUploaded = false }), version: valid.Version},
		{name: "field admission without document image", current: changeReviewCase(valid, func(c *JoiningCaseRecord) { c.Origin = "field"; c.State = "admission_requested"; c.FirstStoreProofImageUploaded = false }), version: valid.Version},
		{name: "missing storefront image", current: changeReviewCase(valid, func(c *JoiningCaseRecord) { c.StoreProfileImage = nil }), version: valid.Version, want: ErrJoiningCaseState},
		{name: "missing location", current: changeReviewCase(valid, func(c *JoiningCaseRecord) { c.FirstStoreLongitude = nil }), version: valid.Version, want: ErrJoiningCaseStoreOrigin},
		{name: "missing fulfillment mode", current: changeReviewCase(valid, func(c *JoiningCaseRecord) { c.FirstStoreFulfillmentModes = nil }), version: valid.Version, want: ErrJoiningCaseState},
		{name: "invalid schedule", current: changeReviewCase(valid, func(c *JoiningCaseRecord) { c.FirstStoreWorkingHours = []byte(`{"intervals":[]}`) }), version: valid.Version, want: ErrJoiningCaseState},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateJoiningCaseSubmissionReadiness(test.current, test.version)
			if !errors.Is(err, test.want) {
				t.Fatalf("submission readiness error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestValidateJoiningCaseReviewNormalizesCorrectionAndFinancialTerms(t *testing.T) {
	current := validReviewJoiningCase()
	tests := []struct {
		name  string
		input ReviewJoiningCaseInput
		want  ReviewJoiningCaseInput
	}{
		{
			name:  "correction reason is trimmed",
			input: ReviewJoiningCaseInput{Decision: " NEEDS_CORRECTION ", CorrectionReason: "  missing origin  ", ExpectedVersion: 4, ActingActorID: "operator-1"},
			want:  ReviewJoiningCaseInput{Decision: "needs_correction", CorrectionReason: "missing origin", ExpectedVersion: 4, ActingActorID: "operator-1"},
		},
		{
			name:  "approved terms are normalized",
			input: ReviewJoiningCaseInput{Decision: " APPROVED ", SettlementPeriod: " monthly ", TermsPolicyVersion: " partner-financial-terms:v2 ", ExpectedVersion: 4, ActingActorID: "operator-1"},
			want:  ReviewJoiningCaseInput{Decision: "approved", SettlementPeriod: "MONTHLY", TermsPolicyVersion: " partner-financial-terms:v2 ", ExpectedVersion: 4, ActingActorID: "operator-1"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := validateJoiningCaseReview(current, tc.input)
			if err != nil {
				t.Fatalf("valid review rejected: %v", err)
			}
			if got.Decision != tc.want.Decision || got.CorrectionReason != tc.want.CorrectionReason || got.SettlementPeriod != tc.want.SettlementPeriod || got.TermsPolicyVersion != tc.want.TermsPolicyVersion {
				t.Fatalf("review normalization = %#v, want %#v", got, tc.want)
			}
		})
	}
}

func validReviewJoiningCase() JoiningCaseRecord {
	latitude, longitude := 15.3, 44.2
	return JoiningCaseRecord{
		OwnerFullName: "Store owner", WalletProviderKey: "provider-test", BusinessName: "Business", FirstStoreName: "Store", FirstStoreAddress: "Main street",
		FirstStoreWorkingHours: []byte(`{"intervals":[{"dayOfWeek":1,"opensAt":"09:00","closesAt":"18:00","closesNextDay":false}]}`),
		FirstStoreProofType:    "COMMERCIAL_REGISTRATION", FirstStoreProofNumberPresent: true,
		StoreProfileImage: &StoreProfileMediaRecord{ID: "profile-image-1"},
		PartnerActorID:    "partner-1", State: "submitted", FirstStoreServiceCityID: "city-1",
		FirstStoreVerticalID: "vertical-1", FirstStoreCommercialTypeID: "type-1", FirstStoreFulfillmentModes: []string{FulfillmentModeBthwaniCaptain}, FirstStoreLatitude: &latitude, FirstStoreLongitude: &longitude,
		Version: 4,
	}
}

func changeReviewCase(value JoiningCaseRecord, change func(*JoiningCaseRecord)) JoiningCaseRecord {
	change(&value)
	return value
}

func changeReviewInput(value ReviewJoiningCaseInput, change func(*ReviewJoiningCaseInput)) ReviewJoiningCaseInput {
	change(&value)
	return value
}
