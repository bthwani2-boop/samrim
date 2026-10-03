package storeaccess

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var (
	ErrInvalidInput           = errors.New("Store access input is invalid")
	ErrPartnerSession         = errors.New("an active app-partner session is required")
	ErrInvitationActorSession = errors.New("an active eligible Human Actor session is required")
	ErrOperatorPermission     = errors.New("an active Operator with Partners permission is required")
	ErrActorSecurityDisabled  = errors.New("the invited Actor must have account security enabled")
)

type Service struct {
	identity *identityintegration.Client
	db       *sql.DB
}

func New(identity *identityintegration.Client, db *sql.DB) (*Service, error) {
	if identity == nil || db == nil {
		return nil, errors.New("Store access configuration is invalid")
	}
	return &Service{identity: identity, db: db}, nil
}

func (s *Service) CreateForPartner(ctx context.Context, accessToken, storeID, delegateActorID string, permissions []string, idempotencyKey, correlationID string) (postgres.StoreAccessGrant, bool, error) {
	actorID, err := s.partnerActor(ctx, accessToken)
	if err != nil {
		return postgres.StoreAccessGrant{}, false, err
	}
	if !validMutation(idempotencyKey, correlationID) {
		return postgres.StoreAccessGrant{}, false, ErrInvalidInput
	}
	delegateActorID = strings.TrimSpace(delegateActorID)
	if delegateActorID == "" || len(delegateActorID) > 128 {
		return postgres.StoreAccessGrant{}, false, ErrInvalidInput
	}
	resolvedActor, err := s.identity.ReadCanonicalActor(ctx, delegateActorID)
	if err != nil {
		return postgres.StoreAccessGrant{}, false, err
	}
	if resolvedActor.ActorID != delegateActorID {
		return postgres.StoreAccessGrant{}, false, postgres.ErrStoreAccessForbidden
	}
	if !resolvedActor.SecurityEnabled {
		return postgres.StoreAccessGrant{}, false, ErrActorSecurityDisabled
	}
	return postgres.CreateStoreAccessInvitation(ctx, s.db, storeID, actorID, delegateActorID, permissions, idempotencyKey, correlationID)
}

func (s *Service) ListForOwner(ctx context.Context, accessToken, storeID string) ([]postgres.StoreAccessGrant, error) {
	actorID, err := s.partnerActor(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	return postgres.ListStoreAccessGrants(ctx, s.db, storeID, actorID)
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

func (s *Service) ListRoleAdmissionsForOperator(ctx context.Context, actingActorID string) ([]postgres.StoreAccessGrant, error) {
	if err := s.requirePartnerAdmissionOperator(ctx, actingActorID); err != nil {
		return nil, err
	}
	return postgres.ListPendingStoreAccessRoleAdmissions(ctx, s.db)
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
		"field":   "app-field",
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
