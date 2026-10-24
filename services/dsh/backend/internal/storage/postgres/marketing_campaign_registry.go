package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

var (
	ErrMarketingCampaignInvalid         = errors.New("marketing campaign input is invalid")
	ErrMarketingCampaignNotFound        = errors.New("marketing campaign not found")
	ErrMarketingCampaignVersionConflict = errors.New("marketing campaign version conflict")
	ErrMarketingCampaignBudgetExceeded  = errors.New("marketing campaign funding caps exceeded")
)

type MarketingCampaignInput struct {
	ID               string
	NameAr           string
	Objective        string
	BudgetLimitMinor int64
	CreatedByActorID string
}

type MarketingCampaignRecord struct {
	ID                           string `json:"id"`
	NameAr                       string `json:"nameAr"`
	Objective                    string `json:"objective"`
	State                        string `json:"state"`
	BudgetLimitMinor             int64 `json:"budgetLimitMinor"`
	AssignedPromotionBudgetMinor int64 `json:"assignedPromotionBudgetMinor"`
	PromotionCount               int64 `json:"promotionCount"`
	ContentCount                 int64 `json:"contentCount"`
	Version                      int `json:"version"`
	CreatedAt                    time.Time `json:"createdAt"`
	UpdatedAt                    time.Time `json:"updatedAt"`
}

// Campaign creation records the parent budget authority, never a payment
// allocation. Financial truth continues to belong exclusively to WLT.
func CreateMarketingCampaign(ctx context.Context, db *sql.DB, in MarketingCampaignInput) (MarketingCampaignRecord, error) {
	in.ID = strings.TrimSpace(in.ID)
	in.NameAr = strings.TrimSpace(in.NameAr)
	in.Objective = strings.TrimSpace(strings.ToUpper(in.Objective))
	in.CreatedByActorID = strings.TrimSpace(in.CreatedByActorID)
	switch in.Objective {
	case "ACQUISITION", "REACTIVATION", "CONVERSION", "RETENTION":
	default:
		return MarketingCampaignRecord{}, ErrMarketingCampaignInvalid
	}
	if db == nil || in.ID == "" || len(in.ID) > 128 || in.NameAr == "" || len([]rune(in.NameAr)) > 160 ||
		in.CreatedByActorID == "" || in.BudgetLimitMinor <= 0 {
		return MarketingCampaignRecord{}, ErrMarketingCampaignInvalid
	}
	_, err := db.ExecContext(ctx, `INSERT INTO dsh.marketing_campaigns
        (id,name_ar,objective,budget_limit_minor,created_by_actor_id)
        VALUES($1,$2,$3,$4,$5)`, in.ID, in.NameAr, in.Objective, in.BudgetLimitMinor, in.CreatedByActorID)
	if err != nil {
		return MarketingCampaignRecord{}, err
	}
	return ReadMarketingCampaign(ctx, db, in.ID)
}

func ReadMarketingCampaign(ctx context.Context, db *sql.DB, id string) (MarketingCampaignRecord, error) {
	id = strings.TrimSpace(id)
	if db == nil || id == "" || len(id) > 128 {
		return MarketingCampaignRecord{}, ErrMarketingCampaignInvalid
	}
	var rec MarketingCampaignRecord
	err := db.QueryRowContext(ctx, `SELECT c.id,c.name_ar,c.objective,c.state,c.budget_limit_minor,
      COALESCE((SELECT SUM(p.discount_budget_limit_minor) FROM dsh.marketing_campaign_promotion_links l
           JOIN dsh.commerce_promotions p ON p.id=l.promotion_id WHERE l.campaign_id=c.id),0),
      (SELECT COUNT(*) FROM dsh.marketing_campaign_promotion_links WHERE campaign_id=c.id),
      (SELECT COUNT(*) FROM dsh.marketing_campaign_content_links WHERE campaign_id=c.id),
      c.version,c.created_at,c.updated_at
      FROM dsh.marketing_campaigns c WHERE id=$1`, id).Scan(
		&rec.ID, &rec.NameAr, &rec.Objective, &rec.State, &rec.BudgetLimitMinor,
		&rec.AssignedPromotionBudgetMinor, &rec.PromotionCount, &rec.ContentCount,
		&rec.Version, &rec.CreatedAt, &rec.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return MarketingCampaignRecord{}, ErrMarketingCampaignNotFound
	}
	return rec, err
}

