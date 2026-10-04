package transporthttp

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var errOfficialWalletIdentityNotVerified = errors.New("official wallet identity is not verified")

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
	actorID = strings.TrimSpace(actorID)
	actorType = strings.ToLower(strings.TrimSpace(actorType))
	identityRole := actorType
	if actorType == "customer" {
		identityRole = "client"
	}
	role, err := s.identity.ReadActorRole(ctx, actorID, identityRole)
	if err != nil {
		return wlt.IdentityFacts{}, fmt.Errorf("read current official-wallet actor role: %w", err)
	}
	if role.ActorID != actorID || role.Role != identityclient.ActorType(identityRole) || !role.Enabled || !role.SecurityEnabled || role.ActivatedAt == nil || role.ActorVersion < 1 || role.RoleVersion < 1 {
		return wlt.IdentityFacts{}, errOfficialWalletIdentityNotVerified
	}
	phone, validPhone := canonicalOfficialWalletPhone(identityRole, actorID, role)
	if !validPhone {
		return wlt.IdentityFacts{}, errOfficialWalletIdentityNotVerified
	}
	legalName, err := s.identity.ReadVerifiedActorLegalName(ctx, actorID, strings.TrimSpace(actingOperatorID))
	if err != nil {
		return wlt.IdentityFacts{}, fmt.Errorf("read current official-wallet legal name: %w", err)
	}
	name, nameVersion, validName := canonicalOfficialWalletName(actorID, legalName)
	if !validName {
		return wlt.IdentityFacts{}, errOfficialWalletIdentityNotVerified
	}
	return wlt.IdentityFacts{
		ActorType:           actorType,
		ActorID:             actorID,
		PhoneE164:           phone,
		ActorVersion:        role.ActorVersion,
		RoleVersion:         role.RoleVersion,
		RoleEnabled:         role.Enabled,
		SecurityEnabled:     role.SecurityEnabled,
		OfficialName:        name,
		OfficialNameVersion: nameVersion,
		OfficialNameStatus:  legalName.Status,
	}, nil
}
