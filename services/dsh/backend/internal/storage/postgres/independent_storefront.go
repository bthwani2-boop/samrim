package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// These independent Store reads are intentionally not wired to public HTTP
// routes. Publication is subject to separate legal, security and Product gates.
var ErrIndependentStorefrontNotPublished = errors.New("independent storefront was not published")

// Both public Store eligibility and the public Catalog use one exact
// orderable Direct-MVP Offer rule. More complex modifiers, quantity-stock
// reservations and measured prices must not appear purchasable until DSH
// owns their server quote and lifecycle.
const independentDirectBuyableOfferSQL = `
    AND o.publication_state='published' AND o.availability=true
    AND o.currency='YER' AND o.pricing_basis='PER_UNIT'
    -- Direct Order rejects free/negative prices and checked-int64 overflow.
    -- Only advertise Offers whose entire declared quantity range is quoteable.
    AND o.price_minor > 0
    AND o.price_minor::numeric * o.quantity_max_base_units::numeric <= 9223372036854775807
    AND o.pricing_unit_base_units=1
    AND o.inventory_policy='AVAILABILITY_ONLY'
    AND EXISTS (SELECT 1 FROM dsh.catalog_publishable_offers publishable WHERE publishable.offer_id=o.id)
    AND o.quantity_min_base_units > 0
    AND o.quantity_max_base_units >= o.quantity_min_base_units
    AND o.quantity_step_base_units > 0 AND o.pricing_unit_base_units > 0
    AND MOD(o.quantity_min_base_units,o.pricing_unit_base_units)=0
    AND v.active=true AND p.active=true AND p.deleted_at IS NULL
    AND (p.scope='SHARED' OR (p.scope='STORE_SCOPED' AND p.store_id=s.id))
    AND NOT EXISTS(SELECT 1 FROM dsh.catalog_store_offer_modifier_groups og WHERE og.offer_id=o.id)
`

