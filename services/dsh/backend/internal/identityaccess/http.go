// Package identityaccess consumes canonical Identity decisions without owning
// principals, credentials, or permissions.
package identityaccess

import (
	"context"
	"encoding/json/v2"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	identityJSONMediaType = "application/json"
	maxIdentityReplyBytes = 4096
	identityReadTimeout   = 3 * time.Second
)

// IdentitySessionHTTP reads current, uncached decisions from the Identity owner.
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
		return nil, ErrInvalidOrigin
	}
	if root.Scheme != "https" &&
		!(root.Scheme == "http" && (root.Hostname() == "127.0.0.1" || root.Hostname() == "localhost")) {
		return nil, ErrInvalidOrigin
	}
	root.Path = "/v1/sessions/current"
	endpoint := root.String()
	root.Path = "/v1/operators/me/permissions/"
	return &IdentitySessionHTTP{
		endpoint:       endpoint,
		permissionBase: root.String(),
		client: &http.Client{
			Timeout: identityReadTimeout,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

// ValidActorID accepts canonical Identity actor identifiers only.
func ValidActorID(id string) bool {
	return id != "" && len(id) <= 128 && utf8.ValidString(id) &&
		strings.TrimSpace(id) == id && !strings.ContainsFunc(id, unicode.IsControl)
}

func validBearer(token string) bool {
	return token != "" && strings.TrimSpace(token) == token &&
		!strings.ContainsAny(token, " \t\r\n")
}

// Pointer fields distinguish missing or null members from supplied values.
// JSON v2 rejects duplicate and case-mismatched names, invalid Unicode and,
// with RejectUnknownMembers, unexpected members.
type sessionReply struct {
	ActorID          *string    `json:"actorId"`
	Role             *string    `json:"role"`
	SessionExpiresAt *time.Time `json:"sessionExpiresAt"`
}

type permissionReply struct {
	ActorID    *string `json:"actorId"`
	Permission *string `json:"permission"`
}

// decodeOwnerReply admits a single, bounded, unencoded JSON representation.
// Header.Get discards subsequent occurrences; those must never authorize a
// session or grant. Trailers cannot redefine admission metadata.
func decodeOwnerReply(response *http.Response, destination any) error {
	cache := response.Header.Values("Cache-Control")
	media := response.Header.Values("Content-Type")
	if len(cache) != 1 || !strings.EqualFold(strings.TrimSpace(cache[0]), "no-store") ||
		len(media) != 1 || len(response.Header.Values("Content-Encoding")) != 0 ||
		response.Uncompressed || response.ContentLength > maxIdentityReplyBytes {
		return ErrIdentityUnavailable
	}
	mediaType, parameters, err := mime.ParseMediaType(media[0])
	if err != nil || mediaType != identityJSONMediaType {
		return ErrIdentityUnavailable
	}
	for name, value := range parameters {
		if name != "charset" || !strings.EqualFold(value, "utf-8") {
			return ErrIdentityUnavailable
		}
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxIdentityReplyBytes+1))
	if err != nil || len(body) > maxIdentityReplyBytes {
		return ErrIdentityUnavailable
	}
	for _, name := range []string{"Cache-Control", "Content-Type", "Content-Encoding"} {
		if _, present := response.Trailer[name]; present {
			return ErrIdentityUnavailable
		}
	}
	if err := json.Unmarshal(body, destination, json.RejectUnknownMembers(true)); err != nil {
		return ErrIdentityUnavailable
	}
	return nil
}

func (identity *IdentitySessionHTTP) read(ctx context.Context, endpoint, token string, destination any, permission bool) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return ErrIdentityUnavailable
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Accept", identityJSONMediaType)
	// Explicit negotiation prevents net/http from silently decompressing and
	// removing the owner-supplied Content-Encoding metadata.
	request.Header.Set("Accept-Encoding", "identity")
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
		if permission {
			return ErrForbidden
		}
		return ErrIdentityUnavailable
	case http.StatusOK:
		return decodeOwnerReply(response, destination)
	default:
		return ErrIdentityUnavailable
	}
}

func (identity *IdentitySessionHTTP) ResolveCurrentSession(ctx context.Context, token string) (VerifiedActor, error) {
	if identity == nil || identity.client == nil || !validBearer(token) {
		return VerifiedActor{}, ErrUnauthorized
	}
	var reply sessionReply
	if err := identity.read(ctx, identity.endpoint, token, &reply, false); err != nil {
		return VerifiedActor{}, err
	}
	if reply.ActorID == nil || reply.Role == nil || reply.SessionExpiresAt == nil {
		return VerifiedActor{}, ErrIdentityUnavailable
	}
	if !ValidActorID(*reply.ActorID) || !reply.SessionExpiresAt.After(time.Now()) {
		return VerifiedActor{}, ErrUnauthorized
	}
	var role ActorRole
	switch *reply.Role {
	case "merchant":
		role = MerchantRole
	case "operator":
		role = OperatorRole
	case "customer":
		role = CustomerRole
	case "captain":
		role = CaptainRole
	default:
		return VerifiedActor{}, ErrUnauthorized
	}
	return VerifiedActor{Subject: *reply.ActorID, Role: role}, nil
}

// RequireOperatorPermission requires the current explicit grant for the same
// owner-verified actor. An Operator role alone never grants a DSH permission.
func (identity *IdentitySessionHTTP) RequireOperatorPermission(ctx context.Context, token, verifiedActorID, permission string) error {
	if identity == nil || identity.client == nil {
		return ErrIdentityUnavailable
	}
	switch permission {
	case "operations", "platform_policies", "hr", "merchant", "finance":
	default:
		return ErrForbidden
	}
	if !ValidActorID(verifiedActorID) {
		return ErrForbidden
	}
	if !validBearer(token) {
		return ErrUnauthorized
	}
	var reply permissionReply
	if err := identity.read(ctx, identity.permissionBase+permission, token, &reply, true); err != nil {
		return err
	}
	if reply.ActorID == nil || reply.Permission == nil {
		return ErrIdentityUnavailable
	}
	if *reply.ActorID != verifiedActorID || *reply.Permission != permission {
		return ErrForbidden
	}
	return nil
}
