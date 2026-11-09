package transporthttp

import (
	"database/sql"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"

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
	storeID, cityID := strings.TrimSpace(r.PathValue("storeId")), strings.TrimSpace(r.URL.Query().Get("serviceCityId"))
	if storeID == "" || len(storeID) > 128 || cityID == "" || len(cityID) > 128 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "valid Store and Service City are required")
		return "", "", false
	}
	// Website callers cannot switch financial relation, owner preview or
	// unpublished content by appending a second/unknown query scope.
	allowed := map[string]bool{"serviceCityId": true}
	if strings.HasSuffix(r.URL.Path, "/catalog") {
		allowed["limit"], allowed["cursor"] = true, true
	}
	for key, values := range r.URL.Query() {
		if !allowed[key] || len(values) != 1 {
			writeError(w, http.StatusBadRequest, "INVALID_INPUT", "unsupported or duplicated independent Store scope")
			return "", "", false
		}
	}
	return storeID, cityID, true
}

// Only rights-attested media with a publicly retrievable HTTPS URL can be
// projected. Storage object keys and local/internal URLs never go public.
func safeIndependentPublicMediaURI(raw string) bool {
	if strings.TrimSpace(raw) != raw || raw == "" {
		return false
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" ||
		parsed.User != nil || parsed.Fragment != "" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".local") ||
		strings.HasSuffix(host, ".internal") {
		return false
	}
	// A public image must not induce a browser to fetch a private-network
	// address, even if its URI uses an HTTPS scheme.
	if ip := net.ParseIP(host); ip != nil && !ip.IsGlobalUnicast() {
		return false
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsPrivate() || ip.IsLoopback()) {
		return false
	}
	return true
}

func (s *IndependentPublicStorefrontServer) publishedStore(w http.ResponseWriter, r *http.Request, storeID, cityID string) (postgres.IndependentPublishedStore, bool) {
	store, err := postgres.ReadPublishedIndependentStore(r.Context(), s.db, storeID, s.approvedTermsVersion)
	switch {
	case errors.Is(err, postgres.ErrIndependentStorefrontNotPublished):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "storefront was not found")
		return postgres.IndependentPublishedStore{}, false
	case err != nil:
		writeError(w, http.StatusServiceUnavailable, "DSH_STORAGE_UNAVAILABLE", "storefront is temporarily unavailable")
		return postgres.IndependentPublishedStore{}, false
	case store.ServiceCityID != cityID || !safeIndependentPublicMediaURI(store.ProfileImageURI) || !safeIndependentPublicMediaURI(store.CoverImageURI):
		writeError(w, http.StatusNotFound, "NOT_FOUND", "storefront was not found")
		return postgres.IndependentPublishedStore{}, false
	}
	return store, true
}

func (s *IndependentPublicStorefrontServer) readStore(w http.ResponseWriter, r *http.Request) {
	storeID, cityID, ok := s.publicScope(w, r)
	if !ok {
		return
	}
	store, ok := s.publishedStore(w, r, storeID, cityID)
	if !ok {
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
	if limit < 1 || limit > 50 || len(cursor) > 2048 {
		writeError(w, http.StatusBadRequest, "INVALID_INPUT", "catalog pagination is invalid")
		return
	}
	if _, ok := s.publishedStore(w, r, storeID, cityID); !ok {
		return
	}
	page, err := postgres.ListPublishedIndependentOffersForCity(r.Context(), s.db, storeID, s.approvedTermsVersion, cityID, limit, cursor)
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
		for _, media := range offer.Media {
			if !safeIndependentPublicMediaURI(media.URI) {
				writeError(w, http.StatusNotFound, "NOT_FOUND", "catalog was not found")
				return
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"storeId": storeID, "offers": page.Offers, "nextCursor": page.NextCursor})
}
