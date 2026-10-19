package financialhandoff

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
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

func TestReconcileHandoffsContinuesAndReturnsMarkedFailures(t *testing.T) {
	items := []postgres.FinancialHandoffOutbox{{ID: "first"}, {ID: "second"}}
	var applied, failed, posted []string
	apply := func(_ context.Context, item postgres.FinancialHandoffOutbox) error {
		applied = append(applied, item.ID)
		if item.ID == "first" {
			return errors.New("source unavailable")
		}
		return nil
	}
	markFailure := func(_ context.Context, item postgres.FinancialHandoffOutbox, cause error) error {
		if cause == nil {
			t.Fatal("expected failure cause")
		}
		failed = append(failed, item.ID)
		return nil
	}
	markPosted := func(_ context.Context, item postgres.FinancialHandoffOutbox) error {
		posted = append(posted, item.ID)
		return nil
	}

	err := reconcileHandoffs(context.Background(), items, apply, markFailure, markPosted)
	if err == nil || !strings.Contains(err.Error(), "1 item(s)") || !strings.Contains(err.Error(), "first") {
		t.Fatalf("reconcileHandoffs() error = %v, want summarized failure for first item", err)
	}
	if !reflect.DeepEqual(applied, []string{"first", "second"}) || !reflect.DeepEqual(failed, []string{"first"}) || !reflect.DeepEqual(posted, []string{"second"}) {
		t.Fatalf("unexpected batch effects: applied=%v failed=%v posted=%v", applied, failed, posted)
	}
}
