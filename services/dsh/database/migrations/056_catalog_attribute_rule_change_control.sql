ALTER TABLE dsh.catalog_registry_mutation_idempotency
    DROP CONSTRAINT catalog_registry_mutation_entity_chk,
    ADD CONSTRAINT catalog_registry_mutation_entity_chk CHECK (entity_type IN ('vertical', 'category', 'attribute_rule'));
