package captain

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"time"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

const storeCaptainInvitationLifetime = 7 * 24 * time.Hour

func maskStoreCaptainPhone(value string) string {
	phone := []rune(strings.TrimSpace(value))
	if len(phone) == 0 {
		return ""
	}
	if len(phone) <= 4 {
		return "••••"
	}
	return "•••• " + string(phone[len(phone)-4:])
}

type StoreCaptainInvitation struct {
	Membership     postgres.StoreCaptainMembership
	InvitationCode string
	Replayed       bool
}

// Owner-created Captain accounts are bound to a specific phone/canonical actor.
// This relationship does not grant eligibility to the platform's public pool.
func (s *Service) CreateTargetedStoreCaptainInvitation(ctx context.Context, accessToken, storeID, phone, displayName, idempotencyKey, correlationID string) (StoreCaptainInvitation, error) {
	identity, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return StoreCaptainInvitation{}, err
	}
	if _, err := postgres.ReadStoreOwnedByPartner(ctx, s.db, strings.TrimSpace(storeID), identity.Subject); err != nil {
		return StoreCaptainInvitation{}, ErrPartnerSessionForbidden
	}
	phone, err = identityintegration.NormalizeInvitePhone(phone)
	displayName = strings.TrimSpace(displayName)
	if err != nil || len([]rune(displayName)) == 0 || len([]rune(displayName)) > 80 || !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return StoreCaptainInvitation{}, ErrInvalidInput
	}
	role, err := s.identity.ProvisionCaptainWithContext(ctx, identityintegration.ActorInput{PhoneE164: phone}, correlationID, identity.Subject)
	if err != nil {
		return StoreCaptainInvitation{}, err
	}
	if !role.SecurityEnabled {
		return StoreCaptainInvitation{}, ErrCaptainIdentityUnavailable
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return StoreCaptainInvitation{}, err
	}
	code := base64.RawURLEncoding.EncodeToString(secret)
	hash := sha256.Sum256([]byte(code))
	membership, replayed, err := postgres.CreateTargetedStoreCaptainInvitation(ctx, s.db, storeID, identity.Subject, role.ActorID, displayName, hex.EncodeToString(hash[:]), time.Now().UTC().Add(storeCaptainInvitationLifetime), idempotencyKey, correlationID)
	if err != nil {
		return StoreCaptainInvitation{}, err
	}
	return StoreCaptainInvitation{Membership: membership, Replayed: replayed}, nil
}

func (s *Service) AcceptTargetedStoreCaptainInvitation(ctx context.Context, accessToken, membershipID, idempotencyKey, correlationID string) (postgres.StoreCaptainMembership, bool, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return postgres.StoreCaptainMembership{}, false, err
	}
	if !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return postgres.StoreCaptainMembership{}, false, ErrInvalidInput
	}
	return postgres.AcceptTargetedStoreCaptainInvitation(ctx, s.db, strings.TrimSpace(membershipID), identity.Subject, idempotencyKey, correlationID)
}

func (s *Service) CreateStoreCaptainInvitation(ctx context.Context, accessToken, storeID, idempotencyKey, correlationID string) (StoreCaptainInvitation, error) {
	identity, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return StoreCaptainInvitation{}, err
	}
	storeID = strings.TrimSpace(storeID)
	if storeID == "" || !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return StoreCaptainInvitation{}, ErrInvalidInput
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return StoreCaptainInvitation{}, err
	}
	code := base64.RawURLEncoding.EncodeToString(secret)
	secretHash := sha256.Sum256([]byte(code))
	requestHash := postgres.HashStoreCaptainInvitationCreate(storeID, identity.Subject)
	membership, replayed, err := postgres.CreateStoreCaptainInvitation(ctx, s.db, storeID, identity.Subject, hex.EncodeToString(secretHash[:]), time.Now().UTC().Add(storeCaptainInvitationLifetime), strings.TrimSpace(idempotencyKey), requestHash, strings.TrimSpace(correlationID))
	if err != nil {
		return StoreCaptainInvitation{}, err
	}
	result := StoreCaptainInvitation{Membership: membership, Replayed: replayed}
	if !replayed {
		result.InvitationCode = code
	}
	return result, nil
}

