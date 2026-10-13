-- Operator partner/store directory: bounded keyset pages, with trigram-backed
-- contains searches by store name, onboarding owner and registered phone.
CREATE INDEX stores_operator_active_name_search_idx
    ON dsh.stores USING gin (name gin_trgm_ops)
    WHERE deleted_at IS NULL;

CREATE INDEX joining_cases_operator_owner_search_idx
    ON dsh.joining_cases USING gin (owner_full_name gin_trgm_ops)
    WHERE partner_actor_id IS NOT NULL;

CREATE INDEX joining_cases_operator_contact_search_idx
    ON dsh.joining_cases USING gin (contact_phone_e164 gin_trgm_ops)
    WHERE partner_actor_id IS NOT NULL;
