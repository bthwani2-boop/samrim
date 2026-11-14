package storeavailability

import (
	"encoding/json"
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
		mediaType, _, parseErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if parseErr != nil || mediaType != "application/json" {
			writeFailure(w, ErrInvalidChange)
			return
		}
		// Even if the caller is authenticated, prevent oversized/unknown input.
		r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		var input struct {
			OperationID        string         `json:"operationId"`
			ExpectedVersion    int64          `json:"expectedVersion"`
			Weekly             []WeeklyWindow `json:"weekly"`
			PausedUntil        *time.Time     `json:"pausedUntil"`
			PreparationMinutes int            `json:"preparationMinutes"`
			Reason             string         `json:"reason"`
		}
		if err := decoder.Decode(&input); err != nil {
			writeFailure(w, ErrInvalidChange)
			return
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			writeFailure(w, ErrInvalidChange)
			return
		}
		var pausedUntil *time.Time
		if input.PausedUntil != nil {
			t := *input.PausedUntil
			pausedUntil = &t
		}
		snapshot, replay, err := service.Change(r.Context(), token, Change{
			StoreID: r.PathValue("storeID"), OperationID: input.OperationID,
			ExpectedVersion: input.ExpectedVersion,
			Weekly:          input.Weekly, PausedUntil: pausedUntil,
			PreparationMinutes: input.PreparationMinutes, Reason: input.Reason,
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
	case errors.Is(err, ErrPolicyUnavailable):
		code, category = http.StatusServiceUnavailable, "OPERATIONAL_POLICY_UNAVAILABLE"
	}
	writeJSON(w, code, struct {
		Code string `json:"code"`
	}{Code: category})
}
