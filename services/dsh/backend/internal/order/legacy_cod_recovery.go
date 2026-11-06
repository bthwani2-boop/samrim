package order

import (
	"context"
	"errors"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
)

var ErrLegacyCODRecoveryInput = errors.New("legacy COD recovery request is invalid")

func (s *Service) SubmitLegacyCODRecovery(ctx context.Context, actorID, paymentIntentID, evidenceDocumentID, idempotencyKey, correlationID string) (wlt.LegacyCODRecoveryResponse, error) {
	if err := s.requireOperatorPermission(ctx, actorID, "finance"); err != nil {
		return wlt.LegacyCODRecoveryResponse{}, err
	}
	if !legacyCODMutationFacts(paymentIntentID, actorID, idempotencyKey, correlationID) ||
		strings.TrimSpace(evidenceDocumentID) == "" || len(strings.TrimSpace(evidenceDocumentID)) > 128 {
		return wlt.LegacyCODRecoveryResponse{}, ErrLegacyCODRecoveryInput
	}
	return s.payment.SubmitLegacyCODRecovery(ctx, paymentIntentID, evidenceDocumentID, actorID, idempotencyKey, correlationID)
}

func (s *Service) ReadLegacyCODRecoveryByPayment(ctx context.Context, actorID, paymentIntentID string) (wlt.LegacyCODRecoveryResponse, error) {
	if err := s.requireOperatorPermission(ctx, actorID, "finance"); err != nil {
		return wlt.LegacyCODRecoveryResponse{}, err
	}
	if strings.TrimSpace(paymentIntentID) == "" || len(strings.TrimSpace(paymentIntentID)) > 128 {
		return wlt.LegacyCODRecoveryResponse{}, ErrLegacyCODRecoveryInput
	}
	return s.payment.ReadLegacyCODRecoveryByPayment(ctx, paymentIntentID, actorID)
}

func (s *Service) ApproveLegacyCODRecovery(ctx context.Context, actorID, reviewID, idempotencyKey, correlationID string) (wlt.LegacyCODRecoveryResponse, error) {
	if err := s.requireOperatorPermission(ctx, actorID, "finance"); err != nil {
		return wlt.LegacyCODRecoveryResponse{}, err
	}
	if !legacyCODMutationFacts(reviewID, actorID, idempotencyKey, correlationID) {
		return wlt.LegacyCODRecoveryResponse{}, ErrLegacyCODRecoveryInput
	}
	return s.payment.ApproveLegacyCODRecovery(ctx, reviewID, actorID, idempotencyKey, correlationID)
}

func legacyCODMutationFacts(id, actorID, key, correlation string) bool {
	id, actorID, key, correlation = strings.TrimSpace(id), strings.TrimSpace(actorID), strings.TrimSpace(key), strings.TrimSpace(correlation)
	return len(id) > 0 && len(id) <= 128 && len(actorID) > 0 && len(actorID) <= 128 &&
		len(key) >= 8 && len(key) <= 128 && len(correlation) >= 8 && len(correlation) <= 128
}
