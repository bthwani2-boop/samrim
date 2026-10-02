package financialhandoff

import (
	"testing"

	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
)

func TestCollectionActorMatchesCanonicalAllocationSemantics(t *testing.T) {
	empty := ""
	captain := "captain-1"
	other := "captain-2"

	tests := []struct {
		name      string
		amount    int64
		actor     string
		collected *string
		wantMatch bool
	}{
		{name: "zero allocation requires null collector", amount: 0, actor: "", collected: nil, wantMatch: true},
		{name: "zero allocation rejects empty collector", amount: 0, actor: "", collected: &empty, wantMatch: false},
		{name: "positive allocation accepts matching collector", amount: 4300, actor: captain, collected: &captain, wantMatch: true},
		{name: "positive allocation rejects different collector", amount: 4300, actor: captain, collected: &other, wantMatch: false},
		{name: "positive allocation rejects missing collector", amount: 4300, actor: captain, collected: nil, wantMatch: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			intent := wltintegration.PaymentIntent{CollectedByActorID: tt.collected}
			if got := collectionActorMatches(intent, tt.actor, tt.amount); got != tt.wantMatch {
				t.Fatalf("collectionActorMatches() = %v, want %v", got, tt.wantMatch)
			}
		})
	}
}
