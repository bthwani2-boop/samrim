-- A created order can be attributed to one discovery item only.
-- Preserve historical evidence: fail closed for legacy duplicates, requiring
-- explicit reconciliation rather than silently deleting or rewriting events.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM dsh.discovery_content_events
        WHERE event_type = 'CONVERSION' AND order_id IS NOT NULL
        GROUP BY order_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'DISCOVERY_CONVERSION_DUPLICATE_ORDERS: reconcile historical attribution before enforcing unique conversion order';
    END IF;
END
$$;

CREATE UNIQUE INDEX discovery_content_events_unique_conversion_order_uq
    ON dsh.discovery_content_events(order_id)
    WHERE event_type = 'CONVERSION';

DROP INDEX dsh.discovery_content_events_conversion_order_uq;
