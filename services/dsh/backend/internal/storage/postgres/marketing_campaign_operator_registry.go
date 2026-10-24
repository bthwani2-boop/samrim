package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
)

var ErrMarketingCampaignIdempotencyConflict = errors.New("marketing campaign create key reused with different facts")

// CreateOperatorMarketingCampaign makes retry identity durable without adding
// a parallel ledger or allowing a client to choose another campaign on retry.
// Different inputs for the same actor + key fail rather than changing a draft.
func CreateOperatorMarketingCampaign(ctx context.Context, db *sql.DB, in MarketingCampaignInput, key string) (MarketingCampaignRecord, bool, error) {
	key = strings.TrimSpace(key)
	in.NameAr = strings.TrimSpace(in.NameAr)
	in.Objective = strings.ToUpper(strings.TrimSpace(in.Objective))
	in.CreatedByActorID = strings.TrimSpace(in.CreatedByActorID)
	if db == nil || len(key) < 8 || len(key) > 128 || in.CreatedByActorID == "" || len(in.CreatedByActorID) > 128 {
		return MarketingCampaignRecord{}, false, ErrMarketingCampaignInvalid
	}
	id := "marketing-campaign-" + HashMarketingFacts("campaign-create:v1", in.CreatedByActorID, key)[:32]
	in.ID = id
	// Validate before entering the database to avoid replaying invalid facts.
	switch in.Objective {
	case "ACQUISITION", "REACTIVATION", "CONVERSION", "RETENTION":
	default:
		return MarketingCampaignRecord{}, false, ErrMarketingCampaignInvalid
	}
	if in.NameAr == "" || len([]rune(in.NameAr)) > 160 || in.BudgetLimitMinor <= 0 {
		return MarketingCampaignRecord{}, false, ErrMarketingCampaignInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return MarketingCampaignRecord{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.ExecContext(ctx, `INSERT INTO dsh.marketing_campaigns(id,name_ar,objective,budget_limit_minor,created_by_actor_id)
  VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`,
		id, in.NameAr, in.Objective, in.BudgetLimitMinor, in.CreatedByActorID)
	if err != nil {
		return MarketingCampaignRecord{}, false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return MarketingCampaignRecord{}, false, err
	}
	replay := affected == 0
	if replay {
		var name, objective, owner string
		var budget int64
		err = tx.QueryRowContext(ctx, `SELECT name_ar,objective,budget_limit_minor,created_by_actor_id
   FROM dsh.marketing_campaigns WHERE id=$1`, id).Scan(&name, &objective, &budget, &owner)
		if err != nil {
			return MarketingCampaignRecord{}, false, err
		}
		if name != in.NameAr || objective != in.Objective || budget != in.BudgetLimitMinor || owner != in.CreatedByActorID {
			return MarketingCampaignRecord{}, false, ErrMarketingCampaignIdempotencyConflict
		}
	}
	if err = tx.Commit(); err != nil {
		return MarketingCampaignRecord{}, false, err
	}
	record, err := ReadMarketingCampaign(ctx, db, id)
	return record, replay, err
}

type MarketingCampaignPage struct {
	Items      []MarketingCampaignRecord `json:"items"`
	NextCursor string                    `json:"nextCursor,omitempty"`
}

// ListOperatorMarketingCampaigns uses keyset pagination, not an initial page
// filtered in the browser. Every item stays limited to commercial aggregates.
func ListOperatorMarketingCampaigns(ctx context.Context, db *sql.DB, state, cursor string, limit int) (MarketingCampaignPage, error) {
	state = strings.ToUpper(strings.TrimSpace(state))
	cursor = strings.TrimSpace(cursor)
	if db == nil || limit < 1 || limit > 100 || len(cursor) > 128 {
		return MarketingCampaignPage{}, ErrMarketingCampaignInvalid
	}
	switch state {
	case "", "DRAFT", "PUBLISHED", "PAUSED", "ENDED", "ARCHIVED":
	default:
		return MarketingCampaignPage{}, ErrMarketingCampaignInvalid
	}
	rows, err := db.QueryContext(ctx, `SELECT id FROM dsh.marketing_campaigns
  WHERE ($1='' OR state=$1) AND id>$2
  ORDER BY id ASC LIMIT $3`, state, cursor, limit+1)
	if err != nil {
		return MarketingCampaignPage{}, err
	}
	ids := make([]string, 0, limit+1)
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			break
		}
		ids = append(ids, id)
	}
	if err == nil {
		err = rows.Err()
	}
	_ = rows.Close()
	if err != nil {
		return MarketingCampaignPage{}, err
	}
	page := MarketingCampaignPage{Items: make([]MarketingCampaignRecord, 0, limit)}
	if len(ids) > limit {
		page.NextCursor = ids[limit-1]
		ids = ids[:limit]
	}
	for _, id := range ids {
		item, err := ReadMarketingCampaign(ctx, db, id)
		if err != nil {
			return MarketingCampaignPage{}, err
		}
		page.Items = append(page.Items, item)
	}
	return page, nil
}
