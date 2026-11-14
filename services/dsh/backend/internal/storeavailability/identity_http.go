package storeavailability

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// IdentitySessionHTTP is an owner-bound, uncached consumer of Identity's
// canonical active-session read. It never verifies client-asserted actor data,
// generates credentials, or grants Operator permissions on role alone.
type IdentitySessionHTTP struct {
	endpoint string
	client   *http.Client
}

func NewIdentitySessionHTTP(baseURL string) (*IdentitySessionHTTP, error) {
	root, err := url.Parse(baseURL)
	if err != nil || root.Host == "" || root.User != nil ||
		root.RawQuery != "" || root.Fragment != "" || root.Opaque != "" ||
		(root.Path != "" && root.Path != "/") {
		return nil, ErrInvalidChange
	}
	if root.Scheme != "https" &&
		!(root.Scheme == "http" && (root.Hostname() == "127.0.0.1" || root.Hostname() == "localhost")) {
		return nil, ErrInvalidChange
	}
	root.Path = "/v1/sessions/current"
	return &IdentitySessionHTTP{
		endpoint: root.String(),
		client: &http.Client{
			Timeout: 3 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				// Never forward an opaque bearer secret to any redirected host.
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

func (identity *IdentitySessionHTTP) ResolveCurrentSession(ctx context.Context, token string) (VerifiedActor, error) {
	if identity == nil || identity.client == nil || token == "" ||
		strings.TrimSpace(token) != token || strings.ContainsAny(token, " \t\r\n") {
		return VerifiedActor{}, ErrUnauthorized
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, identity.endpoint, nil)
	if err != nil {
		return VerifiedActor{}, ErrIdentityUnavailable
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Cache-Control", "no-store")
	response, err := identity.client.Do(request)
	if err != nil {
		return VerifiedActor{}, ErrIdentityUnavailable
	}
	defer response.Body.Close()

	if response.StatusCode == http.StatusUnauthorized {
		return VerifiedActor{}, ErrUnauthorized
	}
	if response.StatusCode != http.StatusOK {
		return VerifiedActor{}, ErrIdentityUnavailable
	}
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return VerifiedActor{}, ErrIdentityUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 4097))
	if err != nil || len(body) > 4096 {
		return VerifiedActor{}, ErrIdentityUnavailable
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	var verified struct {
		ActorID          string    `json:"actorId"`
		Role             string    `json:"role"`
		SessionExpiresAt time.Time `json:"sessionExpiresAt"`
	}
	if err = decoder.Decode(&verified); err != nil {
		return VerifiedActor{}, ErrIdentityUnavailable
	}
	if err = decoder.Decode(new(any)); err != io.EOF {
		return VerifiedActor{}, ErrIdentityUnavailable
	}
	if verified.ActorID == "" || len(verified.ActorID) > 128 ||
		strings.TrimSpace(verified.ActorID) != verified.ActorID ||
		strings.ContainsAny(verified.ActorID, "\r\n\t") ||
		!verified.SessionExpiresAt.After(time.Now()) {
		return VerifiedActor{}, ErrUnauthorized
	}
	var role ActorRole
	switch verified.Role {
	case "merchant":
		role = MerchantRole
	case "operator":
		role = OperatorRole
	case "customer":
		role = ActorRole("CUSTOMER")
	case "captain":
		role = ActorRole("CAPTAIN")
	default:
		return VerifiedActor{}, ErrUnauthorized
	}
	return VerifiedActor{Subject: verified.ActorID, Role: role}, nil
}

func (identity *IdentitySessionHTTP) RequireOperatorPermission(context.Context, string, string) error {
	// Identity currently exposes active roles, NOT the approved effective
	// 'operations' grant or its revocation. Operator mode must fail closed.
	return ErrForbidden
}
