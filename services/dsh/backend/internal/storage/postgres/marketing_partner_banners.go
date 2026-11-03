package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
)

// ListPartnerStoreBanners returns only merchant-authored banners in the
// already-authorized Store. Platform marketing and other Stores never appear.
func ListPartnerStoreBanners(ctx context.Context, db *sql.DB, storeID string) ([]DiscoveryContentRecord, error) {
	storeID = strings.TrimSpace(storeID)
	if storeID == "" {
		return nil, ErrDiscoveryContentInvalid
	}
	rows, err := db.QueryContext(ctx, "SELECT "+discoveryContentSelect+" FROM dsh.discovery_content content WHERE content.kind='BANNER' AND content.source_store_id=$1 ORDER BY content.ordinal ASC,content.created_at DESC LIMIT 60", storeID)
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
	if err = tx.QueryRowContext(ctx, "SELECT version FROM dsh.discovery_content WHERE id=$1 AND source_store_id=$2 AND kind='BANNER' FOR UPDATE", contentID, storeID).Scan(&currentVersion); errors.Is(err, sql.ErrNoRows) {
		return DiscoveryContentRecord{}, false, ErrDiscoveryContentNotFound
	} else if err != nil {
		return DiscoveryContentRecord{}, false, err
	}
	if currentVersion != expectedVersion {
		return DiscoveryContentRecord{}, false, ErrDiscoveryContentVersion
	}
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.discovery_content SET partner_enabled=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND source_store_id=$2 AND kind='BANNER'", contentID, storeID, enabled); err != nil {
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
