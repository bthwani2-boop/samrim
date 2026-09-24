package transporthttp

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/wlt"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

var errDeliveryFeeOperatorNotActive = errors.New("delivery fee operator is not active")

type DeliveryFeeServer struct {
	auth     *auth.ServiceToken
	identity *identityintegration.Client
	payment  *wlt.Client
}

func NewDeliveryFee(identityClient *identityintegration.Client, accessToken string, payment *wlt.Client) (*DeliveryFeeServer, error) {
	authorizer, err := auth.NewServiceToken(accessToken)
	if err != nil {
		return nil, err
	}
	if identityClient == nil || payment == nil {
		return nil, errors.New("delivery fee configuration is invalid")
	}
	return &DeliveryFeeServer{auth: authorizer, identity: identityClient, payment: payment}, nil
}

func (s *DeliveryFeeServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/operator/delivery-fee-policy", s.read)
	mux.HandleFunc("POST /dsh/operator/delivery-fee-policy", s.create)
}

func (s *DeliveryFeeServer) read(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if err := s.requireOperator(r.Context(), acting); err != nil {
		s.writeOperatorError(w, err)
		return
	}
	policy, err := s.payment.ReadDeliveryFeePolicy(r.Context(), r.URL.Query().Get("serviceCityId"))
	if err != nil {
		s.writeWLTError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"policy": policy, "idempotentReplay": false})
}

func (s *DeliveryFeeServer) create(w http.ResponseWriter, r *http.Request) {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	if err := s.requireOperator(r.Context(), acting); err != nil {
		s.writeOperatorError(w, err)
		return
	}
	if !s.requirePlatformPolicyPermission(w, r.Context(), acting) {
		return
	}
	var input struct {
		ServiceCityID          string `json:"serviceCityId"`
		BaseFeeMinor           int64  `json:"baseFeeMinor"`
		DistanceUnitMeters     int64  `json:"distanceUnitMeters"`
		DistanceRateMinor      int64  `json:"distanceRateMinor"`
		OrderSizeUnitBaseUnits int64  `json:"orderSizeUnitBaseUnits"`
		OrderSizeRateMinor     int64  `json:"orderSizeRateMinor"`
		ZoneSurchargeMinor     int64  `json:"zoneSurchargeMinor"`
		RoundingUnitMinor      int64  `json:"roundingUnitMinor"`
		ExpectedVersion        int    `json:"expectedVersion"`
		Reason                 string `json:"reason"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	policy, replayed, err := s.payment.CreateDeliveryFeePolicy(r.Context(), wlt.DeliveryFeePolicy{ServiceCityID: input.ServiceCityID, BaseFeeMinor: input.BaseFeeMinor, DistanceUnitMeters: input.DistanceUnitMeters, DistanceRateMinor: input.DistanceRateMinor, OrderSizeUnitBaseUnits: input.OrderSizeUnitBaseUnits, OrderSizeRateMinor: input.OrderSizeRateMinor, ZoneSurchargeMinor: input.ZoneSurchargeMinor, RoundingUnitMinor: input.RoundingUnitMinor}, input.ExpectedVersion, input.Reason, idempotency, correlation, acting)
	if err != nil {
		s.writeWLTError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{"policy": policy, "idempotentReplay": replayed})
}

func (s *DeliveryFeeServer) requirePlatformPolicyPermission(w http.ResponseWriter, ctx context.Context, actorID string) bool {
	permission, err := s.identity.ReadOperatorPermission(ctx, actorID, "platform_policies")
	if err != nil {
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) {
			writeIdentityError(w, err)
		} else {
			writeError(w, http.StatusBadGateway, "IDENTITY_UNAVAILABLE", "operator permission could not be verified")
		}
		return false
	}
	if !permission.Enabled {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "Platform Policies permission is required")
		return false
	}
	return true
}

func (s *DeliveryFeeServer) requireOperator(ctx context.Context, actorID string) error {
	if actorID == "" || len(actorID) > 128 {
		return errDeliveryFeeOperatorNotActive
	}
	operator, err := s.identity.ReadActorRole(ctx, actorID, "operator")
	if err != nil {
		return err
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		return errDeliveryFeeOperatorNotActive
	}
	return nil
}

func (s *DeliveryFeeServer) writeOperatorError(w http.ResponseWriter, err error) {
	if errors.Is(err, errDeliveryFeeOperatorNotActive) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active control operator session is required")
		return
	}
	var identityErr *identityclient.Error
	if errors.As(err, &identityErr) {
		writeIdentityError(w, err)
		return
	}
	writeError(w, http.StatusBadGateway, "IDENTITY_UNAVAILABLE", "identity service is unavailable")
}

func (s *DeliveryFeeServer) writeWLTError(w http.ResponseWriter, err error) {
	var wltErr *wlt.Error
	if errors.As(err, &wltErr) {
		status := wltErr.Status
		if status < 400 || status > 599 {
			status = http.StatusBadGateway
		}
		writeError(w, status, wltErr.Code, wltErr.Message)
		return
	}
	writeError(w, http.StatusBadGateway, "WLT_DELIVERY_FEE_UNAVAILABLE", "delivery fee policy is unavailable")
}
