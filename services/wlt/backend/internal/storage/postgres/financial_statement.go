package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

var ErrFinancialStatementInput = errors.New("financial statement input is invalid")

type FinancialStatementEntry struct {
	TransactionID   string
	TransactionType string
	SourceType      string
	SourceID        string
	Direction       string
	AmountMinor     int64
	Currency        string
	CreatedAt       time.Time
	BalanceAfter    int64
}

type FinancialStatementRecord struct {
	ActorType          string
	ActorID            string
	Currency           string
	PeriodStart        time.Time
	PeriodEndExclusive time.Time
	OpeningBalance     int64
	CreditsMinor       int64
	DebitsMinor        int64
	ClosingBalance     int64
	CurrentBalance     int64
	Entries            []FinancialStatementEntry
	NextCursor         string
	Limit              int
}

type FinancialStatementSummary struct {
	ActorType              string
	ActorID                string
	BeneficiaryName        string
	WalletIdentifierMasked string
	Currency               string
	OpeningBalance         int64
	CreditsMinor           int64
	DebitsMinor            int64
	ClosingBalance         int64
	CurrentBalance         int64
	HeldMinor              int64
	AvailableMinor         int64
}

type FinancialStatementSummaryTotals struct {
	OpeningBalance int64
	CreditsMinor   int64
	DebitsMinor    int64
	ClosingBalance int64
	CurrentBalance int64
	HeldMinor      int64
	AvailableMinor int64
}

