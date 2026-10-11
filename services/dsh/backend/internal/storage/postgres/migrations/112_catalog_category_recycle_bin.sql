-- Category deletion remains distinct from disabling; do not cascade into products, media or order facts.
ALTER TABLE dsh.catalog_categories
    ADD COLUMN deleted_at timestamptz,
    ADD COLUMN deleted_by text,
    ADD COLUMN deletion_reason text,
    ADD CONSTRAINT catalog_category_deletion_facts_chk CHECK (
        (deleted_at IS NULL AND deleted_by IS NULL AND deletion_reason IS NULL)
        OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND char_length(btrim(deletion_reason)) BETWEEN 5 AND 500 AND active=false)
    );
CREATE INDEX catalog_categories_trash_idx ON dsh.catalog_categories(deleted_at DESC,id DESC) WHERE deleted_at IS NOT NULL;
CREATE TABLE dsh.catalog_category_trash_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idempotency_key text NOT NULL UNIQUE,
    category_id text NOT NULL REFERENCES dsh.catalog_categories(id) ON DELETE RESTRICT,
    actor_id text NOT NULL,
    action text NOT NULL CHECK (action IN ('trash','restore')),
    reason text NOT NULL,
    expected_version integer NOT NULL CHECK (expected_version > 0),
    result_version integer NOT NULL CONSTRAINT catalog_category_trash_result_version_chk CHECK (result_version=expected_version+1),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX catalog_category_trash_audit_category_idx ON dsh.catalog_category_trash_audit(category_id,created_at DESC);
