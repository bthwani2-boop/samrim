package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// Independent Store public readers are served only after DSH publication,
// legal, contact and media eligibility gates. It does not require an Order-
// ready fulfillment mode or any publishable Offer: the website can be
// read-only/empty while direct checkout remains disabled.
var ErrIndependentStorefrontNotPublished = errors.New("independent storefront was not published")

// Public read-only websites consume the canonical Catalog eligibility view.
// The extra constraints below are presentation-only: the current Store website
// uses the same canonical modifier details for read-only display.
// Stock, publication and quantity eligibility are evaluated by the Catalog owner.
const independentWebOfferPresentationSQL = `
    AND EXISTS (SELECT 1 FROM dsh.catalog_publishable_offers published WHERE published.offer_id=o.id)
    AND o.currency='YER'
`

// Immutable query text: every user-selected filter and cursor is a bound
// parameter. The only concatenations are compile-time canonical SQL constants.
const independentWebOffersPageSQL = catalogOfferSelect + ` WHERE o.store_id=$1` + independentWebOfferPresentationSQL + `
    AND ($2::text='' OR EXISTS (
        SELECT 1 FROM dsh.catalog_product_categories pc
        JOIN dsh.catalog_categories category
          ON category.id=pc.category_id AND category.active=true
         AND category.vertical_id=p.vertical_id
        WHERE pc.product_id=p.id AND pc.category_id=$2))
    AND ($3::text='' OR p.id=$3)
    AND ($4::text='' OR strpos(lower(p.canonical_name),lower($4))>0
        OR strpos(lower(v.title),lower($4))>0)
    AND ($5::timestamptz IS NULL OR (o.created_at,o.id)>($5::timestamptz,$6::text))
    ORDER BY o.created_at ASC,o.id ASC LIMIT $7`

const independentWebCategorySQL = `SELECT DISTINCT c.id FROM dsh.catalog_store_offers o
    JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
    JOIN dsh.catalog_products p ON p.id=v.product_id
    JOIN dsh.catalog_product_categories pc ON pc.product_id=p.id
    JOIN dsh.catalog_categories c ON c.id=pc.category_id AND c.active=true AND c.vertical_id=p.vertical_id
    WHERE o.store_id=$1` + independentWebOfferPresentationSQL + ` ORDER BY c.id`

type IndependentPublishedStore struct {
	StoreID               string
	ServiceCityID         string
	Name                  string
	StoreVersion          int
	PublicationVersion    int
	PublishedAt           time.Time
	ProfileImageURI       string
	CoverImageURI         string
	BusinessPhoneE164     string
	BusinessEmail         string
	BusinessWhatsAppE164  string
	HostingTermsVersion   string
	MerchantPolicyVersion string
	CancellationTerms     string
	ReturnsTerms          string
	FulfillmentTerms      string
	CollectionTerms       string
}

// IndependentStorePublicationForOwner checks the canonical DSH ownership
// relation before returning even a draft publication state. Authentication of
// ownerActorID is required at the calling transport/service boundary.
func IndependentStorePublicationForOwner(ctx context.Context, db *sql.DB, storeID, ownerActorID string) (string, int, error) {
	if db == nil {
		return "", 0, ErrStoreNotFound
	}
	return independentStorePublicationForOwnerWithQueryer(ctx, db, storeID, ownerActorID)
}

func independentStorePublicationForOwnerWithQueryer(ctx context.Context, queryer independentStorefrontRowQueryer, storeID, ownerActorID string) (string, int, error) {
	if strings.TrimSpace(storeID) == "" || strings.TrimSpace(ownerActorID) == "" {
		return "", 0, ErrStoreNotFound
	}
	var state string
	var version int
	err := queryer.QueryRowContext(ctx, `SELECT COALESCE(publication.state,'DRAFT'),COALESCE(publication.version,1)
		FROM dsh.stores store
		LEFT JOIN dsh.independent_store_publications publication ON publication.store_id=store.id
		WHERE store.id=$1 AND store.partner_actor_id=$2 AND store.relation_model='INDEPENDENT_STORE'
		  AND store.deleted_at IS NULL`, storeID, ownerActorID).Scan(&state, &version)
	if errors.Is(err, sql.ErrNoRows) {
		return "", 0, ErrStoreNotFound
	}
	if err != nil {
		return "", 0, fmt.Errorf("read owned independent publication: %w", err)
	}
	return state, version, nil
}

