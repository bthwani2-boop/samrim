package postgres

import (
	"context"
	"database/sql"
	"time"
)

// OperatorMarketingSummary is calculated over all canonical records rather than
// the first registry page. These are publication states, not spend or ROI.
type OperatorMarketingSummary struct {
	ActivePromotions    int64     `json:"activePromotions"`
	ScheduledPromotions int64     `json:"scheduledPromotions"`
	EndedPromotions     int64     `json:"endedPromotions"`
	DraftPromotions     int64     `json:"draftPromotions"`
	PausedPromotions    int64     `json:"pausedPromotions"`
	ActiveContent       int64     `json:"activeContent"`
	AsOf                time.Time `json:"asOf"`
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
)
SELECT promotions.active, promotions.scheduled, promotions.ended, promotions.drafts,
 promotions.paused, content.active, at_time.at
FROM promotions CROSS JOIN content CROSS JOIN at_time`
	var result OperatorMarketingSummary
	err := db.QueryRowContext(ctx, query).Scan(
		&result.ActivePromotions, &result.ScheduledPromotions,
		&result.EndedPromotions, &result.DraftPromotions,
		&result.PausedPromotions, &result.ActiveContent, &result.AsOf,
	)
	if err != nil {
		return OperatorMarketingSummary{}, err
	}
	return result, nil
}
