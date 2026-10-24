package notification

import (
	"context"
	"errors"
	"strings"

	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

type ClientShareRequest struct {
	RecipientPhoneE164 string `json:"recipientPhoneE164"`
	ContentKind        string `json:"contentKind"`
	ContentID          string `json:"contentId"`
	MessageCode        string `json:"messageCode"`
}

func ValidClientShareRequest(r ClientShareRequest) bool {
	if len(r.ContentID) < 1 || len(r.ContentID) > 128 || strings.TrimSpace(r.ContentID) != r.ContentID {
		return false
	}
	switch r.ContentKind {
	case "STORE", "OFFER", "PROMOTION", "CONTENT":
	default:
		return false
	}
	switch r.MessageCode {
	case "LOOK", "LIKE", "OFFER", "TRY":
	default:
		return false
	}
	return true
}

func (s *Service) requireClient(ctx context.Context, token string) (string, error) {
	session, role, err := s.requireSession(ctx, token)
	if err != nil {
		return "", err
	}
	if role != "client" {
		return "", ErrSessionForbidden
	}
	return session.Subject, nil
}

// SendClientShare intentionally has the same successful response when the
// phone is not registered or blocked. No client directory is exposed.
func (s *Service) SendClientShare(ctx context.Context, token string, request ClientShareRequest, idem string) error {
	actorID, err := s.requireClient(ctx, token)
	if err != nil {
		return err
	}
	if !ValidClientShareRequest(request) || len(idem) < 8 || len(idem) > 128 {
		return postgres.ErrClientShareInvalid
	}
	phone, err := identityintegration.NormalizeInvitePhone(request.RecipientPhoneE164)
	if err != nil {
		return postgres.ErrClientShareInvalid
	}
	exists, err := postgres.ClientShareExists(ctx, s.db, request.ContentKind, request.ContentID)
	if err != nil {
		return err
	}
	if !exists {
		return postgres.ErrClientShareInvalid
	}
	recipientID, err := s.identity.ResolveClientShareRecipient(ctx, phone)
	if err != nil {
		return err
	}
	if recipientID == "" || recipientID == actorID {
		return nil
	}
	return postgres.SendClientShare(ctx, s.db, actorID, recipientID, phone, request.ContentKind, request.ContentID, request.MessageCode, idem)
}

func (s *Service) ListClientShares(ctx context.Context, token string, before int64, limit int) (postgres.ClientSharePage, error) {
	actorID, err := s.requireClient(ctx, token)
	if err != nil {
		return postgres.ClientSharePage{}, err
	}
	return postgres.ListClientShares(ctx, s.db, actorID, before, limit)
}

func (s *Service) MarkClientShareRead(ctx context.Context, token string, id int64) error {
	actorID, err := s.requireClient(ctx, token)
	if err != nil {
		return err
	}
	return postgres.MarkClientShareRead(ctx, s.db, actorID, id)
}

func (s *Service) SetClientShareSenderBlocked(ctx context.Context, token, senderID string, blocked bool) error {
	actorID, err := s.requireClient(ctx, token)
	if err != nil {
		return err
	}
	if strings.TrimSpace(senderID) == "" {
		return errors.New("sender ID is required")
	}
	return postgres.BlockClientShareSender(ctx, s.db, actorID, senderID, blocked)
}
