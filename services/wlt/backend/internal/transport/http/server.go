package http

import (
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

type Server struct {
	db           *sql.DB
	serviceToken string
}

func New(db *sql.DB, serviceToken string) (*Server, error) {
	if db == nil || strings.TrimSpace(serviceToken) == "" {
		return nil, errors.New("WLT HTTP server configuration is invalid")
	}
	return &Server{db: db, serviceToken: strings.TrimSpace(serviceToken)}, nil
}

func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /wlt/v1/payment-intents", s.create)
	mux.HandleFunc("GET /wlt/v1/payment-intents/{intentId}", s.read)
	mux.HandleFunc("POST /wlt/v1/payment-intents/{intentId}/collect", s.collect)
	mux.HandleFunc("POST /wlt/v1/payment-intents/{intentId}/cancel", s.cancel)
	mux.HandleFunc("GET /wlt/v1/captains/{captainActorId}/cash-liability", s.cashLiability)
	mux.HandleFunc("GET /wlt/v1/operator/cash-liability", s.operatorCashLiability)
	mux.HandleFunc("POST /wlt/v1/payment-intents/{intentId}/remit", s.remitCash)
	mux.HandleFunc("POST /wlt/v1/delivery-quotes", s.deliveryQuote)
	mux.HandleFunc("GET /wlt/v1/operator/delivery-fee-policies", s.readDeliveryFeePolicy)
	mux.HandleFunc("POST /wlt/v1/operator/delivery-fee-policies", s.createDeliveryFeePolicy)
	mux.HandleFunc("POST /wlt/v1/partner-financial-profiles", s.preparePartnerFinancialProfile)
	mux.HandleFunc("GET /wlt/v1/partner-financial-profiles/{profileId}", s.readPartnerFinancialProfile)
	mux.HandleFunc("POST /wlt/v1/partner-financial-profiles/{profileId}/activate", s.activatePartnerFinancialProfile)
}

type createRequest struct {
	ExternalReference string                    `json:"externalReference"`
	PayerActorID      string                    `json:"payerActorId"`
	OrderID           string                    `json:"orderId"`
	AmountMinor       int64                     `json:"amountMinor"`
	Currency          string                    `json:"currency"`
	Method            string                    `json:"method"`
	Allocation        *paymentAllocationRequest `json:"allocation"`
}

type paymentAllocationRequest struct {
	OrderID                           string `json:"orderId"`
	Currency                          string `json:"currency"`
	SubtotalMinor                     int64  `json:"subtotalMinor"`
	DeliveryFeeMinor                  int64  `json:"deliveryFeeMinor"`
	DiscountMinor                     int64  `json:"discountMinor"`
	PlatformSubsidyMinor              int64  `json:"platformSubsidyMinor"`
	InternalWalletAmountMinor         int64  `json:"internalWalletAmountMinor"`
	ExternalOfficialWalletAmountMinor int64  `json:"externalOfficialWalletAmountMinor"`
	CashAmountMinor                   int64  `json:"cashAmountMinor"`
	CODProductAmountMinor             int64  `json:"codProductAmountMinor"`
	CODDeliveryAmountMinor            int64  `json:"codDeliveryAmountMinor"`
	TotalMinor                        int64  `json:"totalMinor"`
	PolicyVersion                     string `json:"policyVersion"`
}

type collectRequest struct {
	CollectedAmountMinor int64  `json:"collectedAmountMinor"`
	CollectedByActorID   string `json:"collectedByActorId"`
	CollectionReference  string `json:"collectionReference"`
}

type cancelRequest struct {
	Reason string `json:"reason"`
}

type remitCashRequest struct {
	CaptainActorID      string `json:"captainActorId"`
	AmountMinor         int64  `json:"amountMinor"`
	RemittanceReference string `json:"remittanceReference"`
}

type preparePartnerFinancialProfileRequest struct {
	JoiningCaseID     string `json:"joiningCaseId"`
	PartnerActorID    string `json:"partnerActorId"`
	Origin            string `json:"origin"`
	CommissionRateBps int    `json:"commissionRateBps"`
	SettlementPeriod  string `json:"settlementPeriod"`
}

