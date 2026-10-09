ALTER TABLE dsh.catalog_attribute_enum_options
    ADD COLUMN version integer NOT NULL DEFAULT 1,
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    ADD CONSTRAINT catalog_attribute_enum_options_version_chk CHECK (version > 0);

ALTER TABLE dsh.catalog_registry_audit_events
    DROP CONSTRAINT catalog_registry_audit_entity_chk,
    ADD CONSTRAINT catalog_registry_audit_entity_chk CHECK (entity_type IN (
        'vertical', 'category', 'attribute_rule', 'commercial_store_type', 'store_type_assignment',
        'attribute_definition', 'attribute_enum_option'
    ));
