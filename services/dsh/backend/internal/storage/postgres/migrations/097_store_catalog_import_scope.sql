ALTER TABLE dsh.catalog_import_runs
    ADD COLUMN purpose text NOT NULL DEFAULT 'PRODUCTS',
    ADD COLUMN actor_role text NOT NULL DEFAULT 'OPERATOR',
    ADD COLUMN store_id text,
    ADD COLUMN joining_case_id text,
    ADD CONSTRAINT catalog_import_runs_purpose_chk
        CHECK (purpose IN ('PRODUCTS','STORE_OFFERS')),
    ADD CONSTRAINT catalog_import_runs_actor_role_chk
        CHECK (actor_role IN ('OPERATOR','PARTNER','FIELD')),
    ADD CONSTRAINT catalog_import_runs_scope_chk
        CHECK (
            (purpose='PRODUCTS' AND actor_role='OPERATOR' AND store_id IS NULL AND joining_case_id IS NULL)
            OR
            (purpose='STORE_OFFERS' AND store_id IS NOT NULL AND (
                (actor_role='FIELD' AND joining_case_id IS NOT NULL)
                OR (actor_role IN ('PARTNER','OPERATOR') AND joining_case_id IS NULL)
            ))
        ),
    ADD CONSTRAINT catalog_import_runs_store_fk
        FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT,
    ADD CONSTRAINT catalog_import_runs_joining_case_fk
        FOREIGN KEY (joining_case_id) REFERENCES dsh.joining_cases(id) ON DELETE RESTRICT;

DROP INDEX dsh.catalog_import_runs_source_mode_uq;
CREATE UNIQUE INDEX catalog_import_runs_source_mode_uq
    ON dsh.catalog_import_runs(source_sha256,mode,purpose,COALESCE(store_id,''));

ALTER TABLE dsh.catalog_import_run_items
    DROP CONSTRAINT catalog_import_run_items_classification_chk,
    ADD CONSTRAINT catalog_import_run_items_classification_chk
        CHECK (classification IN ('READY','NEEDS_REVIEW','DUPLICATE_INPUT','DUPLICATE_EXISTING','CONFLICT_EXISTING','INVALID_INPUT','IMPORTED','REPLAYED','FAILED'));
