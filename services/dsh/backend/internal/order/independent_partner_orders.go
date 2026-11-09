package order

import (
	"context"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

func (s *Service) ListIndependentForPartner(ctx context.Context, token, storeID string, limit int, cursor string) (postgres.IndependentPartnerOrderPage, error) {
	actor, err := s.requireSession(ctx, token, "partner", "app-partner")
	if err != nil {
		return postgres.IndependentPartnerOrderPage{}, err
	}
	return postgres.ListIndependentOrdersForPartner(ctx, s.db, storeID, actor, limit, cursor)
}

func (s *Service) TransitionIndependentForPartner(ctx context.Context, token, storeID, orderID string, input postgres.IndependentPartnerOrderTransition) (postgres.IndependentDirectOrderStatus, error) {
	actor, err := s.requireSession(ctx, token, "partner", "app-partner")
	if err != nil {
		return postgres.IndependentDirectOrderStatus{}, err
	}
	return postgres.TransitionIndependentOrderForPartner(ctx, s.db, storeID, orderID, actor, input)
}