type activatePartnerFinancialProfileRequest struct{}

type deliveryFeeQuoteRequest struct {
	ServiceCityID        string  `json:"serviceCityId"`
	OriginLatitude       float64 `json:"originLatitude"`
	OriginLongitude      float64 `json:"originLongitude"`
	DestinationLatitude  float64 `json:"destinationLatitude"`
	DestinationLongitude float64 `json:"destinationLongitude"`
	OrderSizeBaseUnits   int64   `json:"orderSizeBaseUnits"`
}

type createDeliveryFeePolicyRequest struct {
	ServiceCityID          string `json:"serviceCityId"`
	BaseFeeMinor           int64  `json:"baseFeeMinor"`
	DistanceUnitMeters     int64  `json:"distanceUnitMeters"`
	DistanceRateMinor      int64  `json:"distanceRateMinor"`
	OrderSizeUnitBaseUnits int64  `json:"orderSizeUnitBaseUnits"`
	OrderSizeRateMinor     int64  `json:"orderSizeRateMinor"`
	ZoneSurchargeMinor     int64  `json:"zoneSurchargeMinor"`
	RoundingUnitMinor      int64  `json:"roundingUnitMinor"`
}

type paymentIntentResponse struct {
	PaymentIntent    paymentIntentJSON `json:"paymentIntent"`
	IdempotentReplay bool              `json:"idempotentReplay"`
}

type paymentIntentJSON struct {
	ID                   string                 `json:"id"`
	ExternalReference    string                 `json:"externalReference"`
	PayerActorID         string                 `json:"payerActorId"`
	AmountMinor          int64                  `json:"amountMinor"`
	Currency             string                 `json:"currency"`
	Method               string                 `json:"method"`
	State                string                 `json:"state"`
	Version              int                    `json:"version"`
	CollectedAmountMinor *int64                 `json:"collectedAmountMinor"`
	CollectedByActorID   *string                `json:"collectedByActorId"`
	CollectionReference  *string                `json:"collectionReference"`
	CollectedAt          *string                `json:"collectedAt"`
	CancellationReason   *string                `json:"cancellationReason"`
	CreatedAt            string                 `json:"createdAt"`
	UpdatedAt            string                 `json:"updatedAt"`
	Allocation           *paymentAllocationJSON `json:"allocation,omitempty"`
}

type paymentAllocationJSON struct {
	ID                                string `json:"id"`
	OrderID                           string `json:"orderId"`
	PaymentIntentID                   string `json:"paymentIntentId"`
	Currency                          string `json:"currency"`
	SubtotalMinor                     int64  `json:"subtotalMinor"`
	DeliveryFeeMinor                  int64  `json:"deliveryFeeMinor"`
	DiscountMinor                     int64  `json:"discountMinor"`
	PlatformSubsidyMinor              int64  `json:"platformSubsidyMinor"`
	InternalWalletAmountMinor         int64  `json:"internalWalletAmountMinor"`
	ExternalOfficialWalletAmountMinor int64  `json:"externalOfficialWalletAmountMinor"`
	CashAmountMinor                   int64  `json:"cashAmountMinor"`
	CODProductAmountMinor             int64  `json:"codProductAmountMinor"`
	CODDeliveryAmountMinor            int64  `json:"codDeliveryAmountMinor"`
	TotalMinor                        int64  `json:"totalMinor"`
	PolicyVersion                     string `json:"policyVersion"`
	CreatedAt                         string `json:"createdAt"`
}

type cashLiabilityItemJSON struct {
	PaymentIntentID   string `json:"paymentIntentId"`
	ExternalReference string `json:"externalReference"`
	CaptainActorID    string `json:"captainActorId"`
	AmountMinor       int64  `json:"amountMinor"`
	Currency          string `json:"currency"`
	PaymentVersion    int    `json:"paymentVersion"`
	CollectedAt       string `json:"collectedAt"`
}

type cashLiabilityResponse struct {
	Items            []cashLiabilityItemJSON `json:"items"`
	TotalAmountMinor int64                   `json:"totalAmountMinor"`
}

