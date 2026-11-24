-- Fresh, disposable DSH schema. Owner: products, variants, offers, editable draft commands.
-- __SCHEMA__ requires a validated isolated test schema; never overlay retained data.
CREATE TABLE IF NOT EXISTS __SCHEMA__.products (
    id text PRIMARY KEY,
    store_id text NOT NULL REFERENCES __SCHEMA__.stores(id),
    name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
    active boolean NOT NULL DEFAULT false,
    UNIQUE (id,store_id)
);
CREATE TABLE IF NOT EXISTS __SCHEMA__.variants (
    id text PRIMARY KEY,
    product_id text NOT NULL REFERENCES __SCHEMA__.products(id),
    sellable boolean NOT NULL DEFAULT false,
    required_attributes_valid boolean NOT NULL DEFAULT false,
    UNIQUE (id,product_id)
);
CREATE TABLE IF NOT EXISTS __SCHEMA__.offers (
    id text PRIMARY KEY,
    store_id text NOT NULL,
    product_id text NOT NULL,
    variant_id text NOT NULL,
    published boolean NOT NULL DEFAULT false,
    available boolean NOT NULL DEFAULT false,
    price_yer bigint NOT NULL CHECK (price_yer >= 0),
    stock_units integer NOT NULL CHECK (stock_units >= 0),
    draft_version bigint NOT NULL DEFAULT 1 CHECK (draft_version >= 1),
    FOREIGN KEY (product_id,store_id) REFERENCES __SCHEMA__.products(id,store_id),
    FOREIGN KEY (variant_id,product_id) REFERENCES __SCHEMA__.variants(id,product_id)
);
CREATE INDEX IF NOT EXISTS idx_public_offers ON __SCHEMA__.offers(store_id,id) WHERE published AND available;

CREATE UNIQUE INDEX IF NOT EXISTS customer_cart_offer_store_reference
    ON __SCHEMA__.offers(id, store_id);


CREATE TABLE IF NOT EXISTS __SCHEMA__.catalog_draft_commands (
    actor_id text NOT NULL CHECK (char_length(trim(actor_id)) BETWEEN 1 AND 128),
    operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9._-]{8,128}$'),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    store_id text NOT NULL REFERENCES __SCHEMA__.stores(id) ON DELETE RESTRICT,
    offer_id text NOT NULL UNIQUE REFERENCES __SCHEMA__.offers(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_id,operation_id)
);
CREATE OR REPLACE FUNCTION __SCHEMA__.reject_catalog_draft_command_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'DSH catalog draft commands are immutable';
END
$$;
DROP TRIGGER IF EXISTS trg_catalog_draft_commands_immutable ON __SCHEMA__.catalog_draft_commands;
CREATE TRIGGER trg_catalog_draft_commands_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.catalog_draft_commands
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_catalog_draft_command_rewrite();

CREATE TABLE IF NOT EXISTS __SCHEMA__.catalog_draft_edit_commands (
    actor_id text NOT NULL CHECK (char_length(trim(actor_id)) BETWEEN 1 AND 128),
    operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9._-]{8,128}$'),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    store_id text NOT NULL REFERENCES __SCHEMA__.stores(id) ON DELETE RESTRICT,
    offer_id text NOT NULL,
    expected_version bigint NOT NULL CHECK (expected_version >= 1),
    result_version bigint NOT NULL CHECK (result_version = expected_version + 1),
    old_name text NOT NULL CHECK (char_length(trim(old_name)) BETWEEN 1 AND 160),
    old_price_yer bigint NOT NULL CHECK (old_price_yer >= 0),
    old_stock_units integer NOT NULL CHECK (old_stock_units >= 0),
    result_name text NOT NULL CHECK (char_length(trim(result_name)) BETWEEN 1 AND 160),
    result_price_yer bigint NOT NULL CHECK (result_price_yer > 0),
    result_stock_units integer NOT NULL CHECK (result_stock_units >= 0),
    committed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_id,operation_id),
    UNIQUE (offer_id,result_version),
    UNIQUE (actor_id,store_id,offer_id,result_version),
    FOREIGN KEY (offer_id,store_id) REFERENCES __SCHEMA__.offers(id,store_id) ON DELETE RESTRICT
);
CREATE OR REPLACE FUNCTION __SCHEMA__.reject_catalog_draft_edit_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'DSH catalog draft edits are immutable';
END
$$;
DROP TRIGGER IF EXISTS trg_catalog_draft_edit_immutable ON __SCHEMA__.catalog_draft_edit_commands;
CREATE TRIGGER trg_catalog_draft_edit_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.catalog_draft_edit_commands
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_catalog_draft_edit_rewrite();

