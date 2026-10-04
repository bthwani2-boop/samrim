ALTER TABLE dsh.catalog_product_proposals
    ALTER COLUMN partner_actor_id DROP NOT NULL,
    ADD COLUMN submitter_role text NOT NULL DEFAULT 'PARTNER',
    ADD COLUMN submitter_actor_id text,
    ADD COLUMN joining_case_id text;

UPDATE dsh.catalog_product_proposals
SET submitter_actor_id=partner_actor_id;

ALTER TABLE dsh.catalog_product_proposals
    ALTER COLUMN submitter_actor_id SET NOT NULL,
    ADD CONSTRAINT catalog_product_proposals_submitter_role_chk
        CHECK (submitter_role IN ('PARTNER','FIELD')),
    ADD CONSTRAINT catalog_product_proposals_submitter_facts_chk
        CHECK (
            (submitter_role='PARTNER' AND partner_actor_id=submitter_actor_id AND joining_case_id IS NULL)
            OR (submitter_role='FIELD' AND partner_actor_id IS NULL AND joining_case_id IS NOT NULL)
        ),
    ADD CONSTRAINT catalog_product_proposals_joining_case_fk
        FOREIGN KEY (joining_case_id) REFERENCES dsh.joining_cases(id) ON DELETE RESTRICT;

DROP INDEX dsh.catalog_product_proposals_partner_idx;
CREATE INDEX catalog_product_proposals_submitter_idx
    ON dsh.catalog_product_proposals(submitter_role,submitter_actor_id,joining_case_id,state,created_at DESC,id DESC);
