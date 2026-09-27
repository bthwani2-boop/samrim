package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/opsafety"
	"github.com/bthwani2-boop/samrim/services/wlt/backend/internal/storage/postgres"
)

type invariant struct {
	name  string
	query string
}

func main() {
	if _, err := opsafety.RequireOrdinaryCLIEnvironment(os.Getenv("BTHWANI_ENV"), "wlt financial invariant verification"); err != nil {
		log.Fatal(err)
	}
	databaseURL := strings.TrimSpace(os.Getenv("WLT_FINANCIAL_INVARIANTS_DATABASE_URL"))
	if databaseURL == "" {
		databaseURL = strings.TrimSpace(os.Getenv("WLT_DATABASE_URL"))
	}
	if _, err := opsafety.RequireExpectedDatabaseTarget(databaseURL, os.Getenv); err != nil {
		log.Fatal(err)
	}
	db, err := postgres.Open(databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	checks := []invariant{
		{
			name: "ledger-balanced",
			query: `SELECT COUNT(*) FROM (
				SELECT t.id
				FROM wlt.ledger_transactions t
				LEFT JOIN wlt.ledger_entries e ON e.transaction_id=t.id
				GROUP BY t.id,t.currency
				HAVING COUNT(e.id) < 2
					OR COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_minor ELSE 0 END),0)
					 <> COALESCE(SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_minor ELSE 0 END),0)
					OR COALESCE(BOOL_OR(e.currency <> t.currency),false)
			) violations`,
		},
		{
			name: "settled-cash-in-ledger-link",
			query: `SELECT COUNT(*)
			FROM wlt.cash_in_funding_intents f
			LEFT JOIN wlt.ledger_transactions t ON t.id=f.ledger_transaction_id
			WHERE f.state='SETTLED' AND (
				t.id IS NULL
				OR t.source_type <> 'FUNDING_INTENT'
				OR t.source_id <> f.id
				OR t.currency <> f.currency
				OR (f.actor_type='customer' AND t.transaction_type <> 'CUSTOMER_WALLET_TOPUP')
				OR (f.actor_type='captain' AND t.transaction_type <> 'CAPTAIN_TOPUP')
			)`,
		},
		{
			name: "completed-payout-chain",
			query: `SELECT COUNT(*)
			FROM wlt.payout_requests p
			LEFT JOIN wlt.manual_transfer_executions m ON m.payout_id=p.id
			LEFT JOIN wlt.payout_holds h ON h.payout_id=p.id
			LEFT JOIN wlt.ledger_transactions t ON t.id=p.ledger_transaction_id
			LEFT JOIN wlt.settlement_statement_rows r ON r.id=m.statement_row_id
			WHERE p.status='COMPLETED' AND (
				t.id IS NULL
				OR t.transaction_type <> 'PAYOUT_COMPLETED'
				OR t.source_type <> 'MANUAL_EXTERNAL_TRANSFER'
				OR t.source_id <> p.id
				OR t.currency <> p.currency
				OR m.id IS NULL
				OR m.execution_status <> 'RECONCILED'
				OR m.statement_row_id IS NULL
				OR m.reconciled_by IS NULL
				OR m.reconciled_at IS NULL
				OR r.id IS NULL
				OR r.matched_transfer_id IS DISTINCT FROM m.id
				OR h.id IS NULL
				OR h.status <> 'FINALIZED'
				OR h.released_at IS NULL
			)`,
		},
		{
			name: "terminal-payout-no-active-hold",
			query: `SELECT COUNT(*)
			FROM wlt.payout_requests p
			JOIN wlt.payout_holds h ON h.payout_id=p.id
			WHERE p.status IN ('CANCELLED','COMPLETED') AND h.status='ACTIVE'`,
		},
		{
			name: "reconciled-transfer-statement-link",
			query: `SELECT COUNT(*)
			FROM wlt.manual_transfer_executions m
			LEFT JOIN wlt.settlement_statement_rows r ON r.id=m.statement_row_id
			WHERE m.execution_status='RECONCILED' AND (
				m.statement_row_id IS NULL
				OR m.reconciled_by IS NULL
				OR m.reconciled_at IS NULL
				OR r.id IS NULL
				OR r.matched_transfer_id IS DISTINCT FROM m.id
			)`,
		},
		{
			name: "completed-payout-audit",
			query: `SELECT COUNT(*)
			FROM wlt.payout_requests p
			WHERE p.status='COMPLETED'
			AND (SELECT COUNT(*) FROM wlt.payout_audit_events a WHERE a.payout_id=p.id AND a.event_type='PAYOUT_COMPLETED') <> 1`,
		},
		{
			name: "partner-order-earning-ledger-link",
			query: `SELECT COUNT(*)
			FROM wlt.partner_order_earnings e
			LEFT JOIN wlt.ledger_transactions t ON t.id=e.ledger_transaction_id
			WHERE t.id IS NULL
				OR t.transaction_type <> 'PARTNER_ORDER_EARNING_POSTED'
				OR t.source_type <> 'ORDER_DELIVERED'
				OR t.source_id <> e.order_id
				OR t.currency <> e.currency`,
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	failed := false
	for _, check := range checks {
		var violations int64
		if err := db.QueryRowContext(ctx, check.query).Scan(&violations); err != nil {
			log.Fatalf("WLT_FINANCIAL_INVARIANT=%s ERROR %v", check.name, err)
		}
		if violations != 0 {
			failed = true
			log.Printf("WLT_FINANCIAL_INVARIANT=%s FAIL violations=%d", check.name, violations)
			continue
		}
		log.Printf("WLT_FINANCIAL_INVARIANT=%s PASS", check.name)
	}
	if failed {
		log.Fatal("WLT_FINANCIAL_INVARIANTS=FAIL")
	}
	log.Printf("WLT_FINANCIAL_INVARIANTS=PASS checks=%d", len(checks))
}
