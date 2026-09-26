package postgres

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/lib/pq"
)

const (
	publicStoreDefaultPageSize = 20
	publicStoreMaximumPageSize = 50
	publicStoreMaximumCursor   = 2048
)

type PublicStoreListQuery struct {
	ServiceCityID         string
	Query                 string
	CategoryID            string
	FavoriteClientActorID string
	Sort                  string
	Limit                 int
	Cursor                string
	Latitude              *float64
	Longitude             *float64
}

type PublicStorePage struct {
	Stores     []PublicStoreRecord
	Limit      int
	NextCursor string
}

type publicStoreCursor struct {
	Version        int        `json:"v"`
	Scope          string     `json:"scope"`
	ID             string     `json:"id"`
	NameKey        string     `json:"nameKey,omitempty"`
	CreatedAt      *time.Time `json:"createdAt,omitempty"`
	DistanceMeters *float64   `json:"distanceMeters,omitempty"`
}

func ListPublishedStorePage(ctx context.Context, db *sql.DB, input PublicStoreListQuery) (PublicStorePage, error) {
	if db == nil {
		return PublicStorePage{}, errors.New("DSH database is nil")
	}
	input.ServiceCityID = strings.TrimSpace(input.ServiceCityID)
	input.Query = strings.ToLower(strings.TrimSpace(input.Query))
	input.CategoryID = strings.TrimSpace(input.CategoryID)
	input.Sort = strings.TrimSpace(input.Sort)
	if input.Sort == "" {
		input.Sort = "all"
	}
	if input.Limit == 0 {
		input.Limit = publicStoreDefaultPageSize
	}
	if input.ServiceCityID == "" || len(input.ServiceCityID) > 128 ||
		len(input.CategoryID) > 128 || len(input.FavoriteClientActorID) > 128 || !utf8.ValidString(input.Query) ||
		utf8.RuneCountInString(input.Query) > 160 || strings.ContainsRune(input.Query, '\x00') ||
		input.Limit < 1 || input.Limit > publicStoreMaximumPageSize || len(input.Cursor) > publicStoreMaximumCursor ||
		(input.Sort != "all" && input.Sort != "newest" && input.Sort != "nearest") ||
		(input.Latitude == nil) != (input.Longitude == nil) {
		return PublicStorePage{}, ErrPublicStoreListInvalidInput
	}
	for _, character := range input.Query {
		if unicode.IsControl(character) {
			return PublicStorePage{}, ErrPublicStoreListInvalidInput
		}
	}
	if input.Latitude != nil && (math.IsNaN(*input.Latitude) || math.IsInf(*input.Latitude, 0) || *input.Latitude < -90 || *input.Latitude > 90 || math.IsNaN(*input.Longitude) || math.IsInf(*input.Longitude, 0) || *input.Longitude < -180 || *input.Longitude > 180) {
		return PublicStorePage{}, ErrPublicStoreListInvalidInput
	}
	if input.Sort == "nearest" && input.Latitude == nil {
		return PublicStorePage{}, ErrPublicStoreListInvalidInput
	}

	scope := publicStoreCursorScope(input)
	cursor, err := decodePublicStoreCursor(input.Cursor, input, scope)
	if err != nil {
		return PublicStorePage{}, err
	}

	distanceExpression := "NULL::double precision"
	if input.Latitude != nil {
		distanceExpression = `CASE WHEN s.delivery_origin_latitude IS NULL OR s.delivery_origin_longitude IS NULL THEN NULL ELSE (6371000.0 * acos(LEAST(1.0, GREATEST(-1.0, cos(radians($4)) * cos(radians(s.delivery_origin_latitude)) * cos(radians(s.delivery_origin_longitude) - radians($5)) + sin(radians($4)) * sin(radians(s.delivery_origin_latitude))))))::double precision END`
	}
	searchPattern := ""
	if input.Query != "" {
		searchPattern = "%" + escapePublicStoreSearch(input.Query) + "%"
	}
	args := []any{input.ServiceCityID, searchPattern, input.CategoryID}
	if input.Latitude != nil {
		args = append(args, *input.Latitude, *input.Longitude)
	}
	favoriteFilter := ""
	if input.FavoriteClientActorID != "" {
		favoriteActorArg := appendPublicStoreArg(&args, input.FavoriteClientActorID)
		favoriteFilter = fmt.Sprintf(" AND EXISTS (SELECT 1 FROM dsh.client_favorite_stores f WHERE f.client_actor_id=$%d AND f.store_id=s.id)", favoriteActorArg)
	}
	cursorFilter := ""
	if cursor != nil {
		switch input.Sort {
		case "newest":
			createdAtArg := appendPublicStoreArg(&args, *cursor.CreatedAt)
			idArg := appendPublicStoreArg(&args, cursor.ID)
			cursorFilter = fmt.Sprintf(" AND (s.created_at,s.id)<($%d,$%d)", createdAtArg, idArg)
		default:
			if input.Latitude == nil {
				nameArg := appendPublicStoreArg(&args, cursor.NameKey)
				idArg := appendPublicStoreArg(&args, cursor.ID)
				cursorFilter = fmt.Sprintf(" AND (lower(s.name),s.id)>($%d,$%d)", nameArg, idArg)
			} else if cursor.DistanceMeters == nil {
				nameArg := appendPublicStoreArg(&args, cursor.NameKey)
				idArg := appendPublicStoreArg(&args, cursor.ID)
				cursorFilter = fmt.Sprintf(" AND %s IS NULL AND (lower(s.name),s.id)>($%d,$%d)", distanceExpression, nameArg, idArg)
			} else {
				distanceArg := appendPublicStoreArg(&args, *cursor.DistanceMeters)
				nameArg := appendPublicStoreArg(&args, cursor.NameKey)
				idArg := appendPublicStoreArg(&args, cursor.ID)
				nullTail := ""
				if input.Sort == "all" {
					nullTail = " OR " + distanceExpression + " IS NULL"
				}
				cursorFilter = fmt.Sprintf(" AND (%s>$%d OR (%s=$%d AND (lower(s.name),s.id)>($%d,$%d))%s)", distanceExpression, distanceArg, distanceExpression, distanceArg, nameArg, idArg, nullTail)
			}
		}
	}
	limitArg := len(args) + 1
	args = append(args, input.Limit+1)
	orderBy := "lower(s.name),s.id"
	pageOrderBy := "lower(candidate.name),candidate.id"
	if input.Sort == "newest" {
		orderBy = "s.created_at DESC,s.id DESC"
		pageOrderBy = "candidate.created_at DESC,candidate.id DESC"
	} else if input.Latitude != nil {
		orderBy = distanceExpression + " ASC NULLS LAST,lower(s.name),s.id"
		pageOrderBy = "candidate.distance_meters ASC NULLS LAST,lower(candidate.name),candidate.id"
	}
	nearestOnly := ""
	if input.Sort == "nearest" {
		nearestOnly = " AND s.delivery_origin_latitude IS NOT NULL AND s.delivery_origin_longitude IS NOT NULL"
	}
	visibleOfferConditions := strings.Join(customerVisibleOfferConditions(), " AND ")
	storeCategories := `ARRAY(WITH RECURSIVE store_categories(id,parent_category_id,vertical_id) AS (
		SELECT c.id,c.parent_category_id,c.vertical_id FROM dsh.catalog_store_offers o
		JOIN dsh.stores s ON s.id=o.store_id
		JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
		JOIN dsh.catalog_products p ON p.id=v.product_id
		JOIN dsh.catalog_product_categories pc ON pc.product_id=p.id
		JOIN dsh.catalog_categories c ON c.id=pc.category_id AND c.active=true AND c.vertical_id=p.vertical_id
		WHERE o.store_id=candidate.id AND ` + visibleOfferConditions + `
		UNION
		SELECT parent.id,parent.parent_category_id,parent.vertical_id FROM store_categories child
		JOIN dsh.catalog_categories parent ON parent.id=child.parent_category_id AND parent.vertical_id=child.vertical_id AND parent.active=true
	) SELECT DISTINCT id FROM store_categories ORDER BY id)`
	statement := `WITH candidate_page AS MATERIALIZED (
		SELECT s.id,s.partner_actor_id,s.name,s.primary_vertical_id,s.version,s.publication_changed_at,s.created_at,s.updated_at,s.fulfillment_modes,lower(s.name) AS name_sort_key,
		` + distanceExpression + ` AS distance_meters,
		sc.id AS service_city_id,sc.display_name_ar,sc.active AS service_city_active,sc.version AS service_city_version,sc.created_at AS service_city_created_at,sc.updated_at AS service_city_updated_at
		FROM dsh.stores s JOIN dsh.service_cities sc ON sc.id=s.service_city_id
		WHERE s.service_city_id=$1 AND sc.active=true AND s.publication_state='published' AND s.publication_changed_at IS NOT NULL
		AND ($2='' OR lower(s.name) LIKE $2 ESCAPE '!')
		AND ($3='' OR EXISTS (WITH RECURSIVE store_categories(id,parent_category_id,vertical_id) AS (
			SELECT c.id,c.parent_category_id,c.vertical_id FROM dsh.catalog_store_offers o
			JOIN dsh.catalog_product_variants v ON v.id=o.variant_id
			JOIN dsh.catalog_products p ON p.id=v.product_id
			JOIN dsh.catalog_product_categories pc ON pc.product_id=p.id
			JOIN dsh.catalog_categories c ON c.id=pc.category_id AND c.active=true AND c.vertical_id=p.vertical_id
			WHERE o.store_id=s.id AND ` + visibleOfferConditions + `
			UNION
			SELECT parent.id,parent.parent_category_id,parent.vertical_id FROM store_categories child
			JOIN dsh.catalog_categories parent ON parent.id=child.parent_category_id AND parent.vertical_id=child.vertical_id AND parent.active=true
		) SELECT 1 FROM store_categories WHERE id=$3))
		AND EXISTS (SELECT 1 FROM dsh.catalog_store_offers o JOIN dsh.catalog_product_variants v ON v.id=o.variant_id JOIN dsh.catalog_products p ON p.id=v.product_id WHERE o.store_id=s.id AND ` + visibleOfferConditions + `)
		AND EXISTS (SELECT 1 FROM dsh.joining_cases jc WHERE jc.partner_actor_id=s.partner_actor_id AND jc.financial_profile_state='ACTIVE')` + favoriteFilter + nearestOnly + cursorFilter + `
		ORDER BY ` + orderBy + ` LIMIT $` + fmt.Sprint(limitArg) + `
	)
	SELECT candidate.id,candidate.partner_actor_id,candidate.name,candidate.primary_vertical_id,candidate.version,candidate.name_sort_key,
		COALESCE(rating.rating_average,0),COALESCE(rating.rating_count,0),candidate.publication_changed_at,candidate.created_at,candidate.updated_at,candidate.fulfillment_modes,
		` + storeCategories + `,candidate.distance_meters,
		candidate.service_city_id,candidate.display_name_ar,candidate.service_city_active,candidate.service_city_version,candidate.service_city_created_at,candidate.service_city_updated_at,
		media.id,media.joining_case_id,media.store_id,media.uri,media.object_key,media.content_sha256,media.content_type,media.byte_size,media.media_role,media.state,media.created_at,media.attached_at
	FROM candidate_page candidate
	LEFT JOIN LATERAL (SELECT AVG(r.rating)::double precision AS rating_average,COUNT(*)::int AS rating_count FROM dsh.commerce_order_ratings r WHERE r.store_id=candidate.id) rating ON true
	LEFT JOIN LATERAL (SELECT a.id,a.joining_case_id,COALESCE(a.store_id,'') AS store_id,a.uri,a.object_key,a.content_sha256,a.content_type,a.byte_size,a.media_role,a.state,a.created_at,a.attached_at
		FROM dsh.store_profile_media_assets a WHERE a.state='active' AND a.store_id=candidate.id ORDER BY a.created_at DESC LIMIT 1) media ON true
	ORDER BY ` + pageOrderBy

	rows, err := db.QueryContext(ctx, statement, args...)
	if err != nil {
		return PublicStorePage{}, fmt.Errorf("list published store page: %w", err)
	}
	defer rows.Close()
	page := PublicStorePage{Stores: make([]PublicStoreRecord, 0, input.Limit), Limit: input.Limit}
	hasMore := false
	for rows.Next() {
		if len(page.Stores) == input.Limit {
			hasMore = true
			break
		}
		var store PublicStoreRecord
		var city ServiceCityRecord
		var nameSortKey string
		var distance sql.NullFloat64
		var mediaID, mediaJoiningCaseID, mediaStoreID, mediaURI, mediaObjectKey, mediaContentSHA, mediaContentType, mediaRole, mediaState sql.NullString
		var mediaCreatedAt, mediaAttachedAt sql.NullTime
		var mediaSize sql.NullInt64
		if err := rows.Scan(&store.ID, &store.PartnerActorID, &store.Name, &store.PrimaryVerticalID, &store.Version, &nameSortKey,
			&store.RatingAverage, &store.RatingCount, &store.PublishedAt, &store.CreatedAt, &store.UpdatedAt, pq.Array(&store.FulfillmentModes), pq.Array(&store.CategoryIDs), &distance,
			&city.ID, &city.DisplayNameAr, &city.Active, &city.Version, &city.CreatedAt, &city.UpdatedAt,
			&mediaID, &mediaJoiningCaseID, &mediaStoreID, &mediaURI, &mediaObjectKey, &mediaContentSHA, &mediaContentType, &mediaSize, &mediaRole, &mediaState, &mediaCreatedAt, &mediaAttachedAt); err != nil {
			return PublicStorePage{}, fmt.Errorf("scan published store page: %w", err)
		}
		store.ServiceCity = &city
		store.nameSortKey = nameSortKey
		if distance.Valid {
			sortDistance := distance.Float64
			store.DistanceMeters = new(int)
			*store.DistanceMeters = int(sortDistance)
			store.distanceSortValue = &sortDistance
		}
		if mediaID.Valid {
			media := &StoreProfileMediaRecord{ID: mediaID.String, JoiningCaseID: mediaJoiningCaseID.String, StoreID: mediaStoreID.String, URI: mediaURI.String, ObjectKey: mediaObjectKey.String, ContentSHA256: mediaContentSHA.String, ContentType: mediaContentType.String, Role: mediaRole.String, State: mediaState.String}
			if mediaSize.Valid {
				media.ByteSize = mediaSize.Int64
			}
			if mediaCreatedAt.Valid {
				media.CreatedAt = mediaCreatedAt.Time
			}
			if mediaAttachedAt.Valid {
				attachedAt := mediaAttachedAt.Time
				media.AttachedAt = &attachedAt
			}
			store.StoreProfileImage = media
		}
		page.Stores = append(page.Stores, store)
	}
	if err := rows.Err(); err != nil {
		return PublicStorePage{}, fmt.Errorf("read published store page: %w", err)
	}
	if err := rows.Close(); err != nil {
		return PublicStorePage{}, fmt.Errorf("close published store page: %w", err)
	}
	if len(page.Stores) == 0 {
		city, cityErr := ReadServiceCity(ctx, db, input.ServiceCityID)
		if cityErr != nil {
			return PublicStorePage{}, cityErr
		}
		if !city.Active {
			return PublicStorePage{}, ErrServiceCityNotFound
		}
	}
	if hasMore && len(page.Stores) > 0 {
		last := page.Stores[len(page.Stores)-1]
		page.NextCursor, err = encodePublicStoreCursor(last, input, scope)
		if err != nil {
			return PublicStorePage{}, err
		}
	}
	return page, nil
}