// LinkMarketingCampaignPromotion serializes budget reservations at the
// campaign row. A promotion may belong to only one campaign, and the aggregate
// of its immutable individual caps must fit the campaign budget.
// Only draft platform promotions can be linked; operator authorization and
// a future coordinated publish/preflight remain separate responsibilities.
func LinkMarketingCampaignPromotion(ctx context.Context, db *sql.DB, campaignID, promotionID string, expectedVersion int) (MarketingCampaignRecord, error) {
	campaignID, promotionID = strings.TrimSpace(campaignID), strings.TrimSpace(promotionID)
	if db == nil || campaignID == "" || promotionID == "" || len(campaignID) > 128 || len(promotionID) > 128 || expectedVersion < 1 {
		return MarketingCampaignRecord{}, ErrMarketingCampaignInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return MarketingCampaignRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var budget int64
	var version int
	var state string
	err = tx.QueryRowContext(ctx, `SELECT budget_limit_minor,version,state
        FROM dsh.marketing_campaigns WHERE id=$1 FOR UPDATE`, campaignID).Scan(&budget, &version, &state)
	if errors.Is(err, sql.ErrNoRows) {
		return MarketingCampaignRecord{}, ErrMarketingCampaignNotFound
	}
	if err != nil {
		return MarketingCampaignRecord{}, err
	}
	if version != expectedVersion {
		return MarketingCampaignRecord{}, ErrMarketingCampaignVersionConflict
	}
	if state != "DRAFT" {
		return MarketingCampaignRecord{}, ErrMarketingCampaignInvalid
	}
	var promoBudget sql.NullInt64
	var promoState, storeID string
	err = tx.QueryRowContext(ctx, `SELECT state,COALESCE(store_id,''),discount_budget_limit_minor
       FROM dsh.commerce_promotions WHERE id=$1 FOR UPDATE`, promotionID).Scan(&promoState, &storeID, &promoBudget)
	if errors.Is(err, sql.ErrNoRows) {
		return MarketingCampaignRecord{}, ErrMarketingCampaignInvalid
	}
	if err != nil {
		return MarketingCampaignRecord{}, err
	}
	if promoState != "DRAFT" || storeID != "" || !promoBudget.Valid || promoBudget.Int64 <= 0 {
		return MarketingCampaignRecord{}, ErrMarketingCampaignInvalid
	}
	var linkedTo string
	err = tx.QueryRowContext(ctx, "SELECT campaign_id FROM dsh.marketing_campaign_promotion_links WHERE promotion_id=$1", promotionID).Scan(&linkedTo)
	if err == nil {
		return MarketingCampaignRecord{}, ErrMarketingCampaignInvalid
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return MarketingCampaignRecord{}, err
	}
	var withinBudget bool
	err = tx.QueryRowContext(ctx, `SELECT
      (COALESCE(SUM(p.discount_budget_limit_minor),0) + $2::numeric <= $3::numeric)
      FROM dsh.marketing_campaign_promotion_links l
      JOIN dsh.commerce_promotions p ON p.id=l.promotion_id
      WHERE l.campaign_id=$1`, campaignID, promoBudget.Int64, budget).Scan(&withinBudget)
	if err != nil {
		return MarketingCampaignRecord{}, err
	}
	if !withinBudget {
		return MarketingCampaignRecord{}, ErrMarketingCampaignBudgetExceeded
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.marketing_campaign_promotion_links(campaign_id,promotion_id) VALUES($1,$2)", campaignID, promotionID); err != nil {
		return MarketingCampaignRecord{}, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.marketing_campaigns SET version=version+1,updated_at=clock_timestamp() WHERE id=$1", campaignID); err != nil {
		return MarketingCampaignRecord{}, err
	}
	if err = tx.Commit(); err != nil {
		return MarketingCampaignRecord{}, err
	}
	return ReadMarketingCampaign(ctx, db, campaignID)
}

// LinkMarketingCampaignContent keeps content ownership unique. A PROMOTION
// creative must refer to a promotion already linked to this campaign.
func LinkMarketingCampaignContent(ctx context.Context, db *sql.DB, campaignID, contentID string, expectedVersion int) (MarketingCampaignRecord, error) {
	campaignID, contentID = strings.TrimSpace(campaignID), strings.TrimSpace(contentID)
	if db == nil || campaignID == "" || contentID == "" || len(campaignID) > 128 || len(contentID) > 128 || expectedVersion < 1 {
		return MarketingCampaignRecord{}, ErrMarketingCampaignInvalid
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return MarketingCampaignRecord{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var version int
	var state string
	err = tx.QueryRowContext(ctx, "SELECT version,state FROM dsh.marketing_campaigns WHERE id=$1 FOR UPDATE", campaignID).Scan(&version, &state)
	if errors.Is(err, sql.ErrNoRows) {
		return MarketingCampaignRecord{}, ErrMarketingCampaignNotFound
	}
	if err != nil {
		return MarketingCampaignRecord{}, err
	}
	if version != expectedVersion {
		return MarketingCampaignRecord{}, ErrMarketingCampaignVersionConflict
	}
	if state != "DRAFT" {
		return MarketingCampaignRecord{}, ErrMarketingCampaignInvalid
	}
	var contentState, targetType, targetID string
	err = tx.QueryRowContext(ctx, `SELECT state,target_type,COALESCE(target_id,'')
      FROM dsh.discovery_content WHERE id=$1 FOR UPDATE`, contentID).Scan(&contentState, &targetType, &targetID)
	if errors.Is(err, sql.ErrNoRows) {
		return MarketingCampaignRecord{}, ErrMarketingCampaignInvalid
	}
	if err != nil {
		return MarketingCampaignRecord{}, err
	}
	if contentState != "DRAFT" {
		return MarketingCampaignRecord{}, ErrMarketingCampaignInvalid
	}
	if targetType == "PROMOTION" {
		var match bool
		err = tx.QueryRowContext(ctx, `SELECT EXISTS(
          SELECT 1 FROM dsh.marketing_campaign_promotion_links
          WHERE campaign_id=$1 AND promotion_id=$2)`, campaignID, targetID).Scan(&match)
		if err != nil {
			return MarketingCampaignRecord{}, err
		}
		if !match {
			return MarketingCampaignRecord{}, ErrMarketingCampaignInvalid
		}
	}
	var existing string
	err = tx.QueryRowContext(ctx, "SELECT campaign_id FROM dsh.marketing_campaign_content_links WHERE content_id=$1", contentID).Scan(&existing)
	if err == nil {
		return MarketingCampaignRecord{}, ErrMarketingCampaignInvalid
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return MarketingCampaignRecord{}, err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO dsh.marketing_campaign_content_links(campaign_id,content_id) VALUES($1,$2)", campaignID, contentID); err != nil {
		return MarketingCampaignRecord{}, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE dsh.marketing_campaigns SET version=version+1,updated_at=clock_timestamp() WHERE id=$1", campaignID); err != nil {
		return MarketingCampaignRecord{}, err
	}
	if err = tx.Commit(); err != nil {
		return MarketingCampaignRecord{}, err
	}
	return ReadMarketingCampaign(ctx, db, campaignID)
}