type cashRemittanceJSON struct {
	ID                  string `json:"id"`
	PaymentIntentID     string `json:"paymentIntentId"`
	CaptainActorID      string `json:"captainActorId"`
	AmountMinor         int64  `json:"amountMinor"`
	Currency            string `json:"currency"`
	RemittanceReference string `json:"remittanceReference"`
	State               string `json:"state"`
	CreatedAt           string `json:"createdAt"`
}

type cashRemittanceResponse struct {
	CashRemittance   cashRemittanceJSON `json:"cashRemittance"`
	IdempotentReplay bool               `json:"idempotentReplay"`
}

type partnerFinancialProfileResponse struct {
	Profile          partnerFinancialProfileJSON `json:"profile"`
	IdempotentReplay bool                        `json:"idempotentReplay"`
}

type partnerFinancialProfileJSON struct {
	ID                string  `json:"id"`
	JoiningCaseID     string  `json:"joiningCaseId"`
	PartnerActorID    string  `json:"partnerActorId"`
	Origin            string  `json:"origin"`
	CommissionRateBps int     `json:"commissionRateBps"`
	SettlementPeriod  string  `json:"settlementPeriod"`
	RoundingUnitMinor int64   `json:"roundingUnitMinor"`
	State             string  `json:"state"`
	Version           int     `json:"version"`
	ActivatedAt       *string `json:"activatedAt"`
	CreatedAt         string  `json:"createdAt"`
	UpdatedAt         string  `json:"updatedAt"`
}

type deliveryFeePolicyResponse struct {
	Policy           deliveryFeePolicyJSON `json:"policy"`
	IdempotentReplay bool                  `json:"idempotentReplay"`
}

type deliveryFeePolicyJSON struct {
	ID                     string  `json:"id"`
	ServiceCityID          string  `json:"serviceCityId"`
	PolicyVersion          string  `json:"policyVersion"`
	State                  string  `json:"state"`
	BaseFeeMinor           int64   `json:"baseFeeMinor"`
	DistanceUnitMeters     int64   `json:"distanceUnitMeters"`
	DistanceRateMinor      int64   `json:"distanceRateMinor"`
	OrderSizeUnitBaseUnits int64   `json:"orderSizeUnitBaseUnits"`
	OrderSizeRateMinor     int64   `json:"orderSizeRateMinor"`
	ZoneSurchargeMinor     int64   `json:"zoneSurchargeMinor"`
	RoundingUnitMinor      int64   `json:"roundingUnitMinor"`
	Version                int     `json:"version"`
	CreatedBy              string  `json:"createdBy"`
	CreatedAt              string  `json:"createdAt"`
	RetiredAt              *string `json:"retiredAt"`
}

type deliveryFeeQuoteResponse struct {
	Quote deliveryFeeQuoteJSON `json:"quote"`
}

type deliveryFeeQuoteJSON struct {
	FeeMinor           int64  `json:"feeMinor"`
	PolicyVersion      string `json:"policyVersion"`
	ServiceCityID      string `json:"serviceCityId"`
	DistanceMeters     int64  `json:"distanceMeters"`
	DistanceUnits      int64  `json:"distanceUnits"`
	OrderSizeBaseUnits int64  `json:"orderSizeBaseUnits"`
	OrderSizeUnits     int64  `json:"orderSizeUnits"`
	RoundingUnitMinor  int64  `json:"roundingUnitMinor"`
}

