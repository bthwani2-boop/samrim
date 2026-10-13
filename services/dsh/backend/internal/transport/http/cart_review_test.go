package transporthttp

import (
	"testing"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func TestCartReviewFlagSurvivesHTTPContractMapping(t *testing.T) {
	result := toCart(postgres.CartRecord{
		ID: "cart-1",
		Lines: []postgres.CartLineRecord{{
			ID:                        "line-1",
			SelectedModifierOptionIDs: []string{"old-option"},
			SelectedModifiers:         []postgres.CartLineModifierRecord{},
			RequiresReview:            true,
			UnitPriceMinor:            100,
			LineAmountMinor:           300,
		}},
	})
	if len(result.Lines) != 1 || !result.Lines[0].RequiresReview {
		t.Fatalf("invalid modifier review state missing from API response: %+v", result.Lines)
	}
	if result.Lines[0].SelectedModifiers == nil {
		t.Fatal("selectedModifiers must remain a non-null array on recovery")
	}
	if result.Lines[0].LineAmountMinor != 300 {
		t.Fatalf("base price must remain valid schema data, got %d", result.Lines[0].LineAmountMinor)
	}
}