func ListFinancialStatementSummaries(ctx context.Context, db *sql.DB, actorType string, periodStart, periodEndExclusive time.Time, afterActorID string, limit int) ([]FinancialStatementSummary, FinancialStatementSummaryTotals, bool, error) {
	actorType, afterActorID = strings.ToLower(strings.TrimSpace(actorType)), strings.TrimSpace(afterActorID)
	if db == nil || (actorType != "customer" && actorType != "partner" && actorType != "captain" && actorType != "field") || periodStart.IsZero() || periodEndExclusive.IsZero() || !periodEndExclusive.After(periodStart) || len(afterActorID) > 128 {
		return nil, FinancialStatementSummaryTotals{}, false, ErrFinancialStatementInput
	}
	if limit < 1 || limit > 200 {
		limit = 100
	}
	accountCode := map[string]string{"customer": "CUSTOMER_WALLET", "partner": "PARTNER_WALLET", "captain": "CAPTAIN_WALLET", "field": "FIELD_WALLET"}[actorType]
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, FinancialStatementSummaryTotals{}, false, err
	}
	defer tx.Rollback()
	const common = `WITH actor_totals AS (
		SELECT e.actor_id,
		COALESCE(SUM(CASE WHEN t.created_at<$3 THEN CASE e.direction WHEN 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END ELSE 0 END),0) opening_balance_minor,
		COALESCE(SUM(e.amount_minor) FILTER (WHERE t.created_at >= $3 AND t.created_at < $4 AND e.direction='CREDIT'),0) credits_minor,
		COALESCE(SUM(e.amount_minor) FILTER (WHERE t.created_at >= $3 AND t.created_at < $4 AND e.direction='DEBIT'),0) debits_minor,
		COALESCE(SUM(CASE WHEN t.created_at<$4 THEN CASE e.direction WHEN 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END ELSE 0 END),0) closing_balance_minor,
		COALESCE(SUM(CASE e.direction WHEN 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END),0) current_balance_minor
		FROM wlt.ledger_entries e JOIN wlt.ledger_transactions t ON t.id=e.transaction_id
		WHERE e.account_code=$1 AND e.actor_type=$2 AND e.actor_id IS NOT NULL
		GROUP BY e.actor_id
	), hold_components AS (
		SELECT actor_id,amount_minor FROM wlt.payout_holds WHERE actor_type=$2 AND status='ACTIVE'
		UNION ALL
		SELECT captain_actor_id,SUM(amount_minor) FROM wlt.captain_cod_reservations WHERE $2='captain' AND state IN ('ACTIVE','FINALIZED') GROUP BY captain_actor_id
	), active_holds AS (
		SELECT actor_id,SUM(amount_minor) held_minor FROM hold_components GROUP BY actor_id
	), combined AS (
		SELECT t.actor_id,t.opening_balance_minor,t.credits_minor,t.debits_minor,t.closing_balance_minor,t.current_balance_minor,COALESCE(h.held_minor,0) held_minor
		FROM actor_totals t LEFT JOIN active_holds h ON h.actor_id=t.actor_id
		UNION ALL
		SELECT p.partner_actor_id,0,0,0,0,0,0 FROM wlt.partner_financial_profiles p
		WHERE $2='partner' AND p.state='ACTIVE' AND NOT EXISTS (SELECT 1 FROM actor_totals t WHERE t.actor_id=p.partner_actor_id)
	)`
	args := []any{accountCode, actorType, periodStart.UTC(), periodEndExclusive.UTC()}
	var totals FinancialStatementSummaryTotals
	if err := tx.QueryRowContext(ctx, common+` SELECT COALESCE(SUM(opening_balance_minor),0),COALESCE(SUM(credits_minor),0),COALESCE(SUM(debits_minor),0),COALESCE(SUM(closing_balance_minor),0),COALESCE(SUM(current_balance_minor),0),COALESCE(SUM(held_minor),0),COALESCE(SUM(current_balance_minor-held_minor),0) FROM combined`, args...).Scan(&totals.OpeningBalance, &totals.CreditsMinor, &totals.DebitsMinor, &totals.ClosingBalance, &totals.CurrentBalance, &totals.HeldMinor, &totals.AvailableMinor); err != nil {
		return nil, FinancialStatementSummaryTotals{}, false, err
	}
	rows, err := tx.QueryContext(ctx, common+` SELECT t.actor_id,COALESCE(d.beneficiary_name,''),COALESCE(d.wallet_identifier_masked,''),t.opening_balance_minor,t.credits_minor,t.debits_minor,t.closing_balance_minor,t.current_balance_minor,t.held_minor,t.current_balance_minor-t.held_minor
	FROM combined t LEFT JOIN LATERAL (SELECT beneficiary_name,wallet_identifier_masked FROM wlt.official_wallet_destinations WHERE actor_type=$2 AND actor_id=t.actor_id ORDER BY version DESC LIMIT 1) d ON true
	WHERE $5='' OR t.actor_id>$5 ORDER BY t.actor_id LIMIT $6`, accountCode, actorType, periodStart.UTC(), periodEndExclusive.UTC(), afterActorID, limit+1)
	if err != nil {
		return nil, FinancialStatementSummaryTotals{}, false, err
	}
	items := make([]FinancialStatementSummary, 0, limit+1)
	for rows.Next() {
		item := FinancialStatementSummary{ActorType: actorType, Currency: "YER"}
		if err := rows.Scan(&item.ActorID, &item.BeneficiaryName, &item.WalletIdentifierMasked, &item.OpeningBalance, &item.CreditsMinor, &item.DebitsMinor, &item.ClosingBalance, &item.CurrentBalance, &item.HeldMinor, &item.AvailableMinor); err != nil {
			rows.Close()
			return nil, FinancialStatementSummaryTotals{}, false, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, FinancialStatementSummaryTotals{}, false, err
	}
	if err := rows.Close(); err != nil {
		return nil, FinancialStatementSummaryTotals{}, false, err
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	if err := tx.Commit(); err != nil {
		return nil, FinancialStatementSummaryTotals{}, false, err
	}
	return items, totals, hasMore, nil
}

func ReadFinancialStatement(ctx context.Context, db *sql.DB, actorType, actorID string, periodStart, periodEndExclusive time.Time, cursorAt *time.Time, cursorID string, limit int) (FinancialStatementRecord, error) {
	actorType, actorID = strings.ToLower(strings.TrimSpace(actorType)), strings.TrimSpace(actorID)
	if db == nil || (actorType != "customer" && actorType != "partner" && actorType != "captain" && actorType != "field") || boundedText(actorID, 1, 128) == "" || periodStart.IsZero() || periodEndExclusive.IsZero() || !periodEndExclusive.After(periodStart) {
		return FinancialStatementRecord{}, ErrFinancialStatementInput
	}
	if limit < 1 || limit > 200 {
		limit = 100
	}
	accountCode := map[string]string{"customer": "CUSTOMER_WALLET", "partner": "PARTNER_WALLET", "captain": "CAPTAIN_WALLET", "field": "FIELD_WALLET"}[actorType]
	result := FinancialStatementRecord{ActorType: actorType, ActorID: actorID, Currency: "YER", PeriodStart: periodStart.UTC(), PeriodEndExclusive: periodEndExclusive.UTC(), Entries: make([]FinancialStatementEntry, 0), Limit: limit}
	if err := db.QueryRowContext(ctx, `SELECT
		COALESCE(SUM(CASE WHEN t.created_at < $4 THEN CASE e.direction WHEN 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END ELSE 0 END),0),
		COALESCE(SUM(e.amount_minor) FILTER (WHERE t.created_at >= $4 AND t.created_at < $5 AND e.direction='CREDIT'),0),
		COALESCE(SUM(e.amount_minor) FILTER (WHERE t.created_at >= $4 AND t.created_at < $5 AND e.direction='DEBIT'),0),
		COALESCE(SUM(CASE WHEN t.created_at < $5 THEN CASE e.direction WHEN 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END ELSE 0 END),0),
		COALESCE(SUM(CASE e.direction WHEN 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END),0)
		FROM wlt.ledger_entries e JOIN wlt.ledger_transactions t ON t.id=e.transaction_id
		WHERE e.account_code=$1 AND e.actor_type=$2 AND e.actor_id=$3`, accountCode, actorType, actorID, periodStart.UTC(), periodEndExclusive.UTC()).Scan(&result.OpeningBalance, &result.CreditsMinor, &result.DebitsMinor, &result.ClosingBalance, &result.CurrentBalance); err != nil {
		return FinancialStatementRecord{}, err
	}
	query := `WITH actor_entries AS (
		SELECT t.id transaction_id,t.transaction_type,t.source_type,t.source_id,t.currency,t.created_at,e.direction,e.amount_minor,
		SUM(CASE e.direction WHEN 'CREDIT' THEN e.amount_minor ELSE -e.amount_minor END) OVER (ORDER BY t.created_at ASC,t.id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) balance_after
		FROM wlt.ledger_entries e JOIN wlt.ledger_transactions t ON t.id=e.transaction_id
		WHERE e.account_code=$1 AND e.actor_type=$2 AND e.actor_id=$3
	)
	SELECT transaction_id,transaction_type,source_type,source_id,direction,amount_minor,currency,created_at,balance_after
	FROM actor_entries WHERE created_at >= $4 AND created_at < $5`
	args := []any{accountCode, actorType, actorID, periodStart.UTC(), periodEndExclusive.UTC()}
	if cursorAt != nil {
		query += ` AND (created_at,transaction_id) < ($6,$7)`
		args = append(args, cursorAt.UTC(), cursorID)
	}
	query += ` ORDER BY created_at DESC,transaction_id DESC LIMIT $` + formatInt(len(args)+1)
	args = append(args, limit+1)
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return FinancialStatementRecord{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var entry FinancialStatementEntry
		if err := rows.Scan(&entry.TransactionID, &entry.TransactionType, &entry.SourceType, &entry.SourceID, &entry.Direction, &entry.AmountMinor, &entry.Currency, &entry.CreatedAt, &entry.BalanceAfter); err != nil {
			return FinancialStatementRecord{}, err
		}
		result.Entries = append(result.Entries, entry)
	}
	if err := rows.Err(); err != nil {
		return FinancialStatementRecord{}, err
	}
	if len(result.Entries) > limit {
		last := result.Entries[limit-1]
		result.NextCursor = last.CreatedAt.UTC().Format(time.RFC3339Nano) + "|" + last.TransactionID
		result.Entries = result.Entries[:limit]
	}
	return result, nil
}
