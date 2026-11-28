package wallet

import (
	"context"
	"database/sql"
	"encoding/json/v2"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
)

const agreementCommandMaxBody = 4096

type agreementDecisionWire struct {
	Version             int64  `json:"version"`
	ProposalOperationID string `json:"proposalOperationId"`
	OperationID         string `json:"operationId"`
	Decision            string `json:"decision"`
	Reason              string `json:"reason"`
}

type agreementDecisionReceipt struct {
	StoreID             string `json:"storeId"`
	Version             int64  `json:"version"`
	ProposalOperationID string `json:"proposalOperationId"`
	OperationID         string `json:"operationId"`
	State               string `json:"state"`
}

type agreementDecisionExecutor func(context.Context, string, AgreementDecision) (string, error)

// NewIsolatedAgreementCommandHandler is the authenticated transport of the
// existing WLT command owner. It is NOT mounted by the read-only serving
// binary. The owner independently admits the database principal on every
// transaction; constructing this handler grants no database permission.
func NewIsolatedAgreementCommandHandler(db *sql.DB, identityOrigin, dshOrigin string) (http.Handler, error) {
	if db == nil || !validLoopbackOwnerOrigin(identityOrigin) || !validLoopbackOwnerOrigin(dshOrigin) {
		return nil, errors.New("isolated agreement command dependencies unavailable")
	}
	return agreementCommandRoutes(
		func(ctx context.Context, token string, d AgreementDecision) (string, error) {
			return RecordMerchantAgreementDecision(ctx, db, identityOrigin, dshOrigin, token, d)
		},
		func(ctx context.Context, token string, d AgreementDecision) (string, error) {
			return RecordFinanceAgreementDecision(ctx, db, identityOrigin, dshOrigin, token, d)
		},
		func(ctx context.Context, token string, p AgreementProposal) (AgreementProposalReceipt, error) {
			return RecordFinanceAgreementProposal(ctx, db, identityOrigin, dshOrigin, token, p)
		},
	), nil
}

func agreementCommandRoutes(merchant, finance agreementDecisionExecutor, propose agreementProposalExecutor) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/merchants/stores/{storeID}/commercial-agreement/decisions", agreementDecisionHandler(merchantStage, merchant))
	mux.HandleFunc("/v1/operators/stores/{storeID}/commercial-agreement/decisions", agreementDecisionHandler(financeStage, finance))
	mux.HandleFunc("/v1/operators/stores/{storeID}/commercial-agreement/proposals", agreementProposalHandler(propose))
	// Do not let ServeMux normalize alternate paths or redirect a command.
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		parts := strings.Split(r.URL.Path, "/")
		if r.URL.RawPath != "" || len(parts) != 7 || parts[0] != "" || parts[1] != "v1" ||
			(parts[2] != "merchants" && parts[2] != "operators") || parts[3] != "stores" ||
			!storeIDRule.MatchString(parts[4]) || parts[5] != "commercial-agreement" ||
			(parts[6] != "decisions" && !(parts[2] == "operators" && parts[6] == "proposals")) {
			failure(w, http.StatusBadRequest, "INVALID_REQUEST")
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func decodeAgreementCommandBody(w http.ResponseWriter, r *http.Request, input any) bool {
	types := r.Header.Values("Content-Type")
	if len(types) != 1 || len(r.Header.Values("Content-Encoding")) != 0 ||
		r.URL.RawQuery != "" || r.URL.ForceQuery || r.Body == nil ||
		r.ContentLength < -1 || r.ContentLength == 0 || r.ContentLength > agreementCommandMaxBody {
		return false
	}
	media, params, err := mime.ParseMediaType(types[0])
	if err != nil || media != "application/json" {
		return false
	}
	for name, value := range params {
		if name != "charset" || !strings.EqualFold(value, "utf-8") {
			return false
		}
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, agreementCommandMaxBody))
	if err != nil || (r.ContentLength >= 0 && int64(len(body)) != r.ContentLength) {
		return false
	}
	return json.Unmarshal(body, input, json.RejectUnknownMembers(true)) == nil
}

func decodeAgreementDecision(w http.ResponseWriter, r *http.Request, stage decisionStage) (AgreementDecision, bool) {
	var wire agreementDecisionWire
	if !decodeAgreementCommandBody(w, r, &wire) {
		return AgreementDecision{}, false
	}
	d := AgreementDecision{StoreID: r.PathValue("storeID"), Version: wire.Version,
		ProposalOperationID: wire.ProposalOperationID, OperationID: wire.OperationID,
		Decision: wire.Decision, Reason: wire.Reason}
	return d, validAgreementDecision(d, stage)
}

func agreementDecisionHandler(stage decisionStage, execute agreementDecisionExecutor) http.HandlerFunc {
	return agreementCommandHandler("DECISION_CONFLICT", "DECISION_UNCONFIRMED",
		func(w http.ResponseWriter, r *http.Request) (AgreementDecision, bool) {
			return decodeAgreementDecision(w, r, stage)
		},
		func(ctx context.Context, token string, d AgreementDecision) (agreementDecisionReceipt, error) {
			if execute == nil {
				return agreementDecisionReceipt{}, ErrAgreementUnconfirmed
			}
			state, err := execute(ctx, token, d)
			if err != nil {
				return agreementDecisionReceipt{}, err
			}
			if state != "RECORDED" && state != "REPLAYED" {
				return agreementDecisionReceipt{}, ErrAgreementUnconfirmed
			}
			return agreementDecisionReceipt{StoreID: d.StoreID, Version: d.Version,
				ProposalOperationID: d.ProposalOperationID, OperationID: d.OperationID, State: state}, nil
		})
}

func agreementCommandHandler[I, R any](conflict, unconfirmed string,
	decode func(http.ResponseWriter, *http.Request) (I, bool),
	execute func(context.Context, string, I) (R, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			failure(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED")
			return
		}
		auth := r.Header.Values("Authorization")
		if len(auth) != 1 || !validBearer(auth[0]) {
			failure(w, http.StatusUnauthorized, "UNAUTHORIZED")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
		defer cancel()
		input, valid := decode(w, r)
		if !valid {
			failure(w, http.StatusBadRequest, "INVALID_REQUEST")
			return
		}
		if ctx.Err() != nil {
			failure(w, http.StatusServiceUnavailable, unconfirmed)
			return
		}
		result, err := execute(ctx, strings.TrimPrefix(auth[0], "Bearer "), input)
		switch {
		case errors.Is(err, ErrAgreementInvalid):
			failure(w, http.StatusBadRequest, "INVALID_REQUEST")
		case errors.Is(err, ErrAgreementUnauthorized):
			failure(w, http.StatusUnauthorized, "UNAUTHORIZED")
		case errors.Is(err, ErrAgreementForbidden):
			failure(w, http.StatusForbidden, "FORBIDDEN")
		case errors.Is(err, ErrAgreementConflict):
			failure(w, http.StatusConflict, conflict)
		case err != nil || ctx.Err() != nil:
			// The owner may have committed before transport confirmation was lost.
			// Never claim rejection, activate terms or retry with a new operation ID.
			failure(w, http.StatusServiceUnavailable, unconfirmed)
		default:
			reply(w, http.StatusOK, result)
		}
	}
}
