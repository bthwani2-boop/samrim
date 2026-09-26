package captain

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

const storeCaptainInvitationLifetime = 7 * 24 * time.Hour

type StoreCaptainInvitation struct {
	Membership     postgres.StoreCaptainMembership
	InvitationCode string
	Replayed       bool
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
	return postgres.ListStoreCaptainMemberships(ctx, s.db, storeID, identity.Subject)
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
