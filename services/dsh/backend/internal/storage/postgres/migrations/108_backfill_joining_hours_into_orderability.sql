-- Correct legacy, untouched system defaults only. A Partner/Operator schedule,
-- pause, or mode override is never rewritten by this migration.
WITH eligible AS MATERIALIZED (
    SELECT a.store_id, s.business_working_hours
    FROM dsh.store_operational_availability a
    JOIN dsh.stores s ON s.id = a.store_id
    WHERE a.schedule_mode = 'ALWAYS_OPEN'
      AND a.weekly_schedule = '[]'::jsonb
      AND a.paused = false
      AND a.unavailable_fulfillment_modes = ARRAY[]::text[]
      AND a.updated_by_actor_id IN (
          'system:migration:085', 'system:lazy-initialize', 'system:checkout-initialize'
      )
      AND jsonb_typeof(s.business_working_hours->'intervals') = 'array'
      AND jsonb_array_length(s.business_working_hours->'intervals') BETWEEN 1 AND 28
      AND NOT EXISTS (
          SELECT 1 FROM dsh.store_operational_availability_audit history
          WHERE history.store_id = a.store_id
      )
), intervals AS MATERIALIZED (
    SELECT e.store_id,
           i."dayOfWeek" % 7 AS day_number,
           i."opensAt" AS opens_at,
           i."closesAt" AS closes_at,
           COALESCE(i."closesNextDay", false) AS next_day
    FROM eligible e
    CROSS JOIN LATERAL jsonb_to_recordset(e.business_working_hours->'intervals')
        AS i("dayOfWeek" integer, "opensAt" text, "closesAt" text, "closesNextDay" boolean)
    WHERE i."dayOfWeek" BETWEEN 1 AND 7
      AND i."opensAt" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      AND i."closesAt" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
), parsed AS MATERIALIZED (
    SELECT store_id, day_number, next_day,
      split_part(opens_at, ':', 1)::integer * 60 + split_part(opens_at, ':', 2)::integer AS start_minute,
      split_part(closes_at, ':', 1)::integer * 60 + split_part(closes_at, ':', 2)::integer AS end_minute
    FROM intervals
), valid_stores AS MATERIALIZED (
    SELECT p.store_id
    FROM parsed p
    JOIN eligible e ON e.store_id = p.store_id
    GROUP BY p.store_id, e.business_working_hours
    HAVING count(*) = jsonb_array_length(e.business_working_hours->'intervals')
       AND bool_and(CASE WHEN p.next_day
           THEN p.end_minute <= p.start_minute
           ELSE p.end_minute > p.start_minute END)
), windows AS (
    SELECT p.store_id, day_number, start_minute AS opens_at_minute,
           CASE WHEN next_day THEN 1440 ELSE end_minute END AS closes_at_minute
    FROM parsed p JOIN valid_stores v ON v.store_id=p.store_id
    WHERE next_day OR end_minute > start_minute
    UNION ALL
    SELECT p.store_id, (day_number + 1) % 7, 0, end_minute
    FROM parsed p JOIN valid_stores v ON v.store_id=p.store_id
    WHERE next_day AND end_minute > 0
), overlapping AS (
    SELECT store_id FROM (
        SELECT store_id, opens_at_minute,
           lag(closes_at_minute) OVER (
               PARTITION BY store_id,day_number ORDER BY opens_at_minute,closes_at_minute
           ) AS preceding_close
        FROM windows
    ) ordered
    WHERE preceding_close > opens_at_minute
), schedules AS (
    SELECT store_id,
           jsonb_agg(jsonb_build_object(
             'dayOfWeek', day_number, 'opensAtMinute', opens_at_minute,
             'closesAtMinute', closes_at_minute
           ) ORDER BY day_number, opens_at_minute, closes_at_minute) AS schedule
    FROM windows
    WHERE closes_at_minute > opens_at_minute
      AND NOT EXISTS (SELECT 1 FROM overlapping o WHERE o.store_id = windows.store_id)
    GROUP BY store_id
)
UPDATE dsh.store_operational_availability a
SET schedule_mode = 'WEEKLY', weekly_schedule = s.schedule, version = a.version + 1,
    updated_by_actor_id = 'system:joining-hours-backfill', updated_at = clock_timestamp()
FROM schedules s
WHERE a.store_id = s.store_id
  AND jsonb_array_length(s.schedule) > 0
  AND a.schedule_mode = 'ALWAYS_OPEN'
  AND a.updated_by_actor_id IN (
      'system:migration:085', 'system:lazy-initialize', 'system:checkout-initialize'
  );