// IndependentPublicationOperatorStatus is a private projection of the
// canonical DSH publication, not a second Store publication state. Operators
// need its own version for review CAS; the Store's version is unrelated.
type IndependentPublicationOperatorStatus struct {
	StoreID      string `json:"storeId"`
	State        string `json:"state"`
	ReviewState  string `json:"reviewState"`
	Version      int    `json:"version"`
	ReviewReason string `json:"reviewReason,omitempty"`
}

func ReadIndependentPublicationForOperator(ctx context.Context, db *sql.DB, storeID string) (IndependentPublicationOperatorStatus, error) {
	storeID = strings.TrimSpace(storeID)
	if db == nil || storeID == "" || len(storeID) > 128 {
		return IndependentPublicationOperatorStatus{}, ErrStoreNotFound
	}
	var result IndependentPublicationOperatorStatus
	err := db.QueryRowContext(ctx, `SELECT s.id,COALESCE(p.state,'DRAFT'),COALESCE(p.review_state,'NOT_CHECKED'),
		COALESCE(p.version,1),COALESCE(p.review_reason,'')
		FROM dsh.stores s
		LEFT JOIN dsh.independent_store_publications p ON p.store_id=s.id
		WHERE s.id=$1 AND s.relation_model='INDEPENDENT_STORE'
		  AND s.publication_state<>'published' AND s.deleted_at IS NULL`, storeID).
		Scan(&result.StoreID, &result.State, &result.ReviewState, &result.Version, &result.ReviewReason)
	if errors.Is(err, sql.ErrNoRows) {
		return IndependentPublicationOperatorStatus{}, ErrStoreNotFound
	}
	if err != nil {
		return IndependentPublicationOperatorStatus{}, fmt.Errorf("read independent publication for operator: %w", err)
	}
	return result, nil
}

// ReadPublishedIndependentStore never reuses marketplace publication or a
// client-side model flag. The URL's Store ID is a locator, not authorization.
// Public contact is explicitly opt-in business data; private Identity contact
// and JoiningCase documents are never projected.
func ReadPublishedIndependentStore(ctx context.Context, db *sql.DB, storeID, approvedLegalTermsVersion string) (IndependentPublishedStore, error) {
	if db == nil {
		return IndependentPublishedStore{}, ErrIndependentStorefrontNotPublished
	}
	return readPublishedIndependentStoreWithQueryer(ctx, db, storeID, approvedLegalTermsVersion)
}