type IndependentPublishedStore struct {
	StoreID               string
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
	err := db.QueryRowContext(ctx, `SELECT s.id,s.name,s.version,p.version,p.published_at,
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
		  AND 'CUSTOMER_PICKUP'=ANY(s.fulfillment_modes)
		  AND cp.review_state='PASSED' AND cp.published_at IS NOT NULL
		  AND cp.authored_by_actor_id=s.partner_actor_id
		  AND NULLIF(btrim(cp.reviewed_by_actor_id),'') IS NOT NULL
		  AND EXISTS (
			SELECT 1 FROM dsh.catalog_store_offers o
			JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
			JOIN dsh.catalog_products p ON p.id=v.product_id
			WHERE o.store_id=s.id
		`+independentDirectBuyableOfferSQL+`
		  )`, storeID, approvedLegalTermsVersion).Scan(
		&result.StoreID, &result.Name, &result.StoreVersion,
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

// ListPublishedIndependentOffers queries the canonical Catalog, never a
// shadow independent catalog. A Store-specific cursor cannot be replayed to
// enumerate a different Store. Private draft/hidden offers never leave DSH.
func listPublishedIndependentOffersInternal(ctx context.Context, db *sql.DB, storeID, approvedLegalTermsVersion string, limit int, rawCursor string) (CatalogStoreOfferPage, error) {
	storeID = strings.TrimSpace(storeID)
	if db == nil || storeID == "" || len(storeID) > 128 || limit < 1 || limit > 100 || len(rawCursor) > 2048 {
		return CatalogStoreOfferPage{}, ErrCatalogOfferInvalidCursor
	}
	cursor, err := decodeCatalogStoreOfferCursor(rawCursor, storeID)
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
	if _, err := readPublishedIndependentStoreWithQueryer(ctx, tx, storeID, approvedLegalTermsVersion); err != nil {
		return CatalogStoreOfferPage{}, err
	}
	query := catalogOfferSelect + ` JOIN dsh.independent_store_publications publication ON publication.store_id=s.id
		JOIN dsh.service_cities city ON city.id=s.service_city_id AND city.active=true
		WHERE s.id=$1 AND s.relation_model='INDEPENDENT_STORE'
		  AND s.publication_state<>'published' AND s.deleted_at IS NULL
		  AND publication.state='PUBLISHED_INDEPENDENT' AND publication.review_state='PASSED'
		  AND publication.terms_version=$2 AND publication.terms_accepted_at IS NOT NULL
		  AND publication.terms_accepted_by_actor_id=s.partner_actor_id
		  AND publication.published_at IS NOT NULL
		  AND 'CUSTOMER_PICKUP'=ANY(s.fulfillment_modes)
		  AND EXISTS (SELECT 1 FROM dsh.independent_store_customer_policies cp
		      WHERE cp.store_id=s.id AND cp.review_state='PASSED'
		        AND cp.published_at IS NOT NULL AND cp.authored_by_actor_id=s.partner_actor_id
		        AND NULLIF(btrim(cp.reviewed_by_actor_id),'') IS NOT NULL)
		  AND EXISTS (SELECT 1 FROM dsh.store_public_contacts c
		      WHERE c.store_id=s.id AND (c.phone_e164<>'' OR c.email<>'' OR c.whatsapp_enabled))
		  AND EXISTS (SELECT 1 FROM dsh.store_profile_media_assets a
		      WHERE a.store_id=s.id AND a.media_role='primary' AND a.state='active' AND a.rights_attested_at IS NOT NULL AND NULLIF(btrim(a.uri),'') IS NOT NULL)
		  AND EXISTS (SELECT 1 FROM dsh.store_profile_media_assets a
		      WHERE a.store_id=s.id AND a.media_role='cover' AND a.state='active' AND a.rights_attested_at IS NOT NULL AND NULLIF(btrim(a.uri),'') IS NOT NULL)` + independentDirectBuyableOfferSQL
	args := []any{storeID, approvedLegalTermsVersion}
	if cursor != nil {
		args = append(args, cursor.CreatedAt, cursor.OfferID)
		query += " AND (o.created_at,o.id)>($3,$4)"
	}
	args = append(args, limit+1)
	query += " ORDER BY o.created_at ASC,o.id ASC LIMIT $" + itoa(len(args))
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return CatalogStoreOfferPage{}, err
	}
	items := make([]CatalogStoreOfferRecord, 0, limit+1)
	for rows.Next() {
		item, scanErr := scanCatalogOffer(rows)
		if scanErr != nil {
			_ = rows.Close()
			return CatalogStoreOfferPage{}, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return CatalogStoreOfferPage{}, err
	}
	if err := rows.Close(); err != nil {
		return CatalogStoreOfferPage{}, err
	}
	page := CatalogStoreOfferPage{Offers: items}
	if len(items) > limit {
		page.Offers = items[:limit]
		last := page.Offers[len(page.Offers)-1]
		page.NextCursor, err = encodeCatalogStoreOfferCursor(catalogStoreOfferCursor{Version: 1, StoreID: storeID, CreatedAt: last.CreatedAt.UTC(), OfferID: last.ID})
		if err != nil {
			return CatalogStoreOfferPage{}, err
		}
	}
	if err := hydrateCatalogOfferPage(ctx, tx, page.Offers); err != nil {
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
type IndependentPublicOffer struct {
	OfferID               string                        `json:"offerId"`
	ProductID             string                        `json:"productId"`
	ProductName           string                        `json:"productName"`
	ProductDescription    string                        `json:"productDescription,omitempty"`
	VariantID             string                        `json:"variantId"`
	VariantTitle          string                        `json:"variantTitle"`
	PriceMinor            int64                         `json:"priceMinor"`
	Currency              string                        `json:"currency"`
	QuantityMinBaseUnits  int64                         `json:"quantityMinBaseUnits"`
	QuantityMaxBaseUnits  int64                         `json:"quantityMaxBaseUnits"`
	QuantityStepBaseUnits int64                         `json:"quantityStepBaseUnits"`
	Media                 []IndependentPublicOfferMedia `json:"media"`
}
type IndependentPublicOfferPage struct {
	Offers     []IndependentPublicOffer `json:"offers"`
	NextCursor string                   `json:"nextCursor,omitempty"`
}

// ListPublishedIndependentOffers strips storage/admin fields before any future
// authorized HTTP mapping. This method still requires a reviewed public route,
// verified policy state, customer privacy and abuse controls before activation.
func ListPublishedIndependentOffers(ctx context.Context, db *sql.DB, storeID, approvedLegalTermsVersion string, limit int, rawCursor string) (IndependentPublicOfferPage, error) {
	internal, err := listPublishedIndependentOffersInternal(ctx, db, storeID, approvedLegalTermsVersion, limit, rawCursor)
	if err != nil {
		return IndependentPublicOfferPage{}, err
	}
	public := IndependentPublicOfferPage{Offers: make([]IndependentPublicOffer, 0, len(internal.Offers)), NextCursor: internal.NextCursor}
	for _, offer := range internal.Offers {
		if offer.QuantityMinBaseUnits == nil || offer.QuantityMaxBaseUnits == nil || offer.QuantityStepBaseUnits == nil {
			return IndependentPublicOfferPage{}, ErrIndependentStorefrontNotPublished
		}
		item := IndependentPublicOffer{
			OfferID: offer.ID, ProductID: offer.Product.ID,
			ProductName: offer.Product.CanonicalName, ProductDescription: offer.Product.Description,
			VariantID: offer.VariantID, VariantTitle: offer.Variant.Title,
			PriceMinor: offer.PriceMinor, Currency: offer.Currency,
			QuantityMinBaseUnits:  *offer.QuantityMinBaseUnits,
			QuantityMaxBaseUnits:  *offer.QuantityMaxBaseUnits,
			QuantityStepBaseUnits: *offer.QuantityStepBaseUnits,
			Media:                 make([]IndependentPublicOfferMedia, 0, len(offer.Product.Media)),
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
