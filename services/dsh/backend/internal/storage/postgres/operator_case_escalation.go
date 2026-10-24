package postgres

import (
	"context"
	"database/sql"
	"time"
)

// EscalateUnclaimedOperatorCases raises priority after the operational
// response window, but does not assign an employee or claim a contractual SLA.
// One transactional event is written for every durable state change.
func EscalateUnclaimedOperatorCases(ctx context.Context, db *sql.DB, limit int, minAge time.Duration) (int64, error) {
	if db == nil || limit < 1 || limit > 50 || minAge < time.Minute || minAge > 24*time.Hour {
		return 0, ErrOpsCaseInvalid
	}
	const query = `
WITH candidates AS MATERIALIZED (
 SELECT id FROM dsh.operator_order_cases
 WHERE state='OPEN' AND owner_actor_id IS NULL AND priority='NORMAL'
   AND opened_at <= statement_timestamp()-make_interval(secs=>$2::int)
 ORDER BY opened_at ASC,id ASC
 LIMIT $1
 FOR UPDATE SKIP LOCKED
), updated AS (
 UPDATE dsh.operator_order_cases c
 SET state='ACTION_REQUIRED',priority='URGENT',
     updated_by_actor_id='dsh:operations-detector',updated_at=clock_timestamp(),
     version=version+1
 WHERE c.id IN (SELECT id FROM candidates)
 RETURNING c.id,c.next_action
), events AS (
 INSERT INTO dsh.operator_order_case_events
 (case_id,action,actor_id,idempotency_key,request_hash,correlation_id,detail)
 SELECT u.id,'ACTION_REQUIRED','dsh:operations-detector',
        'ops-escalation-'||u.id::text,
        md5('UNASSIGNED:'||u.id::text),
        'ops-escalation-'||u.id::text,
        'حالة تشغيلية لم يستلمها موظف خلال مدة المتابعة؛ أولوية عاجلة. الإجراء المطلوب: '||u.next_action
 FROM updated u
 RETURNING id
)
SELECT count(*)::bigint FROM events`
	var count int64
	err := db.QueryRowContext(ctx, query, limit, int(minAge/time.Second)).Scan(&count)
	return count, err
}