func (s *Service) ListStoreCaptainMemberships(ctx context.Context, accessToken, storeID string) ([]postgres.StoreCaptainMembership, error) {
	identity, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	storeID = strings.TrimSpace(storeID)
	if storeID == "" {
		return nil, ErrInvalidInput
	}
	memberships, err := postgres.ListStoreCaptainMemberships(ctx, s.db, storeID, identity.Subject)
	if err != nil {
		return nil, err
	}
	actorIDs := make([]string, 0, len(memberships))
	seen := map[string]struct{}{}
	for _, membership := range memberships {
		if membership.CaptainActorID == nil || strings.TrimSpace(*membership.CaptainActorID) == "" {
			continue
		}
		actorID := strings.TrimSpace(*membership.CaptainActorID)
		if _, exists := seen[actorID]; exists {
			continue
		}
		seen[actorID] = struct{}{}
		actorIDs = append(actorIDs, actorID)
	}
	phones := map[string]string{}
	if len(actorIDs) > 0 {
		if roles, roleErr := s.identity.ReadActorRoles(ctx, "captain", actorIDs); roleErr == nil {
			for _, role := range roles.Items {
				phones[strings.TrimSpace(role.ActorID)] = maskStoreCaptainPhone(role.PhoneE164)
			}
		}
	}
	for index := range memberships {
		if memberships[index].CaptainActorID == nil {
			continue
		}
		actorID := strings.TrimSpace(*memberships[index].CaptainActorID)
		if actorID == "" {
			continue
		}
		if admission, admissionErr := postgres.ReadCaptainAdmissionForActor(ctx, s.db, actorID); admissionErr == nil {
			memberships[index].CaptainNameAr = strings.TrimSpace(admission.FullNameAr)
		}
		memberships[index].CaptainPhoneMasked = phones[actorID]
	}
	return memberships, nil
}

func (s *Service) ListCaptainStoreMemberships(ctx context.Context, accessToken string) ([]postgres.StoreCaptainMembership, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return nil, err
	}
	return postgres.ListCaptainStoreMemberships(ctx, s.db, identity.Subject)
}

func (s *Service) TransitionStoreCaptainMembership(ctx context.Context, accessToken, storeID, membershipID, state string, expectedVersion int, idempotencyKey, correlationID string) (postgres.StoreCaptainMembership, bool, error) {
	identity, err := s.requirePartner(ctx, accessToken)
	if err != nil {
		return postgres.StoreCaptainMembership{}, false, err
	}
	storeID, membershipID, state = strings.TrimSpace(storeID), strings.TrimSpace(membershipID), strings.TrimSpace(state)
	if storeID == "" || membershipID == "" || expectedVersion < 1 || !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return postgres.StoreCaptainMembership{}, false, ErrInvalidInput
	}
	requestHash := postgres.HashStoreCaptainMembershipTransition(storeID, membershipID, identity.Subject, state, expectedVersion)
	return postgres.TransitionStoreCaptainMembership(ctx, s.db, storeID, identity.Subject, membershipID, state, expectedVersion, strings.TrimSpace(idempotencyKey), requestHash, strings.TrimSpace(correlationID))
}

func (s *Service) AcceptStoreCaptainInvitation(ctx context.Context, accessToken, invitationCode, idempotencyKey, correlationID string) (postgres.StoreCaptainMembership, bool, error) {
	identity, err := s.requireCaptain(ctx, accessToken)
	if err != nil {
		return postgres.StoreCaptainMembership{}, false, err
	}
	invitationCode = strings.TrimSpace(invitationCode)
	secret, decodeErr := base64.RawURLEncoding.DecodeString(invitationCode)
	if decodeErr != nil || len(secret) != 32 || base64.RawURLEncoding.EncodeToString(secret) != invitationCode || !validMutation(idempotencyKey, correlationID, identity.Subject) {
		return postgres.StoreCaptainMembership{}, false, ErrInvalidInput
	}
	tokenHash := sha256.Sum256([]byte(invitationCode))
	requestHash := postgres.HashStoreCaptainInvitationAccept(hex.EncodeToString(tokenHash[:]), identity.Subject)
	return postgres.AcceptStoreCaptainInvitation(ctx, s.db, hex.EncodeToString(tokenHash[:]), identity.Subject, strings.TrimSpace(idempotencyKey), requestHash, strings.TrimSpace(correlationID))
}