func (s *Server) create(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input createRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	var allocation *postgres.PaymentAllocationInput
	if input.Allocation != nil {
		value := postgres.PaymentAllocationInput{OrderID: input.Allocation.OrderID, Currency: input.Allocation.Currency, SubtotalMinor: input.Allocation.SubtotalMinor, DeliveryFeeMinor: input.Allocation.DeliveryFeeMinor, DiscountMinor: input.Allocation.DiscountMinor, PlatformSubsidyMinor: input.Allocation.PlatformSubsidyMinor, InternalWalletAmountMinor: input.Allocation.InternalWalletAmountMinor, ExternalOfficialWalletAmountMinor: input.Allocation.ExternalOfficialWalletAmountMinor, CashAmountMinor: input.Allocation.CashAmountMinor, CODProductAmountMinor: input.Allocation.CODProductAmountMinor, CODDeliveryAmountMinor: input.Allocation.CODDeliveryAmountMinor, TotalMinor: input.Allocation.TotalMinor, PolicyVersion: input.Allocation.PolicyVersion}
		allocation = &value
	}
	result, replayed, err := postgres.CreatePaymentIntent(r.Context(), s.db, postgres.CreatePaymentIntentInput{ExternalReference: input.ExternalReference, PayerActorID: input.PayerActorID, OrderID: input.OrderID, AmountMinor: input.AmountMinor, Currency: input.Currency, Method: input.Method, Allocation: allocation, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writePaymentError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, paymentIntentResponse{PaymentIntent: toPaymentIntent(result), IdempotentReplay: replayed})
}

func (s *Server) read(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	result, err := postgres.ReadPaymentIntent(r.Context(), s.db, r.PathValue("intentId"))
	if err != nil {
		writePaymentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, paymentIntentResponse{PaymentIntent: toPaymentIntent(result)})
}

func (s *Server) collect(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, expected, ok := versionedMutationHeaders(w, r)
	if !ok {
		return
	}
	var input collectRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := postgres.CollectPaymentIntent(r.Context(), s.db, postgres.CollectPaymentIntentInput{IntentID: r.PathValue("intentId"), CollectedAmountMinor: input.CollectedAmountMinor, CollectedByActorID: input.CollectedByActorID, CollectionReference: input.CollectionReference, ExpectedVersion: expected, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writePaymentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, paymentIntentResponse{PaymentIntent: toPaymentIntent(result), IdempotentReplay: replayed})
}

func (s *Server) cancel(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, expected, ok := versionedMutationHeaders(w, r)
	if !ok {
		return
	}
	var input cancelRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := postgres.CancelPaymentIntent(r.Context(), s.db, postgres.CancelPaymentIntentInput{IntentID: r.PathValue("intentId"), Reason: input.Reason, ExpectedVersion: expected, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writePaymentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, paymentIntentResponse{PaymentIntent: toPaymentIntent(result), IdempotentReplay: replayed})
}

func (s *Server) cashLiability(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	result, err := postgres.ListCashLiability(r.Context(), s.db, r.PathValue("captainActorId"), 100)
	if err != nil {
		writePaymentError(w, err)
		return
	}
	writeCashLiability(w, result)
}

func (s *Server) operatorCashLiability(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	result, err := postgres.ListAllCashLiability(r.Context(), s.db, 100)
	if err != nil {
		writePaymentError(w, err)
		return
	}
	writeCashLiability(w, result)
}

func writeCashLiability(w http.ResponseWriter, result postgres.CashLiabilityList) {
	items := make([]cashLiabilityItemJSON, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, cashLiabilityItemJSON{PaymentIntentID: item.PaymentIntentID, ExternalReference: item.ExternalReference, CaptainActorID: item.CaptainActorID, AmountMinor: item.AmountMinor, Currency: item.Currency, PaymentVersion: item.PaymentVersion, CollectedAt: item.CollectedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")})
	}
	writeJSON(w, http.StatusOK, cashLiabilityResponse{Items: items, TotalAmountMinor: result.TotalAmountMinor})
}

func (s *Server) remitCash(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, expected, ok := versionedMutationHeaders(w, r)
	if !ok {
		return
	}
	var input remitCashRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := postgres.RemitCash(r.Context(), s.db, postgres.RemitCashInput{PaymentIntentID: r.PathValue("intentId"), CaptainActorID: input.CaptainActorID, AmountMinor: input.AmountMinor, RemittanceReference: input.RemittanceReference, ExpectedPaymentVersion: expected, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writePaymentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, cashRemittanceResponse{CashRemittance: toCashRemittance(result), IdempotentReplay: replayed})
}

func (s *Server) deliveryQuote(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	var input deliveryFeeQuoteRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	quote, err := postgres.ResolveDeliveryFeeQuote(r.Context(), s.db, postgres.DeliveryFeeQuoteInput{ServiceCityID: input.ServiceCityID, OriginLatitude: input.OriginLatitude, OriginLongitude: input.OriginLongitude, DestinationLatitude: input.DestinationLatitude, DestinationLongitude: input.DestinationLongitude, OrderSizeBaseUnits: input.OrderSizeBaseUnits})
	if err != nil {
		writeDeliveryFeeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, deliveryFeeQuoteResponse{Quote: toDeliveryFeeQuote(quote)})
}

func (s *Server) readDeliveryFeePolicy(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	policy, err := postgres.ReadDeliveryFeePolicy(r.Context(), s.db, r.URL.Query().Get("serviceCityId"))
	if err != nil {
		writeDeliveryFeeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, deliveryFeePolicyResponse{Policy: toDeliveryFeePolicy(policy)})
}

func (s *Server) createDeliveryFeePolicy(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	acting := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if acting == "" || len(acting) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return
	}
	var input createDeliveryFeePolicyRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	policy, replayed, err := postgres.CreateDeliveryFeePolicy(r.Context(), s.db, postgres.CreateDeliveryFeePolicyInput{ServiceCityID: input.ServiceCityID, BaseFeeMinor: input.BaseFeeMinor, DistanceUnitMeters: input.DistanceUnitMeters, DistanceRateMinor: input.DistanceRateMinor, OrderSizeUnitBaseUnits: input.OrderSizeUnitBaseUnits, OrderSizeRateMinor: input.OrderSizeRateMinor, ZoneSurchargeMinor: input.ZoneSurchargeMinor, RoundingUnitMinor: input.RoundingUnitMinor, ActingActorID: acting, IdempotencyKey: idempotency, CorrelationID: correlation})
	if err != nil {
		writeDeliveryFeeError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, deliveryFeePolicyResponse{Policy: toDeliveryFeePolicy(policy), IdempotentReplay: replayed})
}

func (s *Server) preparePartnerFinancialProfile(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return
	}
	var input preparePartnerFinancialProfileRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := postgres.PreparePartnerFinancialProfile(r.Context(), s.db, postgres.PreparePartnerFinancialProfileInput{
		JoiningCaseID:     input.JoiningCaseID,
		PartnerActorID:    input.PartnerActorID,
		Origin:            input.Origin,
		CommissionRateBps: input.CommissionRateBps,
		SettlementPeriod:  input.SettlementPeriod,
		IdempotencyKey:    idempotency,
		CorrelationID:     correlation,
	})
	if err != nil {
		writeFinancialProfileError(w, err)
		return
	}
	status := http.StatusCreated
	if replayed {
		status = http.StatusOK
	}
	writeJSON(w, status, partnerFinancialProfileResponse{Profile: toPartnerFinancialProfile(result), IdempotentReplay: replayed})
}

func (s *Server) readPartnerFinancialProfile(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	result, err := postgres.ReadPartnerFinancialProfile(r.Context(), s.db, r.PathValue("profileId"))
	if err != nil {
		writeFinancialProfileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, partnerFinancialProfileResponse{Profile: toPartnerFinancialProfile(result)})
}

func (s *Server) activatePartnerFinancialProfile(w http.ResponseWriter, r *http.Request) {
	if !s.authorize(w, r) {
		return
	}
	correlation, idempotency, expected, ok := versionedMutationHeaders(w, r)
	if !ok {
		return
	}
	var input activatePartnerFinancialProfileRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, replayed, err := postgres.ActivatePartnerFinancialProfile(r.Context(), s.db, postgres.ActivatePartnerFinancialProfileInput{
		ProfileID:       r.PathValue("profileId"),
		ExpectedVersion: expected,
		IdempotencyKey:  idempotency,
		CorrelationID:   correlation,
		ActorID:         strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")),
	})
	if err != nil {
		writeFinancialProfileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, partnerFinancialProfileResponse{Profile: toPartnerFinancialProfile(result), IdempotentReplay: replayed})
}

func (s *Server) authorize(w http.ResponseWriter, r *http.Request) bool {
	provided := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(r.Header.Get("Authorization")), "Bearer "))
	if provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(s.serviceToken)) != 1 {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "WLT service authorization is required")
		return false
	}
	return true
}

