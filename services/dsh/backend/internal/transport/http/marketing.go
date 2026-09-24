package transporthttp

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/auth"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	identityintegration "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/integrations/identity"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
	identityclient "github.com/bthwani2-boop/samrim/services/identity/clients/go"
)

type MarketingServer struct {
	auth     *auth.ServiceToken
	db       *sql.DB
	identity *identityintegration.Client
	media    media.Store
}

func NewMarketing(accessToken string, db *sql.DB) (*MarketingServer, error) {
	return NewMarketingWithDependencies(nil, accessToken, db, nil)
}

func NewMarketingWithDependencies(identityClient *identityintegration.Client, accessToken string, db *sql.DB, mediaStore media.Store) (*MarketingServer, error) {
	authorizer, err := auth.NewServiceToken(accessToken)
	if err != nil {
		return nil, err
	}
	if db == nil {
		return nil, errors.New("marketing database is required")
	}
	return &MarketingServer{auth: authorizer, db: db, identity: identityClient, media: mediaStore}, nil
}

func (s *MarketingServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/public/promotions", s.listPublicPromotions)
	mux.HandleFunc("GET /dsh/public/discovery-content", s.listPublicDiscoveryContent)
	mux.HandleFunc("POST /dsh/public/discovery-content/events", s.recordPublicDiscoveryContentEvent)
	mux.HandleFunc("GET /dsh/public/discovery-content/{contentId}/target", s.resolvePublicDiscoveryContentTarget)
	mux.HandleFunc("GET /dsh/operator/promotions", s.listOperatorPromotions)
	mux.HandleFunc("POST /dsh/operator/promotions", s.createOperatorPromotion)
	mux.HandleFunc("POST /dsh/operator/promotions/{promotionId}/publication", s.setOperatorPromotionPublication)
	mux.HandleFunc("GET /dsh/operator/discovery-content", s.listOperatorDiscoveryContent)
	mux.HandleFunc("GET /dsh/operator/discovery-content/analytics", s.listOperatorDiscoveryContentAnalytics)
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

func (s *MarketingServer) recordPublicDiscoveryContentEvent(w http.ResponseWriter, r *http.Request) {
	var input contract.DiscoveryContentEventRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	actorID := ""
	if input.EventType == contract.DiscoveryContentEventType("CONVERSION") {
		if s.identity == nil || bearerToken(r) == "" {
			writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "a client session is required for conversion attribution")
			return
		}
		identity, err := s.identity.ReadSession(r.Context(), bearerToken(r))
		if err != nil || string(identity.Role) != "client" {
			writeError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "a client session is required for conversion attribution")
			return
		}
		actorID = identity.Subject
	}
	if err := postgres.RecordDiscoveryContentEvent(r.Context(), s.db, postgres.DiscoveryContentEventInput{ID: "discovery-event_" + strings.TrimSpace(input.ClientEventID), ClientEventID: input.ClientEventID, ContentID: input.ContentID, EventType: string(input.EventType), ClientSessionID: input.ClientSessionID, ClientActorID: actorID, OrderID: input.OrderID}); err != nil {
		writeMarketingError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *MarketingServer) resolvePublicDiscoveryContentTarget(w http.ResponseWriter, r *http.Request) {
	serviceCityID := strings.TrimSpace(r.URL.Query().Get("serviceCityId"))
	if serviceCityID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "serviceCityId is required for target resolution")
		return
	}
	item, err := postgres.ResolveDiscoveryContentTarget(r.Context(), s.db, r.PathValue("contentId"), serviceCityID)
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, contract.DiscoveryContentTargetResolution{ContentID: item.ContentID, TargetType: contract.DiscoveryContentTargetType(item.TargetType), TargetID: item.TargetID, StoreID: item.StoreID, PromotionID: item.PromotionID})
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

func (s *MarketingServer) listOperatorDiscoveryContentAnalytics(w http.ResponseWriter, r *http.Request) {
	if !s.operatorAuthorized(w, r) {
		return
	}
	items, err := postgres.ListDiscoveryContentAnalytics(r.Context(), s.db, strings.TrimSpace(r.URL.Query().Get("contentId")))
	if err != nil {
		writeMarketingError(w, err)
		return
	}
	values := make([]contract.DiscoveryContentAnalytics, 0, len(items))
	for _, item := range items {
		values = append(values, contract.DiscoveryContentAnalytics{ContentID: item.ContentID, EventType: contract.DiscoveryContentEventType(item.EventType), Count: int(item.Count)})
	}
	writeJSON(w, http.StatusOK, contract.DiscoveryContentAnalyticsListResponse{Items: values})
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
	var uploadedObjectKey string
	if strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "multipart/form-data") {
		if s.media == nil {
			writeError(w, http.StatusServiceUnavailable, "MEDIA_STORAGE_UNAVAILABLE", "media storage is unavailable")
			return
		}
		parsed, ok := parseMarketingContentUpload(w, r)
		if !ok {
			return
		}
		input = parsed.input
		digest := sha256Bytes(parsed.bytes)
		objectKey, keyErr := media.KeyForMarketingUpload(input.ID, idempotency, digest, parsed.contentType)
		if keyErr != nil {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "marketing image upload is invalid")
			return
		}
		if err := s.media.Put(r.Context(), objectKey, bytes.NewReader(parsed.bytes), int64(len(parsed.bytes)), parsed.contentType); err != nil {
			writeError(w, http.StatusServiceUnavailable, "MEDIA_STORAGE_UNAVAILABLE", "marketing media upload failed")
			return
		}
		uploadedObjectKey = objectKey
		input.MediaUri = s.media.PublicURL(objectKey)
	} else if !decodeJSON(w, r, &input) {
		return
	}
	item, replayed, err := postgres.CreateDiscoveryContent(r.Context(), s.db, postgres.DiscoveryContentInput{
		ID: input.ID, Kind: string(input.Kind), TitleAr: input.TitleAr, BodyAr: input.BodyAr, MediaURI: input.MediaUri, TargetType: string(input.TargetType), TargetID: input.TargetID, ServiceCityID: input.ServiceCityID, StartsAt: input.StartsAt, EndsAt: input.EndsAt, Ordinal: input.Ordinal, CreatedByActorID: acting,
	}, idempotency, postgres.HashMarketingFacts("discovery-content-create", input.ID, string(input.Kind), input.TitleAr, input.BodyAr, input.MediaUri, string(input.TargetType), input.TargetID, input.ServiceCityID, input.StartsAt.UTC().Format(time.RFC3339Nano), optionalTimeString(input.EndsAt), fmt.Sprint(input.Ordinal), correlation))
	if err != nil {
		if uploadedObjectKey != "" {
			_ = s.media.Delete(r.Context(), uploadedObjectKey)
		}
		writeMarketingError(w, err)
		return
	}
	writeJSON(w, responseStatus(replayed), contract.DiscoveryContentResponse{Content: toDiscoveryContentView(item), IdempotentReplay: replayed})
}

