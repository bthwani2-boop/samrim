package wallet

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
)

const historySQL = `SELECT funding_id, amount_yer::text, posted_at, reverses_funding_id
    FROM wlt.customer_funding_history
    WHERE actor_id = $1 AND ($2::timestamptz IS NULL OR
        (posted_at, funding_id COLLATE "C") < ($2::timestamptz, $3::text COLLATE "C"))
    ORDER BY posted_at DESC, funding_id COLLATE "C" DESC LIMIT 11`

const balanceSQL = `SELECT COALESCE(b.balance_yer,0)::text,COALESCE(b.available_yer,0)::text
	FROM (SELECT $1::text AS actor_id) a
	LEFT JOIN wlt.customer_wallet_availability b ON b.actor_id=a.actor_id`

func NewHandler(db *sql.DB, identityOrigin string, dshOrigin ...string) (http.Handler, error) {
	return newWalletHandler(db, identityOrigin, false, dshOrigin...)
}

// NewContainerHandler permits only the named, internal synthetic Identity service.
// It does not expand the local CLI or preview origin trust boundary.
func NewContainerHandler(db *sql.DB, identityOrigin string, dshOrigin ...string) (http.Handler, error) {
	if identityOrigin != "http://identity:3302" {
		return nil, errors.New("WLT requires the isolated container Identity origin")
	}
	return newWalletHandler(db, identityOrigin, true, dshOrigin...)
}

func newWalletHandler(db *sql.DB, identityOrigin string, containerMode bool, dshOrigin ...string) (http.Handler, error) {
	if db == nil {
		return nil, errors.New("WLT balance reader unavailable")
	}
	return newHandlerWithHistoryMode(identityOrigin, func(ctx context.Context, actorID string) (walletAmounts, error) {
		var balance walletAmounts
		err := db.QueryRowContext(ctx, balanceSQL, actorID).Scan(&balance.Posted, &balance.Available)
		return balance, err
	}, func(ctx context.Context, actorID string, cursor *historyCursor) (fundingHistory, error) {
		result := fundingHistory{ActorID: actorID, Currency: "YER", Items: []fundingTransaction{}}
		var dateArg any
		var idArg string
		if cursor != nil {
			dateArg = cursor.postedAt
			idArg = cursor.fundingID
		}
		rows, err := db.QueryContext(ctx, historySQL, actorID, dateArg, idArg)
		if err != nil {
			return result, err
		}
		defer rows.Close()
		for rows.Next() {
			var entry fundingTransaction
			if err := rows.Scan(&entry.FundingID, &entry.AmountYER, &entry.PostedAt, &entry.ReversesFundingID); err != nil {
				return result, err
			}
			if !decimalYER.MatchString(entry.AmountYER) || entry.AmountYER == "0" || entry.PostedAt.IsZero() {
				return result, errors.New("invalid posted funding transaction")
			}
			if len(result.Items) == 10 {
				result.HasMore = true
				next := makeHistoryCursor(result.Items[len(result.Items)-1])
				result.NextCursor = &next
				break
			}
			entry.PostedAt = entry.PostedAt.UTC()
			result.Items = append(result.Items, entry)
		}
		if err := rows.Err(); err != nil {
			return result, err
		}
		return result, nil
	}, func(ctx context.Context, storeID string) (agreementResult, error) {
		return readAgreement(ctx, db, storeID)
	}, func(ctx context.Context, actor, checkout string) (allocationReadback, error) {
		return readOrderPaymentAllocation(ctx, db, actor, checkout)
	}, containerMode, dshOrigin...)
}
