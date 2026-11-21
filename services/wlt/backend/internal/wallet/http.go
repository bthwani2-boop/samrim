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
type historyReader func(context.Context, string, *historyCursor) (fundingHistory, error)

type fundingTransaction struct {
	FundingID         string    `json:"fundingId"`
	AmountYER         string    `json:"amountYer"`
	PostedAt          time.Time `json:"postedAt"`
	ReversesFundingID *string   `json:"reversesFundingId,omitempty"`
}

type fundingHistory struct {
	ActorID    string               `json:"actorId"`
	Currency   string               `json:"currency"`
	Items      []fundingTransaction `json:"items"`
	HasMore    bool                 `json:"hasMore"`
	NextCursor *string              `json:"nextCursor"`
}

type historyCursor struct {
	postedAt  time.Time
	fundingID string
}

var fundingIDPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{8,128}$`)

// The cursor is a bounded canonical keyset position, never an actor selector.
// Every query still uses the current verified Identity actor as its first predicate.
func parseHistoryCursor(raw string) (*historyCursor, error) {
	if raw == "" {
		return nil, nil
	}
	query, err := url.ParseQuery(raw)
	if err != nil || len(query) != 1 || len(query["cursor"]) != 1 {
		return nil, errors.New("invalid history query")
	}
	encoded := query.Get("cursor")
	if len(encoded) < 20 || len(encoded) > 240 {
		return nil, errors.New("invalid cursor length")
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if err != nil || base64.RawURLEncoding.EncodeToString(decoded) != encoded {
		return nil, errors.New("invalid cursor encoding")
	}
	stamp, id, ok := strings.Cut(string(decoded), "|")
	if !ok || !fundingIDPattern.MatchString(id) || !strings.HasSuffix(stamp, "Z") {
		return nil, errors.New("invalid cursor data")
	}
	posted, err := time.Parse(time.RFC3339Nano, stamp)
	if err != nil || posted.UTC().Format(time.RFC3339Nano) != stamp {
		return nil, errors.New("invalid cursor timestamp")
	}
	return &historyCursor{postedAt: posted, fundingID: id}, nil
}

func makeHistoryCursor(entry fundingTransaction) string {
	text := entry.PostedAt.UTC().Format(time.RFC3339Nano) + "|" + entry.FundingID
	return base64.RawURLEncoding.EncodeToString([]byte(text))
}

const historySQL = `SELECT funding_id, amount_yer::text, posted_at, reverses_funding_id
    FROM wlt.customer_funding_history
    WHERE actor_id = $1 AND ($2::timestamptz IS NULL OR
        (posted_at, funding_id COLLATE "C") < ($2::timestamptz, $3::text COLLATE "C"))
    ORDER BY posted_at DESC, funding_id COLLATE "C" DESC LIMIT 11`

const balanceSQL = `SELECT COALESCE(
	(SELECT balance_yer FROM wlt.customer_wallet_balances WHERE actor_id = $1), 0)::text`

func NewHandler(db *sql.DB, identityOrigin string) (http.Handler, error) {
	return newWalletHandler(db, identityOrigin, false)
}

// NewContainerHandler permits only the named, internal synthetic Identity service.
// It does not expand the local CLI or preview origin trust boundary.
func NewContainerHandler(db *sql.DB, identityOrigin string) (http.Handler, error) {
	if identityOrigin != "http://identity:3302" {
		return nil, errors.New("WLT requires the isolated container Identity origin")
	}
	return newWalletHandler(db, identityOrigin, true)
}

func newWalletHandler(db *sql.DB, identityOrigin string, containerMode bool) (http.Handler, error) {
	if db == nil {
		return nil, errors.New("WLT balance reader unavailable")
	}
	return newHandlerWithHistoryMode(identityOrigin, func(ctx context.Context, actorID string) (string, error) {
		var balance string
		err := db.QueryRowContext(ctx, balanceSQL, actorID).Scan(&balance)
		return balance, err
	}, func(ctx context.Context, actorID string, cursor *historyCursor) (fundingHistory, error) {
		result := fundingHistory{ActorID: actorID, Currency: "YER", Items: []fundingTransaction{}}
		var dateArg any
		var idArg string
		if cursor != nil {
			dateArg = cursor.postedAt
			idArg = cursor.fundingID
		}
		rows, err := db.QueryContext(ctx, historySQL, actorID, dateArg, idArg)
		if err != nil {
			return result, err
		}
		defer rows.Close()
		for rows.Next() {
			var entry fundingTransaction
			if err := rows.Scan(&entry.FundingID, &entry.AmountYER, &entry.PostedAt, &entry.ReversesFundingID); err != nil {
				return result, err
			}
			if !decimalYER.MatchString(entry.AmountYER) || entry.AmountYER == "0" || entry.PostedAt.IsZero() {
				return result, errors.New("invalid posted funding transaction")
			}
			if len(result.Items) == 10 {
				result.HasMore = true
				next := makeHistoryCursor(result.Items[len(result.Items)-1])
				result.NextCursor = &next
				break
			}
			entry.PostedAt = entry.PostedAt.UTC()
			result.Items = append(result.Items, entry)
		}
		if err := rows.Err(); err != nil {
			return result, err
		}
		return result, nil
	}, containerMode)
}

func newHandler(origin string, balance balanceReader) (http.Handler, error) {
	return newHandlerWithHistory(origin, balance, nil)
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

func newHandlerWithHistory(origin string, balance balanceReader, history historyReader) (http.Handler, error) {
	return newHandlerWithHistoryMode(origin, balance, history, false)
}

func newHandlerWithHistoryMode(origin string, balance balanceReader, history historyReader, containerMode bool) (http.Handler, error) {
	identity, err := newIdentityReader(origin, containerMode)
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/wallets/me", func(w http.ResponseWriter, r *http.Request) {
		serveAuthorizedRead(w, r, identity, func(ctx context.Context, actorID string) (any, error) {
			value, err := balance(ctx, actorID)
			if err != nil {
				return nil, err
			}
			if !decimalYER.MatchString(value) {
				return nil, errors.New("invalid wallet balance")
			}
			return struct {
				ActorID    string `json:"actorId"`
				Currency   string `json:"currency"`
				BalanceYER string `json:"balanceYer"`
			}{actorID, "YER", value}, nil
		}, false)
	})
	mux.HandleFunc("/v1/wallets/me/transactions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			if r.URL.ForceQuery {
				failure(w, http.StatusBadRequest, "INVALID_REQUEST")
				return
			}
			cursor, err := parseHistoryCursor(r.URL.RawQuery)
			if err != nil {
				failure(w, http.StatusBadRequest, "INVALID_REQUEST")
				return
			}
			serveAuthorizedRead(w, r, identity, func(ctx context.Context, actorID string) (any, error) {
				if history == nil {
					return nil, errors.New("funding history unavailable")
				}
				return history(ctx, actorID, cursor)
			}, true)
			return
		}
		serveAuthorizedRead(w, r, identity, nil, false)
	})
	return mux, nil
}

// The same Identity bearer is verified before and after the PostgreSQL read.
// No caller-supplied actor, role or other query input can choose the ledger scope.
func serveAuthorizedRead(w http.ResponseWriter, r *http.Request, identity identityReader,
	read func(context.Context, string) (any, error), allowCursor bool,
) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		failure(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED")
		return
	}
	if r.URL.ForceQuery || (!allowCursor && r.URL.RawQuery != "") || r.ContentLength != 0 || len(r.TransferEncoding) > 0 {
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
	if status != http.StatusOK {
		identityFailure(w, status)
		return
	}
	result, err := read(ctx, actor.ActorID)
	if err != nil || ctx.Err() != nil {
		failure(w, http.StatusServiceUnavailable, "OWNER_UNAVAILABLE")
		return
	}
	current, status := identity.read(ctx, auth[0])
	if status != http.StatusOK {
		identityFailure(w, status)
		return
	}
	now := time.Now()
	if actor.ActorID != current.ActorID || !actor.Expires.After(now) || !current.Expires.After(now) {
		failure(w, http.StatusUnauthorized, "UNAUTHORIZED")
		return
	}
	reply(w, http.StatusOK, result)
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

func identityFailure(w http.ResponseWriter, status int) {
	switch status {
	case http.StatusUnauthorized:
		failure(w, status, "UNAUTHORIZED")
	case http.StatusForbidden:
		failure(w, status, "FORBIDDEN")
	default:
		failure(w, http.StatusServiceUnavailable, "OWNER_UNAVAILABLE")
	}
}

func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