// QueryRowContext exists on both *sql.DB and *sql.Tx. Public Catalog pages
// read Store publication under the very same read-only MVCC snapshot as Offers
// and media instead of re-authorizing against a different database version.
type independentStorefrontRowQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readPublishedIndependentStoreWithQueryer(ctx context.Context, db independentStorefrontRowQueryer, storeID, approvedLegalTermsVersion string) (IndependentPublishedStore, error) {
	storeID = strings.TrimSpace(storeID)
	approvedLegalTermsVersion = strings.TrimSpace(approvedLegalTermsVersion)
	// The legal owner has not yet admitted any release version. Without one,
	// even a manually forged PASSED publication row cannot become public.
	if db == nil || storeID == "" || len(storeID) > 128 || approvedLegalTermsVersion == "" {
		return IndependentPublishedStore{}, ErrIndependentStorefrontNotPublished
	}
	var result IndependentPublishedStore
	var whatsappEnabled bool
	err := db.QueryRowContext(ctx, `SELECT s.id,s.service_city_id,s.name,s.version,p.version,p.published_at,
		COALESCE(c.phone_e164,''),COALESCE(c.email,''),COALESCE(c.whatsapp_phone_e164,''),COALESCE(c.whatsapp_enabled,false),
		p.terms_version,cp.policy_version,cp.cancellation_terms,cp.returns_terms,cp.fulfillment_terms,cp.collection_terms,
		profile_media.uri,cover_media.uri
		FROM dsh.stores s
		JOIN dsh.service_cities city ON city.id=s.service_city_id AND city.active=true
		JOIN dsh.independent_store_publications p ON p.store_id=s.id
		JOIN dsh.independent_store_customer_policies cp ON cp.store_id=s.id
		JOIN dsh.store_public_contacts c ON c.store_id=s.id
		JOIN LATERAL (
			SELECT asset.uri FROM dsh.store_profile_media_assets asset
			WHERE asset.store_id=s.id AND asset.media_role='primary'
			  AND asset.state='active' AND asset.rights_attested_at IS NOT NULL
			  AND NULLIF(btrim(asset.uri),'') IS NOT NULL
			ORDER BY asset.created_at DESC LIMIT 1
		) profile_media ON true
		JOIN LATERAL (
			SELECT asset.uri FROM dsh.store_profile_media_assets asset
			WHERE asset.store_id=s.id AND asset.media_role='cover'
			  AND asset.state='active' AND asset.rights_attested_at IS NOT NULL
			  AND NULLIF(btrim(asset.uri),'') IS NOT NULL
			ORDER BY asset.created_at DESC LIMIT 1
		) cover_media ON true
		WHERE s.id=$1 AND s.relation_model='INDEPENDENT_STORE'
		  AND s.publication_state<>'published' AND s.deleted_at IS NULL
		  AND p.state='PUBLISHED_INDEPENDENT' AND p.review_state='PASSED'
		  AND p.terms_version=$2
		  AND p.terms_accepted_at IS NOT NULL AND p.published_at IS NOT NULL
		  AND p.terms_accepted_by_actor_id=s.partner_actor_id
		  AND (c.phone_e164<>'' OR c.email<>'' OR c.whatsapp_enabled)
		  AND cp.review_state='PASSED' AND cp.published_at IS NOT NULL
		  AND cp.authored_by_actor_id=s.partner_actor_id
		  AND NULLIF(btrim(cp.reviewed_by_actor_id),'') IS NOT NULL`, storeID, approvedLegalTermsVersion).Scan(
		&result.StoreID, &result.ServiceCityID, &result.Name, &result.StoreVersion,
		&result.PublicationVersion, &result.PublishedAt,
		&result.BusinessPhoneE164, &result.BusinessEmail,
		&result.BusinessWhatsAppE164, &whatsappEnabled,
		&result.HostingTermsVersion, &result.MerchantPolicyVersion,
		&result.CancellationTerms, &result.ReturnsTerms,
		&result.FulfillmentTerms, &result.CollectionTerms,
		&result.ProfileImageURI, &result.CoverImageURI)
	if errors.Is(err, sql.ErrNoRows) {
		return IndependentPublishedStore{}, ErrIndependentStorefrontNotPublished
	}
	if err != nil {
		return IndependentPublishedStore{}, fmt.Errorf("read independent public Store: %w", err)
	}
	// Both rights-attested media records and publication/policy facts were
	// projected by the same SQL statement under one MVCC read snapshot.
	if !whatsappEnabled {
		result.BusinessWhatsAppE164 = ""
	}
	return result, nil
}

// A public cursor is scoped to the original Store, City, legal publication
// version, search and filters. Moving it between two views is rejected before
// opening a database transaction; legacy unfiltered internal reads retain
// their canonical Store-only cursor.
func independentCatalogCursorScope(storeID, termsVersion, cityID, categoryID, productID, search string) string {
	if cityID == "" && categoryID == "" && productID == "" && search == "" {
		return storeID
	}
	sum := sha256.Sum256([]byte(strings.Join([]string{storeID, termsVersion, cityID, categoryID, productID, search}, "\x00")))
	return storeID + ":" + hex.EncodeToString(sum[:])
}

