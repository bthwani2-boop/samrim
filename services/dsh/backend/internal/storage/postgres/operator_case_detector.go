package postgres

import (
	"context"
	"database/sql"
	"errors"
)

// DetectOperatorOrderExceptions opens a bounded, actionable case for
// an audited stalled stage, missing dispatch offer, lost active mission GPS, or failed delivery.  Every signal is tied
// to the current stage event; a resolved incident never reopens while
// the Order remains in the same occurrence of that stage.
func DetectOperatorOrderExceptions(ctx context.Context, db *sql.DB, max int) (int64, error) {
	if db == nil || max < 1 || max > 50 {
		return 0, ErrOpsCaseInvalid
	}
	// Automatically resolve only unclaimed location alerts when canonical DSH
	// readback proves recovery. A claimed investigation remains operator-owned.
	// This statement updates the case and appends its one audit event atomically.
	const recoverLocations = `WITH recovered AS MATERIALIZED (
 SELECT c.id FROM dsh.operator_order_cases c
 WHERE c.reason='CAPTAIN_LOCATION_LOST' AND c.state='OPEN' AND c.owner_actor_id IS NULL
 AND (EXISTS(
   SELECT 1 FROM dsh.captain_assignments a
   JOIN dsh.commerce_orders o ON o.id=a.order_id
   JOIN dsh.captain_mission_latest ml ON ml.assignment_id=a.id
   WHERE a.order_id=c.order_id AND a.state IN ('assigned','in_custody')
   AND o.state IN ('CAPTAIN_ASSIGNED','IN_CUSTODY')
   AND ml.received_at>=statement_timestamp()-interval '90 seconds'
   AND ml.recorded_at>=statement_timestamp()-interval '90 seconds'
 ) OR EXISTS(
   SELECT 1 FROM dsh.commerce_orders o
   JOIN dsh.commerce_order_delivery_proofs p ON p.order_id=o.id
   WHERE o.id=c.order_id AND o.state='DELIVERED' AND p.state='VERIFIED'
 ))
 ORDER BY c.id LIMIT $1 FOR UPDATE OF c SKIP LOCKED
), updated AS (
 UPDATE dsh.operator_order_cases c
 SET state='RESOLVED', resolution_note='عاد موقع المهمة وتأكدت حالة الكابتن من المصدر الموثوق.',
     resolved_at=clock_timestamp(), updated_at=clock_timestamp(),
     updated_by_actor_id='dsh:operations-detector',version=version+1
 FROM recovered r WHERE c.id=r.id
 RETURNING c.id
)
INSERT INTO dsh.operator_order_case_events
(case_id,action,actor_id,idempotency_key,request_hash,correlation_id,detail)
SELECT u.id,'RESOLVE','dsh:operations-detector',
  'ops-gps-recovered-'||u.id::text,
  md5('MISSION_GPS_RECOVERED:'||u.id::text),
  'ops-gps-recovered-'||u.id::text,
  'Mission location recovered from DSH readback'
FROM updated u`
	if _, err := db.ExecContext(ctx, recoverLocations, max); err != nil {
		return 0, err
	}
	// One statement owns both the case and its event.  Every candidate Order
	// is locked before writing so a concurrent Order transition cannot race.
	// SKIP LOCKED keeps concurrent detectors non-blocking.
	const query = `
WITH candidates AS MATERIALIZED (
 SELECT o.id AS order_id,
   CASE WHEN ce.id IS NOT NULL THEN 'CUSTOMER_CONTACT'
        WHEN gps.assignment_id IS NOT NULL THEN 'CAPTAIN_LOCATION_LOST'
        WHEN o.state='CREATED' THEN 'OTHER'
        WHEN o.state IN ('PARTNER_ACCEPTED','PREPARING') THEN 'PARTNER_DELAY'
        WHEN o.state='READY_FOR_DISPATCH' THEN 'DISPATCH_UNAVAILABLE'
        ELSE 'DELIVERY_BLOCKED' END AS reason,
   CASE WHEN ce.id IS NOT NULL THEN 'CUSTOMER_NO_ANSWER:'||ce.id::text
        WHEN gps.assignment_id IS NOT NULL THEN 'MISSION_LOST:'||gps.assignment_id||':'||gps.alert_at::text
        WHEN o.state='CREATED' THEN 'CREATED:'||cr.id::text
        WHEN o.state='PARTNER_ACCEPTED' THEN 'PARTNER_ACCEPTED:'||aa.id::text
                WHEN o.state='PREPARING' THEN 'PREPARING:'||pa.id::text
        WHEN o.state='READY_FOR_DISPATCH' THEN 'READY_FOR_DISPATCH:'||rd.id::text
        ELSE 'DELIVERY_FAILED:'||ca.id::text END AS signal_key,
   CASE WHEN ce.id IS NOT NULL THEN ce.created_at
        WHEN gps.assignment_id IS NOT NULL THEN gps.alert_at
        WHEN o.state='CREATED' THEN cr.created_at
        WHEN o.state='PARTNER_ACCEPTED' THEN aa.created_at
                                            WHEN o.state='PREPARING' THEN pa.created_at
        WHEN o.state='READY_FOR_DISPATCH' THEN rd.created_at
        ELSE ca.created_at END AS stage_at,
   CASE WHEN ce.id IS NOT NULL THEN 'URGENT'
       WHEN gps.assignment_id IS NOT NULL THEN 'URGENT'
       WHEN o.state='CREATED'
       THEN CASE WHEN statement_timestamp()-cr.created_at >= interval '60 minutes' THEN 'URGENT' ELSE 'NORMAL' END
       WHEN o.state='PARTNER_ACCEPTED'
       THEN CASE WHEN statement_timestamp()-aa.created_at >= interval '60 minutes' THEN 'URGENT' ELSE 'NORMAL' END
       WHEN o.state='READY_FOR_DISPATCH'
       THEN CASE WHEN statement_timestamp()-rd.created_at >= interval '30 minutes' THEN 'URGENT' ELSE 'NORMAL' END
       WHEN o.state='PREPARING'
       THEN CASE WHEN statement_timestamp()-pa.created_at >= 2*make_interval(mins => COALESCE(soa.preparation_minutes,30))
           THEN 'URGENT' ELSE 'NORMAL' END
       ELSE 'URGENT' END AS priority,
   CASE WHEN ce.id IS NOT NULL
       THEN 'راجع تعذر الاتصال بالعميل بعد محاولتين. لا تلغِ الطلب تلقائيًا.'
       WHEN gps.assignment_id IS NOT NULL
       THEN 'انقطع تحديث موقع مهمة الكابتن. تحقق من الاتصال والمهمة دون افتراض وصول أو تسليم.'
       WHEN o.state='CREATED'
       THEN 'تحقق من سبب بقاء الطلب جديدًا، وحالة الدفع والتواصل دون تعطيل الطلب أو اتهام المتجر.'
       WHEN o.state='PARTNER_ACCEPTED'
       THEN 'تحقق مع المتجر من سبب توقف الطلب بعد القبول قبل بدء التجهيز وحدد إجراء المتابعة.'
       WHEN o.state='PREPARING'
       THEN 'راجع تأخر تجهيز الطلب مع المتجر وحدد الإجراء التالي.'
       WHEN o.state='READY_FOR_DISPATCH'
       THEN 'تحقق من أهلية الكباتن وانتهاء عروض التوزيع قبل أي إعادة إسناد.'
       ELSE 'راجع فشل التسليم وعهدة الكابتن قبل أي قرار بشأن إعادة الإسناد أو التسوية.'
   END AS next_action
 FROM dsh.commerce_orders o
 LEFT JOIN LATERAL (
   SELECT a.id,a.created_at FROM dsh.captain_assignments a
   WHERE a.order_id=o.id AND a.state IN ('assigned','in_custody')
   ORDER BY a.created_at DESC LIMIT 1
 ) mission ON o.fulfillment_mode='BTHWANI_CAPTAIN'
          AND o.state IN ('CAPTAIN_ASSIGNED','IN_CUSTODY')
 LEFT JOIN dsh.captain_mission_latest ml ON ml.assignment_id=mission.id
 LEFT JOIN LATERAL (
   SELECT mission.id AS assignment_id,
          COALESCE(ml.received_at,mission.created_at) AS alert_at
   WHERE mission.id IS NOT NULL
     AND mission.created_at<=statement_timestamp()-interval '3 minutes'
     AND (ml.assignment_id IS NULL
       OR ml.received_at<statement_timestamp()-interval '3 minutes'
       OR ml.recorded_at<statement_timestamp()-interval '3 minutes')
 ) gps ON true
 LEFT JOIN dsh.store_operational_availability soa ON soa.store_id=o.store_id
 LEFT JOIN dsh.customer_order_contact_reviews verification
   ON verification.order_id=o.id AND verification.state='NO_ANSWER'
      AND verification.attempt_count>=2
 LEFT JOIN LATERAL (
     SELECT e.id,e.created_at FROM dsh.customer_order_contact_events e
     WHERE e.order_id=o.id AND e.decision='NO_ANSWER'
     ORDER BY e.created_at DESC,e.id DESC LIMIT 1
 ) ce ON verification.order_id IS NOT NULL AND o.state NOT IN ('DELIVERED','PICKED_UP','REJECTED','CANCELLED')
 LEFT JOIN LATERAL (
     SELECT a.id,a.created_at FROM dsh.commerce_order_audit a
     WHERE a.order_id=o.id AND a.to_state='CREATED' AND a.event_type='order_created'
     ORDER BY a.created_at DESC,a.id DESC LIMIT 1
 ) cr ON o.state='CREATED'
 LEFT JOIN LATERAL (
     SELECT a.id,a.created_at FROM dsh.commerce_order_audit a
     WHERE a.order_id=o.id AND a.to_state='PARTNER_ACCEPTED' AND a.event_type='order_partner_accepted'
     ORDER BY a.created_at DESC,a.id DESC LIMIT 1
 ) aa ON o.state='PARTNER_ACCEPTED'
 LEFT JOIN LATERAL (
     SELECT a.id,a.created_at FROM dsh.commerce_order_audit a
     WHERE a.order_id=o.id AND a.to_state='PREPARING' AND a.event_type='order_preparing'
     ORDER BY a.created_at DESC,a.id DESC LIMIT 1
 ) pa ON o.state='PREPARING'
 LEFT JOIN LATERAL (
     SELECT a.id,a.created_at FROM dsh.commerce_order_audit a
     WHERE a.order_id=o.id AND a.to_state='READY_FOR_DISPATCH' AND a.event_type='order_ready_for_dispatch'
     ORDER BY a.created_at DESC,a.id DESC LIMIT 1
 ) rd ON o.state='READY_FOR_DISPATCH'
 LEFT JOIN LATERAL (
     SELECT a.id,a.created_at FROM dsh.captain_audit a
     WHERE a.order_id=o.id AND a.event_type='delivery_failed'
     ORDER BY a.created_at DESC,a.id DESC LIMIT 1
 ) ca ON o.state='DELIVERY_FAILED'
 WHERE (ce.id IS NOT NULL OR gps.assignment_id IS NOT NULL
       OR o.state='CREATED' AND cr.id IS NOT NULL
          AND cr.created_at <= statement_timestamp()-interval '30 minutes'
       OR o.state='PARTNER_ACCEPTED' AND aa.id IS NOT NULL
          AND aa.created_at <= statement_timestamp()-interval '30 minutes'
       OR o.state='PREPARING' AND pa.id IS NOT NULL
          AND pa.created_at <= statement_timestamp()-make_interval(mins => COALESCE(soa.preparation_minutes,30))
       OR o.state='READY_FOR_DISPATCH' AND o.fulfillment_mode='BTHWANI_CAPTAIN'
          AND rd.id IS NOT NULL AND rd.created_at <= statement_timestamp()-interval '5 minutes'
          AND NOT EXISTS (
            SELECT 1 FROM dsh.captain_dispatch_offers off
            WHERE off.order_id=o.id AND off.state='offered' AND off.expires_at>statement_timestamp()
          )
          AND NOT EXISTS (
            SELECT 1 FROM dsh.captain_assignments assignment
            WHERE assignment.order_id=o.id AND assignment.state IN ('assigned','in_custody')
          )
       OR o.state='DELIVERY_FAILED' AND ca.id IS NOT NULL)
   AND NOT EXISTS (
       SELECT 1 FROM dsh.operator_order_cases existing
       WHERE existing.order_id=o.id
         AND existing.reason=CASE WHEN ce.id IS NOT NULL THEN 'CUSTOMER_CONTACT'
        WHEN gps.assignment_id IS NOT NULL THEN 'CAPTAIN_LOCATION_LOST'
        WHEN o.state='CREATED' THEN 'OTHER'
                                  WHEN o.state IN ('PARTNER_ACCEPTED','PREPARING') THEN 'PARTNER_DELAY'
        WHEN o.state='READY_FOR_DISPATCH' THEN 'DISPATCH_UNAVAILABLE' ELSE 'DELIVERY_BLOCKED' END
         AND (existing.state <> 'RESOLVED'
             OR existing.opened_at >= CASE WHEN ce.id IS NOT NULL THEN ce.created_at
        WHEN gps.assignment_id IS NOT NULL THEN gps.alert_at
        WHEN o.state='CREATED' THEN cr.created_at
                                            WHEN o.state='PARTNER_ACCEPTED' THEN aa.created_at
                                            WHEN o.state='PREPARING' THEN pa.created_at
        WHEN o.state='READY_FOR_DISPATCH' THEN rd.created_at ELSE ca.created_at END)
   )
   AND NOT EXISTS (
       SELECT 1 FROM dsh.operator_order_case_events e
       WHERE e.idempotency_key='ops-auto-'||md5(
           CASE WHEN ce.id IS NOT NULL THEN 'CUSTOMER_NO_ANSWER:'||ce.id::text
        WHEN gps.assignment_id IS NOT NULL THEN 'MISSION_LOST:'||gps.assignment_id||':'||gps.alert_at::text
        WHEN o.state='CREATED' THEN 'CREATED:'||cr.id::text
                WHEN o.state='PARTNER_ACCEPTED' THEN 'PARTNER_ACCEPTED:'||aa.id::text
                WHEN o.state='PREPARING' THEN 'PREPARING:'||pa.id::text
        WHEN o.state='READY_FOR_DISPATCH' THEN 'READY_FOR_DISPATCH:'||rd.id::text
                ELSE 'DELIVERY_FAILED:'||ca.id::text END)
   )
 ORDER BY CASE WHEN ce.id IS NOT NULL THEN ce.created_at
        WHEN gps.assignment_id IS NOT NULL THEN gps.alert_at
        WHEN o.state='CREATED' THEN cr.created_at
                 WHEN o.state='PARTNER_ACCEPTED' THEN aa.created_at
                                            WHEN o.state='PREPARING' THEN pa.created_at
        WHEN o.state='READY_FOR_DISPATCH' THEN rd.created_at ELSE ca.created_at END,o.id
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
