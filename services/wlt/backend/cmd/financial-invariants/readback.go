package main

import (
	"context"
	"database/sql"
	"log"
	"strings"
)

type deliveryHandoffReadback struct {
	OrderID                string
	PaymentIntentID        string
	CaptainActorID         string
	PartnerActorID         string
	CashAmountMinor        int64
	OrderFound             bool
	OrderPaymentIntentID   string
	OrderCashAmountMinor   int64
	PaymentFound           bool
	PaymentState           string
	PaymentAmountMinor     int64
	CollectedByActorID     string
	CollectorIsNull        bool
	EarningFound           bool
	EarningPaymentIntentID string
	EarningPartnerActorID  string
	EarningCaptainActorID  string
	CODReservationFound    bool
	CODPaymentIntentID     string
	CODCaptainActorID      string
	CODAmountMinor         int64
	CODState               string
}

func (r deliveryHandoffReadback) violations() []string {
	var violations []string
	if r.CashAmountMinor < 0 {
		violations = append(violations, "negative_cash_amount")
	}
	if !r.OrderFound || r.OrderPaymentIntentID != r.PaymentIntentID {
		violations = append(violations, "order_payment_intent_mismatch")
	}
	if r.OrderCashAmountMinor != r.CashAmountMinor {
		violations = append(violations, "order_cash_amount_mismatch")
	}
	if !r.PaymentFound || r.PaymentState != "COLLECTED" {
		violations = append(violations, "payment_not_collected")
	}
	if r.PaymentAmountMinor != r.CashAmountMinor {
		violations = append(violations, "payment_cash_amount_mismatch")
	}
	if r.CashAmountMinor > 0 {
		if r.CollectedByActorID != r.CaptainActorID {
			violations = append(violations, "cash_collector_mismatch")
		}
		if !r.CODReservationFound || r.CODPaymentIntentID != r.PaymentIntentID || r.CODCaptainActorID != r.CaptainActorID || r.CODAmountMinor != r.CashAmountMinor || (r.CODState != "FINALIZED" && r.CODState != "REMITTED") {
			violations = append(violations, "cod_reservation_not_settled")
		}
	} else if !r.CollectorIsNull {
		violations = append(violations, "zero_cash_has_collector")
	}
	if !r.EarningFound || r.EarningPaymentIntentID != r.PaymentIntentID || r.EarningPartnerActorID != r.PartnerActorID || r.EarningCaptainActorID != r.CaptainActorID {
		violations = append(violations, "partner_earning_mismatch")
	}
	return violations
}

type storeCashHandoffReadback struct {
	EffectType              string
	OrderID                 string
	PaymentIntentID         string
	PartnerActorID          string
	CaptainActorID          string
	CashAmountMinor         int64
	OrderFound              bool
	OrderPaymentIntentID    string
	OrderCashAmountMinor    int64
	PaymentFound            bool
	PaymentState            string
	PaymentMethod           string
	PaymentAmountMinor      int64
	CollectedByActorID      string
	CollectorIsNull         bool
	CommissionFound         bool
	CommissionPaymentIntent string
	CommissionPartnerActor  string
	CommissionFulfillment   string
}