type marketingContentUpload struct {
	input       contract.CreateDiscoveryContentRequest
	bytes       []byte
	contentType string
}

func parseMarketingContentUpload(w http.ResponseWriter, r *http.Request) (marketingContentUpload, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, media.MaxUploadBytes+1)
	if err := r.ParseMultipartForm(media.MaxUploadBytes + 1); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a valid marketing image upload is required")
		return marketingContentUpload{}, false
	}
	file, header, err := r.FormFile("file")
	if err != nil || header == nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "a file field is required")
		return marketingContentUpload{}, false
	}
	defer file.Close()
	if header.Size < 1 || header.Size > media.MaxUploadBytes {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "image size must not exceed 10 MiB")
		return marketingContentUpload{}, false
	}
	bytes, err := io.ReadAll(io.LimitReader(file, media.MaxUploadBytes+1))
	if err != nil || int64(len(bytes)) > media.MaxUploadBytes {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "image size must not exceed 10 MiB")
		return marketingContentUpload{}, false
	}
	contentType, _, _, err := media.ValidateImageBytes(bytes)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "only valid JPEG and PNG images are accepted")
		return marketingContentUpload{}, false
	}
	startsAt, err := time.Parse(time.RFC3339, strings.TrimSpace(r.FormValue("startsAt")))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "startsAt must be a valid date-time")
		return marketingContentUpload{}, false
	}
	ordinal := 0
	if raw := strings.TrimSpace(r.FormValue("ordinal")); raw != "" {
		if _, scanErr := fmt.Sscan(raw, &ordinal); scanErr != nil || ordinal < 0 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "ordinal must be a non-negative integer")
			return marketingContentUpload{}, false
		}
	}
	input := contract.CreateDiscoveryContentRequest{ID: strings.TrimSpace(r.FormValue("id")), Kind: contract.DiscoveryContentKind(strings.TrimSpace(r.FormValue("kind"))), TitleAr: strings.TrimSpace(r.FormValue("titleAr")), BodyAr: strings.TrimSpace(r.FormValue("bodyAr")), TargetType: contract.DiscoveryContentTargetType(strings.TrimSpace(r.FormValue("targetType"))), TargetID: strings.TrimSpace(r.FormValue("targetId")), ServiceCityID: strings.TrimSpace(r.FormValue("serviceCityId")), StartsAt: startsAt, Ordinal: ordinal}
	if rawEnds := strings.TrimSpace(r.FormValue("endsAt")); rawEnds != "" {
		endsAt, parseErr := time.Parse(time.RFC3339, rawEnds)
		if parseErr != nil {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "endsAt must be a valid date-time")
			return marketingContentUpload{}, false
		}
		input.EndsAt = &endsAt
	}
	return marketingContentUpload{input: input, bytes: bytes, contentType: contentType}, true
}

func sha256Bytes(value []byte) string {
	digest := sha256.Sum256(value)
	return fmt.Sprintf("%x", digest[:])
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
	actorID := strings.TrimSpace(r.Header.Get("X-Acting-Actor-ID"))
	if actorID == "" {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "X-Acting-Actor-ID is required")
		return false
	}
	if s.identity == nil {
		writeError(w, http.StatusBadGateway, "IDENTITY_UNAVAILABLE", "Operator permission could not be verified")
		return false
	}
	operator, err := s.identity.ReadActorRole(r.Context(), actorID, "operator")
	if err != nil {
		writeIdentityError(w, err)
		return false
	}
	if operator.Role != "operator" || !operator.Enabled || !operator.SecurityEnabled || operator.ActivatedAt == nil {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "an active Control Panel Operator session is required")
		return false
	}
	if err := s.identity.RequireOperatorPermission(r.Context(), actorID, "marketing"); err != nil {
		var identityErr *identityclient.Error
		if errors.As(err, &identityErr) && identityErr.Status == http.StatusForbidden {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "Marketing permission is required")
		} else {
			writeIdentityError(w, err)
		}
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
	case errors.Is(err, postgres.ErrPromotionInvalid), errors.Is(err, postgres.ErrDiscoveryContentInvalid), errors.Is(err, postgres.ErrDiscoveryContentEventInvalid):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "marketing input is invalid")
	case errors.Is(err, postgres.ErrPromotionNotFound), errors.Is(err, postgres.ErrDiscoveryContentNotFound), errors.Is(err, postgres.ErrDiscoveryContentEventNotFound):
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
