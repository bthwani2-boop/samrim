package transporthttp

import (
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
)

func normalizeFieldFinancePayoutStatus(raw string) (string, bool) {
	status := strings.ToUpper(strings.TrimSpace(raw))
	switch status {
	case "", "NO_REQUEST", "HELD", "CANCELLED", "PREPARED", "APPROVED", "FROZEN", "EXECUTED", "COMPLETED", "EXCEPTION":
		return status, true
	default:
		return "", false
	}
}

func fieldFinanceStateMatchesPayoutStatus(state wlt.PayoutState, status string) bool {
	if status == "" {
		return true
	}
	if status == "NO_REQUEST" {
		return state.LatestPayout == nil
	}
	return state.LatestPayout != nil && state.LatestPayout.Status == status
}