func mutationHeaders(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	correlation := strings.TrimSpace(r.Header.Get("X-Correlation-ID"))
	idempotency := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(correlation) < 8 || len(correlation) > 128 || len(idempotency) < 8 || len(idempotency) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Correlation-ID and Idempotency-Key are required")
		return "", "", false
	}
	return correlation, idempotency, true
}

func versionedMutationHeaders(w http.ResponseWriter, r *http.Request) (string, string, int, bool) {
	correlation, idempotency, ok := mutationHeaders(w, r)
	if !ok {
		return "", "", 0, false
	}
	expected, err := strconv.Atoi(strings.TrimSpace(r.Header.Get("X-Expected-Version")))
	if err != nil || expected < 1 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Expected-Version must be a positive integer")
		return "", "", 0, false
	}
	return correlation, idempotency, expected, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 32*1024)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "request body is invalid")
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "request body must contain exactly one JSON value")
		return false
	}
	return true
}

func toPaymentIntent(item postgres.PaymentIntentRecord) paymentIntentJSON {
	result := paymentIntentJSON{ID: item.ID, ExternalReference: item.ExternalReference, PayerActorID: item.PayerActorID, AmountMinor: item.AmountMinor, Currency: item.Currency, Method: item.Method, State: item.State, Version: item.Version, CollectedAmountMinor: item.CollectedAmountMinor, CollectedByActorID: item.CollectedByActorID, CollectionReference: item.CollectionReference, CancellationReason: item.CancellationReason, CreatedAt: item.CreatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00"), UpdatedAt: item.UpdatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")}
	if item.CollectedAt != nil {
		value := item.CollectedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")
		result.CollectedAt = &value
	}
	if item.Allocation != nil {
		allocation := item.Allocation
		result.Allocation = &paymentAllocationJSON{ID: allocation.ID, OrderID: allocation.OrderID, PaymentIntentID: allocation.PaymentIntentID, Currency: allocation.Currency, SubtotalMinor: allocation.SubtotalMinor, DeliveryFeeMinor: allocation.DeliveryFeeMinor, DiscountMinor: allocation.DiscountMinor, PlatformSubsidyMinor: allocation.PlatformSubsidyMinor, InternalWalletAmountMinor: allocation.InternalWalletAmountMinor, ExternalOfficialWalletAmountMinor: allocation.ExternalOfficialWalletAmountMinor, CashAmountMinor: allocation.CashAmountMinor, CODProductAmountMinor: allocation.CODProductAmountMinor, CODDeliveryAmountMinor: allocation.CODDeliveryAmountMinor, TotalMinor: allocation.TotalMinor, PolicyVersion: allocation.PolicyVersion, CreatedAt: allocation.CreatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")}
	}
	return result
}

