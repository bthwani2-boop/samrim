package identityaccess

import "errors"

// Shared, owner-verified session results for DSH consumers. The Identity
// service remains the sole authority for principals and effective permissions.
var (
	ErrUnauthorized        = errors.New("UNAUTHENTICATED")
	ErrIdentityUnavailable = errors.New("IDENTITY_OWNER_UNAVAILABLE")
	ErrForbidden           = errors.New("FORBIDDEN")
	ErrInvalidOrigin       = errors.New("INVALID_IDENTITY_ORIGIN")
)

type ActorRole string

const (
	MerchantRole ActorRole = "MERCHANT"
	OperatorRole ActorRole = "OPERATOR"
	CustomerRole ActorRole = "CUSTOMER"
	CaptainRole  ActorRole = "CAPTAIN"
)

type VerifiedActor struct {
	Subject string
	Role    ActorRole
}
