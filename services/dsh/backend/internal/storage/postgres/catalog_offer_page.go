package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/lib/pq"
)

var ErrCatalogOfferInvalidCursor = errors.New("catalog StoreOffer cursor is invalid")

type CatalogStoreOfferPage struct {
	Offers     []CatalogStoreOfferRecord
	NextCursor string
}

type catalogStoreOfferCursor struct {
	Version   int       `json:"v"`
	StoreID   string    `json:"storeId"`
	CreatedAt time.Time `json:"createdAt"`
	OfferID   string    `json:"offerId"`
}

func ListCatalogOfferPage(ctx context.Context, db *sql.DB, storeID string, limit int, rawCursor string) (CatalogStoreOfferPage, error) {
	storeID = strings.TrimSpace(storeID)
	rawCursor = strings.TrimSpace(rawCursor)
	if db == nil {
		return CatalogStoreOfferPage{}, errors.New("DSH database is nil")
	}
	if storeID == "" || len(storeID) > 128 || limit < 1 || limit > 100 || len(rawCursor) > 2048 {
		return CatalogStoreOfferPage{}, ErrCatalogOfferInvalidCursor
	}
	cursor, err := decodeCatalogStoreOfferCursor(rawCursor, storeID)
	if err != nil {
		return CatalogStoreOfferPage{}, err
	}
	query := catalogOfferSelect + " WHERE o.store_id=$1"
	args := []any{storeID}
	if cursor != nil {
		args = append(args, cursor.CreatedAt, cursor.OfferID)
		query += " AND (o.created_at,o.id)>($2,$3)"
	}
	args = append(args, limit+1)
	query += " ORDER BY o.created_at ASC,o.id ASC LIMIT $" + itoa(len(args))
	rows, err := db.QueryContext(ctx, query, args...)
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
	if err := hydrateCatalogOfferPage(ctx, db, page.Offers); err != nil {
		return CatalogStoreOfferPage{}, err
	}
	return page, nil
}

func hydrateCatalogOfferPage(ctx context.Context, db *sql.DB, offers []CatalogStoreOfferRecord) error {
	if len(offers) == 0 {
		return nil
	}
	productIDs := make([]string, 0, len(offers))
	offerIDs := make([]string, 0, len(offers))
	productSeen := make(map[string]struct{}, len(offers))
	for _, offer := range offers {
		offerIDs = append(offerIDs, offer.ID)
		if _, exists := productSeen[offer.Product.ID]; !exists {
			productSeen[offer.Product.ID] = struct{}{}
			productIDs = append(productIDs, offer.Product.ID)
		}
	}
	mediaByProduct := make(map[string][]CatalogMediaRecord, len(productIDs))
	mediaRows, err := db.QueryContext(ctx, `SELECT media.product_id,media.uri,media.media_role,media.ordinal
		FROM dsh.catalog_media media
		JOIN dsh.catalog_media_assets asset ON asset.product_id=media.product_id AND asset.uri=media.uri AND asset.state='active'
		WHERE media.product_id=ANY($1) ORDER BY media.product_id,media.ordinal`, pq.Array(productIDs))
	if err != nil {
		return err
	}
	for mediaRows.Next() {
		var productID string
		var media CatalogMediaRecord
		if err := mediaRows.Scan(&productID, &media.URI, &media.Role, &media.Ordinal); err != nil {
			_ = mediaRows.Close()
			return err
		}
		mediaByProduct[productID] = append(mediaByProduct[productID], media)
	}
	if err := mediaRows.Err(); err != nil {
		_ = mediaRows.Close()
		return err
	}
	if err := mediaRows.Close(); err != nil {
		return err
	}
	groupsByOffer := make(map[string][]CatalogModifierGroupRecord, len(offerIDs))
	groupIDs := make([]string, 0)
	groupRows, err := db.QueryContext(ctx, `SELECT og.offer_id,g.id,g.store_id,g.name_ar,g.required,g.min_selections,g.max_selections,g.active,g.version
		FROM dsh.catalog_store_offer_modifier_groups og
		JOIN dsh.catalog_modifier_groups g ON g.id=og.group_id
		WHERE og.offer_id=ANY($1) AND g.active=true ORDER BY og.offer_id,og.ordinal,g.id`, pq.Array(offerIDs))
	if err != nil {
		return err
	}
	for groupRows.Next() {
		var offerID string
		var group CatalogModifierGroupRecord
		if err := groupRows.Scan(&offerID, &group.ID, &group.StoreID, &group.NameAr, &group.Required, &group.MinSelections, &group.MaxSelections, &group.Active, &group.Version); err != nil {
			_ = groupRows.Close()
			return err
		}
		groupsByOffer[offerID] = append(groupsByOffer[offerID], group)
		groupIDs = append(groupIDs, group.ID)
	}
	if err := groupRows.Err(); err != nil {
		_ = groupRows.Close()
		return err
	}
	if err := groupRows.Close(); err != nil {
		return err
	}
	optionsByGroup := make(map[string][]CatalogModifierOptionRecord, len(groupIDs))
	if len(groupIDs) > 0 {
		optionRows, err := db.QueryContext(ctx, `SELECT id,group_id,name_ar,price_delta_minor,availability,ordinal,version
			FROM dsh.catalog_modifier_options WHERE group_id=ANY($1) ORDER BY group_id,ordinal,id`, pq.Array(groupIDs))
		if err != nil {
			return err
		}
		for optionRows.Next() {
			var option CatalogModifierOptionRecord
			if err := optionRows.Scan(&option.ID, &option.GroupID, &option.NameAr, &option.PriceDeltaMinor, &option.Availability, &option.Ordinal, &option.Version); err != nil {
				_ = optionRows.Close()
				return err
			}
			optionsByGroup[option.GroupID] = append(optionsByGroup[option.GroupID], option)
		}
		if err := optionRows.Err(); err != nil {
			_ = optionRows.Close()
			return err
		}
		if err := optionRows.Close(); err != nil {
			return err
		}
	}
	for i := range offers {
		offers[i].Product.Media = mediaByProduct[offers[i].Product.ID]
		offers[i].ModifierGroups = groupsByOffer[offers[i].ID]
		for groupIndex := range offers[i].ModifierGroups {
			offers[i].ModifierGroups[groupIndex].Options = optionsByGroup[offers[i].ModifierGroups[groupIndex].ID]
		}
	}
	return nil
}

func encodeCatalogStoreOfferCursor(cursor catalogStoreOfferCursor) (string, error) {
	value, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func decodeCatalogStoreOfferCursor(raw, storeID string) (*catalogStoreOfferCursor, error) {
	if raw == "" {
		return nil, nil
	}
	value, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, ErrCatalogOfferInvalidCursor
	}
	var cursor catalogStoreOfferCursor
	if json.Unmarshal(value, &cursor) != nil || cursor.Version != 1 || cursor.StoreID != storeID || cursor.CreatedAt.IsZero() || strings.TrimSpace(cursor.OfferID) == "" {
		return nil, ErrCatalogOfferInvalidCursor
	}
	return &cursor, nil
}
