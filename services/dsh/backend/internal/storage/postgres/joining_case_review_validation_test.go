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
		{name: "store origin incomplete", current: changeReviewCase(base, func(c *JoiningCaseRecord) { c.FirstStoreLatitude = nil }), input: valid, want: ErrJoiningCaseStoreOrigin},
		{name: "required intake evidence missing", current: changeReviewCase(base, func(c *JoiningCaseRecord) { c.FirstStoreProofImageUploaded = false }), input: valid, want: ErrJoiningCaseState},
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
		OwnerFullName: "Store owner", FirstStoreAddress: "Main street",
		FirstStoreWorkingHours: []byte(`{"sunday":[{"opensAt":"09:00","closesAt":"18:00"}]}`),
		FirstStoreProofType:    "commercial_register", FirstStoreProofNumberPresent: true,
		FirstStoreProofImageUploaded: true, StoreProfileImage: &StoreProfileMediaRecord{ID: "profile-image-1"},
		PartnerActorID: "partner-1", State: "submitted", FirstStoreServiceCityID: "city-1",
		FirstStoreVerticalID: "vertical-1", FirstStoreLatitude: &latitude, FirstStoreLongitude: &longitude,
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
