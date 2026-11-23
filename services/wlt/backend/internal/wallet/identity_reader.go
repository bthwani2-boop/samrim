package wallet

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
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

func newIdentityReader(origin string, containerMode ...bool) (identityReader, error) {
	allowedContainer := len(containerMode) == 1 && containerMode[0] && origin == "http://identity:3302"
	root, err := url.Parse(origin)
	if err != nil || (!allowedContainer && (root.Scheme != "http" || root.Hostname() != "127.0.0.1" ||
		root.Port() == "" || root.User != nil || root.Path != "" || root.ForceQuery ||
		root.RawQuery != "" || root.Fragment != "" || origin != root.String())) {
		return identityReader{}, errors.New("WLT requires the isolated Identity loopback origin")
	}
	return identityReader{
		endpoint: origin + "/v1/sessions/current",
		client: &http.Client{
			Timeout: 2 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
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
	var actor principal
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, identity.endpoint, nil)
	if err != nil {
		return actor, http.StatusServiceUnavailable
	}
	request.Header.Set("Authorization", auth)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Cache-Control", "no-store")
	response, err := identity.client.Do(request)
	if err != nil {
		return actor, http.StatusServiceUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized {
		return actor, http.StatusUnauthorized
	}
	media, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	cache := response.Header.Values("Cache-Control")
	if response.StatusCode != http.StatusOK || err != nil || media != "application/json" ||
		len(cache) != 1 || !strings.EqualFold(cache[0], "no-store") {
		return actor, http.StatusServiceUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 4097))
	if err != nil || len(body) > 4096 || !utf8.Valid(body) {
		return actor, http.StatusServiceUnavailable
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&actor) != nil || decoder.Decode(new(any)) != io.EOF ||
		actor.ActorID == "" || utf8.RuneCountInString(actor.ActorID) > 128 ||
		strings.TrimSpace(actor.ActorID) != actor.ActorID || strings.ContainsFunc(actor.ActorID, unicode.IsControl) ||
		!actor.Expires.After(time.Now()) {
		return actor, http.StatusServiceUnavailable
	}
	if actor.Role != "customer" {
		return actor, http.StatusForbidden
	}
	return actor, http.StatusOK
}