-- Confirmed, immutable CSV manifest and per-row receipts. A run can be
-- resumed in bounded transactions; edits are recorded by the existing writer.
CREATE TABLE IF NOT EXISTS __SCHEMA__.catalog_import_runs (
    actor_id text NOT NULL CHECK (char_length(trim(actor_id)) BETWEEN 1 AND 128),
    run_id text NOT NULL CHECK (run_id ~ '^[A-Za-z0-9._-]{8,128}$'),
    store_id text NOT NULL REFERENCES __SCHEMA__.stores(id) ON DELETE RESTRICT,
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object' AND
        manifest ? 'sourceSha256' AND jsonb_typeof(manifest->'sourceSha256') = 'string' AND
        manifest->>'sourceSha256' ~ '^[a-f0-9]{64}$' AND manifest ? 'rows' AND
        jsonb_typeof(manifest->'rows') = 'array' AND jsonb_array_length(manifest->'rows') BETWEEN 1 AND 5000),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_id,run_id),
    UNIQUE (actor_id,run_id,store_id)
);
CREATE TABLE IF NOT EXISTS __SCHEMA__.catalog_import_outcomes (
    actor_id text NOT NULL,
    run_id text NOT NULL,
    store_id text NOT NULL,
    row_number integer NOT NULL CHECK (row_number BETWEEN 2 AND 5001),
    status text NOT NULL CHECK (status IN ('ACCEPTED','HELD','FAILED')),
    reason text NOT NULL CHECK (reason IN ('UPDATED','UNSELECTED','DUPLICATE','INVALID_VALUES','AMBIGUOUS_OR_CHANGED','INELIGIBLE','STALE_VERSION_OR_NAME','OPERATION_CONFLICT')),
    offer_id text REFERENCES __SCHEMA__.offers(id) ON DELETE RESTRICT,
    result_version bigint,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (actor_id,run_id,row_number),
    FOREIGN KEY (actor_id,run_id,store_id) REFERENCES __SCHEMA__.catalog_import_runs(actor_id,run_id,store_id) ON DELETE RESTRICT,
    FOREIGN KEY (actor_id,store_id,offer_id,result_version) REFERENCES __SCHEMA__.catalog_draft_edit_commands(actor_id,store_id,offer_id,result_version) ON DELETE RESTRICT,
    CHECK ((status='ACCEPTED' AND reason='UPDATED' AND offer_id IS NOT NULL AND result_version IS NOT NULL AND result_version >= 2)
        OR (status='FAILED' AND reason='OPERATION_CONFLICT' AND offer_id IS NULL AND result_version IS NULL)
        OR (status='HELD' AND reason NOT IN ('UPDATED','OPERATION_CONFLICT') AND offer_id IS NULL AND result_version IS NULL))
);
DROP TRIGGER IF EXISTS trg_catalog_import_runs_immutable ON __SCHEMA__.catalog_import_runs;
CREATE TRIGGER trg_catalog_import_runs_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.catalog_import_runs
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_catalog_draft_edit_rewrite();
DROP TRIGGER IF EXISTS trg_catalog_import_outcomes_immutable ON __SCHEMA__.catalog_import_outcomes;
CREATE TRIGGER trg_catalog_import_outcomes_immutable
BEFORE UPDATE OR DELETE ON __SCHEMA__.catalog_import_outcomes
FOR EACH ROW EXECUTE FUNCTION __SCHEMA__.reject_catalog_draft_edit_rewrite();
