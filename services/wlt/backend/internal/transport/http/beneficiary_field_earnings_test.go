package http

import (
	"encoding/json"
	"testing"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

func TestPayoutStateJSONProjectsFieldEarningsAndOmitsThemForOtherActors(t *testing.T) {
	count, earned := int64(0), int64(725)
	field, err := json.Marshal(toPayoutState(postgres.PayoutStateRecord{
		ActorType: "field", ActorID: "field-1", Currency: "YER",
		AcquiredStoreCount: &count, EarnedMinor: &earned,
	}))
	if err != nil {
		t.Fatal(err)
	}
	var fieldPayload map[string]any
	if err := json.Unmarshal(field, &fieldPayload); err != nil {
		t.Fatal(err)
	}
	if fieldPayload["acquiredStoreCount"] != float64(0) || fieldPayload["earnedMinor"] != float64(725) {
		t.Fatalf("Field payout state omitted canonical acquisition metrics: %s", field)
	}

	for _, actorType := range []string{"partner", "captain"} {
		payload, err := json.Marshal(toPayoutState(postgres.PayoutStateRecord{ActorType: actorType, ActorID: actorType + "-1", Currency: "YER"}))
		if err != nil {
			t.Fatal(err)
		}
		var decoded map[string]any
		if err := json.Unmarshal(payload, &decoded); err != nil {
			t.Fatal(err)
		}
		if _, exists := decoded["acquiredStoreCount"]; exists {
			t.Fatalf("%s payout state unexpectedly included acquiredStoreCount: %s", actorType, payload)
		}
		if _, exists := decoded["earnedMinor"]; exists {
			t.Fatalf("%s payout state unexpectedly included earnedMinor: %s", actorType, payload)
		}
	}
}
