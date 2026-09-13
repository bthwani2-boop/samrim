package managedaccess

import (
	"context"
	"errors"
	"strings"

	contract "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type Service struct {
	identity *identityintegration.Client
}

func New(identity *identityintegration.Client) (*Service, error) {
	if identity == nil {
		return nil, errors.New("dsh managed access configuration is invalid")
	}
	return &Service{identity: identity}, nil
}

func (s *Service) StatusByPhone(ctx context.Context, phone, role string) (contract.ManagedRoleStatusResponse, error) {
	role = strings.ToLower(strings.TrimSpace(role))
	phone = strings.TrimSpace(phone)
	if !isManagedRole(role) || phone == "" {
		return contract.ManagedRoleStatusResponse{}, errors.New("managed role and phone are required")
	}
	view, err := s.identity.LookupRoleByPhone(ctx, phone, role)
	if err != nil {
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) && identityErr.Status == 404 {
			return contract.ManagedRoleStatusResponse{Role: contract.ManagedRole(role), Exists: false, Reenrollable: false, State: "not_provisioned"}, nil
		}
		return contract.ManagedRoleStatusResponse{}, err
	}
	state := "active"
	if !view.SecurityEnabled {
		state = "identity_disabled"
	} else if !view.Enabled {
		state = "role_disabled"
	} else if view.ActivatedAt == nil {
		state = "pending_activation"
	}
	return contract.ManagedRoleStatusResponse{
		ActorID: view.ActorID, Exists: true, Enabled: view.Enabled, Activated: view.ActivatedAt != nil,
		SecurityEnabled: view.SecurityEnabled, Reenrollable: view.Enabled && view.SecurityEnabled && view.ActivatedAt != nil,
		State: state, Role: contract.ManagedRole(role), ActorVersion: view.ActorVersion, RoleVersion: view.RoleVersion,
	}, nil
}

func (s *Service) SetEnabledByPhone(ctx context.Context, phone, role string, enabled bool, correlationID, reason, operatorActorID string, expectedVersion int) error {
	return s.identity.SetRoleEnabledByPhoneWithContext(ctx, strings.TrimSpace(phone), strings.ToLower(strings.TrimSpace(role)), enabled, strings.TrimSpace(correlationID), strings.TrimSpace(reason), strings.TrimSpace(operatorActorID), expectedVersion)
}

func (s *Service) Provision(ctx context.Context, phone, role, correlationID, operatorActorID string) (identityclient.ActorRoleView, error) {
	input := identityintegration.ActorInput{PhoneE164: strings.TrimSpace(phone)}
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "partner":
		return s.identity.ProvisionPartnerWithContext(ctx, input, correlationID, operatorActorID)
	case "captain":
		return s.identity.ProvisionCaptainWithContext(ctx, input, correlationID, operatorActorID)
	case "field":
		return s.identity.ProvisionFieldWithContext(ctx, input, correlationID, operatorActorID)
	default:
		return identityclient.ActorRoleView{}, errors.New("managed role is not supported")
	}
}

func (s *Service) Reenroll(ctx context.Context, phone, role, correlationID, operatorActorID string) error {
	role = strings.ToLower(strings.TrimSpace(role))
	if !isManagedRole(role) {
		return errors.New("managed role is not supported")
	}
	return s.identity.AuthorizeReenrollmentByPhoneWithContext(ctx, strings.TrimSpace(phone), role, strings.TrimSpace(correlationID), strings.TrimSpace(operatorActorID))
}

func (s *Service) Ready(ctx context.Context) error { return s.identity.Readiness(ctx) }

func isManagedRole(role string) bool {
	return role == "partner" || role == "captain" || role == "field"
}
