package order

import (
	"context"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	"strings"
)

// The operator permission is checked by the DSH authoritative service, not only by the UI.
func (s *Service) ListForOperatorCustomer(ctx context.Context, actorID, operatorID, cursor string, limit int) (postgres.OperatorCustomerOrdersPage, error) {
	// Marketing may read purchasing behavior, while operational mutations remain
	// under the separate operations permission. Identity is the authority.
	if err := s.requireOperator(ctx, operatorID); err != nil {
		return postgres.OperatorCustomerOrdersPage{}, err
	}
	operations, err := s.identity.ReadOperatorPermission(ctx, operatorID, "operations")
	if err != nil {
		return postgres.OperatorCustomerOrdersPage{}, err
	}
	if !operations.Enabled {
		if err := s.requireOperatorPermission(ctx, operatorID, "marketing"); err != nil {
			return postgres.OperatorCustomerOrdersPage{}, err
		}
	}
	return postgres.ListOperatorCustomerOrders(ctx, s.db, strings.TrimSpace(actorID), strings.TrimSpace(cursor), limit)
}
