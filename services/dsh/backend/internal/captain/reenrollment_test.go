package captain

import (
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestPartnerJoiningStateAllowsReenrollmentOnlyWhileAccessRemainsEligible(t *testing.T) {
	for _, state := range []string{"submitted", "needs_correction", "approved"} {
		if !partnerJoiningStateAllowsReenrollment(state) {
			t.Errorf("partner in %q must retain the governed correction or operation access path", state)
		}
	}
	for _, state := range []string{"", "draft", "rejected", "closed"} {
		if partnerJoiningStateAllowsReenrollment(state) {
			t.Errorf("partner in %q must not be re-enrolled without current DSH eligibility", state)
		}
	}
}

func TestCaptainAdmissionMustBeEligibleAndReviewedBeforeReenrollment(t *testing.T) {
	for _, admission := range []postgres.CaptainAdmission{
		{State: "pending", RequiresProfileReview: false},
		{State: "suspended", RequiresProfileReview: false},
		{State: "eligible", RequiresProfileReview: true},
	} {
		if captainAdmissionAllowsReenrollment(admission) {
			t.Errorf("captain admission %+v must not be re-enrolled", admission)
		}
	}
	if !captainAdmissionAllowsReenrollment(postgres.CaptainAdmission{State: "eligible"}) {
		t.Fatal("a reviewed eligible Captain must retain the governed recovery path")
	}
}
