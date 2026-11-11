package transporthttp

import (
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/contract"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"
	"github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres"
)

// IndependentPublicStorefrontServer reads DSH-owned publication and Catalog
// facts. The release switch and approved legal version are deliberately
// separate: neither a merchant draft nor a marketplace publication can
// enable independent public visibility.
type IndependentPublicStorefrontServer struct {
	db                   *sql.DB
	approvedTermsVersion string
	approvedHosts        map[string]bool
}

func NewIndependentPublicStorefront(db *sql.DB, releaseEnabled bool, approvedTermsVersion, approvedHostsCSV string) *IndependentPublicStorefrontServer {
	hosts := make(map[string]bool)
	for _, raw := range strings.Split(approvedHostsCSV, ",") {
		host := strings.ToLower(strings.TrimSpace(raw))
		if host != "" && !strings.ContainsAny(host, "/\\@*?# ") {
			hosts[host] = true
		}
	}
	if !releaseEnabled {
		approvedTermsVersion = ""
	}
	return &IndependentPublicStorefrontServer{
		db: db, approvedTermsVersion: strings.TrimSpace(approvedTermsVersion), approvedHosts: hosts,
	}
}

func (s *IndependentPublicStorefrontServer) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /dsh/public/independent-stores/{storeId}", s.readStore)
	mux.HandleFunc("GET /dsh/public/independent-stores/{storeId}/catalog", s.readCatalog)
	mux.HandleFunc("GET /dsh/public/independent-stores/{storeId}/banners", s.readBanners)
}

func (s *IndependentPublicStorefrontServer) publicScope(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	w.Header().Set("Vary", "Host")
	// Absent explicit legal approval, even forged published DB records stay
	// unavailable and cannot be distinguished from an unknown Store.
	if s == nil || s.approvedTermsVersion == "" || !s.approvedHosts[strings.ToLower(r.Host)] {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "storefront was not found")
		return "", "", false
	}
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "malformed independent Store query")
		return "", "", false
	}
	storeID, cityID := strings.TrimSpace(r.PathValue("storeId")), strings.TrimSpace(query.Get("serviceCityId"))
	if storeID == "" || len(storeID) > 128 || cityID == "" || len(cityID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "valid Store and Service City are required")
		return "", "", false
	}
	// Website callers cannot switch financial relation, owner preview or
	// unpublished content by appending a second/unknown query scope.
	allowed := map[string]bool{"serviceCityId": true}
	if strings.HasSuffix(r.URL.Path, "/catalog") {
		allowed["limit"], allowed["cursor"] = true, true
		allowed["q"], allowed["categoryId"], allowed["productId"] = true, true, true
	}
	for key, values := range query {
		if !allowed[key] || len(values) != 1 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "unsupported or duplicated independent Store scope")
			return "", "", false
		}
	}
	return storeID, cityID, true
}

func (s *IndependentPublicStorefrontServer) readStore(w http.ResponseWriter, r *http.Request) {
	storeID, cityID, ok := s.publicScope(w, r)
	if !ok {
		return
	}
	store, err := postgres.ReadPublishedIndependentStore(r.Context(), s.db, storeID, s.approvedTermsVersion)
	switch {
	case errors.Is(err, postgres.ErrIndependentStorefrontNotPublished):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "storefront was not found")
		return
	case err != nil:
		writeError(w, http.StatusServiceUnavailable, "DSH_STORAGE_UNAVAILABLE", "storefront is temporarily unavailable")
		return
	case store.ServiceCityID != cityID:
		writeError(w, http.StatusNotFound, "NOT_FOUND", "storefront was not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"storeId": store.StoreID, "name": store.Name,
		"serviceCityId":   store.ServiceCityID,
		"profileImageUri": store.ProfileImageURI, "coverImageUri": store.CoverImageURI,
		"businessPhoneE164": store.BusinessPhoneE164, "businessEmail": store.BusinessEmail,
		"businessWhatsAppE164":  store.BusinessWhatsAppE164,
		"hostingTermsVersion":   store.HostingTermsVersion,
		"merchantPolicyVersion": store.MerchantPolicyVersion,
		"cancellationTerms":     store.CancellationTerms, "returnsTerms": store.ReturnsTerms,
		"fulfillmentTerms": store.FulfillmentTerms, "collectionTerms": store.CollectionTerms,
		"checkoutEnabled": false,
	})
}

func (s *IndependentPublicStorefrontServer) readCatalog(w http.ResponseWriter, r *http.Request) {
	storeID, cityID, ok := s.publicScope(w, r)
	if !ok {
		return
	}
	limit := 24
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, _ = strconv.Atoi(raw)
	}
	cursor := r.URL.Query().Get("cursor")
	categoryID, productID, search := strings.TrimSpace(r.URL.Query().Get("categoryId")), strings.TrimSpace(r.URL.Query().Get("productId")), strings.TrimSpace(r.URL.Query().Get("q"))
	if len(categoryID) > 128 || len(productID) > 128 || !utf8.ValidString(search) || utf8.RuneCountInString(search) > 160 ||
		limit < 1 || limit > 50 || len(cursor) > 2048 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog pagination is invalid")
		return
	}
	page, err := postgres.ListPublishedIndependentOffersForCityFiltered(r.Context(), s.db, storeID, s.approvedTermsVersion, cityID, categoryID, productID, search, limit, cursor)
	switch {
	case errors.Is(err, postgres.ErrIndependentStorefrontNotPublished):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "storefront was not found")
		return
	case errors.Is(err, postgres.ErrCatalogOfferInvalidCursor):
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog cursor is invalid")
		return
	case err != nil:
		writeError(w, http.StatusServiceUnavailable, "DSH_STORAGE_UNAVAILABLE", "catalog is temporarily unavailable")
		return
	}
	for _, offer := range page.Offers {
		for _, asset := range offer.Media {
			if !media.IsPublicHTTPSURI(asset.URI) {
				writeError(w, http.StatusNotFound, "NOT_FOUND", "catalog was not found")
				return
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"storeId": storeID, "categories": page.Categories, "offers": page.Offers, "nextCursor": page.NextCursor})
}

// readBanners uses the same canonical DSH Discovery Content owner as the
// marketplace website, but only after the independent legal/host gate passes.
func (s *IndependentPublicStorefrontServer) readBanners(w http.ResponseWriter, r *http.Request) {
	storeID, cityID, ok := s.publicScope(w, r)
	if !ok {
		return
	}
	items, err := postgres.ListPublishedIndependentStoreBanners(r.Context(), s.db, storeID, cityID, s.approvedTermsVersion)
	switch {
	case errors.Is(err, postgres.ErrIndependentStorefrontNotPublished):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "storefront was not found")
		return
	case err != nil:
		writeError(w, http.StatusServiceUnavailable, "DSH_STORAGE_UNAVAILABLE", "banners are temporarily unavailable")
		return
	}
	values := make([]contract.PublicDiscoveryContentView, 0, len(items))
	for _, item := range items {
		if !media.IsPublicHTTPSURI(item.MediaURI) ||
			item.TargetType != "STORE" || item.TargetID != storeID {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "banners were not found")
			return
		}
		values = append(values, toPublicDiscoveryContentView(item))
	}
	writeJSON(w, http.StatusOK, contract.DiscoveryContentListResponse{Items: values})
}
