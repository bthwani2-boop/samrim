package transporthttp

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

type MarketingServer struct {
	auth *auth.ServiceToken
	db   *sql.DB
}

func NewMarketing(accessToken string, db *sql.DB) (*MarketingServer, error) {
	authorizer, err := auth.NewServiceToken(accessToken)
	if err != nil {
		return nil, err
	}
	if db == nil {
		return nil, errors.New("marketing database is required")
	}
	return &MarketingServer{auth: authorizer, db: db}, nil
}

func (s *MarketingServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/public/promotions", s.listPublicPromotions)
	mux.HandleFunc("GET /dsh/public/discovery-content", s.listPublicDiscoveryContent)
	mux.HandleFunc("GET /dsh/operator/promotions", s.listOperatorPromotions)
	mux.HandleFunc("POST /dsh/operator/promotions", s.createOperatorPromotion)
	mux.HandleFunc("POST /dsh/operator/promotions/{promotionId}/publication", s.setOperatorPromotionPublication)
	mux.HandleFunc("GET /dsh/operator/discovery-content", s.listOperatorDiscoveryContent)
	mux.HandleFunc("POST /dsh/operator/discovery-content", s.createOperatorDiscoveryContent)
	mux.HandleFunc("POST /dsh/operator/discovery-content/{contentId}/publication", s.setOperatorDiscoveryContentPublication)
}

func (s *MarketingServer) listPublicPromotions(w http.ResponseWriter, r *http.Request) {
	items, err := postgres.ListPromotions(r.Context(), s.db, true, strings.TrimSpace(r.URL.Query().Get("serviceCityId")), strings.TrimSpace(r.URL.Query().Get("storeId")))
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	values := make([]contract.PromotionView, 0, len(items))
	for _, item := range items {
		values = append(values, toPromotionView(item))
	}
	writeJSON(w, http.StatusOK, contract.PromotionListResponse{Promotions: values})
}

func (s *MarketingServer) listPublicDiscoveryContent(w http.ResponseWriter, r *http.Request) {
	items, err := postgres.ListDiscoveryContent(r.Context(), s.db, true, strings.TrimSpace(r.URL.Query().Get("serviceCityId")))
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	values := make([]contract.DiscoveryContentView, 0, len(items))
	for _, item := range items {
		values = append(values, toDiscoveryContentView(item))
	}
	writeJSON(w, http.StatusOK, contract.DiscoveryContentListResponse{Items: values})
}

func (s *MarketingServer) listOperatorPromotions(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	items, err := postgres.ListPromotions(r.Context(), s.db, false, "", "")
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	values := make([]contract.PromotionView, 0, len(items))
	for _, item := range items {
		values = append(values, toPromotionView(item))
	}
	writeJSON(w, http.StatusOK, contract.PromotionListResponse{Promotions: values})
}

func (s *MarketingServer) createOperatorPromotion(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.CreatePromotionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	var maxDiscount *int64
	if input.MaxDiscountMinor > 0 {
		value := int64(input.MaxDiscountMinor)
		maxDiscount = &value
	}
	var limit *int64
	if input.RedemptionLimit > 0 {
		value := int64(input.RedemptionLimit)
		limit = &value
	}
	item, replayed, err := postgres.CreatePromotion(r.Context(), s.db, postgres.PromotionInput{
		ID: input.ID, Code: input.Code, NameAr: input.NameAr, DescriptionAr: input.DescriptionAr, Kind: string(input.Kind), ValueMinor: int64(input.ValueMinor), MaxDiscountMinor: maxDiscount,
		FundingSource: input.FundingSource, StoreID: input.StoreID, ServiceCityID: input.ServiceCityID, StartsAt: input.StartsAt, EndsAt: input.EndsAt, RedemptionLimit: limit, CreatedByActorID: acting,
	}, idempotency, postgres.HashMarketingFacts("promotion-create", input.ID, input.Code, input.NameAr, input.DescriptionAr, string(input.Kind), fmt.Sprint(input.ValueMinor), input.FundingSource, input.StoreID, input.ServiceCityID, input.StartsAt.UTC().Format(time.RFC3339Nano), optionalTimeString(input.EndsAt), fmt.Sprint(input.RedemptionLimit), correlation))
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	writeJSON(w, responseStatus(replayed), contract.PromotionResponse{Promotion: toPromotionView(item), IdempotentReplay: replayed})
}

func (s *MarketingServer) setOperatorPromotionPublication(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	acting, correlation, idempotency, expected, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	var input contract.MarketingPublicationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, replayed, err := postgres.SetPromotionState(r.Context(), s.db, r.PathValue("promotionId"), input.State, idempotency, postgres.HashMarketingFacts("promotion-publication", r.PathValue("promotionId"), input.State, fmt.Sprint(expected), acting, correlation), expected)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	writeJSON(w, responseStatus(replayed), contract.PromotionResponse{Promotion: toPromotionView(item), IdempotentReplay: replayed})
}

func (s *MarketingServer) listOperatorDiscoveryContent(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	items, err := postgres.ListDiscoveryContent(r.Context(), s.db, false, "")
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	values := make([]contract.DiscoveryContentView, 0, len(items))
	for _, item := range items {
		values = append(values, toDiscoveryContentView(item))
	}
	writeJSON(w, http.StatusOK, contract.DiscoveryContentListResponse{Items: values})
}

