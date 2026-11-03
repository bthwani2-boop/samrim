package postgres

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
)

// ListPartnerStoreBanners returns the first merchant-authored banner page for
// existing callers. API consumers should use the cursor-based page variant.
func ListPartnerStoreBanners(ctx context.Context, db *sql.DB, storeID string) ([]DiscoveryContentRecord, error) {
	items, _, err := PagePartnerStoreBanners(ctx, db, storeID, "", 60)
	return items, err
}

type partnerBannerCursor struct {
	StoreID   string    `json:"s"`
	Ordinal   int       `json:"o"`
	CreatedAt time.Time `json:"t"`
	ID        string    `json:"i"`
}

func decodePartnerBannerCursor(storeID, cursor string) (partnerBannerCursor, error) {
	var value partnerBannerCursor
	if len(cursor) > 1024 {
		return value, ErrDiscoveryContentInvalid
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil || json.Unmarshal(raw, &value) != nil || value.StoreID != storeID ||
		value.CreatedAt.IsZero() || value.ID == "" || len(value.ID) > 128 || value.Ordinal < 0 {
		return partnerBannerCursor{}, ErrDiscoveryContentInvalid
	}
	return value, nil
}

func encodePartnerBannerCursor(storeID string, last DiscoveryContentRecord) string {
	raw, _ := json.Marshal(partnerBannerCursor{StoreID: storeID, Ordinal: last.Ordinal, CreatedAt: last.CreatedAt.UTC(), ID: last.ID})
	return base64.RawURLEncoding.EncodeToString(raw)
}

// PagePartnerStoreBanners only reads the authenticated Store's own banners.
// The bound keyset tuple is stable across equally ranked banner timestamps.
func PagePartnerStoreBanners(ctx context.Context, db *sql.DB, storeID, cursor string, limit int) ([]DiscoveryContentRecord, string, error) {
	storeID = strings.TrimSpace(storeID)
	if db == nil || storeID == "" || len(storeID) > 150 || limit < 1 || limit > 60 {
		return nil, "", ErrDiscoveryContentInvalid
	}
	var after partnerBannerCursor
	if cursor != "" {
		var err error
		after, err = decodePartnerBannerCursor(storeID, cursor)
		if err != nil {
			return nil, "", err
		}
	}
	rows, err := db.QueryContext(ctx,
		"SELECT "+discoveryContentSelect+` FROM dsh.discovery_content content
        WHERE content.kind='BANNER' AND content.source_store_id=$1
          AND ($2::boolean=false OR
            (content.ordinal > $3 OR
              (content.ordinal=$3 AND content.created_at < $4) OR
              (content.ordinal=$3 AND content.created_at=$4 AND content.id < $5)))
        ORDER BY content.ordinal ASC,content.created_at DESC,content.id DESC LIMIT $6`,
		storeID, cursor != "", after.Ordinal, after.CreatedAt, after.ID, limit+1)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	items := make([]DiscoveryContentRecord, 0, limit+1)
	for rows.Next() {
		item, scanErr := scanDiscoveryContent(rows)
		if scanErr != nil {
			return nil, "", scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	if len(items) > limit {
		items = items[:limit]
		return items, encodePartnerBannerCursor(storeID, items[len(items)-1]), nil
	}
	return items, "", nil
}

// ListPublishedStoreBanners is the Store-scoped customer readback. A banner
// requires Operator publication, Partner activation, valid media/target,
// an active time window and a published Store in the requested Service City.
func ListPublishedStoreBanners(ctx context.Context, db *sql.DB, storeID, serviceCityID string) ([]DiscoveryContentRecord, error) {
	storeID, serviceCityID = strings.TrimSpace(storeID), strings.TrimSpace(serviceCityID)
	if storeID == "" || serviceCityID == "" || len(storeID) > 128 || len(serviceCityID) > 128 {
		return nil, ErrDiscoveryContentInvalid
	}
	query := "SELECT " + discoveryContentSelect + `
 FROM dsh.discovery_content content
 JOIN dsh.stores store ON store.id=content.source_store_id
 JOIN dsh.service_cities city ON city.id=store.service_city_id AND city.active=true
 WHERE content.kind='BANNER'
   AND content.source_store_id=$1
   AND content.partner_enabled=true
   AND content.state='PUBLISHED'
   AND NOT EXISTS (SELECT 1 FROM dsh.marketing_campaign_content_links link
      JOIN dsh.marketing_campaigns campaign ON campaign.id=link.campaign_id
      WHERE link.content_id=content.id AND campaign.state<>'PUBLISHED')
   AND content.starts_at<=statement_timestamp()
   AND (content.ends_at IS NULL OR content.ends_at>statement_timestamp())
   AND (content.service_city_id IS NULL OR content.service_city_id=$2)
   AND store.service_city_id=$2
   AND store.publication_state='published'
   AND store.publication_changed_at IS NOT NULL
   AND EXISTS (
      SELECT 1 FROM dsh.discovery_content_media_assets asset
      WHERE asset.id=content.media_asset_id AND asset.state='active'
        AND asset.rights_attested_at IS NOT NULL AND asset.uri<>''
        AND asset.content_type IN ('image/jpeg','image/png')
   )
   AND ` + discoveryContentTargetEligibilityPredicate("content", "$2", "statement_timestamp()") +
		" ORDER BY content.ordinal ASC,content.starts_at DESC,content.id DESC LIMIT 8"
	rows, err := db.QueryContext(ctx, query, storeID, serviceCityID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]DiscoveryContentRecord, 0)
	for rows.Next() {
		item, scanErr := scanDiscoveryContent(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

// SetPartnerStoreBannerEnabled lets the owning Partner hide or restore only
// previously Operator-governed content. It cannot alter publication state.
func SetPartnerStoreBannerEnabled(ctx context.Context, db *sql.DB, storeID, contentID, actorID string, enabled bool, expectedVersion int, idempotencyKey, correlationID string) (DiscoveryContentRecord, bool, error) {
	storeID, contentID, actorID = strings.TrimSpace(storeID), strings.TrimSpace(contentID), strings.TrimSpace(actorID)
	idempotencyKey, correlationID = strings.TrimSpace(idempotencyKey), strings.TrimSpace(correlationID)
	if db == nil || storeID == "" || contentID == "" || actorID == "" || expectedVersion < 1 || idempotencyKey == "" || correlationID == "" {
		return DiscoveryContentRecord{}, false, ErrDiscoveryContentInvalid
	}
	hash := HashMarketingFacts("partner-store-banner-visibility", storeID, contentID, actorID, strconv.FormatBool(enabled), strconv.Itoa(expectedVersion), correlationID)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:marketing:idempotency:"+idempotencyKey); err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	var priorID, priorHash, priorType, priorOperation string
	err = tx.QueryRowContext(ctx, "SELECT resource_id,request_hash,resource_type,operation FROM dsh.commerce_marketing_mutation_idempotency WHERE idempotency_key=$1 FOR UPDATE", idempotencyKey).Scan(&priorID, &priorHash, &priorType, &priorOperation)
	if err == nil {
		if priorID != contentID || priorHash != hash || priorType != "DISCOVERY_CONTENT" || priorOperation != "UPDATE" {
			return DiscoveryContentRecord{}, false, ErrDiscoveryContentIdempotency
		}
		item, readErr := scanDiscoveryContent(tx.QueryRowContext(ctx, "SELECT "+discoveryContentSelect+" FROM dsh.discovery_content content WHERE content.id=$1 AND content.source_store_id=$2 AND content.kind='BANNER'", contentID, storeID))
		if errors.Is(readErr, sql.ErrNoRows) {
			return DiscoveryContentRecord{}, false, ErrDiscoveryContentNotFound
		}
		if readErr != nil {
			return DiscoveryContentRecord{}, false, readErr
		}
		if err = tx.Commit(); err != nil {
			return DiscoveryContentRecord{}, false, err
		}
		return item, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return DiscoveryContentRecord{}, false, err
	}
	var currentVersion int
	if err = tx.QueryRowContext(ctx, "SELECT version FROM dsh.discovery_content WHERE id=$1 AND source_store_id=$2 AND kind='BANNER' AND state='PUBLISHED' FOR UPDATE", contentID, storeID).Scan(&currentVersion); errors.Is(err, sql.ErrNoRows) {
		return DiscoveryContentRecord{}, false, ErrDiscoveryContentNotFound
	} else if err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	if currentVersion != expectedVersion {
		return DiscoveryContentRecord{}, false, ErrDiscoveryContentVersion
	}
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.discovery_content SET partner_enabled=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND source_store_id=$2 AND kind='BANNER' AND state='PUBLISHED'", contentID, storeID, enabled); err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.commerce_marketing_mutation_idempotency(idempotency_key,request_hash,resource_type,resource_id,operation) VALUES($1,$2,'DISCOVERY_CONTENT',$3,'UPDATE')", idempotencyKey, hash, contentID); err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	item, err := scanDiscoveryContent(tx.QueryRowContext(ctx, "SELECT "+discoveryContentSelect+" FROM dsh.discovery_content content WHERE id=$1 AND source_store_id=$2 AND content.kind='BANNER'", contentID, storeID))
	if err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	return item, false, nil
}