// ListPublishedIndependentOffers queries the canonical Catalog, never a
// shadow independent catalog. A Store-specific cursor cannot be replayed to
// enumerate a different Store. Private draft/hidden offers never leave DSH.
func listPublishedIndependentOffersInternal(ctx context.Context, db *sql.DB, storeID, approvedLegalTermsVersion, expectedCityID, categoryID, productID, search string, limit int, rawCursor string) (CatalogStoreOfferPage, error) {
	storeID = strings.TrimSpace(storeID)
	categoryID, productID, search = strings.TrimSpace(categoryID), strings.TrimSpace(productID), strings.TrimSpace(search)
	if db == nil || storeID == "" || len(storeID) > 128 || len(categoryID) > 128 || len(productID) > 128 ||
		!utf8.ValidString(search) || utf8.RuneCountInString(search) > 160 || limit < 1 || limit > 100 || len(rawCursor) > 2048 {
		return CatalogStoreOfferPage{}, ErrCatalogOfferInvalidCursor
	}
	cursorScope := independentCatalogCursorScope(storeID, approvedLegalTermsVersion, expectedCityID, categoryID, productID, search)
	cursor, err := decodeCatalogStoreOfferCursor(rawCursor, cursorScope)
	if err != nil {
		return CatalogStoreOfferPage{}, err
	}
	// One read-only, repeatable-read transaction binds the publication,
	// price/offer pagination and rights-attested media to one MVCC snapshot.
	// This is not a Store checkout or a writer transaction.
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return CatalogStoreOfferPage{}, err
	}
	defer func() { _ = tx.Rollback() }()
	store, err := readPublishedIndependentStoreWithQueryer(ctx, tx, storeID, approvedLegalTermsVersion)
	if err != nil {
		return CatalogStoreOfferPage{}, err
	}
	if expectedCityID != "" && store.ServiceCityID != expectedCityID {
		return CatalogStoreOfferPage{}, ErrIndependentStorefrontNotPublished
	}
	// The authorized Store publication and product page use the same read-only
	// repeatable-read snapshot. The DSH Store reader owns all independent legal,
	// media and publication gates; do not clone them into this Catalog query.
	var afterCreatedAt any
	afterOfferID := ""
	if cursor != nil {
		afterCreatedAt, afterOfferID = cursor.CreatedAt, cursor.OfferID
	}
	rows, err := tx.QueryContext(ctx, independentWebOffersPageSQL,
		storeID, categoryID, productID, search, afterCreatedAt, afterOfferID, limit+1)
	if err != nil {
		return CatalogStoreOfferPage{}, err
	}
	items, err := scanCatalogOfferRows(rows, limit+1)
	if err != nil {
		return CatalogStoreOfferPage{}, err
	}
	page := CatalogStoreOfferPage{Offers: items}
	if len(items) > limit {
		page.Offers = items[:limit]
		last := page.Offers[len(page.Offers)-1]
		page.NextCursor, err = encodeCatalogStoreOfferCursor(catalogStoreOfferCursor{Version: 1, StoreID: cursorScope, CreatedAt: last.CreatedAt.UTC(), OfferID: last.ID})
		if err != nil {
			return CatalogStoreOfferPage{}, err
		}
	}
	if err := hydrateCatalogOfferPage(ctx, tx, page.Offers); err != nil {
		return CatalogStoreOfferPage{}, err
	}
	// Reuse the canonical Catalog's category labels/ancestry from this same
	// read-only Store publication snapshot. The category list covers all
	// publishable Offers, not just the current product page or filter.
	categoryRows, err := tx.QueryContext(ctx, independentWebCategorySQL, storeID)
	if err != nil {
		return CatalogStoreOfferPage{}, err
	}
	categoryIDs := make([]string, 0)
	for categoryRows.Next() {
		var categoryID string
		if err := categoryRows.Scan(&categoryID); err != nil {
			_ = categoryRows.Close()
			return CatalogStoreOfferPage{}, err
		}
		categoryIDs = append(categoryIDs, categoryID)
	}
	if err := categoryRows.Err(); err != nil {
		_ = categoryRows.Close()
		return CatalogStoreOfferPage{}, err
	}
	if err := categoryRows.Close(); err != nil {
		return CatalogStoreOfferPage{}, err
	}
	page.Categories, err = ListPublicCatalogCategories(ctx, tx, categoryIDs)
	if err != nil {
		return CatalogStoreOfferPage{}, err
	}
	if err := tx.Commit(); err != nil {
		return CatalogStoreOfferPage{}, err
	}
	return page, nil
}

