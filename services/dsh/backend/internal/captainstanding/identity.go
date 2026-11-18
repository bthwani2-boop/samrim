package captainstanding

import (
	"context"
	"errors"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storeavailability"
)

// IdentityAdapter reuses DSH's canonical uncached current-session HTTP client.
// The role and Operator permission come only from Identity, not request headers.
type IdentityAdapter struct {
	client *storeavailability.IdentitySessionHTTP
}

func NewIdentityAdapter(baseURL string) (*IdentityAdapter, error) {
	client, err := storeavailability.NewIdentitySessionHTTP(baseURL)
	if err != nil {
		return nil, ErrInvalidChange
	}
	return &IdentityAdapter{client: client}, nil
}

func ownerIdentityError(err error) error {
	switch {
	case errors.Is(err, storeavailability.ErrUnauthorized):
		return ErrUnauthorized
	case errors.Is(err, storeavailability.ErrForbidden):
		return ErrForbidden
	default:
		return ErrOwnerUnavailable
	}
}

func (a *IdentityAdapter) Resolve(ctx context.Context, bearer string) (Actor, error) {
	if a == nil || a.client == nil {
		return Actor{}, ErrOwnerUnavailable
	}
	actor, err := a.client.ResolveCurrentSession(ctx, bearer)
	if err != nil {
		return Actor{}, ownerIdentityError(err)
	}
	return Actor{ID: actor.Subject, Role: roleString(actor.Role)}, nil
}

func roleString(role storeavailability.ActorRole) string {
	switch role {
	case storeavailability.MerchantRole:
		return "merchant"
	case storeavailability.OperatorRole:
		return "operator"
	case storeavailability.ActorRole("CUSTOMER"):
		return "customer"
	case storeavailability.ActorRole("CAPTAIN"):
		return "captain"
	default:
		return ""
	}
}

func (a *IdentityAdapter) RequireOperations(ctx context.Context, bearer, verifiedActorID string) error {
	if a == nil || a.client == nil {
		return ErrOwnerUnavailable
	}
	return mapPermissionError(a.client.RequireOperatorPermission(ctx, bearer, verifiedActorID, "operations"))
}

func mapPermissionError(err error) error {
	if err == nil {
		return nil
	}
	return ownerIdentityError(err)
}
