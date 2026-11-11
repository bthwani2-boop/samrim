-- Preserve historical migration 040. Successful and failed child outcomes are
-- mutually exclusive; the combined count must never exceed the parent size.
ALTER TABLE dsh.commerce_multi_store_checkouts
    ADD CONSTRAINT commerce_multi_store_checkouts_total_count_chk
        CHECK (successful_child_count <= child_count - failed_child_count);

-- The unique index on (checkout_id, child_index) already supports the
-- same lookup prefix. Keep it and retire the duplicate nonunique index.
DROP INDEX dsh.commerce_multi_store_checkout_children_checkout_idx;
