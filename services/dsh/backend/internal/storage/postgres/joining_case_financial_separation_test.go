package postgres

import "testing"

func TestPartnerReviewSeparatesAdmissionFromFinancialBinding(t *testing.T) {
	lat, lng := 15.37, 44.21
	current := JoiningCaseRecord{
		ID: "case-test", Version: 4, State: "submitted", PartnerActorID: "partner-a",
		OwnerFullName: "Partner owner", BusinessName: "General supplies",
		FirstStoreName: "General supplies shop", FirstStoreAddress: "Sanaa",
		FirstStoreProofType: "IDENTITY_DOCUMENT", FirstStoreProofNumberPresent: true,
		FirstStoreServiceCityID: "sanaa", FirstStoreVerticalID: "market",
		FirstStoreCommercialTypeID: "shop",
		FirstStoreLatitude:         &lat, FirstStoreLongitude: &lng,
		FirstStoreFulfillmentModes: []string{"CUSTOMER_PICKUP"},
	}
	for _, tc := range []struct {
		name  string
		input ReviewJoiningCaseInput
		want  bool
	}{
		{"Partners approval without financial terms", ReviewJoiningCaseInput{Decision: "approved", ExpectedVersion: 4, ActingActorID: "operator-a"}, true},
		{"Partners correction without financial terms", ReviewJoiningCaseInput{Decision: "needs_correction", ExpectedVersion: 4, ActingActorID: "operator-a", CorrectionReason: "Correct identification"}, true},
		{"cannot smuggle financial policy", ReviewJoiningCaseInput{Decision: "approved", ExpectedVersion: 4, ActingActorID: "operator-a", TermsPolicyVersion: "partner-financial-terms:v1", SettlementPeriod: "WEEKLY"}, false},
		{"cannot bind period during approval", ReviewJoiningCaseInput{Decision: "approved", ExpectedVersion: 4, ActingActorID: "operator-a", SettlementPeriod: "WEEKLY"}, false},
		{"cannot approve self", ReviewJoiningCaseInput{Decision: "approved", ExpectedVersion: 4, ActingActorID: "partner-a"}, false},
		{"stale optimistic version", ReviewJoiningCaseInput{Decision: "approved", ExpectedVersion: 3, ActingActorID: "operator-a"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := validateJoiningCaseReview(current, tc.input)
			if (err == nil) != tc.want {
				t.Fatalf("got err=%v want valid=%v", err, tc.want)
			}
		})
	}
}
