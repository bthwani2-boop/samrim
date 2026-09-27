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
			name: "duplicate-ledger-source-postings",
			query: `SELECT COUNT(*) FROM (
				SELECT source_type,source_id
				FROM wlt.ledger_transactions
				GROUP BY source_type,source_id
				HAVING COUNT(*) <> 1
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
			name: "settled-cash-in-exact-ledger-effect",
			query: `SELECT COUNT(*)
			FROM wlt.cash_in_funding_intents f
			WHERE f.state='SETTLED' AND (
				(SELECT COUNT(*) FROM wlt.ledger_entries e
					WHERE e.transaction_id=f.ledger_transaction_id
					AND e.account_class='asset'
					AND e.account_code='EXTERNAL_SETTLEMENT_CASH'
					AND e.actor_type IS NULL AND e.actor_id IS NULL
					AND e.direction='DEBIT'
					AND e.amount_minor=f.requested_amount_minor
					AND e.currency=f.currency) <> 1
				OR (SELECT COUNT(*) FROM wlt.ledger_entries e
					WHERE e.transaction_id=f.ledger_transaction_id
					AND e.account_class='liability'
					AND e.account_code=CASE WHEN f.actor_type='customer' THEN 'CUSTOMER_WALLET' ELSE 'CAPTAIN_WALLET' END
					AND e.actor_type=f.actor_type
					AND e.actor_id=f.actor_id
					AND e.direction='CREDIT'
					AND e.amount_minor=f.requested_amount_minor
					AND e.currency=f.currency) <> 1
				OR (SELECT COUNT(*) FROM wlt.ledger_entries e WHERE e.transaction_id=f.ledger_transaction_id) <> 2
			)`,
		},
		{
			name: "captain-wallet-not-overheld",
			query: `SELECT COUNT(*) FROM (
				SELECT actors.actor_id,
					COALESCE((SELECT SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_minor ELSE -e.amount_minor END)
						FROM wlt.ledger_entries e
						WHERE e.account_code='CAPTAIN_WALLET' AND e.actor_type='captain' AND e.actor_id=actors.actor_id AND e.currency='YER'),0)
					- COALESCE((SELECT SUM(c.amount_minor) FROM wlt.captain_cod_reservations c
						WHERE c.captain_actor_id=actors.actor_id AND c.state IN ('ACTIVE','FINALIZED')),0)
					- COALESCE((SELECT SUM(h.amount_minor) FROM wlt.payout_holds h
						WHERE h.actor_type='captain' AND h.actor_id=actors.actor_id AND h.status='ACTIVE'),0) AS available_minor
				FROM (
					SELECT actor_id FROM wlt.ledger_entries WHERE account_code='CAPTAIN_WALLET' AND actor_type='captain'
					UNION SELECT captain_actor_id FROM wlt.captain_cod_reservations
					UNION SELECT actor_id FROM wlt.payout_holds WHERE actor_type='captain'
				) actors
			) balances
			WHERE available_minor < 0`,
		},
		{
			name: "partner-commission-receivable-derived",
			query: `SELECT COUNT(*) FROM (
				SELECT actors.actor_id,
					COALESCE((SELECT SUM(c.commission_minor) FROM wlt.partner_store_cash_commissions c WHERE c.partner_actor_id=actors.actor_id),0)
					- COALESCE((SELECT SUM(r.amount_minor) FROM wlt.partner_commission_remittances r WHERE r.partner_actor_id=actors.actor_id),0) AS expected_minor,
					COALESCE((SELECT SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_minor ELSE -e.amount_minor END)
						FROM wlt.ledger_entries e WHERE e.account_code='PARTNER_COMMISSION_RECEIVABLE' AND e.actor_type='partner' AND e.actor_id=actors.actor_id),0) AS ledger_minor
				FROM (
					SELECT partner_actor_id AS actor_id FROM wlt.partner_store_cash_commissions
					UNION SELECT partner_actor_id FROM wlt.partner_commission_remittances
					UNION SELECT actor_id FROM wlt.ledger_entries WHERE account_code='PARTNER_COMMISSION_RECEIVABLE' AND actor_type='partner'
				) actors
			) balances
			WHERE expected_minor <> ledger_minor OR expected_minor < 0 OR ledger_minor < 0`,
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
		{
			name: "posted-delivery-handoff-readback",
			query: `SELECT COUNT(*)
			FROM dsh.commerce_financial_handoff_outbox o
			LEFT JOIN wlt.payment_intents p ON p.id=o.payment_intent_id
			LEFT JOIN wlt.partner_order_earnings e ON e.order_id=o.order_id
			LEFT JOIN wlt.captain_cod_reservations c ON c.order_id=o.order_id
			WHERE o.state='POSTED' AND o.effect_type='DELIVERY_SETTLEMENT' AND (
				p.id IS NULL OR p.state <> 'COLLECTED' OR p.collected_by_actor_id IS DISTINCT FROM o.captain_actor_id OR p.amount_minor <> o.amount_minor
				OR e.order_id IS NULL OR e.payment_intent_id <> o.payment_intent_id OR e.partner_actor_id IS DISTINCT FROM o.partner_actor_id OR e.captain_actor_id IS DISTINCT FROM o.captain_actor_id
				OR c.order_id IS NULL OR c.payment_intent_id <> o.payment_intent_id OR c.captain_actor_id IS DISTINCT FROM o.captain_actor_id OR c.amount_minor <> o.amount_minor OR c.state <> 'FINALIZED'
			)`,
		},
		{
			name: "posted-store-cash-handoff-readback",
			query: `SELECT COUNT(*)
			FROM dsh.commerce_financial_handoff_outbox o
			LEFT JOIN wlt.payment_intents p ON p.id=o.payment_intent_id
			LEFT JOIN wlt.partner_store_cash_commissions c ON c.order_id=o.order_id
			WHERE o.state='POSTED' AND o.effect_type IN ('STORE_PICKUP_COLLECTION','PARTNER_CAPTAIN_STORE_CASH_COLLECTION') AND (
				p.id IS NULL OR p.state <> 'COLLECTED' OR p.method <> 'CASH_AT_STORE' OR p.collected_by_actor_id IS DISTINCT FROM o.partner_actor_id OR p.amount_minor <> o.amount_minor
				OR c.order_id IS NULL OR c.payment_intent_id <> o.payment_intent_id OR c.partner_actor_id IS DISTINCT FROM o.partner_actor_id
				OR c.fulfillment_mode <> CASE WHEN o.effect_type='STORE_PICKUP_COLLECTION' THEN 'CUSTOMER_PICKUP' ELSE 'PARTNER_CAPTAIN' END
			)`,
		},
		{
			name: "posted-cod-release-readback",
			query: `SELECT COUNT(*)
			FROM dsh.commerce_financial_handoff_outbox o
			JOIN wlt.captain_cod_reservations c ON c.order_id=o.order_id AND c.payment_intent_id=o.payment_intent_id AND c.captain_actor_id=o.captain_actor_id
			WHERE o.state='POSTED' AND o.effect_type='CAPTAIN_COD_RELEASE' AND c.state='ACTIVE'`,
		},
		{
			name: "posted-payment-cancel-readback",
			query: `SELECT COUNT(*)
			FROM dsh.commerce_financial_handoff_outbox o
			LEFT JOIN wlt.payment_intents p ON p.id=o.payment_intent_id
			WHERE o.state='POSTED' AND o.effect_type='PAYMENT_CANCEL' AND (p.id IS NULL OR p.state <> 'CANCELLED')`,
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
