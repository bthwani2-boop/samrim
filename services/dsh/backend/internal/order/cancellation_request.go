package order

import (
	"context"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) CreateClientCancellationRequest(ctx context.Context, token, orderID, reason, idem, correlation string) (postgres.CancellationRequestRecord, bool, error) {
	actor, err := s.requireSession(ctx, token, "client", "app-client")
	if err != nil {
		return postgres.CancellationRequestRecord{}, false, err
	}
	return postgres.CreateCancellationRequest(ctx, s.db, orderID, actor, reason, idem, correlation)
}
func (s *Service) ReadClientCancellationRequest(ctx context.Context, token, orderID string) (postgres.CancellationRequestRecord, error) {
	actor, err := s.requireSession(ctx, token, "client", "app-client")
	if err != nil {
		return postgres.CancellationRequestRecord{}, err
	}
	return postgres.ReadClientCancellationRequest(ctx, s.db, orderID, actor)
}
func (s *Service) ListCancellationRequestsForOperator(ctx context.Context, actor string, limit int) ([]postgres.CancellationRequestRecord, error) {
	if err := s.requireOperatorPermission(ctx, actor, "operations"); err != nil {
		return nil, err
	}
	return postgres.ListPendingCancellationRequests(ctx, s.db, limit)
}
func (s *Service) DeclineCancellationRequestForOperator(ctx context.Context, actor, requestID, reason string) (postgres.CancellationRequestRecord, error) {
	if err := s.requireOperatorPermission(ctx, actor, "operations"); err != nil {
		return postgres.CancellationRequestRecord{}, err
	}
	return postgres.DeclineCancellationRequest(ctx, s.db, requestID, actor, reason)
}
