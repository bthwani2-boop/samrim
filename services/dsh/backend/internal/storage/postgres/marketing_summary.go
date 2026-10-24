package postgres

import (
	"context"
	"database/sql"
	"time"
)

// OperatorMarketingSummary is calculated over all canonical records rather than
// the first registry page. These are publication states, not spend or ROI.
type OperatorMarketingSummary struct {
	ActivePromotions    int64 `json:"activePromotions"`
	ScheduledPromotions int64 `json:"scheduledPromotions"`
	EndedPromotions     int64 `json:"endedPromotions"`
	DraftPromotions     int64 `json:"draftPromotions"`
	PausedPromotions    int64 `json:"pausedPromotions"`
	ActiveContent       int64 `json:"activeContent"`
	// Counts are across all currently eligible published campaign-store pairs,
	// never a page of the operator promotion registry.
	PartnerInvitations int64     `json:"partnerInvitations"`
	PartnerApproved    int64     `json:"partnerApproved"`
	PartnerDeclined    int64     `json:"partnerDeclined"`
	PartnerPending     int64     `json:"partnerPending"`
	AsOf               time.Time `json:"asOf"`
}

func ReadOperatorMarketingSummary(ctx context.Context, db *sql.DB) (OperatorMarketingSummary, error) {
	if db == nil {
		return OperatorMarketingSummary{}, ErrPromotionInvalid
	}
	const query = `
WITH at_time AS (SELECT CURRENT_TIMESTAMP AS at),
promotions AS (
 SELECT
  COUNT(*) FILTER (WHERE state='PUBLISHED' AND starts_at<=at AND (ends_at IS NULL OR ends_at>at)) AS active,
  COUNT(*) FILTER (WHERE state='PUBLISHED' AND starts_at>at) AS scheduled,
  COUNT(*) FILTER (WHERE state='ENDED' OR (state<>'DRAFT' AND ends_at IS NOT NULL AND ends_at<=at)) AS ended,
  COUNT(*) FILTER (WHERE state='DRAFT') AS drafts,
  COUNT(*) FILTER (WHERE state='PAUSED' AND (ends_at IS NULL OR ends_at>at)) AS paused
 FROM dsh.commerce_promotions CROSS JOIN at_time
),
content AS (
 SELECT COUNT(*) FILTER (WHERE state='PUBLISHED' AND starts_at<=at AND (ends_at IS NULL OR ends_at>at)) AS active
 FROM dsh.discovery_content CROSS JOIN at_time
),
partner_participation AS (
 SELECT COUNT(*) AS invited,
        COUNT(*) FILTER (WHERE opt.state='OPTED_IN') AS approved,
        COUNT(*) FILTER (WHERE opt.state='DECLINED') AS declined,
        COUNT(*) FILTER (WHERE opt.state IS NULL) AS pending
 FROM dsh.commerce_promotions p CROSS JOIN at_time
 JOIN dsh.stores s ON s.publication_state='published'
     AND (p.service_city_id IS NULL OR p.service_city_id=s.service_city_id)
 LEFT JOIN dsh.commerce_promotion_store_opt_ins opt
     ON opt.promotion_id=p.id AND opt.store_id=s.id
 WHERE p.store_id IS NULL AND p.requires_partner_opt_in
   AND p.state='PUBLISHED' AND p.starts_at<=at AND (p.ends_at IS NULL OR p.ends_at>at)
   AND p.discount_budget_limit_minor IS NOT NULL
)
SELECT promotions.active, promotions.scheduled, promotions.ended, promotions.drafts,
 promotions.paused, content.active, partner_participation.invited,
 partner_participation.approved, partner_participation.declined,
 partner_participation.pending, at_time.at
FROM promotions CROSS JOIN content CROSS JOIN partner_participation CROSS JOIN at_time`
	var result OperatorMarketingSummary
	err := db.QueryRowContext(ctx, query).Scan(
		&result.ActivePromotions, &result.ScheduledPromotions,
		&result.EndedPromotions, &result.DraftPromotions,
		&result.PausedPromotions, &result.ActiveContent,
		&result.PartnerInvitations, &result.PartnerApproved,
		&result.PartnerDeclined, &result.PartnerPending, &result.AsOf,
	)
	if err != nil {
		return OperatorMarketingSummary{}, err
	}
	return result, nil
}
