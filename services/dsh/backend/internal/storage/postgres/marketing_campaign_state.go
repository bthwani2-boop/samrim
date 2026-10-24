package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"
)

var ErrMarketingCampaignNotReady = errors.New("marketing campaign preflight failed")

// SetMarketingCampaignState is the single state transition authority for
// campaign shells. Child offers/creatives retain their own publication
// authority; public feeds and checkout intersect both effective states.
func SetMarketingCampaignState(ctx context.Context, db *sql.DB, campaignID, nextState, actorID, correlationID, idempotencyKey string, expectedVersion int) (MarketingCampaignRecord, bool, error) {
	campaignID = strings.TrimSpace(campaignID)
	nextState = strings.ToUpper(strings.TrimSpace(nextState))
	actorID = strings.TrimSpace(actorID)
	correlationID = strings.TrimSpace(correlationID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if db == nil || campaignID == "" || len(campaignID) > 128 || actorID == "" || correlationID == "" ||
		len(idempotencyKey) < 8 || len(idempotencyKey) > 128 || expectedVersion < 1 ||
		(nextState != "PUBLISHED" && nextState != "PAUSED" && nextState != "ENDED" && nextState != "ARCHIVED") {
		return MarketingCampaignRecord{}, false, ErrMarketingCampaignInvalid
	}
	requestHash := HashMarketingFacts("marketing-campaign-state", campaignID, nextState, actorID, strconv.Itoa(expectedVersion))
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return MarketingCampaignRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "dsh:campaign:state:"+idempotencyKey); err != nil {
		return MarketingCampaignRecord{}, false, err
	}
	var oldHash, oldCampaign string
	err = tx.QueryRowContext(ctx, "SELECT request_hash,campaign_id FROM dsh.marketing_campaign_state_events WHERE idempotency_key=$1",
		idempotencyKey).Scan(&oldHash, &oldCampaign)
	if err == nil {
		if oldHash != requestHash || oldCampaign != campaignID {
			return MarketingCampaignRecord{}, false, ErrMarketingCampaignVersionConflict
		}
		if err = tx.Commit(); err != nil {
			return MarketingCampaignRecord{}, false, err
		}
		rec, err := ReadMarketingCampaign(ctx, db, campaignID)
		return rec, true, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return MarketingCampaignRecord{}, false, err
	}
	var currentVersion int
	var currentState string
	var budget int64
	err = tx.QueryRowContext(ctx, "SELECT version,state,budget_limit_minor FROM dsh.marketing_campaigns WHERE id=$1 FOR UPDATE", campaignID).Scan(&currentVersion, &currentState, &budget)
	if errors.Is(err, sql.ErrNoRows) {
		return MarketingCampaignRecord{}, false, ErrMarketingCampaignNotFound
	}
	if err != nil {
		return MarketingCampaignRecord{}, false, err
	}
	if currentVersion != expectedVersion {
		return MarketingCampaignRecord{}, false, ErrMarketingCampaignVersionConflict
	}
	validTransition := (nextState == "PUBLISHED" && (currentState == "DRAFT" || currentState == "PAUSED")) ||
		(nextState == "PAUSED" && currentState == "PUBLISHED") ||
		(nextState == "ENDED" && (currentState == "PUBLISHED" || currentState == "PAUSED")) ||
		(nextState == "ARCHIVED" && (currentState == "DRAFT" || currentState == "ENDED"))
	if !validTransition {
		return MarketingCampaignRecord{}, false, ErrMarketingCampaignInvalid
	}
	if nextState == "PUBLISHED" {
		var offers, creatives int64
		var assigned int64
		err = tx.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(p.discount_budget_limit_minor),0)
   FROM dsh.marketing_campaign_promotion_links l
   JOIN dsh.commerce_promotions p ON p.id=l.promotion_id
   WHERE l.campaign_id=$1`, campaignID).Scan(&offers, &assigned)
		if err != nil {
			return MarketingCampaignRecord{}, false, err
		}
		if assigned > budget {
			return MarketingCampaignRecord{}, false, ErrMarketingCampaignBudgetExceeded
		}
		var invalidOffers int64
		err = tx.QueryRowContext(ctx, `SELECT COUNT(*)
   FROM dsh.marketing_campaign_promotion_links l
   JOIN dsh.commerce_promotions p ON p.id=l.promotion_id
   WHERE l.campaign_id=$1
     AND (p.state<>'PUBLISHED' OR p.store_id IS NOT NULL
       OR p.discount_budget_limit_minor IS NULL
       OR p.discount_spent_minor>=p.discount_budget_limit_minor
       OR (p.redemption_limit IS NOT NULL AND p.redeemed_count>=p.redemption_limit)
       OR (p.ends_at IS NOT NULL AND p.ends_at<=statement_timestamp()))`, campaignID).Scan(&invalidOffers)
		if err != nil {
			return MarketingCampaignRecord{}, false, err
		}
		var invalidCreatives int64
		err = tx.QueryRowContext(ctx, `SELECT COUNT(*)
   FROM dsh.marketing_campaign_content_links l
   JOIN dsh.discovery_content content ON content.id=l.content_id
   LEFT JOIN dsh.discovery_content_media_assets asset ON asset.id=content.media_asset_id
   WHERE l.campaign_id=$1 AND (
     content.state<>'PUBLISHED'
     OR (content.ends_at IS NOT NULL AND content.ends_at<=statement_timestamp())
     OR asset.id IS NULL OR asset.state<>'active'
     OR asset.rights_attested_at IS NULL OR asset.uri=''
   )`, campaignID).Scan(&invalidCreatives)
		if err != nil {
			return MarketingCampaignRecord{}, false, err
		}
		err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM dsh.marketing_campaign_content_links WHERE campaign_id=$1", campaignID).Scan(&creatives)
		if err != nil {
			return MarketingCampaignRecord{}, false, err
		}
		if offers+creatives == 0 || invalidOffers != 0 || invalidCreatives != 0 {
			return MarketingCampaignRecord{}, false, ErrMarketingCampaignNotReady
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE dsh.marketing_campaigns
 SET state=$2,version=version+1,updated_at=clock_timestamp()
 WHERE id=$1 AND version=$3`, campaignID, nextState, expectedVersion)
	if err != nil {
		return MarketingCampaignRecord{}, false, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO dsh.marketing_campaign_state_events
   (idempotency_key,request_hash,campaign_id,actor_id,correlation_id,
    expected_version,result_version,previous_state,resulting_state)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		idempotencyKey, requestHash, campaignID, actorID, correlationID,
		currentVersion, currentVersion+1, currentState, nextState)
	if err != nil {
		return MarketingCampaignRecord{}, false, err
	}
	if err = tx.Commit(); err != nil {
		return MarketingCampaignRecord{}, false, err
	}
	rec, err := ReadMarketingCampaign(ctx, db, campaignID)
	return rec, false, err
}
