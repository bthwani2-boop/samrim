package captainstanding

import (
	"context"
	"errors"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/identityaccess"
)

// IdentityAdapter reuses DSH's canonical uncached current-session HTTP client.
// The role and Operator permission come only from Identity, not request headers.
type IdentityAdapter struct {
	client *identityaccess.IdentitySessionHTTP
}

func NewIdentityAdapter(baseURL string) (*IdentityAdapter, error) {
	client, err := identityaccess.NewIdentitySessionHTTP(baseURL)
	if err != nil {
		return nil, ErrInvalidChange
	}
	return &IdentityAdapter{client: client}, nil
}

func ownerIdentityError(err error) error {
	switch {
	case errors.Is(err, identityaccess.ErrUnauthorized):
		return ErrUnauthorized
	case errors.Is(err, identityaccess.ErrForbidden):
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

func roleString(role identityaccess.ActorRole) string {
	switch role {
	case identityaccess.MerchantRole:
		return "merchant"
	case identityaccess.OperatorRole:
		return "operator"
	case identityaccess.CustomerRole:
		return "customer"
	case identityaccess.CaptainRole:
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
