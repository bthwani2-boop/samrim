package transporthttp

import (
	"encoding/json"
	"testing"

	wlt "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
)

func TestBeneficiaryPayoutStatePresentationPreservesFieldEarningsOnly(t *testing.T) {
	count, earned := int64(3), int64(725)
	field, err := json.Marshal(beneficiaryPayoutStatePresentation{PayoutState: wlt.PayoutState{
		ActorType: "field", ActorID: "field-1", Currency: "YER",
		AcquiredStoreCount: &count, EarnedMinor: &earned,
	}})
	if err != nil {
		t.Fatal(err)
	}
	var fieldPayload map[string]any
	if err := json.Unmarshal(field, &fieldPayload); err != nil {
		t.Fatal(err)
	}
	if fieldPayload["acquiredStoreCount"] != float64(3) || fieldPayload["earnedMinor"] != float64(725) {
		t.Fatalf("Field Finance presentation dropped WLT acquisition metrics: %s", field)
	}

	for _, actorType := range []string{"partner", "captain"} {
		payload, err := json.Marshal(beneficiaryPayoutStatePresentation{PayoutState: wlt.PayoutState{ActorType: actorType, ActorID: actorType + "-1", Currency: "YER"}})
		if err != nil {
			t.Fatal(err)
		}
		var decoded map[string]any
		if err := json.Unmarshal(payload, &decoded); err != nil {
			t.Fatal(err)
		}
		for _, field := range []string{"acquiredStoreCount", "earnedMinor"} {
			if _, exists := decoded[field]; exists {
				t.Fatalf("%s presentation unexpectedly included %s: %s", actorType, field, payload)
			}
		}
	}
}

func TestFieldFinanceRosterPresentationIncludesAdmissionStateAndGlobalWLTTotal(t *testing.T) {
	count, earned := int64(0), int64(0)
	payload, err := json.Marshal(fieldFinanceRosterPresentation{
		Beneficiaries: []beneficiaryPayoutStatePresentation{{
			PayoutState:         wlt.PayoutState{ActorType: "field", ActorID: "field-1", Currency: "YER", AcquiredStoreCount: &count, EarnedMinor: &earned},
			FieldAdmissionState: "suspended",
		}},
		TotalCount:          1,
		FieldFinanceSummary: wlt.FieldFinanceSummary{Currency: "YER", FieldActorCount: 2, EarnedMinor: 500},
	})
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatal(err)
	}
	beneficiaries := decoded["beneficiaries"].([]any)
	row := beneficiaries[0].(map[string]any)
	if row["fieldAdmissionState"] != "suspended" || row["acquiredStoreCount"] != float64(0) || row["earnedMinor"] != float64(0) {
		t.Fatalf("Field roster projection dropped state or zero aggregates: %s", payload)
	}
	summary := decoded["fieldFinanceSummary"].(map[string]any)
	if summary["fieldActorCount"] != float64(2) || summary["earnedMinor"] != float64(500) {
		t.Fatalf("Field roster projection dropped global WLT totals: %s", payload)
	}
}
