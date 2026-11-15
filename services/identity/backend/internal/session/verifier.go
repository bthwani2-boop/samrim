package session

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"time"
)

// A Principal comes exclusively from canonical Identity actor/role/session state.
// It is never a DSH Store grant and carries no token or private attributes.
type Principal struct {
	ActorID   string    `json:"actorId"`
	Role      string    `json:"role"`
	ExpiresAt time.Time `json:"sessionExpiresAt"`
}

var (
	ErrUnauthorized = errors.New("unverified identity session")
	ErrForbidden    = errors.New("effective operator permission denied")
)

// Reader only accepts a digest; the caller never supplies an actor or role.
type Reader interface {
	Lookup(context.Context, [32]byte) (Principal, error)
}

// PermissionReader is optional for callers that need explicit effective
// Operator permissions. A valid role alone never grants a permission.
type PermissionReader interface {
	LookupPermission(context.Context, [32]byte, string) (Principal, error)
}

type Verifier struct{ reader Reader }

func NewVerifier(reader Reader) *Verifier { return &Verifier{reader: reader} }

func bearerDigest(authorization string) ([32]byte, error) {
	const prefix = "Bearer "
	if len(authorization) != len(prefix)+43 || authorization[:len(prefix)] != prefix {
		return [32]byte{}, ErrUnauthorized
	}
	encoded := authorization[len(prefix):]
	raw, err := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if err != nil || len(raw) != 32 || base64.RawURLEncoding.EncodeToString(raw) != encoded {
		return [32]byte{}, ErrUnauthorized
	}
	return sha256.Sum256(raw), nil
}

// Verify accepts exactly 32 random bytes as canonical unpadded base64url
// Bearer authorization. Raw credentials are never logged or persisted.
func (v *Verifier) Verify(ctx context.Context, authorization string) (Principal, error) {
	digest, err := bearerDigest(authorization)
	if err != nil {
		return Principal{}, err
	}
	if v == nil || v.reader == nil {
		return Principal{}, errors.New("identity session reader unavailable")
	}
	principal, err := v.reader.Lookup(ctx, digest)
	if err != nil {
		return Principal{}, err
	}
	if !validPrincipal(principal) {
		return Principal{}, ErrUnauthorized
	}
	return principal, nil
}

// An unexpected, incomplete, or expired owner response is never a
// current authenticated principal, even when an adapter returns nil error.
func validPrincipal(p Principal) bool {
	if p.ActorID == "" || len(p.ActorID) > 128 ||
		strings.TrimSpace(p.ActorID) != p.ActorID ||
		strings.ContainsAny(p.ActorID, "\r\n\t") ||
		!p.ExpiresAt.After(time.Now().UTC()) {
		return false
	}
	switch p.Role {
	case "customer", "merchant", "captain", "operator":
		return true
	default:
		return false
	}
}

func isOperatorPermission(permission string) bool {
	switch permission {
	case "operations", "partners", "catalog", "marketing", "finance", "hr", "platform_policies":
		return true
	default:
		return false
	}
}

// VerifyPermission obtains the effective decision in the Identity owner;
// it never synthesizes a grant from an operator role or caller header.
func (v *Verifier) VerifyPermission(ctx context.Context, authorization, permission string) (Principal, error) {
	if !isOperatorPermission(permission) {
		return Principal{}, ErrForbidden
	}
	digest, err := bearerDigest(authorization)
	if err != nil {
		return Principal{}, err
	}
	if v == nil || v.reader == nil {
		return Principal{}, errors.New("identity session reader unavailable")
	}
	owner, ok := v.reader.(PermissionReader)
	if !ok {
		return Principal{}, errors.New("identity permissions owner unavailable")
	}
	principal, err := owner.LookupPermission(ctx, digest, permission)
	if err != nil {
		return Principal{}, err
	}
	if !validPrincipal(principal) {
		return Principal{}, ErrUnauthorized
	}
	if principal.Role != "operator" {
		return Principal{}, ErrForbidden
	}
	return principal, nil
}
