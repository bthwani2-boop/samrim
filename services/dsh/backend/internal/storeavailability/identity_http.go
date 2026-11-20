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

const identityJSONMediaType = "application/json"

// IdentitySessionHTTP is an owner-bound, uncached consumer of Identity's
// canonical active-session read. It never verifies client-asserted actor data,
// generates credentials, or grants Operator permissions on role alone.
type IdentitySessionHTTP struct {
	endpoint       string
	permissionBase string
	client         *http.Client
}

func NewIdentitySessionHTTP(baseURL string) (*IdentitySessionHTTP, error) {
	root, err := url.Parse(baseURL)
	if err != nil || root.Host == "" || root.User != nil ||
		root.RawQuery != "" || root.ForceQuery || root.Fragment != "" || root.Opaque != "" ||
		(root.Path != "" && root.Path != "/") {
		return nil, ErrInvalidChange
	}
	if root.Scheme != "https" &&
		!(root.Scheme == "http" && (root.Hostname() == "127.0.0.1" || root.Hostname() == "localhost")) {
		return nil, ErrInvalidChange
	}
	root.Path = "/v1/operators/me/permissions/"
	permissionBase := root.String()
	root.Path = "/v1/sessions/current"
	return &IdentitySessionHTTP{
		endpoint:       root.String(),
		permissionBase: permissionBase,
		client: &http.Client{
			Timeout: 3 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				// Never forward an opaque bearer secret to any redirected host.
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

func decodeIdentityOwnerJSON(response *http.Response, destination any) error {
	cache := response.Header.Values("Cache-Control")
	if len(cache) != 1 || !strings.EqualFold(strings.TrimSpace(cache[0]), "no-store") {
		return ErrIdentityUnavailable
	}
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || mediaType != identityJSONMediaType {
		return ErrIdentityUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 4097))
	if err != nil || len(body) > 4096 {
		return ErrIdentityUnavailable
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(destination); err != nil || decoder.Decode(new(any)) != io.EOF {
		return ErrIdentityUnavailable
	}
	return nil
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
	request.Header.Set("Accept", identityJSONMediaType)
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
	var verified struct {
		ActorID          string    `json:"actorId"`
		Role             string    `json:"role"`
		SessionExpiresAt time.Time `json:"sessionExpiresAt"`
	}
	if err = decodeIdentityOwnerJSON(response, &verified); err != nil {
		return VerifiedActor{}, err
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

// RequireOperatorPermission checks the current effective Identity grant for
// the SAME actor already verified via /v1/sessions/current by Service.authorize.
// No role-to-permission inference, cache, redirect, or client-supplied actor ID.
func (identity *IdentitySessionHTTP) RequireOperatorPermission(ctx context.Context, token, verifiedActorID, permission string) error {
	if identity == nil || identity.client == nil {
		return ErrIdentityUnavailable
	}
	if (permission != "operations" && permission != "platform_policies") || verifiedActorID == "" ||
		len(verifiedActorID) > 128 || strings.TrimSpace(verifiedActorID) != verifiedActorID ||
		strings.ContainsAny(verifiedActorID, "\r\n\t") {
		return ErrForbidden
	}
	if token == "" || strings.TrimSpace(token) != token ||
		strings.ContainsAny(token, " \t\r\n") {
		return ErrUnauthorized
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, identity.permissionBase+permission, nil)
	if err != nil {
		return ErrIdentityUnavailable
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Accept", identityJSONMediaType)
	request.Header.Set("Cache-Control", "no-store")
	response, err := identity.client.Do(request)
	if err != nil {
		return ErrIdentityUnavailable
	}
	defer response.Body.Close()
	switch response.StatusCode {
	case http.StatusUnauthorized:
		return ErrUnauthorized
	case http.StatusForbidden:
		return ErrForbidden
	case http.StatusOK:
	default:
		return ErrIdentityUnavailable
	}
	var grant struct {
		ActorID    string `json:"actorId"`
		Permission string `json:"permission"`
	}
	if err = decodeIdentityOwnerJSON(response, &grant); err != nil {
		return err
	}
	if grant.ActorID != verifiedActorID || grant.Permission != permission {
		return ErrForbidden
	}
	return nil
}
