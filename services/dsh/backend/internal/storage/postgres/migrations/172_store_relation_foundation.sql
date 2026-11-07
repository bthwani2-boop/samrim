-- Preserve existing partner Stores and their marketplace agreement snapshots.
-- This column does not enable independent checkout or public publication.
ALTER TABLE dsh.stores
    ADD COLUMN relation_model text NOT NULL DEFAULT 'BTHWANI_PARTNER';

ALTER TABLE dsh.stores
    ADD CONSTRAINT stores_relation_model_chk
        CHECK (relation_model IN ('BTHWANI_PARTNER', 'INDEPENDENT_STORE')),
    ADD CONSTRAINT stores_independent_market_publication_chk
        CHECK (relation_model = 'BTHWANI_PARTNER' OR publication_state <> 'published');

-- Independent Stores remain ineligible for the existing marketplace publication
-- flow until a separately admitted, owner-backed web-only publication path exists.
