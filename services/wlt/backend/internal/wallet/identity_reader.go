package wallet

import (
	"bytes"
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
	maxOwnerReplyLimit    = 262144
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

// Isolated direct owners emit uncompressed JSON. Never silently decompress,
// follow redirects, or use an ambient proxy for authority-bearing evidence.
func ownerHTTPClient(dialTimeout, totalTimeout time.Duration, keepAlive bool) *http.Client {
	transport := &http.Transport{
		Proxy:                  nil,
		DialContext:            (&net.Dialer{Timeout: dialTimeout, KeepAlive: 30 * time.Second}).DialContext,
		DisableCompression:     true,
		DisableKeepAlives:      !keepAlive,
		MaxIdleConns:           16,
		IdleConnTimeout:        90 * time.Second,
		MaxResponseHeaderBytes: 16384,
	}
	return &http.Client{
		Transport:     transport,
		Timeout:       totalTimeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
}

var isolatedOwnerClient = ownerHTTPClient(2*time.Second, 2*time.Second, true)

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

// Every consumer must explicitly select its isolated runtime boundary.
// The container service and local preview origins are mutually exclusive.
func newIdentityReader(origin string, containerMode bool) (identityReader, error) {
	if containerMode {
		if origin != "http://identity:3302" {
			return identityReader{}, errors.New("WLT requires the isolated container Identity origin")
		}
	} else if !validLoopbackOwnerOrigin(origin) {
		return identityReader{}, errors.New("WLT requires the isolated Identity loopback origin")
	}
	return identityReader{endpoint: origin + sessionPath, client: isolatedOwnerClient}, nil
}

func validBearer(header string) bool {
	token, ok := strings.CutPrefix(header, "Bearer ")
	if !ok || len(token) != 43 || strings.ContainsRune(token, 13) || strings.ContainsRune(token, 10) {
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

// Finance authority is one observation of an explicit grant bracketed by
// current Identity session reads. A delayed grant cannot revive an expired,
// revoked, replaced or differently scoped operator session.
func (identity identityReader) finance(ctx context.Context, auth string) (principal, int) {
	before, status := identity.readRole(ctx, auth, "operator")
	if status != http.StatusOK {
		return principal{}, status
	}
	var grant struct {
		ActorID    *string `json:"actorId"`
		Permission *string `json:"permission"`
	}
	endpoint := strings.TrimSuffix(identity.endpoint, sessionPath) + financePermissionPath
	if status = identity.readBoundedOwner(ctx, auth, endpoint, &grant, identityReplyLimit); status != http.StatusOK {
		return principal{}, status
	}
	if grant.ActorID == nil || grant.Permission == nil {
		return principal{}, http.StatusServiceUnavailable
	}
	if *grant.ActorID != before.ActorID || *grant.Permission != "finance" {
		return principal{}, http.StatusForbidden
	}
	after, status := identity.readRole(ctx, auth, "operator")
	if status != http.StatusOK {
		return principal{}, status
	}
	if ctx.Err() != nil {
		return principal{}, http.StatusServiceUnavailable
	}
	now := time.Now()
	if before.ActorID != after.ActorID || !before.Expires.After(now) || !after.Expires.After(now) {
		return principal{}, http.StatusUnauthorized
	}
	return after, http.StatusOK
}

func (identity identityReader) readBoundedOwner(ctx context.Context, auth, endpoint string, destination any, limit int64) int {
	if !validBearer(auth) {
		return http.StatusUnauthorized
	}
	status, err := requestOwnerDocument(ctx, identity.client, endpoint, auth, destination, limit, true)
	if err != nil {
		return http.StatusServiceUnavailable
	}
	switch status {
	case http.StatusOK, http.StatusUnauthorized, http.StatusForbidden:
		return status
	default:
		return http.StatusServiceUnavailable
	}
}

// CheckDevelopmentIdentityHealth observes the exact isolated Identity
// readiness document. It grants no session, financial or serving authority.
func CheckDevelopmentIdentityHealth(ctx context.Context, origin string) error {
	if origin != "http://identity:3302" && !validLoopbackOwnerOrigin(origin) {
		return errors.New("invalid isolated Identity health origin")
	}
	var health struct {
		Status string `json:"status"`
	}
	status, err := requestOwnerDocument(ctx, isolatedOwnerClient, origin+"/health", "", &health, identityReplyLimit, true)
	if err != nil || status != http.StatusOK || health.Status != "ok" {
		return errors.New("Identity development dependency unavailable")
	}
	return nil
}

// The caller admits the fixed destination before entering this common
// transport. Bearer admission and required response cache policy are distinct:
// private Identity/DSH documents and public Identity health require no-store;
// the synthetic provider retains its own separately admitted contract.
func requestOwnerDocument(ctx context.Context, client *http.Client, endpoint, auth string, destination any, limit int64, requireNoStore bool) (int, error) {
	if client == nil || ctx.Err() != nil {
		return 0, errors.New("owner request unavailable")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Accept-Encoding", "identity")
	request.Header.Set("Cache-Control", "no-store")
	if auth != "" {
		request.Header.Set("Authorization", auth)
	}
	response, err := client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return response.StatusCode, nil
	}
	if requireNoStore {
		cache := response.Header.Values("Cache-Control")
		if len(cache) != 1 || !strings.EqualFold(cache[0], "no-store") {
			return 0, errors.New("invalid owner cache policy")
		}
	}
	if err := decodeBoundedOwnerReply(response, destination, limit); err != nil {
		return 0, err
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	return http.StatusOK, nil
}

// net/http owns raw HTTP framing. Validate the representation it exposes,
// not raw transfer metadata already consumed by the standard library.
func decodeBoundedOwnerReply(response *http.Response, destination any, limit int64) error {
	if response == nil || response.Body == nil || limit <= 0 || limit > maxOwnerReplyLimit {
		return errors.New("invalid owner response bound")
	}
	length := response.ContentLength
	encodings := response.Header.Values("Content-Encoding")
	if response.Uncompressed || len(encodings) > 1 ||
		(len(encodings) == 1 && !strings.EqualFold(encodings[0], "identity")) ||
		length < -1 || length == 0 || length > limit ||
		(len(response.TransferEncoding) != 0 &&
			(len(response.TransferEncoding) != 1 || response.TransferEncoding[0] != "chunked" || length != -1)) {
		return errors.New("invalid owner response representation")
	}
	contentTypes := response.Header.Values("Content-Type")
	if len(contentTypes) != 1 {
		return errors.New("invalid owner response metadata")
	}
	media, _, err := mime.ParseMediaType(contentTypes[0])
	if err != nil || media != "application/json" {
		return errors.New("invalid owner response media type")
	}
	ceiling := limit
	if length >= 0 {
		ceiling = length
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, ceiling+1))
	if err != nil || int64(len(body)) > ceiling || (length >= 0 && int64(len(body)) != length) {
		return errors.New("invalid owner response size")
	}
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return errors.New("owner response must be a JSON object")
	}
	// JSON v2 rejects duplicate names, invalid Unicode and unknown members.
	return json.Unmarshal(body, destination, json.RejectUnknownMembers(true))
}
