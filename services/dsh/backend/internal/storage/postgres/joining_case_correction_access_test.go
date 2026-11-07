package postgres

import "testing"

func TestJoiningCaseCorrectionActorAllowed(t *testing.T) {
	const ownPhone = "+967777123456"
	cases := []struct {
		name    string
		record  JoiningCaseRecord
		request CorrectJoiningCaseInput
		allowed bool
	}{
		{name: "verified applicant", record: JoiningCaseRecord{Origin: "self_service", ContactPhoneE164: ownPhone}, request: CorrectJoiningCaseInput{ActorID: "applicant", ApplicantActorID: "applicant", ApplicantPhone: ownPhone}, allowed: true},
		{name: "switched actor", record: JoiningCaseRecord{Origin: "self_service", ContactPhoneE164: ownPhone}, request: CorrectJoiningCaseInput{ActorID: "other", ApplicantActorID: "applicant", ApplicantPhone: ownPhone}},
		{name: "phone changed", record: JoiningCaseRecord{Origin: "self_service", ContactPhoneE164: ownPhone}, request: CorrectJoiningCaseInput{ActorID: "applicant", ApplicantActorID: "applicant", ApplicantPhone: "+967777000000"}},
		{name: "missing verified phone", record: JoiningCaseRecord{Origin: "self_service", ContactPhoneE164: ownPhone}, request: CorrectJoiningCaseInput{ActorID: "applicant", ApplicantActorID: "applicant"}},
		{name: "operator case never applicant owned", record: JoiningCaseRecord{Origin: "operator", ContactPhoneE164: ownPhone}, request: CorrectJoiningCaseInput{ActorID: "applicant", ApplicantActorID: "applicant", ApplicantPhone: ownPhone}},
		{name: "field case never applicant owned", record: JoiningCaseRecord{Origin: "field", ContactPhoneE164: ownPhone}, request: CorrectJoiningCaseInput{ActorID: "applicant", ApplicantActorID: "applicant", ApplicantPhone: ownPhone}},
		{name: "existing partner owner", record: JoiningCaseRecord{Origin: "operator", PartnerActorID: "partner"}, request: CorrectJoiningCaseInput{ActorID: "partner"}, allowed: true},
		{name: "different partner", record: JoiningCaseRecord{Origin: "operator", PartnerActorID: "partner"}, request: CorrectJoiningCaseInput{ActorID: "other"}},
		{name: "missing actor", record: JoiningCaseRecord{Origin: "self_service", ContactPhoneE164: ownPhone}, request: CorrectJoiningCaseInput{ApplicantPhone: ownPhone}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := joiningCaseCorrectionActorAllowed(tc.record, tc.request); got != tc.allowed {
				t.Fatalf("allowed=%v, want %v", got, tc.allowed)
			}
		})
	}
}