func (s *MarketingServer) createOperatorDiscoveryContent(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	acting, correlation, idempotency, ok := requiredMutationHeaders(w, r)
	if !ok {
		return
	}
	var input contract.CreateDiscoveryContentRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, replayed, err := postgres.CreateDiscoveryContent(r.Context(), s.db, postgres.DiscoveryContentInput{
		ID: input.ID, Kind: string(input.Kind), TitleAr: input.TitleAr, BodyAr: input.BodyAr, MediaURI: input.MediaUri, TargetType: string(input.TargetType), TargetID: input.TargetID, ServiceCityID: input.ServiceCityID, StartsAt: input.StartsAt, EndsAt: input.EndsAt, Ordinal: input.Ordinal, CreatedByActorID: acting,
	}, idempotency, postgres.HashMarketingFacts("discovery-content-create", input.ID, string(input.Kind), input.TitleAr, input.BodyAr, input.MediaUri, string(input.TargetType), input.TargetID, input.ServiceCityID, input.StartsAt.UTC().Format(time.RFC3339Nano), optionalTimeString(input.EndsAt), fmt.Sprint(input.Ordinal), correlation))
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	writeJSON(w, responseStatus(replayed), contract.DiscoveryContentResponse{Content: toDiscoveryContentView(item), IdempotentReplay: replayed})
}

func (s *MarketingServer) setOperatorDiscoveryContentPublication(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	acting, correlation, idempotency, expected, ok := requiredVersionedCaseHeaders(w, r)
	if !ok {
		return
	}
	var input contract.MarketingPublicationRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	item, replayed, err := postgres.SetDiscoveryContentState(r.Context(), s.db, r.PathValue("contentId"), input.State, idempotency, postgres.HashMarketingFacts("discovery-content-publication", r.PathValue("contentId"), input.State, fmt.Sprint(expected), acting, correlation), expected)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	writeJSON(w, responseStatus(replayed), contract.DiscoveryContentResponse{Content: toDiscoveryContentView(item), IdempotentReplay: replayed})
}

func (s *MarketingServer) operatorAuthorized(w http.ResponseWriter, r *http.Request) bool {
	if !s.auth.Authorized(r) {
		writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "service authentication is required")
		return false
	}
	if strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID")) == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return false
	}
	return true
}

func toPromotionView(item postgres.PromotionRecord) contract.PromotionView {
	return contract.PromotionView{ID: item.ID, Code: item.Code, NameAr: item.NameAr, DescriptionAr: item.DescriptionAr, Kind: contract.PromotionKind(item.Kind), ValueMinor: int(item.ValueMinor), MaxDiscountMinor: intValue(item.MaxDiscountMinor), FundingSource: item.FundingSource, StoreID: item.StoreID, ServiceCityID: item.ServiceCityID, State: contract.PromotionState(item.State), StartsAt: item.StartsAt, EndsAt: item.EndsAt, RedemptionLimit: intValue(item.RedemptionLimit), RedeemedCount: int(item.RedeemedCount), Version: item.Version, CreatedByActorID: item.CreatedByActorID, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func toDiscoveryContentView(item postgres.DiscoveryContentRecord) contract.DiscoveryContentView {
	return contract.DiscoveryContentView{ID: item.ID, Kind: contract.DiscoveryContentKind(item.Kind), TitleAr: item.TitleAr, BodyAr: item.BodyAr, MediaUri: item.MediaURI, TargetType: contract.DiscoveryContentTargetType(item.TargetType), TargetID: item.TargetID, ServiceCityID: item.ServiceCityID, State: contract.PromotionState(item.State), StartsAt: item.StartsAt, EndsAt: item.EndsAt, Ordinal: item.Ordinal, Version: item.Version, CreatedByActorID: item.CreatedByActorID, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt}
}

func intValue(value *int64) int {
	if value == nil {
		return 0
	}
	return int(*value)
}

func optionalTimeString(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func writeMarketingError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrPromotionInvalid), errors.Is(err, postgres.ErrDiscoveryContentInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "marketing input is invalid")
	case errors.Is(err, postgres.ErrPromotionNotFound), errors.Is(err, postgres.ErrDiscoveryContentNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "marketing record was not found")
	case errors.Is(err, postgres.ErrPromotionCodeConflict):
		writeError(w, http.StatusConflict, "PROMOTION_CODE_EXISTS", "promotion code already exists")
	case errors.Is(err, postgres.ErrPromotionIdempotencyConflict), errors.Is(err, postgres.ErrDiscoveryContentIdempotency):
		writeError(w, http.StatusConflict, "IDEMPOTENCY_CONFLICT", "marketing mutation idempotency key conflicts with a prior request")
	case errors.Is(err, postgres.ErrPromotionVersionConflict), errors.Is(err, postgres.ErrDiscoveryContentVersion):
		writeError(w, http.StatusConflict, "VERSION_CONFLICT", "marketing record version is stale")
	case errors.Is(err, postgres.ErrDiscoveryContentTargetInvalid):
		writeError(w, http.StatusConflict, "TARGET_UNAVAILABLE", "discovery content target is not canonical and available")
	case errors.Is(err, postgres.ErrPromotionUnavailable), errors.Is(err, postgres.ErrPromotionAlreadyRedeemed), errors.Is(err, postgres.ErrPromotionLimitReached):
		writeError(w, http.StatusConflict, "PROMOTION_UNAVAILABLE", "promotion is not currently eligible")
	default:
		writeError(w, http.StatusBadGateway, "DSH_STORAGE_UNAVAILABLE", "DSH marketing persistence is unavailable")
	}
}