func (r storeCashHandoffReadback) violations() []string {
	var violations []string
	if r.CashAmountMinor < 0 {
		violations = append(violations, "negative_cash_amount")
	}
	expectedFulfillment := "CUSTOMER_PICKUP"
	switch r.EffectType {
	case "STORE_PICKUP_COLLECTION":
		if r.CashAmountMinor < 0 || r.CaptainActorID != "" {
			violations = append(violations, "store_pickup_shape_mismatch")
		}
	case "PARTNER_CAPTAIN_STORE_CASH_COLLECTION":
		expectedFulfillment = "PARTNER_CAPTAIN"
		if r.CashAmountMinor <= 0 || r.CaptainActorID == "" {
			violations = append(violations, "partner_captain_cash_shape_mismatch")
		}
	case "PARTNER_CAPTAIN_BALANCE_SETTLEMENT":
		expectedFulfillment = "PARTNER_CAPTAIN"
		if r.CashAmountMinor != 0 || r.CaptainActorID != "" {
			violations = append(violations, "partner_captain_balance_shape_mismatch")
		}
	default:
		violations = append(violations, "unknown_store_cash_effect")
	}
	if !r.OrderFound || r.OrderPaymentIntentID != r.PaymentIntentID {
		violations = append(violations, "order_payment_intent_mismatch")
	}
	if r.OrderCashAmountMinor != r.CashAmountMinor {
		violations = append(violations, "order_cash_amount_mismatch")
	}
	if !r.PaymentFound || r.PaymentState != "COLLECTED" || r.PaymentMethod != "CASH_AT_STORE" {
		violations = append(violations, "payment_not_collected_by_store_method")
	}
	if r.PaymentAmountMinor != r.CashAmountMinor {
		violations = append(violations, "payment_cash_amount_mismatch")
	}
	if r.CashAmountMinor > 0 {
		if r.CollectedByActorID != r.PartnerActorID {
			violations = append(violations, "cash_collector_mismatch")
		}
	} else if !r.CollectorIsNull {
		violations = append(violations, "zero_cash_has_collector")
	}
	if !r.CommissionFound || r.CommissionPaymentIntent != r.PaymentIntentID || r.CommissionPartnerActor != r.PartnerActorID || r.CommissionFulfillment != expectedFulfillment {
		violations = append(violations, "partner_commission_mismatch")
	}
	return violations
}

func verifyDeliveryHandoffReadbacks(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, `SELECT o.order_id,o.payment_intent_id,COALESCE(o.captain_actor_id,''),COALESCE(o.partner_actor_id,''),o.amount_minor,
		d.id IS NOT NULL,COALESCE(d.payment_intent_id,''),COALESCE(d.payment_cash_amount_minor,-1),
		p.id IS NOT NULL,COALESCE(p.state,''),COALESCE(p.amount_minor,-1),COALESCE(p.collected_by_actor_id,''),p.collected_by_actor_id IS NULL,
		e.order_id IS NOT NULL,COALESCE(e.payment_intent_id,''),COALESCE(e.partner_actor_id,''),COALESCE(e.captain_actor_id,''),
		c.id IS NOT NULL,COALESCE(c.payment_intent_id,''),COALESCE(c.captain_actor_id,''),COALESCE(c.amount_minor,-1),COALESCE(c.state,'')
		FROM dsh.commerce_financial_handoff_outbox o
		LEFT JOIN dsh.commerce_orders d ON d.id=o.order_id
		LEFT JOIN wlt.payment_intents p ON p.id=o.payment_intent_id
		LEFT JOIN wlt.partner_order_earnings e ON e.order_id=o.order_id
		LEFT JOIN LATERAL (
			SELECT id,payment_intent_id,captain_actor_id,amount_minor,state
			FROM wlt.captain_cod_reservations
			WHERE order_id=o.order_id AND payment_intent_id=o.payment_intent_id AND captain_actor_id=o.captain_actor_id AND state IN ('FINALIZED','REMITTED')
			ORDER BY created_at DESC,id DESC LIMIT 1
		) c ON TRUE
		WHERE o.state='POSTED' AND o.effect_type='DELIVERY_SETTLEMENT'`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var readbacks, violations, detailsLogged int
	for rows.Next() {
		readbacks++
		var r deliveryHandoffReadback
		if err := rows.Scan(&r.OrderID, &r.PaymentIntentID, &r.CaptainActorID, &r.PartnerActorID, &r.CashAmountMinor,
			&r.OrderFound, &r.OrderPaymentIntentID, &r.OrderCashAmountMinor,
			&r.PaymentFound, &r.PaymentState, &r.PaymentAmountMinor, &r.CollectedByActorID, &r.CollectorIsNull,
			&r.EarningFound, &r.EarningPaymentIntentID, &r.EarningPartnerActorID, &r.EarningCaptainActorID,
			&r.CODReservationFound, &r.CODPaymentIntentID, &r.CODCaptainActorID, &r.CODAmountMinor, &r.CODState); err != nil {
			return violations, err
		}
		if issues := r.violations(); len(issues) > 0 {
			violations++
			if detailsLogged < 10 {
				logReadbackFailure("posted-delivery-handoff-readback", r.OrderID, issues)
				detailsLogged++
			}
		}
	}
	if err := rows.Err(); err != nil {
		return violations, err
	}
	logReadbackResult("posted-delivery-handoff-readback", readbacks, violations, detailsLogged)
	return violations, nil
}

