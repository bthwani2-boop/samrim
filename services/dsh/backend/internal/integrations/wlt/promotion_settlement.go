package wlt

import (
	"context"
	"net/http"
	"net/url"
	"strings"
)

// PromotionSettlementSummary contains only WLT-finalized order and ledger
// facts. It does not claim refund-net profitability or attribute ad clicks.
type PromotionSettlementSummary struct {
	PromotionID                string `json:"promotionId"`
	SettledOrderCount          int64  `json:"settledOrderCount"`
	SettledDiscountMinor       int64  `json:"settledDiscountMinor"`
	PartnerFundedMinor         int64  `json:"partnerFundedMinor"`
	PlatformFrozenMinor        int64  `json:"platformFrozenMinor"`
	PlatformPostedExpenseMinor int64  `json:"platformPostedExpenseMinor"`
	Currency                   string `json:"currency"`
	Basis                      string `json:"basis"`
}

func (c *Client) ReadPromotionSettlementSummary(ctx context.Context, promotionID, actingActorID string) (PromotionSettlementSummary, error) {
	var summary PromotionSettlementSummary
	err := c.requestWithActor(ctx, actorRequest{
		method:        http.MethodGet,
		path:          "/wlt/v1/operator/promotion-settlement/" + url.PathEscape(strings.TrimSpace(promotionID)),
		actingActorID: actingActorID,
		target:        &summary,
	})
	return summary, err
}
