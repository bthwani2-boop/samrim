package session

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"
)

// A Principal is read exclusively from canonical Identity session/actor/role state.
// It is not a Store grant and never carries credentials or private actor attributes.
type Principal struct {
	ActorID   string    `json:"actorId"`
	Role      string    `json:"role"`
	ExpiresAt time.Time `json:"sessionExpiresAt"`
}

var ErrUnauthorized = errors.New("unverified identity session")

// Reader is implemented only by the Identity owner. A consumer-supplied actor or
// role is never an input to the verification decision.
type Reader interface {
	Lookup(context.Context, [32]byte) (Principal, error)
}

type Verifier struct{ reader Reader }

func NewVerifier(reader Reader) *Verifier { return &Verifier{reader: reader} }

// Verify accepts exactly 32 random bytes encoded as canonical unpadded
// base64url in the Bearer authorization header. The raw token is neither
// logged nor persisted, and no request-local identity is reused across calls.
func (v *Verifier) Verify(ctx context.Context, authorization string) (Principal, error) {
	const prefix = "Bearer "
	if len(authorization) != len(prefix)+43 || authorization[:len(prefix)] != prefix {
		return Principal{}, ErrUnauthorized
	}
	encoded := authorization[len(prefix):]
	raw, err := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if err != nil || len(raw) != 32 || base64.RawURLEncoding.EncodeToString(raw) != encoded {
		return Principal{}, ErrUnauthorized
	}
	if v == nil || v.reader == nil {
		return Principal{}, errors.New("identity session reader unavailable")
	}
	digest := sha256.Sum256(raw)
	return v.reader.Lookup(ctx, digest)
}