// IndependentPublicOffer is the only allowed outbound independent catalog
// projection. It never carries inventory counts, internal product attributes,
// publication/version bookkeeping, supplier identifiers or private metadata.
type IndependentPublicOfferMedia struct {
	URI  string `json:"uri"`
	Role string `json:"role"`
}
type IndependentPublicModifierOption struct {
	ID              string `json:"id"`
	NameAr          string `json:"nameAr"`
	PriceDeltaMinor int64  `json:"priceDeltaMinor"`
}
type IndependentPublicModifierGroup struct {
	ID            string                            `json:"id"`
	NameAr        string                            `json:"nameAr"`
	Required      bool                              `json:"required"`
	MinSelections int                               `json:"minSelections"`
	MaxSelections int                               `json:"maxSelections"`
	Options       []IndependentPublicModifierOption `json:"options"`
}
type IndependentPublicOffer struct {
	OfferID               string                           `json:"offerId"`
	ProductID             string                           `json:"productId"`
	ProductName           string                           `json:"productName"`
	ProductDescription    string                           `json:"productDescription,omitempty"`
	VariantID             string                           `json:"variantId"`
	VariantTitle          string                           `json:"variantTitle"`
	PriceMinor            int64                            `json:"priceMinor"`
	Availability          bool                             `json:"availability"`
	BaseUnit              string                           `json:"baseUnit"`
	PricingBasis          string                           `json:"pricingBasis"`
	PricingUnitBaseUnits  int64                            `json:"pricingUnitBaseUnits"`
	Currency              string                           `json:"currency"`
	QuantityMinBaseUnits  int64                            `json:"quantityMinBaseUnits"`
	QuantityMaxBaseUnits  int64                            `json:"quantityMaxBaseUnits"`
	QuantityStepBaseUnits int64                            `json:"quantityStepBaseUnits"`
	Media                 []IndependentPublicOfferMedia    `json:"media"`
	ModifierGroups        []IndependentPublicModifierGroup `json:"modifierGroups"`
}
type IndependentPublicCategory struct {
	ID     string `json:"id"`
	NameAr string `json:"nameAr"`
	Active bool   `json:"active"`
}
type IndependentPublicOfferPage struct {
	Categories []IndependentPublicCategory `json:"categories"`
	Offers     []IndependentPublicOffer    `json:"offers"`
	NextCursor string                      `json:"nextCursor,omitempty"`
}

// ListPublishedIndependentOffers strips storage/admin fields before any future
// authorized HTTP mapping. This method still requires a reviewed public route,
// verified policy state, customer privacy and abuse controls before activation.
func ListPublishedIndependentOffers(ctx context.Context, db *sql.DB, storeID, approvedLegalTermsVersion string, limit int, rawCursor string) (IndependentPublicOfferPage, error) {
	internal, err := listPublishedIndependentOffersInternal(ctx, db, storeID, approvedLegalTermsVersion, "", "", "", "", limit, rawCursor)
	if err != nil {
		return IndependentPublicOfferPage{}, err
	}
	return projectIndependentPublicOffers(internal)
}

// ListPublishedIndependentOffersForCity binds an unauthenticated website read
// to the same active City as the Store publication and its Catalog snapshot.
func ListPublishedIndependentOffersForCity(ctx context.Context, db *sql.DB, storeID, approvedLegalTermsVersion, cityID string, limit int, rawCursor string) (IndependentPublicOfferPage, error) {
	return ListPublishedIndependentOffersForCityFiltered(ctx, db, storeID, approvedLegalTermsVersion, cityID, "", "", "", limit, rawCursor)
}

