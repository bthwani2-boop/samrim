package wallet

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"time"
)

var decimalYER = regexp.MustCompile(`^(0|[1-9][0-9]{0,37})$`)

type walletAmounts struct{ Posted, Available string }
type balanceReader func(context.Context, string) (walletAmounts, error)
type historyReader func(context.Context, string, *historyCursor) (fundingHistory, error)

func newHandler(origin string, balance balanceReader) (http.Handler, error) {
	return newHandlerWithHistory(origin, balance, nil)
}

func newHandlerWithHistory(origin string, balance balanceReader, history historyReader) (http.Handler, error) {
	return newHandlerWithHistoryMode(origin, balance, history, nil, nil, false)
}

func newHandlerWithHistoryMode(origin string, balance balanceReader, history historyReader, agreement agreementReader, allocation allocationReader, containerMode bool) (http.Handler, error) {
	identity, err := newIdentityReader(origin, containerMode)
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/wallets/me", func(w http.ResponseWriter, r *http.Request) {
		serveAuthorizedRead(w, r, identity.read, func(ctx context.Context, actorID string) (any, error) {
			value, err := balance(ctx, actorID)
			if err != nil {
				return nil, err
			}
			if !decimalYER.MatchString(value.Posted) || !decimalYER.MatchString(value.Available) ||
				len(value.Available) > len(value.Posted) ||
				(len(value.Available) == len(value.Posted) && value.Available > value.Posted) {
				return nil, errors.New("invalid wallet balance")
			}
			return struct {
				ActorID      string `json:"actorId"`
				Currency     string `json:"currency"`
				BalanceYER   string `json:"balanceYer"`
				AvailableYER string `json:"availableYer"`
			}{actorID, "YER", value.Posted, value.Available}, nil
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
			serveAuthorizedRead(w, r, identity.read, func(ctx context.Context, actorID string) (any, error) {
				if history == nil {
					return nil, errors.New("funding history unavailable")
				}
				return history(ctx, actorID, cursor)
			}, true)
			return
		}
		serveAuthorizedRead(w, r, identity.read, nil, false)
	})
	mux.HandleFunc("/v1/operators/stores/{storeID}/commercial-agreement", func(w http.ResponseWriter, r *http.Request) {
		store := r.PathValue("storeID")
		if !storeIDRule.MatchString(store) {
			failure(w, http.StatusBadRequest, "INVALID_REQUEST")
			return
		}
		serveAuthorizedRead(w, r, identity.finance, func(ctx context.Context, _ string) (any, error) {
			if agreement == nil {
				return nil, errors.New("agreement read unavailable")
			}
			return agreement(ctx, store)
		}, false)
	})
	mux.HandleFunc("/v1/wallets/me/order-payment-allocations/{checkoutID}", func(w http.ResponseWriter, r *http.Request) {
		checkout := r.PathValue("checkoutID")
		if !fundingIDPattern.MatchString(checkout) {
			failure(w, http.StatusBadRequest, "INVALID_REQUEST")
			return
		}
		serveAuthorizedRead(w, r, identity.read, func(ctx context.Context, actor string) (any, error) {
			if allocation == nil {
				return nil, errors.New("allocation read unavailable")
			}
			return allocation(ctx, actor, checkout)
		}, false)
	})
	return mux, nil
}

// The same Identity bearer is verified before and after the PostgreSQL read.
// No caller-supplied actor, role or other query input can choose the ledger scope.
func serveAuthorizedRead(w http.ResponseWriter, r *http.Request, verify func(context.Context, string) (principal, int),
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
	actor, status := verify(ctx, auth[0])
	if status != http.StatusOK {
		identityFailure(w, status)
		return
	}
	result, err := read(ctx, actor.ActorID)
	if err != nil || ctx.Err() != nil {
		failure(w, http.StatusServiceUnavailable, "OWNER_UNAVAILABLE")
		return
	}
	current, status := verify(ctx, auth[0])
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
