package wallet

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var decimalYER = regexp.MustCompile(`^(0|[1-9][0-9]{0,37})$`)

type principal struct {
	ActorID string    `json:"actorId"`
	Role    string    `json:"role"`
	Expires time.Time `json:"sessionExpiresAt"`
}

type identityReader struct {
	endpoint string
	client   *http.Client
}

type balanceReader func(context.Context, string) (string, error)

const balanceSQL = `SELECT COALESCE(
	(SELECT balance_yer FROM wlt.customer_wallet_balances WHERE actor_id = $1), 0)::text`

func NewHandler(db *sql.DB, identityOrigin string) (http.Handler, error) {
	if db == nil {
		return nil, errors.New("WLT balance reader unavailable")
	}
	return newHandler(identityOrigin, func(ctx context.Context, actorID string) (string, error) {
		var balance string
		err := db.QueryRowContext(ctx, balanceSQL, actorID).Scan(&balance)
		return balance, err
	})
}

func newHandler(origin string, balance balanceReader) (http.Handler, error) {
	root, err := url.Parse(origin)
	if err != nil || root.Scheme != "http" || root.Hostname() != "127.0.0.1" ||
		root.Port() == "" || root.User != nil || root.Path != "" || root.ForceQuery ||
		root.RawQuery != "" || root.Fragment != "" || origin != root.String() {
		return nil, errors.New("WLT requires the isolated Identity loopback origin")
	}
	identity := identityReader{
		endpoint: origin + "/v1/sessions/current",
		client: &http.Client{
			Timeout: 2 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/wallets/me", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			failure(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED")
			return
		}
		if r.URL.ForceQuery || r.URL.RawQuery != "" || r.ContentLength != 0 || len(r.TransferEncoding) > 0 {
			failure(w, http.StatusBadRequest, "INVALID_REQUEST")
			return
		}
		auth := r.Header.Values("Authorization")
		if len(auth) != 1 || !validBearer(auth[0]) {
			failure(w, http.StatusUnauthorized, "UNAUTHORIZED")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
		defer cancel()
		actor, status := identity.read(ctx, auth[0])
		switch status {
		case http.StatusUnauthorized:
			failure(w, status, "UNAUTHORIZED")
			return
		case http.StatusForbidden:
			failure(w, status, "FORBIDDEN")
			return
		case http.StatusOK:
		default:
			failure(w, http.StatusServiceUnavailable, "OWNER_UNAVAILABLE")
			return
		}
		value, err := balance(ctx, actor.ActorID)
		if err != nil || !decimalYER.MatchString(value) || ctx.Err() != nil {
			failure(w, http.StatusServiceUnavailable, "OWNER_UNAVAILABLE")
			return
		}
		if !actor.Expires.After(time.Now()) {
			failure(w, http.StatusUnauthorized, "UNAUTHORIZED")
			return
		}
		reply(w, http.StatusOK, struct {
			ActorID    string `json:"actorId"`
			Currency   string `json:"currency"`
			BalanceYER string `json:"balanceYer"`
		}{actor.ActorID, "YER", value})
	})
	return mux, nil
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

func failure(w http.ResponseWriter, status int, code string) {
	reply(w, status, map[string]string{"error": code})
}

func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
