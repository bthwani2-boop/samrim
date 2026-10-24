package postgres

import (
	"context"
	"database/sql"
	"strings"
)

type MarketingConsentSnapshot struct {
	Channel  string `json:"channel"`
	Decision string `json:"decision"`
	Version  int    `json:"version"`
}

func ReadPromotionalContactConsent(ctx context.Context, db *sql.DB, clientActorID, channel string) (MarketingConsentSnapshot, error) {
	clientActorID = strings.TrimSpace(clientActorID)
	channel = strings.ToUpper(strings.TrimSpace(channel))
	if db == nil || !validMarketingConsentIdentity(clientActorID, channel) {
		return MarketingConsentSnapshot{}, ErrMarketingConsentInvalid
	}
	result := MarketingConsentSnapshot{Channel: channel, Decision: "OPTED_OUT", Version: 0}
	err := db.QueryRowContext(ctx, `SELECT status,version FROM dsh.customer_marketing_consents
 WHERE client_actor_id=$1 AND channel=$2 AND purpose='PROMOTIONS'`, clientActorID, channel).Scan(&result.Decision, &result.Version)
	if err == sql.ErrNoRows {
		return result, nil
	}
	return result, err
}