func appendPublicStoreArg(args *[]any, value any) int {
	*args = append(*args, value)
	return len(*args)
}

func escapePublicStoreSearch(value string) string {
	value = strings.ReplaceAll(value, "!", "!!")
	value = strings.ReplaceAll(value, "%", "!%")
	return strings.ReplaceAll(value, "_", "!_")
}

func publicStoreCursorScope(input PublicStoreListQuery) string {
	value, _ := json.Marshal(struct {
		CityID                string   `json:"cityId"`
		Query                 string   `json:"query"`
		Category              string   `json:"category"`
		FavoriteClientActorID string   `json:"favoriteClientActorId"`
		Sort                  string   `json:"sort"`
		Latitude              *float64 `json:"latitude"`
		Longitude             *float64 `json:"longitude"`
	}{CityID: input.ServiceCityID, Query: input.Query, Category: input.CategoryID, FavoriteClientActorID: input.FavoriteClientActorID, Sort: input.Sort, Latitude: input.Latitude, Longitude: input.Longitude})
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func decodePublicStoreCursor(raw string, input PublicStoreListQuery, scope string) (*publicStoreCursor, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, ErrPublicStoreListInvalidInput
	}
	var cursor publicStoreCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil || cursor.Version != 1 || cursor.ID == "" || cursor.Scope != scope {
		return nil, ErrPublicStoreListInvalidInput
	}
	if input.Sort == "newest" {
		if cursor.CreatedAt == nil || cursor.CreatedAt.IsZero() {
			return nil, ErrPublicStoreListInvalidInput
		}
	} else {
		if cursor.NameKey == "" || (input.Sort == "nearest" && cursor.DistanceMeters == nil) {
			return nil, ErrPublicStoreListInvalidInput
		}
		if cursor.DistanceMeters != nil && (math.IsNaN(*cursor.DistanceMeters) || math.IsInf(*cursor.DistanceMeters, 0)) {
			return nil, ErrPublicStoreListInvalidInput
		}
	}
	return &cursor, nil
}

func encodePublicStoreCursor(last PublicStoreRecord, input PublicStoreListQuery, scope string) (string, error) {
	cursor := publicStoreCursor{Version: 1, Scope: scope, ID: last.ID}
	if input.Sort == "newest" {
		createdAt := last.CreatedAt
		cursor.CreatedAt = &createdAt
	} else {
		cursor.NameKey = last.nameSortKey
		cursor.DistanceMeters = last.distanceSortValue
	}
	value, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}
