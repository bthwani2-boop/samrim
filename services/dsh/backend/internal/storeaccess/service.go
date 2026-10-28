package storeaccess

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	wltintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/walletfacts"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var (
	ErrInvalidInput           = errors.New("Store access input is invalid")
	ErrPartnerSession         = errors.New("an active app-partner session is required")
	ErrInvitationActorSession = errors.New("an active eligible Human Actor session is required")
	ErrOperatorPermission     = errors.New("an active Operator with Partners permission is required")
	ErrActorSecurityDisabled  = errors.New("the invited Actor must have account security enabled")
	ErrStoreOwnership         = errors.New("only the Store owner may manage store payout recipients")
	ErrGrantNotActive         = errors.New("the selected team member does not have an active grant on this Store")
)

type StorePayoutBeneficiaryProfile struct {
	BeneficiaryName        string `json:"beneficiaryName,omitempty"`
	PhoneMasked            string `json:"phoneMasked,omitempty"`
	ProviderKey            string `json:"providerKey,omitempty"`
	WalletIdentifierMasked string `json:"walletIdentifierMasked,omitempty"`
}

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
	wlt      *wltintegration.Client
}

func New(identity *identityintegration.Client, db *sql.DB, wlt *wltintegration.Client) (*Service, error) {
	if identity == nil || db == nil || wlt == nil {
		return nil, errors.New("Store access configuration is invalid")
	}
	return &Service{identity: identity, db: db, wlt: wlt}, nil
}

func (s *Service) CreateForPartner(ctx context.Context, accessToken, storeID, delegatePhone, displayNameAr string, permissions []string, idempotencyKey, correlationID string) (postgres.StoreAccessGrant, bool, error) {
	actorID, err := s.partnerActor(ctx, accessToken)
	if err != nil {
		return postgres.StoreAccessGrant{}, false, err
	}
	if !validMutation(idempotencyKey, correlationID) {
		return postgres.StoreAccessGrant{}, false, ErrInvalidInput
	}
	// Authorization and validation must precede the Identity side effect.
	if _, err := postgres.ReadStoreOwnedByPartner(ctx, s.db, strings.TrimSpace(storeID), actorID); err != nil {
		return postgres.StoreAccessGrant{}, false, postgres.ErrStoreAccessForbidden
	}
	phone, err := identityintegration.NormalizeInvitePhone(delegatePhone)
	if err != nil || !postgres.ValidStorePermissionSet(permissions) ||
		utf8.RuneCountInString(strings.TrimSpace(displayNameAr)) > 80 {
		return postgres.StoreAccessGrant{}, false, ErrInvalidInput
	}
	// Identity provisioning cannot give Store access. The member verifies
	// their own phone and accepts the Store grant before DSH authorizes actions.
	resolvedActor, err := s.identity.ProvisionPartnerWithContext(ctx, identityintegration.ActorInput{PhoneE164: phone}, correlationID, actorID)
	if err != nil {
		return postgres.StoreAccessGrant{}, false, err
	}
	if !resolvedActor.SecurityEnabled {
		return postgres.StoreAccessGrant{}, false, ErrActorSecurityDisabled
	}
	grant, replayed, err := postgres.CreateStoreAccessInvitationNamed(ctx, s.db, storeID, actorID, resolvedActor.ActorID, displayNameAr, permissions, idempotencyKey, correlationID)
	if err != nil {
		return postgres.StoreAccessGrant{}, false, err
	}
	grant.DelegatePhoneMasked = maskStoreAccessPhone(resolvedActor.PhoneE164)
	return grant, replayed, nil
}

