CREATE TABLE dsh.commercial_store_types (
    id text PRIMARY KEY,
    vertical_id text NOT NULL,
    name_ar text NOT NULL,
    name_en text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT commercial_store_types_id_chk CHECK (id ~ '^[a-z0-9][a-z0-9_-]{1,127}$'),
    CONSTRAINT commercial_store_types_name_ar_chk CHECK (char_length(btrim(name_ar)) BETWEEN 2 AND 160),
    CONSTRAINT commercial_store_types_name_en_chk CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 160),
    CONSTRAINT commercial_store_types_version_chk CHECK (version > 0),
    CONSTRAINT commercial_store_types_vertical_fk FOREIGN KEY (vertical_id) REFERENCES dsh.commerce_verticals(id) ON DELETE RESTRICT,
    CONSTRAINT commercial_store_types_id_vertical_uq UNIQUE (id, vertical_id)
);

CREATE UNIQUE INDEX commercial_store_types_vertical_name_en_uq
    ON dsh.commercial_store_types(vertical_id, lower(btrim(name_en)));
CREATE INDEX commercial_store_types_active_registry_idx
    ON dsh.commercial_store_types(vertical_id, active, lower(name_en), id);

ALTER TABLE dsh.catalog_registry_mutation_idempotency
    DROP CONSTRAINT catalog_registry_mutation_entity_chk,
    ADD CONSTRAINT catalog_registry_mutation_entity_chk
        CHECK (entity_type IN ('vertical', 'category', 'attribute_rule', 'commercial_store_type'));
ALTER TABLE dsh.catalog_registry_audit_events
    DROP CONSTRAINT catalog_registry_audit_entity_chk,
    ADD CONSTRAINT catalog_registry_audit_entity_chk
        CHECK (entity_type IN ('vertical', 'category', 'attribute_rule', 'commercial_store_type'));

ALTER TABLE dsh.joining_cases
    ADD COLUMN first_store_commercial_type_id text,
    ADD CONSTRAINT joining_cases_first_store_commercial_type_fk
        FOREIGN KEY (first_store_commercial_type_id, first_store_vertical_id)
        REFERENCES dsh.commercial_store_types(id, vertical_id) ON DELETE RESTRICT;

ALTER TABLE dsh.stores
    ADD COLUMN commercial_store_type_id text,
    ADD CONSTRAINT stores_commercial_type_vertical_fk
        FOREIGN KEY (commercial_store_type_id, primary_vertical_id)
        REFERENCES dsh.commercial_store_types(id, vertical_id) ON DELETE RESTRICT;

CREATE INDEX stores_commercial_type_idx ON dsh.stores(commercial_store_type_id, publication_state, id);

CREATE FUNCTION dsh.require_new_commercial_store_type() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.first_store_commercial_type_id IS NULL THEN
        RAISE EXCEPTION 'first store commercial type is required' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER joining_cases_require_commercial_type
    BEFORE INSERT OR UPDATE OF first_store_commercial_type_id ON dsh.joining_cases
    FOR EACH ROW EXECUTE FUNCTION dsh.require_new_commercial_store_type();

CREATE FUNCTION dsh.require_new_store_commercial_type() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.commercial_store_type_id IS NULL THEN
        RAISE EXCEPTION 'store commercial type is required' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER stores_require_commercial_type
    BEFORE INSERT OR UPDATE OF commercial_store_type_id ON dsh.stores
    FOR EACH ROW EXECUTE FUNCTION dsh.require_new_store_commercial_type();