func verifyStoreCashHandoffReadbacks(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, `SELECT o.effect_type,o.order_id,o.payment_intent_id,COALESCE(o.partner_actor_id,''),COALESCE(o.captain_actor_id,''),o.amount_minor,
		d.id IS NOT NULL,COALESCE(d.payment_intent_id,''),COALESCE(d.payment_cash_amount_minor,-1),
		p.id IS NOT NULL,COALESCE(p.state,''),COALESCE(p.method,''),COALESCE(p.amount_minor,-1),COALESCE(p.collected_by_actor_id,''),p.collected_by_actor_id IS NULL,
		c.order_id IS NOT NULL,COALESCE(c.payment_intent_id,''),COALESCE(c.partner_actor_id,''),COALESCE(c.fulfillment_mode,'')
		FROM dsh.commerce_financial_handoff_outbox o
		LEFT JOIN dsh.commerce_orders d ON d.id=o.order_id
		LEFT JOIN wlt.payment_intents p ON p.id=o.payment_intent_id
		LEFT JOIN wlt.partner_store_cash_commissions c ON c.order_id=o.order_id
		WHERE o.state='POSTED' AND o.effect_type IN ('STORE_PICKUP_COLLECTION','PARTNER_CAPTAIN_STORE_CASH_COLLECTION','PARTNER_CAPTAIN_BALANCE_SETTLEMENT')`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var readbacks, violations, detailsLogged int
	for rows.Next() {
		readbacks++
		var r storeCashHandoffReadback
		if err := rows.Scan(&r.EffectType, &r.OrderID, &r.PaymentIntentID, &r.PartnerActorID, &r.CaptainActorID, &r.CashAmountMinor,
			&r.OrderFound, &r.OrderPaymentIntentID, &r.OrderCashAmountMinor,
			&r.PaymentFound, &r.PaymentState, &r.PaymentMethod, &r.PaymentAmountMinor, &r.CollectedByActorID, &r.CollectorIsNull,
			&r.CommissionFound, &r.CommissionPaymentIntent, &r.CommissionPartnerActor, &r.CommissionFulfillment); err != nil {
			return violations, err
		}
		if issues := r.violations(); len(issues) > 0 {
			violations++
			if detailsLogged < 10 {
				logReadbackFailure("posted-store-cash-handoff-readback", r.OrderID, issues)
				detailsLogged++
			}
		}
	}
	if err := rows.Err(); err != nil {
		return violations, err
	}
	logReadbackResult("posted-store-cash-handoff-readback", readbacks, violations, detailsLogged)
	return violations, nil
}

func logReadbackFailure(name, orderID string, issues []string) {
	log.Printf("WLT_FINANCIAL_INVARIANT=%s ROW_FAIL order_id=%s reasons=%s", name, orderID, strings.Join(issues, ","))
}

func logReadbackResult(name string, readbacks, violations, detailsLogged int) {
	if violations == 0 {
		log.Printf("WLT_FINANCIAL_INVARIANT=%s PASS rows=%d", name, readbacks)
		return
	}
	log.Printf("WLT_FINANCIAL_INVARIANT=%s FAIL violations=%d rows=%d detail_rows=%d", name, violations, readbacks, detailsLogged)
}
