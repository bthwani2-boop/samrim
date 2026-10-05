// Package walletfacts derives the canonical official-wallet Identity facts that WLT
// accepts for protected financial mutations. One owner: every caller (partner
// self-service, Operator destination management, Store payout-recipient selection)
// resolves the same phone + verified legal name through this package; public clients
// never provide these facts.
package walletfacts

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var PhoneE164Pattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

var ErrOfficialWalletIdentityNotVerified = errors.New("official wallet identity is not verified")

// CanonicalPhone validates the only phone that may back an official wallet
// destination for the actor role snapshot.
func CanonicalPhone(actorType, actorID string, role identityclient.ActorRoleView) (string, bool) {
	phone := strings.TrimSpace(role.PhoneE164)
	if role.ActorID != actorID || role.Role != identityclient.ActorType(actorType) || role.ActorVersion < 1 || role.RoleVersion < 1 || !role.Enabled || !role.SecurityEnabled || role.ActivatedAt == nil || !PhoneE164Pattern.MatchString(phone) {
		return "", false
	}
	return phone, true
}

// CanonicalName validates the verified legal name that may back an official wallet
// destination.
func CanonicalName(actorID string, legalName identityclient.ActorLegalName) (string, int, bool) {
	if legalName.ActorID != actorID || legalName.Status != "VERIFIED" || legalName.Version < 1 {
		return "", 0, false
	}
	parts := []string{legalName.GivenName, legalName.SecondName, legalName.ThirdName, legalName.FamilyName}
	for index := range parts {
		parts[index] = strings.TrimSpace(parts[index])
		if parts[index] == "" {
			return "", 0, false
		}
	}
	name := strings.Join(parts, " ")
	if utf8.RuneCountInString(name) > 320 {
		return "", 0, false
	}
	return name, legalName.Version, true
}

// CurrentFacts resolves the canonical facts for one actor immediately before a
// protected mutation.
func CurrentFacts(ctx context.Context, identity *identityintegration.Client, actorType, actorID, actingOperatorID string) (wlt.IdentityFacts, error) {
	actorID = strings.TrimSpace(actorID)
	actorType = strings.ToLower(strings.TrimSpace(actorType))
	identityRole := actorType
	if actorType == "customer" {
		identityRole = "client"
	}
	role, err := identity.ReadActorRole(ctx, actorID, identityRole)
	if err != nil {
		return wlt.IdentityFacts{}, err
	}
	if role.ActorID != actorID || role.Role != identityclient.ActorType(identityRole) || !role.Enabled || !role.SecurityEnabled || role.ActivatedAt == nil || role.ActorVersion < 1 || role.RoleVersion < 1 {
		return wlt.IdentityFacts{}, ErrOfficialWalletIdentityNotVerified
	}
	phone, validPhone := CanonicalPhone(identityRole, actorID, role)
	if !validPhone {
		return wlt.IdentityFacts{}, ErrOfficialWalletIdentityNotVerified
	}
	legalName, err := identity.ReadVerifiedActorLegalName(ctx, actorID, strings.TrimSpace(actingOperatorID))
	if err != nil {
		return wlt.IdentityFacts{}, err
	}
	name, nameVersion, validName := CanonicalName(actorID, legalName)
	if !validName {
		return wlt.IdentityFacts{}, ErrOfficialWalletIdentityNotVerified
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
