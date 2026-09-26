ALTER TABLE dsh.catalog_product_proposals
    ADD COLUMN proposed_attribute_values jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN proposed_variant_attribute_values jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD CONSTRAINT catalog_product_proposal_attribute_values_array_chk CHECK (jsonb_typeof(proposed_attribute_values) = 'array'),
    ADD CONSTRAINT catalog_product_proposal_variant_attribute_values_array_chk CHECK (jsonb_typeof(proposed_variant_attribute_values) = 'array');
