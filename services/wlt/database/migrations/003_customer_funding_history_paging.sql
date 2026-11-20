-- The immutable journal remains the source for bounded keyset history reads.
-- Index-only schema change; no financial data or historical postings rewritten.
BEGIN;
DO $isolation$
BEGIN
    IF current_database() <> 'bthwani_wlt_test' OR current_user <> 'bthwani_wlt_owner' THEN
        RAISE EXCEPTION 'WLT development migration requires the isolated owner';
    END IF;
END;
$isolation$;

CREATE INDEX customer_funding_history_page_idx
    ON wlt.customer_funding_journal (actor_id, posted_at DESC, funding_id DESC);
COMMIT;
