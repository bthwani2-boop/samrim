package auth

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"
)

// ServiceToken is the one DSH service-boundary authenticator. It deliberately
// does not interpret actor attribution; authorization is a separate Identity
// read at the operation boundary.
type ServiceToken struct {
	token []byte
}

func NewServiceToken(raw string) (*ServiceToken, error) {
	value := strings.TrimSpace(raw)
	if len(value) < 24 {
		return nil, errors.New("dsh service token is too short")
	}
	return &ServiceToken{token: []byte(value)}, nil
}

func (s *ServiceToken) Authorized(r *http.Request) bool {
	if s == nil || r == nil {
		return false
	}
	value := strings.TrimSpace(r.Header.Get("Authorization"))
	const prefix = "Bearer "
	if !strings.HasPrefix(value, prefix) {
		return false
	}
	provided := strings.TrimSpace(strings.TrimPrefix(value, prefix))
	return len(provided) == len(s.token) && subtle.ConstantTimeCompare([]byte(provided), s.token) == 1
}
