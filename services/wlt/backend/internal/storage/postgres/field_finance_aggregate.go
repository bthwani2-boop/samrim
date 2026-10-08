package postgres

import (
	"context"
	"database/sql"
)

// FieldFinanceAggregateRecord summarizes canonical WLT Field finance data.
// It deliberately does not include DSH admission counts.
type FieldFinanceAggregateRecord struct {
	FieldActorCount        int64
	AcquiredStoreCount     int64
	EarnedMinor            int64
	EligibleAvailableMinor int64
	HeldMinor              int64
	PayoutRequestCount     int64
	ActiveDestinationCount int64
}

func ReadFieldFinanceAggregate(ctx context.Context, db *sql.DB) (FieldFinanceAggregateRecord, error) {
	if db == nil {
		return FieldFinanceAggregateRecord{}, ErrPayoutInvalidInput
	}
	var result FieldFinanceAggregateRecord
	err := db.QueryRowContext(ctx, `WITH field_actors AS (
		SELECT actor_id FROM wlt.ledger_entries WHERE account_code='FIELD_WALLET' AND actor_type='field' AND actor_id IS NOT NULL
		UNION SELECT actor_id FROM wlt.payout_requests WHERE actor_type='field' AND actor_id IS NOT NULL
		UNION SELECT actor_id FROM wlt.official_wallet_destinations WHERE actor_type='field' AND actor_id IS NOT NULL
		UNION SELECT field_actor_id FROM wlt.field_acquisition_entitlements WHERE field_actor_id IS NOT NULL
	), balances AS (
		SELECT actor_id,SUM(CASE direction WHEN 'CREDIT' THEN amount_minor ELSE -amount_minor END)::bigint balance_minor
		FROM wlt.ledger_entries WHERE account_code='FIELD_WALLET' AND actor_type='field' AND currency='YER' GROUP BY actor_id
	), acquired AS (
		SELECT earning.field_actor_id,
			COUNT(DISTINCT COALESCE(earning.joining_case_id,'legacy-store:'||earning.store_id))::bigint acquired_store_count,
			COALESCE(SUM(entry.amount_minor),0)::bigint earned_minor
		FROM wlt.field_acquisition_entitlements earning
		JOIN wlt.ledger_entries entry ON entry.transaction_id=earning.ledger_transaction_id
			AND entry.account_code='FIELD_WALLET' AND entry.actor_type='field'
			AND entry.actor_id=earning.field_actor_id AND entry.direction='CREDIT' AND entry.currency='YER'
		GROUP BY earning.field_actor_id
	), holds AS (
		SELECT actor_id,SUM(amount_minor)::bigint held_minor FROM wlt.payout_holds
		WHERE actor_type='field' AND status='ACTIVE' GROUP BY actor_id
	), requests AS (
		SELECT actor_id,COUNT(*)::bigint payout_request_count FROM wlt.payout_requests
		WHERE actor_type='field' GROUP BY actor_id
	), active_destinations AS (
		SELECT actor_id FROM wlt.official_wallet_destinations
		WHERE actor_type='field' AND status='ACTIVE_FOR_PAYOUT' AND verification_status='VERIFIED'
		GROUP BY actor_id
	)
	SELECT COUNT(*)::bigint,
		COALESCE(SUM(COALESCE(acquired.acquired_store_count,0)),0)::bigint,
		COALESCE(SUM(COALESCE(acquired.earned_minor,0)),0)::bigint,
		COALESCE(SUM(COALESCE(balances.balance_minor,0)-COALESCE(holds.held_minor,0)),0)::bigint,
		COALESCE(SUM(COALESCE(holds.held_minor,0)),0)::bigint,
		COALESCE(SUM(COALESCE(requests.payout_request_count,0)),0)::bigint,
		COUNT(active_destinations.actor_id)::bigint
	FROM field_actors
	LEFT JOIN balances USING(actor_id)
	LEFT JOIN acquired ON acquired.field_actor_id=field_actors.actor_id
	LEFT JOIN holds USING(actor_id)
	LEFT JOIN requests USING(actor_id)
	LEFT JOIN active_destinations USING(actor_id)`).Scan(
		&result.FieldActorCount, &result.AcquiredStoreCount, &result.EarnedMinor,
		&result.EligibleAvailableMinor, &result.HeldMinor, &result.PayoutRequestCount,
		&result.ActiveDestinationCount,
	)
	return result, err
}
