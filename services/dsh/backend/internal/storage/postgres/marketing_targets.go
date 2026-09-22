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
	case "STORE":
		return resolveDiscoveryStoreTarget(ctx, source, targetID, serviceCityID)
	case "PROMOTION":
		return resolveDiscoveryPromotionTarget(ctx, source, targetID, serviceCityID, at.UTC())
	case "PRODUCT", "CATEGORY":
		return resolveDiscoveryCatalogTarget(ctx, source, targetType, targetID, serviceCityID)
	default:
		return DiscoveryContentTargetResolution{}, ErrDiscoveryContentTargetInvalid
	}
}

func resolveDiscoveryStoreTarget(ctx context.Context, source discoveryContentTargetQuerier, targetID, serviceCityID string) (DiscoveryContentTargetResolution, error) {
	result := DiscoveryContentTargetResolution{TargetType: "STORE", TargetID: targetID}
	if err := source.QueryRowContext(ctx, `SELECT s.id FROM dsh.stores s JOIN dsh.service_cities sc ON sc.id=s.service_city_id WHERE s.id=$1 AND ($2='' OR s.service_city_id=$2) AND sc.active=true AND s.publication_state='published' AND s.publication_changed_at IS NOT NULL`, targetID, serviceCityID).Scan(&result.StoreID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return DiscoveryContentTargetResolution{}, ErrDiscoveryContentNotFound
		}
		return DiscoveryContentTargetResolution{}, err
	}
	return result, nil
}

func resolveDiscoveryPromotionTarget(ctx context.Context, source discoveryContentTargetQuerier, targetID, serviceCityID string, at time.Time) (DiscoveryContentTargetResolution, error) {
	var storeID, promotionCityID, state string
	var startsAt time.Time
	var endsAt sql.NullTime
	if err := source.QueryRowContext(ctx, "SELECT COALESCE(store_id,''),COALESCE(service_city_id,''),state,starts_at,ends_at FROM dsh.commerce_promotions WHERE id=$1", targetID).Scan(&storeID, &promotionCityID, &state, &startsAt, &endsAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return DiscoveryContentTargetResolution{}, ErrDiscoveryContentNotFound
		}
		return DiscoveryContentTargetResolution{}, err
	}
	if state != "PUBLISHED" || startsAt.After(at) || (endsAt.Valid && !endsAt.Time.After(at)) || (serviceCityID != "" && promotionCityID != "" && promotionCityID != serviceCityID) {
		return DiscoveryContentTargetResolution{}, ErrDiscoveryContentNotFound
	}
	if promotionCityID != "" {
		var active bool
		if err := source.QueryRowContext(ctx, "SELECT active FROM dsh.service_cities WHERE id=$1", promotionCityID).Scan(&active); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return DiscoveryContentTargetResolution{}, ErrDiscoveryContentNotFound
			}
			return DiscoveryContentTargetResolution{}, err
		}
		if !active {
			return DiscoveryContentTargetResolution{}, ErrDiscoveryContentNotFound
		}
	}
	if storeID != "" {
		var storeCityID string
		if err := source.QueryRowContext(ctx, `SELECT s.service_city_id FROM dsh.stores s JOIN dsh.service_cities sc ON sc.id=s.service_city_id WHERE s.id=$1 AND ($2='' OR s.service_city_id=$2) AND sc.active=true AND s.publication_state='published' AND s.publication_changed_at IS NOT NULL`, storeID, serviceCityID).Scan(&storeCityID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return DiscoveryContentTargetResolution{}, ErrDiscoveryContentNotFound
			}
			return DiscoveryContentTargetResolution{}, err
		}
		if promotionCityID != "" && promotionCityID != storeCityID {
			return DiscoveryContentTargetResolution{}, ErrDiscoveryContentNotFound
		}
	}
	return DiscoveryContentTargetResolution{TargetType: "PROMOTION", TargetID: targetID, StoreID: storeID, PromotionID: targetID}, nil
}

func resolveDiscoveryCatalogTarget(ctx context.Context, source discoveryContentTargetQuerier, targetType, targetID, serviceCityID string) (DiscoveryContentTargetResolution, error) {
	conditions := strings.Join(customerVisibleOfferConditionsForAliases("o", "v", "p", "s"), " AND ")
	predicate := "p.id=$2"
	join := ""
	if targetType == "CATEGORY" {
		join = " JOIN dsh.catalog_product_categories pc ON pc.product_id=p.id"
		predicate = "pc.category_id=$2"
	}
	query := `SELECT s.id FROM dsh.stores s JOIN dsh.service_cities sc ON sc.id=s.service_city_id AND sc.active=true JOIN dsh.catalog_store_offers o ON o.store_id=s.id JOIN dsh.catalog_product_variants v ON v.id=o.variant_id JOIN dsh.catalog_products p ON p.id=v.product_id` + join + ` WHERE ($1='' OR s.service_city_id=$1) AND ` + predicate + " AND " + conditions + " ORDER BY s.id ASC LIMIT 1"
	result := DiscoveryContentTargetResolution{TargetType: targetType, TargetID: targetID}
	if err := source.QueryRowContext(ctx, query, serviceCityID, targetID).Scan(&result.StoreID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return DiscoveryContentTargetResolution{}, ErrDiscoveryContentNotFound
		}
		return DiscoveryContentTargetResolution{}, err
	}
	return result, nil
}
