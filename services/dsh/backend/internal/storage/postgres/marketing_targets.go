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

func ResolveDiscoveryContentTarget(ctx context.Context, db *sql.DB, contentID, serviceCityID string) (DiscoveryContentTargetResolution, error) {
	contentID = strings.TrimSpace(contentID)
	serviceCityID = strings.TrimSpace(serviceCityID)
	if contentID == "" || serviceCityID == "" {
		return DiscoveryContentTargetResolution{}, ErrDiscoveryContentInvalid
	}
	content, err := ReadDiscoveryContent(ctx, db, contentID)
	if errors.Is(err, ErrDiscoveryContentNotFound) {
		return DiscoveryContentTargetResolution{}, ErrDiscoveryContentNotFound
	}
	if err != nil {
		return DiscoveryContentTargetResolution{}, err
	}
	if content.State != "PUBLISHED" || content.StartsAt.After(time.Now().UTC()) || (content.EndsAt != nil && !content.EndsAt.After(time.Now().UTC())) || (content.ServiceCityID != "" && content.ServiceCityID != serviceCityID) {
		return DiscoveryContentTargetResolution{}, ErrDiscoveryContentNotFound
	}
	result := DiscoveryContentTargetResolution{ContentID: content.ID, TargetType: content.TargetType, TargetID: content.TargetID}
	switch content.TargetType {
	case "INFO":
		return result, nil
	case "STORE":
		if err := db.QueryRowContext(ctx, `SELECT s.id FROM dsh.stores s JOIN dsh.service_cities sc ON sc.id=s.service_city_id WHERE s.id=$1 AND s.service_city_id=$2 AND sc.active=true AND s.publication_state='published' AND s.publication_changed_at IS NOT NULL`, content.TargetID, serviceCityID).Scan(&result.StoreID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return DiscoveryContentTargetResolution{}, ErrDiscoveryContentNotFound
			}
			return DiscoveryContentTargetResolution{}, err
		}
		return result, nil
	case "PROMOTION":
		var storeID, promotionCityID, state string
		var startsAt time.Time
		var endsAt sql.NullTime
		if err := db.QueryRowContext(ctx, "SELECT COALESCE(store_id,''),COALESCE(service_city_id,''),state,starts_at,ends_at FROM dsh.commerce_promotions WHERE id=$1", content.TargetID).Scan(&storeID, &promotionCityID, &state, &startsAt, &endsAt); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return DiscoveryContentTargetResolution{}, ErrDiscoveryContentNotFound
			}
			return DiscoveryContentTargetResolution{}, err
		}
		if state != "PUBLISHED" || startsAt.After(time.Now().UTC()) || (endsAt.Valid && !endsAt.Time.After(time.Now().UTC())) || (promotionCityID != "" && promotionCityID != serviceCityID) {
			return DiscoveryContentTargetResolution{}, ErrDiscoveryContentNotFound
		}
		result.PromotionID = content.TargetID
		result.StoreID = storeID
		return result, nil
	case "PRODUCT", "CATEGORY":
		conditions := strings.Join(customerVisibleOfferConditionsForAliases("o", "v", "p", "s"), " AND ")
		predicate := "p.id=$2"
		join := ""
		if content.TargetType == "CATEGORY" {
			join = " JOIN dsh.catalog_product_categories pc ON pc.product_id=p.id"
			predicate = "pc.category_id=$2"
		}
		query := `SELECT s.id FROM dsh.stores s JOIN dsh.catalog_store_offers o ON o.store_id=s.id JOIN dsh.catalog_product_variants v ON v.id=o.variant_id JOIN dsh.catalog_products p ON p.id=v.product_id` + join + ` WHERE s.service_city_id=$1 AND ` + predicate + " AND " + conditions + " ORDER BY s.id ASC LIMIT 1"
		if err := db.QueryRowContext(ctx, query, serviceCityID, content.TargetID).Scan(&result.StoreID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return DiscoveryContentTargetResolution{}, ErrDiscoveryContentNotFound
			}
			return DiscoveryContentTargetResolution{}, err
		}
		return result, nil
	default:
		return DiscoveryContentTargetResolution{}, ErrDiscoveryContentTargetInvalid
	}
}
