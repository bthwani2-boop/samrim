package postgres

import (
	"context"
	"database/sql"
	"errors"
)

// DetectOperatorOrderExceptions opens a bounded, actionable case for
// an audited preparation delay or failed delivery.  Every signal is tied
// to the current stage event; a resolved incident never reopens while
// the Order remains in the same occurrence of that stage.
func DetectOperatorOrderExceptions(ctx context.Context, db *sql.DB, max int) (int64, error) {
	if db == nil || max < 1 || max > 50 {
		return 0, ErrOpsCaseInvalid
	}
	// One statement owns both the case and its event.  Every candidate Order
	// is locked before writing so a concurrent Order transition cannot race.
	// SKIP LOCKED keeps concurrent detectors non-blocking.
	const query = `
WITH candidates AS MATERIALIZED (
 SELECT o.id AS order_id,
   CASE WHEN o.state='CREATED' THEN 'OTHER'
        WHEN o.state='PREPARING' THEN 'PARTNER_DELAY'
        ELSE 'DELIVERY_BLOCKED' END AS reason,
   CASE WHEN o.state='CREATED' THEN 'CREATED:'||cr.id::text
        WHEN o.state='PREPARING' THEN 'PREPARING:'||pa.id::text
        ELSE 'DELIVERY_FAILED:'||ca.id::text END AS signal_key,
   CASE WHEN o.state='CREATED' THEN cr.created_at
        WHEN o.state='PREPARING' THEN pa.created_at
        ELSE ca.created_at END AS stage_at,
   CASE WHEN o.state='CREATED'
       THEN CASE WHEN statement_timestamp()-cr.created_at >= interval '60 minutes' THEN 'URGENT' ELSE 'NORMAL' END
       WHEN o.state='PREPARING'
       THEN CASE WHEN statement_timestamp()-pa.created_at >= 2*make_interval(mins => COALESCE(soa.preparation_minutes,30))
           THEN 'URGENT' ELSE 'NORMAL' END
       ELSE 'URGENT' END AS priority,
   CASE WHEN o.state='CREATED'
       THEN 'تحقق من سبب بقاء الطلب جديدًا، وحالة الدفع والتواصل دون تعطيل الطلب أو اتهام المتجر.'
       WHEN o.state='PREPARING'
       THEN 'راجع تأخر تجهيز الطلب مع المتجر وحدد الإجراء التالي.'
       ELSE 'راجع فشل التسليم وعهدة الكابتن قبل أي قرار بشأن إعادة الإسناد أو التسوية.'
   END AS next_action
 FROM dsh.commerce_orders o
 LEFT JOIN dsh.store_operational_availability soa ON soa.store_id=o.store_id
 LEFT JOIN LATERAL (
     SELECT a.id,a.created_at FROM dsh.commerce_order_audit a
     WHERE a.order_id=o.id AND a.to_state='CREATED' AND a.event_type='order_created'
     ORDER BY a.created_at DESC,a.id DESC LIMIT 1
 ) cr ON o.state='CREATED'
 LEFT JOIN LATERAL (
     SELECT a.id,a.created_at FROM dsh.commerce_order_audit a
     WHERE a.order_id=o.id AND a.to_state='PREPARING' AND a.event_type='order_preparing'
     ORDER BY a.created_at DESC,a.id DESC LIMIT 1
 ) pa ON o.state='PREPARING'
 LEFT JOIN LATERAL (
     SELECT a.id,a.created_at FROM dsh.captain_audit a
     WHERE a.order_id=o.id AND a.event_type='delivery_failed'
     ORDER BY a.created_at DESC,a.id DESC LIMIT 1
 ) ca ON o.state='DELIVERY_FAILED'
 WHERE (o.state='CREATED' AND cr.id IS NOT NULL
          AND cr.created_at <= statement_timestamp()-interval '30 minutes'
       OR o.state='PREPARING' AND pa.id IS NOT NULL
          AND pa.created_at <= statement_timestamp()-make_interval(mins => COALESCE(soa.preparation_minutes,30))
       OR o.state='DELIVERY_FAILED' AND ca.id IS NOT NULL)
   AND NOT EXISTS (
       SELECT 1 FROM dsh.operator_order_cases existing
       WHERE existing.order_id=o.id
         AND existing.reason=CASE WHEN o.state='CREATED' THEN 'OTHER'
                                  WHEN o.state='PREPARING' THEN 'PARTNER_DELAY' ELSE 'DELIVERY_BLOCKED' END
         AND (existing.state <> 'RESOLVED'
             OR existing.opened_at >= CASE WHEN o.state='CREATED' THEN cr.created_at
                                            WHEN o.state='PREPARING' THEN pa.created_at ELSE ca.created_at END)
   )
   AND NOT EXISTS (
       SELECT 1 FROM dsh.operator_order_case_events e
       WHERE e.idempotency_key='ops-auto-'||md5(
           CASE WHEN o.state='CREATED' THEN 'CREATED:'||cr.id::text
                WHEN o.state='PREPARING' THEN 'PREPARING:'||pa.id::text
                ELSE 'DELIVERY_FAILED:'||ca.id::text END)
   )
 ORDER BY CASE WHEN o.state='CREATED' THEN cr.created_at
                 WHEN o.state='PREPARING' THEN pa.created_at ELSE ca.created_at END,o.id
 LIMIT $1
 FOR UPDATE OF o SKIP LOCKED
), inserted AS (
 INSERT INTO dsh.operator_order_cases
 (order_id,reason,priority,next_action,opened_by_actor_id,updated_by_actor_id)
 SELECT order_id,reason,priority,next_action,
        'dsh:operations-detector','dsh:operations-detector'
 FROM candidates
 ON CONFLICT DO NOTHING
 RETURNING id,order_id,reason,next_action
), events AS (
 INSERT INTO dsh.operator_order_case_events
 (case_id,action,actor_id,idempotency_key,request_hash,correlation_id,detail)
 SELECT i.id,'OPEN','dsh:operations-detector',
   'ops-auto-'||md5(c.signal_key),
   md5('OPEN:'||c.order_id||':'||c.signal_key),
   'ops-auto-'||md5(c.signal_key),i.next_action
 FROM inserted i JOIN candidates c ON c.order_id=i.order_id AND c.reason=i.reason
 RETURNING id
)
SELECT count(*)::bigint FROM events`
	var opened int64
	err := db.QueryRowContext(ctx, query, max).Scan(&opened)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return opened, err
}
