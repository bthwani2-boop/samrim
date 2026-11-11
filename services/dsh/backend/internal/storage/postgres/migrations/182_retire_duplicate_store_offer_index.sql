-- Migration 069 created the same (store_id, created_at, id) index that
-- migration 010 already owned. Preserve the original index and retire only
-- the redundant registry index; Offer rows and their keys are untouched.
DROP INDEX dsh.catalog_store_offers_store_created_registry_idx;