func (s *Service) ListForOwner(ctx context.Context, accessToken, storeID string) ([]postgres.StoreAccessGrant, error) {
	actorID, err := s.partnerActor(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	grants, err := postgres.ListStoreAccessGrants(ctx, s.db, storeID, actorID)
	if err != nil {
		return nil, err
	}
	return s.addMaskedDelegatePhones(ctx, grants)
}

func (s *Service) ListForDelegate(ctx context.Context, accessToken string) ([]postgres.StoreAccessGrant, error) {
	actorID, _, err := s.invitationActor(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	return postgres.ListDelegateStoreAccessInvitations(ctx, s.db, actorID)
}

func (s *Service) ListAccessibleStores(ctx context.Context, accessToken string, limit int, cursor string) (postgres.PartnerAccessibleStorePage, error) {
	actorID, err := s.partnerActor(ctx, accessToken)
	if err != nil {
		return postgres.PartnerAccessibleStorePage{}, err
	}
	return postgres.ListPartnerAccessibleStores(ctx, s.db, actorID, limit, cursor)
}

func (s *Service) DecideForDelegate(ctx context.Context, accessToken, grantID, decision string, expectedVersion int, idempotencyKey, correlationID string) (postgres.StoreAccessGrant, bool, error) {
	actorID, partnerSession, err := s.invitationActor(ctx, accessToken)
	if err != nil {
		return postgres.StoreAccessGrant{}, false, err
	}
	if !validMutation(idempotencyKey, correlationID) || expectedVersion < 1 {
		return postgres.StoreAccessGrant{}, false, ErrInvalidInput
	}
	acceptedState := ""
	if decision == "accept" {
		if partnerSession {
			acceptedState = "active"
		} else {
			role, roleErr := s.identity.ReadActorRole(ctx, actorID, "partner")
			if roleErr != nil {
				if !identityNotFound(roleErr) {
					return postgres.StoreAccessGrant{}, false, roleErr
				}
				acceptedState = "pending_role_admission"
			} else {
				if role.ActorID != actorID || role.Role != "partner" {
					return postgres.StoreAccessGrant{}, false, postgres.ErrStoreAccessForbidden
				}
				if !role.SecurityEnabled {
					return postgres.StoreAccessGrant{}, false, ErrActorSecurityDisabled
				}
				if role.Enabled {
					acceptedState = "pending_partner_activation"
				} else {
					acceptedState = "pending_role_admission"
				}
			}
		}
	}
	return postgres.DecideStoreAccessInvitation(ctx, s.db, grantID, actorID, decision, acceptedState, expectedVersion, idempotencyKey, correlationID)
}

func (s *Service) ActivateForDelegate(ctx context.Context, accessToken, grantID string, expectedVersion int, idempotencyKey, correlationID string) (postgres.StoreAccessGrant, bool, error) {
	actorID, err := s.partnerActor(ctx, accessToken)
	if err != nil {
		return postgres.StoreAccessGrant{}, false, err
	}
	if !validMutation(idempotencyKey, correlationID) || expectedVersion < 1 {
		return postgres.StoreAccessGrant{}, false, ErrInvalidInput
	}
	return postgres.ConfirmStoreAccessPartnerActivation(ctx, s.db, grantID, actorID, expectedVersion, idempotencyKey, correlationID)
}

func (s *Service) TransitionForOwner(ctx context.Context, accessToken, storeID, grantID, targetState string, expectedVersion int, idempotencyKey, correlationID string) (postgres.StoreAccessGrant, bool, error) {
	actorID, err := s.partnerActor(ctx, accessToken)
	if err != nil {
		return postgres.StoreAccessGrant{}, false, err
	}
	if !validMutation(idempotencyKey, correlationID) || expectedVersion < 1 {
		return postgres.StoreAccessGrant{}, false, ErrInvalidInput
	}
	if targetState == "revoked" || targetState == "suspended" {
		release, err := s.lockPayoutRecipientStore(ctx, storeID)
		if err != nil {
			return postgres.StoreAccessGrant{}, false, err
		}
		defer release()
		// Resolve the authorized target before touching WLT; a failed or foreign
		// DSH grant may never put someone else's payout recipient under review.
		grant, err := postgres.ReadStoreAccessGrant(ctx, s.db, grantID)
		if err != nil {
			return postgres.StoreAccessGrant{}, false, err
		}
		if grant.StoreID != storeID || grant.OwnerPartnerActorID != actorID {
			return postgres.StoreAccessGrant{}, false, postgres.ErrStoreAccessForbidden
		}
		// The original version remains valid for a replay of a committed
		// transition. The storage owner checks the actual idempotency hash.
		if grant.Version != expectedVersion && !(grant.Version == expectedVersion+1 && grant.State == targetState) {
			// A past replay may have been followed by another legal transition.
			// Let the storage owner verify its original idempotency hash, without
			// imposing a stale review on the current recipient.
			return postgres.TransitionStoreAccessGrant(ctx, s.db, storeID, actorID, grantID, targetState, expectedVersion, idempotencyKey, correlationID)
		}
		if grant.Version == expectedVersion {
			legal := (grant.State == "active" && (targetState == "suspended" || targetState == "revoked")) ||
				(grant.State == "suspended" && targetState == "revoked") ||
				((grant.State == "pending_role_admission" || grant.State == "pending_partner_activation" || grant.State == "pending_acceptance") && targetState == "revoked")
			if !legal {
				return postgres.StoreAccessGrant{}, false, postgres.ErrStoreAccessConflict
			}
		}
		// Fail closed: WLT must acknowledge a selected staff recipient's
		// REVIEW_REQUIRED state before DSH commits the permission withdrawal.
		// Otherwise an outage and no caller retry leave a revoked but payable
		// beneficiary. WLT review is idempotent for a repeated attempt.
		if err := s.markPayoutRecipientReviewIfNeeded(ctx, storeID, actorID, grant.DelegateActorID, targetState, correlationID); err != nil {
			return postgres.StoreAccessGrant{}, false, err
		}
	}
	return postgres.TransitionStoreAccessGrant(ctx, s.db, storeID, actorID, grantID, targetState, expectedVersion, idempotencyKey, correlationID)
}

func (s *Service) UpdatePermissionsForOwner(ctx context.Context, accessToken, storeID, grantID string, permissions []string, expectedVersion int, idempotencyKey, correlationID string) (postgres.StoreAccessGrant, bool, error) {
	actorID, err := s.partnerActor(ctx, accessToken)
	if err != nil {
		return postgres.StoreAccessGrant{}, false, err
	}
	if !validMutation(idempotencyKey, correlationID) || expectedVersion < 1 {
		return postgres.StoreAccessGrant{}, false, ErrInvalidInput
	}
	return postgres.UpdateStoreAccessGrantPermissions(ctx, s.db, storeID, actorID, grantID, permissions, expectedVersion, idempotencyKey, correlationID)
}

func (s *Service) ListTeamForOperator(ctx context.Context, actingActorID, ownerID, storeID string, limit int, cursor string) (postgres.StoreAccessTeamPage, error) {
	if err := s.requirePartnerAdmissionOperator(ctx, actingActorID); err != nil {
		return postgres.StoreAccessTeamPage{}, err
	}
	return postgres.ListStoreAccessTeamPage(ctx, s.db, ownerID, storeID, limit, cursor)
}

func (s *Service) ListRoleAdmissionsForOperator(ctx context.Context, actingActorID string, limit int, cursor string) (postgres.StoreAccessRoleAdmissionPage, error) {
	if err := s.requirePartnerAdmissionOperator(ctx, actingActorID); err != nil {
		return postgres.StoreAccessRoleAdmissionPage{}, err
	}
	page, err := postgres.ListPendingStoreAccessRoleAdmissionsPage(ctx, s.db, limit, cursor)
	if err != nil {
		return postgres.StoreAccessRoleAdmissionPage{}, err
	}
	// The operator needs a masked contact, not one WLT lookup per queued grant.
	page.Items, err = s.addMaskedDelegatePhones(ctx, page.Items)
	return page, err
}

func (s *Service) AdmitPartnerRoleForOperator(ctx context.Context, grantID, actingActorID, idempotencyKey, correlationID string) (postgres.StoreAccessGrant, bool, error) {
	actingActorID = strings.TrimSpace(actingActorID)
	if !validMutation(idempotencyKey, correlationID) || actingActorID == "" || len(actingActorID) > 128 {
		return postgres.StoreAccessGrant{}, false, ErrInvalidInput
	}
	if err := s.requirePartnerAdmissionOperator(ctx, actingActorID); err != nil {
		return postgres.StoreAccessGrant{}, false, err
	}
	if replay, replayed, err := postgres.ReadStoreAccessMutationReplay(ctx, s.db, idempotencyKey, "role_admission_confirm", actingActorID, grantID); err == nil {
		return replay, replayed, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return postgres.StoreAccessGrant{}, false, err
	}
	grant, err := postgres.ReadStoreAccessGrant(ctx, s.db, grantID)
	if err != nil {
		return postgres.StoreAccessGrant{}, false, err
	}
	if grant.State != "pending_role_admission" || grant.Version < 1 {
		if grant.State == "expired" {
			return postgres.StoreAccessGrant{}, false, postgres.ErrStoreAccessExpired
		}
		return postgres.StoreAccessGrant{}, false, postgres.ErrStoreAccessConflict
	}
	role, err := s.identity.ReadActorRole(ctx, grant.DelegateActorID, "partner")
	roleChanged := false
	if err != nil {
		if !identityNotFound(err) {
			return postgres.StoreAccessGrant{}, false, err
		}
		role, err = s.identity.ProvisionExistingPartnerWithContext(ctx, grant.DelegateActorID, correlationID, actingActorID)
		if err != nil {
			return postgres.StoreAccessGrant{}, false, err
		}
		roleChanged = role.RoleCreated
	} else if role.ActorID == grant.DelegateActorID && role.Role == "partner" && !role.Enabled {
		if !role.SecurityEnabled {
			return postgres.StoreAccessGrant{}, false, ErrActorSecurityDisabled
		}
		if err := s.identity.SetRoleEnabledWithContext(ctx, grant.DelegateActorID, "partner", true, correlationID, "accepted Store access invitation requires Partner workspace admission", actingActorID, role.RoleVersion); err != nil {
			return postgres.StoreAccessGrant{}, false, err
		}
		roleChanged = true
		role, err = s.identity.ReadActorRole(ctx, grant.DelegateActorID, "partner")
		if err != nil {
			return postgres.StoreAccessGrant{}, false, err
		}
	}
	if role.Role != "partner" || role.ActorID != grant.DelegateActorID || !role.Enabled || !role.SecurityEnabled {
		return postgres.StoreAccessGrant{}, false, postgres.ErrStoreAccessForbidden
	}
	confirmed, replayed, confirmErr := postgres.ConfirmStoreAccessRoleAdmission(ctx, s.db, grant.ID, actingActorID, grant.Version, idempotencyKey, correlationID)
	if confirmErr == nil {
		return confirmed, replayed, nil
	}
	canonical, readErr := postgres.ReadStoreAccessGrant(ctx, s.db, grant.ID)
	if readErr != nil {
		return postgres.StoreAccessGrant{}, false, errors.Join(confirmErr, readErr)
	}
	if canonical.State == "pending_partner_activation" && canonical.DelegateActorID == grant.DelegateActorID && canonical.StoreID == grant.StoreID {
		return canonical, true, nil
	}
	if canonical.State == "pending_role_admission" {
		confirmed, replayed, confirmErr = postgres.ConfirmStoreAccessRoleAdmission(ctx, s.db, canonical.ID, actingActorID, canonical.Version, idempotencyKey, correlationID)
		if confirmErr == nil {
			return confirmed, replayed, nil
		}
		canonical, readErr = postgres.ReadStoreAccessGrant(ctx, s.db, grant.ID)
		if readErr != nil {
			return postgres.StoreAccessGrant{}, false, errors.Join(confirmErr, readErr)
		}
		if canonical.State == "pending_partner_activation" && canonical.DelegateActorID == grant.DelegateActorID && canonical.StoreID == grant.StoreID {
			return canonical, true, nil
		}
	}
	if roleChanged {
		eligible, eligibilityErr := postgres.HasPartnerWorkspaceEligibility(ctx, s.db, grant.DelegateActorID)
		if eligibilityErr != nil {
			return postgres.StoreAccessGrant{}, false, errors.Join(confirmErr, eligibilityErr)
		}
		if !eligible {
			if disableErr := s.identity.SetRoleEnabledWithContext(ctx, grant.DelegateActorID, "partner", false, correlationID, "store access admission did not complete", actingActorID, role.RoleVersion); disableErr != nil {
				return postgres.StoreAccessGrant{}, false, errors.Join(confirmErr, disableErr)
			}
			roleReadback, readbackErr := s.identity.ReadActorRole(ctx, grant.DelegateActorID, "partner")
			if readbackErr != nil || roleReadback.Enabled {
				if readbackErr == nil {
					readbackErr = errors.New("Identity did not confirm the newly provisioned Partner role was disabled")
				}
				return postgres.StoreAccessGrant{}, false, errors.Join(confirmErr, readbackErr)
			}
		}
	}
	return postgres.StoreAccessGrant{}, false, confirmErr
}

func (s *Service) invitationActor(ctx context.Context, accessToken string) (string, bool, error) {
	accessToken = strings.TrimSpace(accessToken)
	if accessToken == "" {
		return "", false, ErrInvitationActorSession
	}
	identity, err := s.identity.ReadSession(ctx, accessToken)
	if err != nil {
		return "", false, err
	}
	actorID := strings.TrimSpace(identity.Subject)
	surfaceByRole := map[string]string{
		"client":  "app-client",
		"partner": "app-partner",
		"captain": "app-captain",
	}
	if actorID == "" || surfaceByRole[identity.Role] == "" || surfaceByRole[identity.Role] != identity.Surface {
		return "", false, ErrInvitationActorSession
	}
	return actorID, identity.Role == "partner", nil
}

func (s *Service) partnerActor(ctx context.Context, accessToken string) (string, error) {
	accessToken = strings.TrimSpace(accessToken)
	if accessToken == "" {
		return "", ErrPartnerSession
	}
	identity, err := s.identity.ReadSession(ctx, accessToken)
	if err != nil {
		return "", err
	}
	actorID := strings.TrimSpace(identity.Subject)
	if identity.Role != "partner" || identity.Surface != "app-partner" || actorID == "" {
		return "", ErrPartnerSession
	}
	return actorID, nil
}

func (s *Service) requirePartnerAdmissionOperator(ctx context.Context, actorID string) error {
	actorID = strings.TrimSpace(actorID)
	if actorID == "" || len(actorID) > 128 {
		return ErrInvalidInput
	}
	role, err := s.identity.ReadActorRole(ctx, actorID, "operator")
	if err != nil {
		return err
	}
	if role.Role != "operator" || !role.Enabled || !role.SecurityEnabled || role.ActivatedAt == nil {
		return ErrOperatorPermission
	}
	permission, err := s.identity.ReadOperatorPermission(ctx, actorID, "partners")
	if err != nil {
		return err
	}
	if !permission.Enabled {
		return ErrOperatorPermission
	}
	return nil
}

func validMutation(idempotencyKey, correlationID string) bool {
	return len(strings.TrimSpace(idempotencyKey)) >= 8 && len(strings.TrimSpace(idempotencyKey)) <= 128 &&
		len(strings.TrimSpace(correlationID)) >= 8 && len(strings.TrimSpace(correlationID)) <= 128
}

func identityNotFound(err error) bool {
	var identityErr *identityclient.Error
	return errors.As(err, &identityErr) && identityErr.Status == 404
}

var storeAccessPhoneE164Pattern = regexp.MustCompile(`^\+[1-9][0-9]{7,14}$`)

func (s *Service) addMaskedDelegatePhones(ctx context.Context, grants []postgres.StoreAccessGrant) ([]postgres.StoreAccessGrant, error) {
	actorIDs := make([]string, 0, len(grants))
	seen := make(map[string]struct{}, len(grants))
	for _, grant := range grants {
		if grant.DelegateActorID == "" {
			continue
		}
		if _, exists := seen[grant.DelegateActorID]; exists {
			continue
		}
		seen[grant.DelegateActorID] = struct{}{}
		actorIDs = append(actorIDs, grant.DelegateActorID)
	}
	phones := make(map[string]string, len(actorIDs))
	for start := 0; start < len(actorIDs); start += 100 {
		end := start + 100
		if end > len(actorIDs) {
			end = len(actorIDs)
		}
		roles, err := s.identity.ReadActorRoles(ctx, "client", actorIDs[start:end])
		if err != nil {
			return nil, err
		}
		for _, role := range roles.Items {
			if role.Role == "client" && role.ActorID != "" && storeAccessPhoneE164Pattern.MatchString(role.PhoneE164) {
				phones[role.ActorID] = maskStoreAccessPhone(role.PhoneE164)
			}
		}
	}
	for index := range grants {
		grants[index].DelegatePhoneMasked = phones[grants[index].DelegateActorID]
	}
	return grants, nil
}

func (s *Service) addDelegatePresentation(ctx context.Context, grants []postgres.StoreAccessGrant) ([]postgres.StoreAccessGrant, error) {
	grants, err := s.addMaskedDelegatePhones(ctx, grants)
	if err != nil {
		return nil, err
	}
	for index := range grants {
		actorID := grants[index].DelegateActorID
		destination, destinationErr := s.wlt.ReadOfficialWalletDestination(ctx, "partner", actorID)
		if destinationErr != nil {
			var wltErr *wltintegration.Error
			if errors.As(destinationErr, &wltErr) && wltErr.Status == 404 {
				continue
			}
			return nil, destinationErr
		}
		grants[index].DelegateBeneficiaryName = strings.TrimSpace(destination.BeneficiaryName)
		grants[index].DelegateWalletProviderKey = strings.TrimSpace(destination.ProviderKey)
		grants[index].DelegateWalletIdentifierMasked = strings.TrimSpace(destination.WalletIdentifierMasked)
	}
	return grants, nil
}

func maskStoreAccessPhone(phone string) string {
	if len(phone) <= 6 {
		return "***"
	}
	return phone[:4] + strings.Repeat("*", len(phone)-7) + phone[len(phone)-3:]
}

// ListStorePayoutRecipients returns the effective payout recipient per Store for the
// session's Partner actor, enriched with Store names and one canonical human-readable
// beneficiary profile per effective recipient. WLT owns the assignment truth.
func (s *Service) ListStorePayoutRecipients(ctx context.Context, accessToken string) (wltintegration.StorePayoutRecipientReadback, map[string]string, map[string]StorePayoutBeneficiaryProfile, error) {
	actorID, err := s.partnerActor(ctx, accessToken)
	if err != nil {
		return wltintegration.StorePayoutRecipientReadback{}, nil, nil, err
	}
	return s.ReadStorePayoutRecipientsForPartner(ctx, actorID)
}

// ReadStorePayoutRecipientsForPartner returns the same canonical WLT-owned payout
// recipient truth for an already-authorized Partner actor. Calling surfaces own
// authorization; this function owns only readback and human-safe enrichment.
func (s *Service) ReadStorePayoutRecipientsForPartner(ctx context.Context, partnerActorID string) (wltintegration.StorePayoutRecipientReadback, map[string]string, map[string]StorePayoutBeneficiaryProfile, error) {
	actorID := strings.TrimSpace(partnerActorID)
	if actorID == "" || len(actorID) > 128 {
		return wltintegration.StorePayoutRecipientReadback{}, nil, nil, ErrInvalidInput
	}
	readback, err := s.wlt.ListPartnerStorePayoutRecipients(ctx, actorID)
	if err != nil {
		return wltintegration.StorePayoutRecipientReadback{}, nil, nil, err
	}
	storeIDs := make([]string, 0, len(readback.Recipients))
	for _, record := range readback.Recipients {
		storeIDs = append(storeIDs, record.StoreID)
	}
	names, err := s.storeNames(ctx, storeIDs)
	if err != nil {
		return wltintegration.StorePayoutRecipientReadback{}, nil, nil, err
	}
	beneficiaryIDs := make([]string, 0, 2)
	seen := make(map[string]struct{}, 2)
	for _, record := range readback.Recipients {
		if record.BeneficiaryActorID == "" {
			continue
		}
		if _, exists := seen[record.BeneficiaryActorID]; exists {
			continue
		}
		seen[record.BeneficiaryActorID] = struct{}{}
		beneficiaryIDs = append(beneficiaryIDs, record.BeneficiaryActorID)
	}
	beneficiaryPhones, err := s.maskedPartnerPhones(ctx, beneficiaryIDs)
	if err != nil {
		return wltintegration.StorePayoutRecipientReadback{}, nil, nil, err
	}
	profiles := make(map[string]StorePayoutBeneficiaryProfile, len(beneficiaryIDs))
	for _, beneficiaryID := range beneficiaryIDs {
		profile := StorePayoutBeneficiaryProfile{PhoneMasked: beneficiaryPhones[beneficiaryID]}
		destination, destinationErr := s.wlt.ReadOfficialWalletDestination(ctx, "partner", beneficiaryID)
		if destinationErr != nil {
			var wltErr *wltintegration.Error
			if errors.As(destinationErr, &wltErr) && wltErr.Status == 404 {
				profiles[beneficiaryID] = profile
				continue
			}
			return wltintegration.StorePayoutRecipientReadback{}, nil, nil, destinationErr
		}
		profile.BeneficiaryName = strings.TrimSpace(destination.BeneficiaryName)
		profile.ProviderKey = strings.TrimSpace(destination.ProviderKey)
		profile.WalletIdentifierMasked = strings.TrimSpace(destination.WalletIdentifierMasked)
		profiles[beneficiaryID] = profile
	}
	return readback, names, profiles, nil
}

// PrepareStorePayoutRecipientSelection verifies, from the owner session, that the
// referenced team grant is an active grant on that Store owned by the acting owner,
// and returns the canonical delegate actor behind the boundary. The user-facing
// reference is the grant, never a raw Actor ID.
func (s *Service) PrepareStorePayoutRecipientSelection(ctx context.Context, accessToken, storeID, grantID string) (string, string, error) {
	actorID, err := s.partnerActor(ctx, accessToken)
	if err != nil {
		return "", "", err
	}
	grants, err := postgres.ListStoreAccessGrants(ctx, s.db, storeID, actorID)
	if err != nil {
		return "", "", err
	}
	for _, grant := range grants {
		if grant.ID != grantID {
			continue
		}
		if grant.OwnerPartnerActorID != actorID || grant.StoreID != storeID {
			return "", "", ErrStoreOwnership
		}
		if grant.State != "active" {
			return "", "", ErrGrantNotActive
		}
		return actorID, grant.DelegateActorID, nil
	}
	return "", "", ErrStoreOwnership
}

// VerifyStoreOwnerForPayoutRecipient confirms the session actor owns the Store
// before a payout-recipient mutation is forwarded to WLT.
func (s *Service) VerifyStoreOwnerForPayoutRecipient(ctx context.Context, accessToken, storeID string) (string, error) {
	actorID, err := s.partnerActor(ctx, accessToken)
	if err != nil {
		return "", err
	}
	store, err := postgres.ReadStore(ctx, s.db, storeID)
	if err != nil {
		return "", err
	}
	if store.PartnerActorID != actorID {
		return "", ErrStoreOwnership
	}
	return actorID, nil
}

// All DSH-owned recipient selection, reversion and grant withdrawal for a
// Store share a DB advisory lock across service instances. This prevents
// reinstating staff routing between WLT review and the DSH revoke commit.
func (s *Service) lockPayoutRecipientStore(ctx context.Context, storeID string) (func(), error) {
	storeID = strings.TrimSpace(storeID)
	if storeID == "" {
		return nil, ErrInvalidInput
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:store-payout:"+storeID); err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	return func() { _ = tx.Rollback() }, nil
}

func (s *Service) markPayoutRecipientReviewIfNeeded(ctx context.Context, storeID, ownerActorID, delegateActorID, targetState, correlationID string) error {
	if strings.TrimSpace(delegateActorID) == "" {
		return nil
	}
	record, err := s.wlt.ReadStorePayoutRecipient(ctx, ownerActorID, storeID)
	if err != nil {
		// Only an explicit missing assignment means default owner routing.
		// WLT outages, authorization errors and malformed responses must not
		// silently bypass the staff payout review gate.
		var wltErr *wltintegration.Error
		if errors.As(err, &wltErr) && wltErr.Status == http.StatusNotFound && wltErr.Code == "NOT_FOUND" {
			return nil
		}
		return err
	}
	if record.State != wltintegration.StorePayoutRecipientStateSelectedStaff || record.BeneficiaryActorID != delegateActorID {
		return nil
	}
	return s.wlt.MarkStorePayoutRecipientReviewRequired(ctx, storeID, ownerActorID, "STORE_ACCESS_GRANT_"+strings.ToUpper(targetState), correlationID)
}

// SelectStorePayoutRecipientForOwner records the owner's verified-staff payout
// recipient for one Store. DSH verifies ownership and the active team grant, then
// forwards the canonical beneficiary facts to WLT, which owns the assignment and its
// readiness. Payout-recipient routing is owner-only and is never implied by any
// delegated permission.
func (s *Service) SelectStorePayoutRecipientForOwner(ctx context.Context, accessToken, storeID, grantID, reason, idempotencyKey, correlationID string) (wltintegration.StorePayoutRecipientAssignment, bool, error) {
	if !validMutation(idempotencyKey, correlationID) {
		return wltintegration.StorePayoutRecipientAssignment{}, false, ErrInvalidInput
	}
	release, err := s.lockPayoutRecipientStore(ctx, storeID)
	if err != nil {
		return wltintegration.StorePayoutRecipientAssignment{}, false, err
	}
	defer release()
	partnerActorID, delegateActorID, err := s.PrepareStorePayoutRecipientSelection(ctx, accessToken, storeID, grantID)
	if err != nil {
		return wltintegration.StorePayoutRecipientAssignment{}, false, err
	}
	facts, err := walletfacts.CurrentFacts(ctx, s.identity, "partner", delegateActorID, "")
	if err != nil {
		return wltintegration.StorePayoutRecipientAssignment{}, false, err
	}
	return s.wlt.SelectStorePayoutRecipient(ctx, storeID, partnerActorID, delegateActorID, facts, reason, idempotencyKey, correlationID)
}

// RevertStorePayoutRecipientForOwner deletes the Store's explicit assignment so
// future unpinned payout intents route to the Partner owner again.
func (s *Service) RevertStorePayoutRecipientForOwner(ctx context.Context, accessToken, storeID, reason, idempotencyKey, correlationID string) (bool, error) {
	if !validMutation(idempotencyKey, correlationID) {
		return false, ErrInvalidInput
	}
	release, err := s.lockPayoutRecipientStore(ctx, storeID)
	if err != nil {
		return false, err
	}
	defer release()
	partnerActorID, err := s.VerifyStoreOwnerForPayoutRecipient(ctx, accessToken, storeID)
	if err != nil {
		return false, err
	}
	return s.wlt.RevertStorePayoutRecipient(ctx, storeID, partnerActorID, reason, idempotencyKey, correlationID)
}

func (s *Service) storeNames(ctx context.Context, storeIDs []string) (map[string]string, error) {
	names := make(map[string]string, len(storeIDs))
	for _, storeID := range storeIDs {
		store, err := postgres.ReadStore(ctx, s.db, storeID)
		if err != nil {
			continue
		}
		names[store.ID] = store.Name
	}
	return names, nil
}

func (s *Service) maskedPartnerPhones(ctx context.Context, actorIDs []string) (map[string]string, error) {
	if len(actorIDs) == 0 {
		return map[string]string{}, nil
	}
	roles, err := s.identity.ReadActorRoles(ctx, "partner", actorIDs)
	if err != nil {
		return nil, err
	}
	masked := make(map[string]string, len(actorIDs))
	for _, role := range roles.Items {
		if role.Role == "partner" && role.ActorID != "" && storeAccessPhoneE164Pattern.MatchString(role.PhoneE164) {
			masked[role.ActorID] = maskStoreAccessPhone(role.PhoneE164)
		}
	}
	return masked, nil
}
