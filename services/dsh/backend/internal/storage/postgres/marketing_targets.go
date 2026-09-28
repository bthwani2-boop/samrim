package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

type DiscoveryContentTargetResolution struct {
	ContentID   string
	TargetType  string
	TargetID    string
	StoreID     string
	PromotionID string
}

type discoveryContentTargetQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func ResolveDiscoveryContentTarget(ctx context.Context, db *sql.DB, contentID, serviceCityID string) (DiscoveryContentTargetResolution, error) {
	contentID = strings.TrimSpace(contentID)
	serviceCityID = strings.TrimSpace(serviceCityID)
	if contentID == "" || serviceCityID == "" {
		return DiscoveryContentTargetResolution{}, ErrDiscoveryContentInvalid
	}
	content, err := ReadDiscoveryContent(ctx, db, contentID)
	if err != nil {
		return DiscoveryContentTargetResolution{}, err
	}
	now := time.Now().UTC()
	if content.State != "PUBLISHED" || content.StartsAt.After(now) || (content.EndsAt != nil && !content.EndsAt.After(now)) || (content.ServiceCityID != "" && content.ServiceCityID != serviceCityID) {
		return DiscoveryContentTargetResolution{}, ErrDiscoveryContentNotFound
	}
	result, err := resolveDiscoveryContentTarget(ctx, db, content.TargetType, content.TargetID, serviceCityID, now)
	if err != nil {
		return DiscoveryContentTargetResolution{}, err
	}
	result.ContentID = content.ID
	return result, nil
}

func resolveDiscoveryContentTarget(ctx context.Context, source discoveryContentTargetQuerier, targetType, targetID, serviceCityID string, at time.Time) (DiscoveryContentTargetResolution, error) {
	targetType = strings.TrimSpace(targetType)
	targetID = strings.TrimSpace(targetID)
	serviceCityID = strings.TrimSpace(serviceCityID)
	if targetType == "INFO" {
		if targetID == "" {
			return DiscoveryContentTargetResolution{TargetType: targetType}, nil
		}
		return DiscoveryContentTargetResolution{}, ErrDiscoveryContentTargetInvalid
	}
	if targetID == "" {
		return DiscoveryContentTargetResolution{}, ErrDiscoveryContentTargetInvalid
	}
	switch targetType {
	case "STORE", "PROMOTION", "PRODUCT", "CATEGORY":
	default:
		return DiscoveryContentTargetResolution{}, ErrDiscoveryContentTargetInvalid
	}

	catalogConditions := strings.Join(customerVisibleOfferConditionsForAliases("offer", "variant", "product", "store"), " AND ")
	targetPredicate := discoveryContentTargetEligibilityPredicate("target", "$3", "$4")
	query := `WITH target AS (
		SELECT $1::text AS target_type,NULLIF($2::text,'') AS target_id
	)
	SELECT target.target_type,COALESCE(target.target_id,''),
	       CASE
	         WHEN target.target_type='STORE' THEN target.target_id
	         WHEN target.target_type='PROMOTION' THEN COALESCE((
	           SELECT promotion.store_id FROM dsh.commerce_promotions promotion WHERE promotion.id=target.target_id
	         ),'')
	         WHEN target.target_type IN ('PRODUCT','CATEGORY') THEN COALESCE((
	           SELECT store.id
	           FROM dsh.stores store
	           JOIN dsh.service_cities city ON city.id=store.service_city_id AND city.active=true
	           JOIN dsh.catalog_store_offers offer ON offer.store_id=store.id
	           JOIN dsh.catalog_product_variants variant ON variant.id=offer.variant_id
	           JOIN dsh.catalog_products product ON product.id=variant.product_id
	           LEFT JOIN dsh.catalog_product_categories product_category
	             ON target.target_type='CATEGORY' AND product_category.product_id=product.id
	           WHERE ($3='' OR store.service_city_id=$3)
	             AND ((target.target_type='PRODUCT' AND product.id=target.target_id)
	               OR (target.target_type='CATEGORY' AND product_category.category_id=target.target_id))
	             AND ` + catalogConditions + `
	           ORDER BY store.id ASC LIMIT 1
	         ),'')
	         ELSE ''
	       END AS store_id
	FROM target
	WHERE ` + targetPredicate
	var result DiscoveryContentTargetResolution
	err := source.QueryRowContext(ctx, query, targetType, targetID, serviceCityID, at.UTC()).Scan(&result.TargetType, &result.TargetID, &result.StoreID)
	if errors.Is(err, sql.ErrNoRows) {
		return DiscoveryContentTargetResolution{}, ErrDiscoveryContentNotFound
	}
	if err != nil {
		return DiscoveryContentTargetResolution{}, err
	}
	if result.TargetType == "PROMOTION" {
		result.PromotionID = result.TargetID
	}
	return result, nil
}

