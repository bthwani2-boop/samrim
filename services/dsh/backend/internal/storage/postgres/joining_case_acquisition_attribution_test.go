package postgres

import "testing"

func TestCanAttributeJoiningCaseAcquisition(t *testing.T) {
	for _, tc := range []struct {
		name       string
		caseRecord JoiningCaseRecord
		eligible   bool
	}{
		{"operator draft", JoiningCaseRecord{Origin: "control_panel", State: "draft"}, true},
		{"self service draft", JoiningCaseRecord{Origin: "self_service", State: "draft"}, true},
		{"self service submitted", JoiningCaseRecord{Origin: "self_service", State: "submitted", PartnerActorID: "partner-a"}, true},
		{"self service correction", JoiningCaseRecord{Origin: "self_service", State: "needs_correction", PartnerActorID: "partner-a"}, true},
		{"field already owns source", JoiningCaseRecord{Origin: "field", State: "draft"}, false},
		{"already attributed", JoiningCaseRecord{Origin: "self_service", State: "draft", OriginatingFieldActorID: "field-a"}, false},
		{"approved", JoiningCaseRecord{Origin: "self_service", State: "approved"}, false},
		{"store already exists", JoiningCaseRecord{Origin: "self_service", State: "draft", StoreID: "store-a"}, false},
		{"unknown origin", JoiningCaseRecord{Origin: "other", State: "draft"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := CanAttributeJoiningCaseAcquisition(tc.caseRecord)
			if got != tc.eligible {
				t.Fatalf("eligible=%v want %v", got, tc.eligible)
			}
		})
	}
}
