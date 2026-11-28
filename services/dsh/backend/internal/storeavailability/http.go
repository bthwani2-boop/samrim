package storeavailability

import (
	"bytes"
	"encoding/json"
	jsonv2 "encoding/json/v2"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
)

// NewHandler exposes owner-guarded availability reads and updates.
// Mount it only after the canonical Store schema, current Identity verifier,
// Store-grant checks and DSH operational policy source are actually wired.
func NewHandler(service *Service) (http.Handler, error) {
	if service == nil {
		return nil, ErrUnauthorized
	}
	mux := http.NewServeMux()
	reader, _ := service.grants.(MerchantStoreLister)
	mux.Handle("GET /v1/stores/mine", NewMerchantStandingHandler(service.identity, reader))
	mux.HandleFunc("GET /v1/stores/{storeID}/availability", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		token, ok := bearerToken(r)
		if !ok {
			writeFailure(w, ErrUnauthorized)
			return
		}
		snapshot, err := service.ReadForActor(r.Context(), token, r.PathValue("storeID"))
		if err != nil {
			writeFailure(w, err)
			return
		}
		writeJSON(w, http.StatusOK, snapshot)
	})
	mux.HandleFunc("PATCH /v1/stores/{storeID}/availability", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		token, ok := bearerToken(r)
		if !ok {
			writeFailure(w, ErrUnauthorized)
			return
		}
		// Even if the caller is authenticated, prevent oversized/unknown input.
		var input struct {
			OperationID     string `json:"operationId"`
			ExpectedVersion *int64 `json:"expectedVersion"`
			Weekly          *[]struct {
				Weekday *time.Weekday `json:"weekday"`
				Opens   *int          `json:"opens"`
				Closes  *int          `json:"closes"`
			} `json:"weekly"`
			PausedUntil        *time.Time `json:"pausedUntil"`
			PreparationMinutes *int       `json:"preparationMinutes"`
			Reason             string     `json:"reason"`
		}
		if decodeUniqueJSON(w, r, 16*1024, &input) != nil {
			writeFailure(w, ErrInvalidChange)
			return
		}
		if input.ExpectedVersion == nil || input.Weekly == nil || input.PreparationMinutes == nil {
			writeFailure(w, ErrInvalidChange)
			return
		}
		weekly := make([]WeeklyWindow, 0, len(*input.Weekly))
		for _, slot := range *input.Weekly {
			if slot.Weekday == nil || slot.Opens == nil || slot.Closes == nil {
				writeFailure(w, ErrInvalidChange)
				return
			}
			weekly = append(weekly, WeeklyWindow{Weekday: *slot.Weekday, Opens: *slot.Opens, Closes: *slot.Closes})
		}
		var pausedUntil *time.Time
		if input.PausedUntil != nil {
			t := *input.PausedUntil
			pausedUntil = &t
		}
		snapshot, replay, err := service.Change(r.Context(), token, Change{
			StoreID: r.PathValue("storeID"), OperationID: input.OperationID,
			ExpectedVersion: *input.ExpectedVersion,
			Weekly:          weekly, PausedUntil: pausedUntil,
			PreparationMinutes: *input.PreparationMinutes, Reason: input.Reason,
		})
		if err != nil {
			writeFailure(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			Availability Snapshot `json:"availability"`
			Replay       bool     `json:"replay"`
		}{Availability: snapshot, Replay: replay})
	})
	return mux, nil
}

// NewMerchantStandingHandler exposes only the current Merchant's owned Store read.
func NewMerchantStandingHandler(identity IdentitySessions, reader MerchantStoreLister) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		token, ok := bearerToken(r)
		if !ok {
			writeFailure(w, ErrUnauthorized)
			return
		}
		standing, err := listMerchantStores(r.Context(), token, identity, reader)
		if err != nil {
			writeFailure(w, err)
			return
		}
		writeJSON(w, http.StatusOK, standing)
	})
}

// Decode a single bounded JSON object using the native strict decoder.
func decodeUniqueJSON(w http.ResponseWriter, r *http.Request, limit int64, target any) error {
	values := r.Header.Values("Content-Type")
	if len(values) != 1 || len(r.Header.Values("Content-Encoding")) != 0 || r.URL.RawQuery != "" || r.URL.ForceQuery || r.Body == nil || r.ContentLength > limit {
		return ErrInvalidChange
	}
	media, params, err := mime.ParseMediaType(values[0])
	if err != nil || media != "application/json" {
		return ErrInvalidChange
	}
	for key, value := range params {
		if key != "charset" || !strings.EqualFold(value, "utf-8") {
			return ErrInvalidChange
		}
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	body, err := io.ReadAll(r.Body)
	body = bytes.Trim(body, " \t\r\n")
	if err != nil || len(body) == 0 || body[0] != '{' || jsonv2.Unmarshal(body, target, jsonv2.RejectUnknownMembers(true)) != nil {
		return ErrInvalidChange
	}
	return nil
}

func bearerToken(r *http.Request) (string, bool) {
	values := r.Header.Values("Authorization")
	if len(values) != 1 || !strings.HasPrefix(values[0], "Bearer ") {
		return "", false
	}
	token := strings.TrimPrefix(values[0], "Bearer ")
	if token == "" || strings.TrimSpace(token) != token || strings.ContainsAny(token, " \r\n\t") {
		return "", false
	}
	return token, true
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeFailure(w http.ResponseWriter, err error) {
	code := http.StatusInternalServerError
	category := "OWNER_UNAVAILABLE"
	switch {
	case errors.Is(err, ErrUnauthorized):
		code, category = http.StatusUnauthorized, "UNAUTHENTICATED"
	case errors.Is(err, ErrIdentityUnavailable):
		code, category = http.StatusServiceUnavailable, "IDENTITY_OWNER_UNAVAILABLE"
	case errors.Is(err, ErrForbidden):
		code, category = http.StatusForbidden, "STORE_OPERATION_FORBIDDEN"
	case errors.Is(err, ErrStoreMissing):
		code, category = http.StatusNotFound, "STORE_NOT_FOUND"
	case errors.Is(err, ErrVersionConflict):
		code, category = http.StatusConflict, "STORE_AVAILABILITY_VERSION_CONFLICT"
	case errors.Is(err, ErrPolicyVersionConflict):
		code, category = http.StatusConflict, "OPERATIONAL_POLICY_VERSION_CONFLICT"
	case errors.Is(err, ErrOperationConflict):
		code, category = http.StatusConflict, "IDEMPOTENCY_KEY_REUSED"
	case errors.Is(err, ErrInvalidChange), errors.Is(err, ErrInvalidSchedule), errors.Is(err, ErrInvalidTimezone):
		code, category = http.StatusBadRequest, "INVALID_OPERATIONAL_CHANGE"
	case errors.Is(err, ErrUnknownResult):
		code, category = http.StatusServiceUnavailable, "OPERATION_RESULT_UNKNOWN"
	case errors.Is(err, ErrStoreOwnerUnavailable):
		code, category = http.StatusServiceUnavailable, "STORE_OWNER_UNAVAILABLE"
	case errors.Is(err, ErrPolicyUnavailable):
		code, category = http.StatusServiceUnavailable, "OPERATIONAL_POLICY_UNAVAILABLE"
	}
	writeJSON(w, code, struct {
		Code string `json:"code"`
	}{Code: category})
}
