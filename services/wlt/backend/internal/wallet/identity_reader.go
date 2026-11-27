package wallet

import (
	"context"
	"encoding/base64"
	json "encoding/json/v2"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	sessionPath           = "/v1/sessions/current"
	financePermissionPath = "/v1/operators/me/permissions/finance"
	identityReplyLimit    = 4096
)

type principal struct {
	ActorID string    `json:"actorId"`
	Role    string    `json:"role"`
	Expires time.Time `json:"sessionExpiresAt"`
}

type identityReader struct {
	endpoint string
	client   *http.Client
}

// Keep authenticated owner requests off ambient proxies and redirects.
var isolatedOwnerTransport = &http.Transport{
	Proxy:           nil,
	DialContext:     (&net.Dialer{Timeout: 2 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
	MaxIdleConns:    16,
	IdleConnTimeout: 90 * time.Second,
}

func validLoopbackOwnerOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" ||
		u.User != nil || u.Path != "" || u.RawPath != "" || u.RawQuery != "" ||
		u.Fragment != "" || u.Opaque != "" || u.ForceQuery || u.String() != origin {
		return false
	}
	port, err := strconv.ParseUint(u.Port(), 10, 16)
	return err == nil && port > 0
}

func newIdentityReader(origin string, containerMode ...bool) (identityReader, error) {
	allowedContainer := len(containerMode) == 1 && containerMode[0] && origin == "http://identity:3302"
	if !allowedContainer && !validLoopbackOwnerOrigin(origin) {
		return identityReader{}, errors.New("WLT requires the isolated Identity loopback origin")
	}
	return identityReader{
		endpoint: origin + sessionPath,
		client: &http.Client{
			Transport:     isolatedOwnerTransport,
			Timeout:       2 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
		},
	}, nil
}

func validBearer(header string) bool {
	token, ok := strings.CutPrefix(header, "Bearer ")
	if !ok || len(token) != 43 || strings.ContainsAny(token, "\r\n") {
		return false
	}
	digest, err := base64.RawURLEncoding.Strict().DecodeString(token)
	return err == nil && len(digest) == 32
}

func (identity identityReader) read(ctx context.Context, auth string) (principal, int) {
	return identity.readRole(ctx, auth, "customer")
}

func (identity identityReader) readRole(ctx context.Context, auth, role string) (principal, int) {
	var actor principal
	status := identity.readBoundedOwner(ctx, auth, identity.endpoint, &actor, identityReplyLimit)
	if status != http.StatusOK {
		return principal{}, status
	}
	if actor.ActorID == "" || utf8.RuneCountInString(actor.ActorID) > 128 ||
		strings.TrimSpace(actor.ActorID) != actor.ActorID || strings.ContainsFunc(actor.ActorID, unicode.IsControl) ||
		!actor.Expires.After(time.Now()) || actor.Role == "" {
		return principal{}, http.StatusServiceUnavailable
	}
	if actor.Role != role {
		return principal{}, http.StatusForbidden
	}
	return actor, http.StatusOK
}

// Finance requires the current explicit grant for the same verified actor.
func (identity identityReader) finance(ctx context.Context, auth string) (principal, int) {
	actor, status := identity.readRole(ctx, auth, "operator")
	if status != http.StatusOK {
		return principal{}, status
	}
	var grant struct {
		ActorID    *string `json:"actorId"`
		Permission *string `json:"permission"`
	}
	endpoint := strings.TrimSuffix(identity.endpoint, sessionPath) + financePermissionPath
	status = identity.readBoundedOwner(ctx, auth, endpoint, &grant, identityReplyLimit)
	if status != http.StatusOK {
		return principal{}, status
	}
	if grant.ActorID == nil || grant.Permission == nil {
		return principal{}, http.StatusServiceUnavailable
	}
	if *grant.ActorID != actor.ActorID || *grant.Permission != "finance" {
		return principal{}, http.StatusForbidden
	}
	return actor, http.StatusOK
}

func (identity identityReader) readBoundedOwner(ctx context.Context, auth, endpoint string, destination any, limit int64) int {
	if !validBearer(auth) {
		return http.StatusUnauthorized
	}
	if identity.client == nil {
		return http.StatusServiceUnavailable
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return http.StatusServiceUnavailable
	}
	request.Header.Set("Authorization", auth)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Cache-Control", "no-store")
	response, err := identity.client.Do(request)
	if err != nil {
		return http.StatusServiceUnavailable
	}
	defer response.Body.Close()
	switch response.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return response.StatusCode
	case http.StatusOK:
	default:
		return http.StatusServiceUnavailable
	}
	cache := response.Header.Values("Cache-Control")
	if len(cache) != 1 || !strings.EqualFold(cache[0], "no-store") {
		return http.StatusServiceUnavailable
	}
	if err := decodeBoundedOwnerReply(response, destination, limit); err != nil {
		return http.StatusServiceUnavailable
	}
	return http.StatusOK
}

// Every owner and synthetic provider JSON document is bounded before decoding.
// Go JSON v2 rejects duplicate member names, invalid Unicode and noncanonical
// field names; reject unknown members instead of silently dropping them.
func decodeBoundedOwnerReply(response *http.Response, destination any, limit int64) error {
	contentTypes := response.Header.Values("Content-Type")
	if len(contentTypes) != 1 || response.ContentLength > limit {
		return errors.New("invalid owner response metadata")
	}
	media, _, err := mime.ParseMediaType(contentTypes[0])
	if err != nil || media != "application/json" {
		return errors.New("invalid owner response media type")
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil || int64(len(body)) > limit {
		return errors.New("invalid owner response size")
	}
	return json.Unmarshal(body, destination, json.RejectUnknownMembers(true))
}
