package transporthttp

import (
	"context"
	"errors"
	"net/http"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/walletfacts"
)

var errOfficialWalletIdentityNotVerified = walletfacts.ErrOfficialWalletIdentityNotVerified

func writeOfficialWalletIdentityReadError(w http.ResponseWriter, err error) {
	if errors.Is(err, errOfficialWalletIdentityNotVerified) {
		writeError(w, http.StatusConflict, "REVERIFICATION_REQUIRED", "verify the beneficiary's current phone and legal name before continuing")
		return
	}
	writeIdentityError(w, err)
}

// readCurrentOfficialWalletIdentityFacts resolves the only phone and name that
// may be used for an official wallet destination. Callers pass these facts to
// WLT over the authenticated service connection; public clients never provide
// them.
func (s *BeneficiaryFinanceServer) readCurrentOfficialWalletIdentityFacts(ctx context.Context, actorType, actorID, actingOperatorID string) (wlt.IdentityFacts, error) {
	return walletfacts.CurrentFacts(ctx, s.identity, actorType, actorID, actingOperatorID)
}