// ListPublishedIndependentOffersForCityFiltered reuses the canonical Catalog
// and applies all public filters before pagination under one publication snapshot.
func ListPublishedIndependentOffersForCityFiltered(ctx context.Context, db *sql.DB, storeID, approvedLegalTermsVersion, cityID, categoryID, productID, search string, limit int, rawCursor string) (IndependentPublicOfferPage, error) {
	if strings.TrimSpace(cityID) == "" || len(cityID) > 128 {
		return IndependentPublicOfferPage{}, ErrIndependentStorefrontNotPublished
	}
	internal, err := listPublishedIndependentOffersInternal(ctx, db, storeID, approvedLegalTermsVersion, cityID, categoryID, productID, search, limit, rawCursor)
	if err != nil {
		return IndependentPublicOfferPage{}, err
	}
	return projectIndependentPublicOffers(internal)
}

func projectIndependentPublicOffers(internal CatalogStoreOfferPage) (IndependentPublicOfferPage, error) {
	public := IndependentPublicOfferPage{
		Categories: make([]IndependentPublicCategory, 0, len(internal.Categories)),
		Offers:     make([]IndependentPublicOffer, 0, len(internal.Offers)),
		NextCursor: internal.NextCursor,
	}
	for _, category := range internal.Categories {
		if category.Active {
			public.Categories = append(public.Categories, IndependentPublicCategory{
				ID: category.ID, NameAr: category.NameAr, Active: true,
			})
		}
	}
	for _, offer := range internal.Offers {
		if offer.QuantityMinBaseUnits == nil || offer.QuantityMaxBaseUnits == nil || offer.QuantityStepBaseUnits == nil {
			return IndependentPublicOfferPage{}, ErrIndependentStorefrontNotPublished
		}
		item := IndependentPublicOffer{
			OfferID: offer.ID, ProductID: offer.Product.ID,
			ProductName: offer.Product.CanonicalName, ProductDescription: offer.Product.Description,
			VariantID: offer.VariantID, VariantTitle: offer.Variant.Title,
			BaseUnit: offer.Variant.BaseUnit, PricingBasis: offer.PricingBasis,
			PricingUnitBaseUnits: offer.PricingUnitBaseUnits,
			PriceMinor:           offer.PriceMinor, Currency: offer.Currency, Availability: offer.Availability,
			QuantityMinBaseUnits:  *offer.QuantityMinBaseUnits,
			QuantityMaxBaseUnits:  *offer.QuantityMaxBaseUnits,
			QuantityStepBaseUnits: *offer.QuantityStepBaseUnits,
			Media:                 make([]IndependentPublicOfferMedia, 0, len(offer.Product.Media)),
		}
		item.ModifierGroups = make([]IndependentPublicModifierGroup, 0, len(offer.ModifierGroups))
		for _, group := range offer.ModifierGroups {
			if !group.Active {
				continue
			}
			publicGroup := IndependentPublicModifierGroup{
				ID: group.ID, NameAr: group.NameAr, Required: group.Required,
				MinSelections: group.MinSelections, MaxSelections: group.MaxSelections,
				Options: make([]IndependentPublicModifierOption, 0, len(group.Options)),
			}
			for _, option := range group.Options {
				if option.Availability && option.PriceDeltaMinor >= 0 {
					publicGroup.Options = append(publicGroup.Options, IndependentPublicModifierOption{
						ID: option.ID, NameAr: option.NameAr, PriceDeltaMinor: option.PriceDeltaMinor,
					})
				}
			}
			item.ModifierGroups = append(item.ModifierGroups, publicGroup)
		}
		for _, media := range offer.Product.Media {
			if strings.TrimSpace(media.URI) != "" {
				item.Media = append(item.Media, IndependentPublicOfferMedia{URI: media.URI, Role: media.Role})
			}
		}
		public.Offers = append(public.Offers, item)
	}
	return public, nil
}