func toCashRemittance(item postgres.CashRemittanceRecord) cashRemittanceJSON {
	return cashRemittanceJSON{ID: item.ID, PaymentIntentID: item.PaymentIntentID, CaptainActorID: item.CaptainActorID, AmountMinor: item.AmountMinor, Currency: item.Currency, RemittanceReference: item.RemittanceReference, State: item.State, CreatedAt: item.CreatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")}
}

func toDeliveryFeePolicy(item postgres.DeliveryFeePolicyRecord) deliveryFeePolicyJSON {
	result := deliveryFeePolicyJSON{ID: item.ID, ServiceCityID: item.ServiceCityID, PolicyVersion: item.PolicyVersion, State: item.State, BaseFeeMinor: item.BaseFeeMinor, DistanceUnitMeters: item.DistanceUnitMeters, DistanceRateMinor: item.DistanceRateMinor, OrderSizeUnitBaseUnits: item.OrderSizeUnitBaseUnits, OrderSizeRateMinor: item.OrderSizeRateMinor, ZoneSurchargeMinor: item.ZoneSurchargeMinor, RoundingUnitMinor: item.RoundingUnitMinor, Version: item.Version, CreatedBy: item.CreatedBy, CreatedAt: item.CreatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")}
	if item.RetiredAt != nil {
		value := item.RetiredAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")
		result.RetiredAt = &value
	}
	return result
}

func toDeliveryFeeQuote(item postgres.DeliveryFeeQuoteRecord) deliveryFeeQuoteJSON {
	return deliveryFeeQuoteJSON{FeeMinor: item.FeeMinor, PolicyVersion: item.PolicyVersion, ServiceCityID: item.ServiceCityID, DistanceMeters: item.DistanceMeters, DistanceUnits: item.DistanceUnits, OrderSizeBaseUnits: item.OrderSizeBaseUnits, OrderSizeUnits: item.OrderSizeUnits, RoundingUnitMinor: item.RoundingUnitMinor}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func writePaymentError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "payment intent was not found")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different payment facts")
	case errors.Is(err, postgres.ErrIntentExists):
		writeError(w, http.StatusConflict, "PAYMENT_EXISTS", "a payment intent already exists for this external reference")
	case errors.Is(err, postgres.ErrVersionConflict):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "payment intent version is stale")
	case errors.Is(err, postgres.ErrStateConflict):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "payment intent state does not allow this operation")
	case errors.Is(err, postgres.ErrAmountMismatch):
		writeError(w, http.StatusBadRequest, "AMOUNT_MISMATCH", "collected amount must equal the payment intent amount")
	case errors.Is(err, postgres.ErrRemittanceExists):
		writeError(w, http.StatusConflict, "CASH_ALREADY_REMITTED", "cash for this payment intent was already remitted")
	case errors.Is(err, postgres.ErrRemittanceIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different cash remittance facts")
	case errors.Is(err, postgres.ErrRemittanceInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "cash remittance input is invalid")
	case errors.Is(err, postgres.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "payment input is invalid")
	case errors.Is(err, postgres.ErrPaymentAllocationInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_PAYMENT_ALLOCATION", "payment allocation is invalid")
	default:
		log.Printf("WLT partner financial profile persistence error: %T %v", err, err)
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT persistence is unavailable")
	}
}

func writeDeliveryFeeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrDeliveryFeePolicyNotFound):
		writeError(w, http.StatusNotFound, "DELIVERY_FEE_POLICY_NOT_FOUND", "no active delivery fee policy is available")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different delivery fee policy facts")
	case errors.Is(err, postgres.ErrDeliveryFeePolicyInvalidInput), errors.Is(err, postgres.ErrDeliveryFeeQuoteInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_DELIVERY_FEE", "delivery fee policy or quote is invalid")
	default:
		log.Printf("WLT delivery fee persistence error: %T %v", err, err)
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT persistence is unavailable")
	}
}

func toPartnerFinancialProfile(item postgres.PartnerFinancialProfileRecord) partnerFinancialProfileJSON {
	result := partnerFinancialProfileJSON{
		ID:                item.ID,
		JoiningCaseID:     item.JoiningCaseID,
		PartnerActorID:    item.PartnerActorID,
		Origin:            item.Origin,
		CommissionRateBps: item.CommissionRateBps,
		SettlementPeriod:  item.SettlementPeriod,
		RoundingUnitMinor: item.RoundingUnitMinor,
		State:             item.State,
		Version:           item.Version,
		CreatedAt:         item.CreatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00"),
		UpdatedAt:         item.UpdatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00"),
	}
	if item.ActivatedAt != nil {
		value := item.ActivatedAt.UTC().Format("2006-01-02T15:04:05.999Z07:00")
		result.ActivatedAt = &value
	}
	return result
}

func writeFinancialProfileError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrFinancialProfileNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "partner financial profile was not found")
	case errors.Is(err, postgres.ErrFinancialProfileExists):
		writeError(w, http.StatusConflict, "PROFILE_EXISTS", "partner financial profile already exists")
	case errors.Is(err, postgres.ErrIdempotencyConflict):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with different financial profile facts")
	case errors.Is(err, postgres.ErrVersionConflict):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "financial profile version is stale")
	case errors.Is(err, postgres.ErrFinancialProfileState):
		writeError(w, http.StatusConflict, "STATE_CONFLICT", "financial profile state does not allow this operation")
	case errors.Is(err, postgres.ErrFinancialProfileInvalidInput):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "financial profile input is invalid")
	default:
		writeError(w, http.StatusBadGateway, "WLT_STORAGE_UNAVAILABLE", "WLT persistence is unavailable")
	}
}