func discoveryContentTargetEligibilityPredicate(contentAlias, serviceCityPlaceholder, atExpression string) string {
	catalogConditions := strings.Join(customerVisibleOfferConditionsForAliases("offer", "variant", "product", "store"), " AND ")
	return `(
		(` + contentAlias + `.target_type='INFO' AND ` + contentAlias + `.target_id IS NULL)
		OR (` + contentAlias + `.target_type='STORE' AND EXISTS (
			SELECT 1
			FROM dsh.stores store
			JOIN dsh.service_cities city ON city.id=store.service_city_id AND city.active=true
			WHERE store.id=` + contentAlias + `.target_id
			  AND (` + serviceCityPlaceholder + `='' OR store.service_city_id=` + serviceCityPlaceholder + `)
			  AND store.publication_state='published'
			  AND store.publication_changed_at IS NOT NULL
		))
		OR (` + contentAlias + `.target_type='PROMOTION' AND EXISTS (
			SELECT 1
			FROM dsh.commerce_promotions promotion
			WHERE promotion.id=` + contentAlias + `.target_id
			  AND promotion.state='PUBLISHED'
			  AND promotion.starts_at<=` + atExpression + `
			  AND (promotion.ends_at IS NULL OR promotion.ends_at>` + atExpression + `)
			  AND (` + serviceCityPlaceholder + `='' OR promotion.service_city_id IS NULL OR promotion.service_city_id='' OR promotion.service_city_id=` + serviceCityPlaceholder + `)
			  AND (promotion.service_city_id IS NULL OR promotion.service_city_id='' OR EXISTS (
				  SELECT 1 FROM dsh.service_cities promotion_city
				  WHERE promotion_city.id=promotion.service_city_id AND promotion_city.active=true
			  ))
			  AND (promotion.store_id IS NULL OR promotion.store_id='' OR EXISTS (
				  SELECT 1
				  FROM dsh.stores store
				  JOIN dsh.service_cities city ON city.id=store.service_city_id AND city.active=true
				  WHERE store.id=promotion.store_id
				    AND (` + serviceCityPlaceholder + `='' OR store.service_city_id=` + serviceCityPlaceholder + `)
				    AND store.publication_state='published'
				    AND store.publication_changed_at IS NOT NULL
				    AND (promotion.service_city_id IS NULL OR promotion.service_city_id='' OR promotion.service_city_id=store.service_city_id)
			  ))
		))
		OR (` + contentAlias + `.target_type='PRODUCT' AND EXISTS (
			SELECT 1
			FROM dsh.stores store
			JOIN dsh.service_cities city ON city.id=store.service_city_id AND city.active=true
			JOIN dsh.catalog_store_offers offer ON offer.store_id=store.id
			JOIN dsh.catalog_product_variants variant ON variant.id=offer.variant_id
			JOIN dsh.catalog_products product ON product.id=variant.product_id
			WHERE (` + serviceCityPlaceholder + `='' OR store.service_city_id=` + serviceCityPlaceholder + `)
			  AND product.id=` + contentAlias + `.target_id
			  AND ` + catalogConditions + `
		))
		OR (` + contentAlias + `.target_type='CATEGORY' AND EXISTS (
			SELECT 1
			FROM dsh.stores store
			JOIN dsh.service_cities city ON city.id=store.service_city_id AND city.active=true
			JOIN dsh.catalog_store_offers offer ON offer.store_id=store.id
			JOIN dsh.catalog_product_variants variant ON variant.id=offer.variant_id
			JOIN dsh.catalog_products product ON product.id=variant.product_id
			JOIN dsh.catalog_product_categories product_category ON product_category.product_id=product.id
			WHERE (` + serviceCityPlaceholder + `='' OR store.service_city_id=` + serviceCityPlaceholder + `)
			  AND product_category.category_id=` + contentAlias + `.target_id
			  AND ` + catalogConditions + `
		))
	)`
}
