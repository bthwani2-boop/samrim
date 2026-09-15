package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

type PublicCatalogRecord struct {
	StoreID    string
	VerticalID string
	Categories []CatalogCategoryRecord
	Offers     []CatalogStoreOfferRecord
}

type rowQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func ReadCustomerVisibleOffer(ctx context.Context, db *sql.DB, storeID, offerID string) (CatalogStoreOfferRecord, error) {
	item, err := readCustomerVisibleOffer(ctx, db, storeID, offerID, false)
	if errors.Is(err, sql.ErrNoRows) {
		return CatalogStoreOfferRecord{}, ErrCatalogOfferNotFound
	}
	return item, err
}

func readCustomerVisibleOfferTx(ctx context.Context, tx *sql.Tx, storeID, offerID string) (CatalogStoreOfferRecord, error) {
	return readCustomerVisibleOffer(ctx, tx, storeID, offerID, true)
}

func readCustomerVisibleOffer(ctx context.Context, rowSource rowQueryer, storeID, offerID string, lock bool) (CatalogStoreOfferRecord, error) {
	conditions := append([]string{"o.store_id=$1", "o.id=$2"}, customerVisibleOfferConditions()...)
	query := catalogOfferSelect + " WHERE " + strings.Join(conditions, " AND ")
	if lock {
		query += " FOR SHARE OF o,v,p,s"
	}
	return scanCatalogOffer(rowSource.QueryRowContext(ctx, query, strings.TrimSpace(storeID), strings.TrimSpace(offerID)))
}

func ReadPublicCatalog(ctx context.Context, db *sql.DB, storeID, serviceCityID, categoryID, query string) (PublicCatalogRecord, error) {
	storeID = strings.TrimSpace(storeID)
	serviceCityID = strings.TrimSpace(serviceCityID)
	categoryID = strings.TrimSpace(categoryID)
	query = strings.TrimSpace(query)
	if storeID == "" || serviceCityID == "" {
		return PublicCatalogRecord{}, ErrStoreNotFound
	}
	var verticalID string
	err := db.QueryRowContext(ctx, `SELECT s.primary_vertical_id
		FROM dsh.stores s
		JOIN dsh.service_cities c ON c.id=s.service_city_id AND c.active=true
		JOIN dsh.commerce_verticals v ON v.id=s.primary_vertical_id AND v.active=true
		WHERE s.id=$1 AND s.service_city_id=$2 AND s.publication_state='published'`, storeID, serviceCityID).Scan(&verticalID)
	if errors.Is(err, sql.ErrNoRows) {
		return PublicCatalogRecord{}, ErrStoreNotFound
	}
	if err != nil {
		return PublicCatalogRecord{}, fmt.Errorf("read public catalog store scope: %w", err)
	}

	categories, err := ListCatalogCategories(ctx, db, verticalID, true)
	if err != nil {
		return PublicCatalogRecord{}, err
	}
	offers, err := listCustomerVisibleOffers(ctx, db, storeID, categoryID, query)
	if err != nil {
		return PublicCatalogRecord{}, err
	}
	return PublicCatalogRecord{StoreID: storeID, VerticalID: verticalID, Categories: categories, Offers: offers}, nil
}

func listCustomerVisibleOffers(ctx context.Context, db *sql.DB, storeID, categoryID, query string) ([]CatalogStoreOfferRecord, error) {
	conditions := customerVisibleOfferConditions()
	args := []any{strings.TrimSpace(storeID)}
	conditions = append([]string{"o.store_id=$1"}, conditions...)
	if categoryID != "" {
		args = append(args, categoryID)
		conditions = append(conditions, fmt.Sprintf("EXISTS (SELECT 1 FROM dsh.catalog_product_categories pc WHERE pc.product_id=p.id AND pc.category_id=$%d)", len(args)))
	}
	if query != "" {
		args = append(args, query+"%")
		conditions = append(conditions, fmt.Sprintf("lower(p.canonical_name) LIKE lower($%d)", len(args)))
	}
	rows, err := db.QueryContext(ctx, catalogOfferSelect+" WHERE "+strings.Join(conditions, " AND ")+" ORDER BY lower(p.canonical_name),o.id", args...)
	if err != nil {
		return nil, fmt.Errorf("list customer-visible offers: %w", err)
	}
	defer rows.Close()
	items := make([]CatalogStoreOfferRecord, 0)
	for rows.Next() {
		item, scanErr := scanCatalogOffer(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func customerVisibleOfferConditions() []string {
	return customerVisibleOfferConditionsForAliases("o", "v", "p", "s")
}

func customerVisibleOfferConditionsForAliases(offerAlias, variantAlias, productAlias, storeAlias string) []string {
	conditions := publishableCatalogOfferConditionsForAliases(offerAlias, variantAlias, productAlias, storeAlias)
	return append(conditions, storeAlias+".publication_state='published'")
}

func publishableCatalogOfferConditionsForAliases(offerAlias, variantAlias, productAlias, storeAlias string) []string {
	return []string{
		offerAlias + ".publication_state='published'",
		offerAlias + ".availability=true",
		offerAlias + ".price_minor>0",
		productAlias + ".active=true",
		variantAlias + ".active=true",
		storeAlias + ".service_city_id IS NOT NULL",
		storeAlias + ".primary_vertical_id IS NOT NULL",
		productAlias + ".vertical_id=" + storeAlias + ".primary_vertical_id",
		"EXISTS (SELECT 1 FROM dsh.commerce_verticals cv WHERE cv.id=" + storeAlias + ".primary_vertical_id AND cv.active=true)",
	}
}
