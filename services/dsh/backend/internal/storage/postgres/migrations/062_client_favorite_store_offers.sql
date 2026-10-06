-- Client favorites keep explicit intent tied to the StoreOffer whose price and availability the customer saw.
-- Identity owns customer identity; DSH owns the offer-scoped favorite and its mutation history.
CREATE TABLE dsh.client_favorite_store_offers (
    client_actor_id text NOT NULL,
    store_offer_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT client_favorite_store_offers_pkey PRIMARY KEY (client_actor_id, store_offer_id),
    CONSTRAINT client_favorite_store_offers_actor_chk CHECK (length(btrim(client_actor_id)) > 0),
    CONSTRAINT client_favorite_store_offers_offer_fk
        FOREIGN KEY (store_offer_id) REFERENCES dsh.catalog_store_offers(id) ON DELETE CASCADE
);

CREATE INDEX client_favorite_store_offers_client_idx
    ON dsh.client_favorite_store_offers(client_actor_id, created_at DESC, store_offer_id);

CREATE TABLE dsh.client_favorite_store_offer_mutation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    client_actor_id text NOT NULL,
    store_offer_id text NOT NULL,
    operation text NOT NULL,
    result_is_favorite boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT client_favorite_store_offer_idempotency_facts_uq
        UNIQUE (idempotency_key, request_hash, client_actor_id, store_offer_id, operation),
    CONSTRAINT client_favorite_store_offer_idempotency_actor_chk CHECK (length(btrim(client_actor_id)) > 0),
    CONSTRAINT client_favorite_store_offer_idempotency_operation_chk CHECK (operation IN ('add', 'remove')),
    CONSTRAINT client_favorite_store_offer_idempotency_offer_fk
        FOREIGN KEY (store_offer_id) REFERENCES dsh.catalog_store_offers(id) ON DELETE CASCADE
);

CREATE INDEX client_favorite_store_offer_idempotency_client_idx
    ON dsh.client_favorite_store_offer_mutation_idempotency(client_actor_id, created_at DESC);

CREATE TABLE dsh.client_favorite_store_offer_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    client_actor_id text NOT NULL,
    store_offer_id text NOT NULL,
    result_is_favorite boolean NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT client_favorite_store_offer_audit_event_type_chk
        CHECK (event_type IN ('client_store_offer_favorited', 'client_store_offer_unfavorited')),
    CONSTRAINT client_favorite_store_offer_audit_event_idempotency_uq
        UNIQUE (event_type, idempotency_key),
    CONSTRAINT client_favorite_store_offer_audit_actor_chk CHECK (length(btrim(client_actor_id)) > 0),
    CONSTRAINT client_favorite_store_offer_audit_offer_fk
        FOREIGN KEY (store_offer_id) REFERENCES dsh.catalog_store_offers(id) ON DELETE CASCADE
);

CREATE INDEX client_favorite_store_offer_audit_client_idx
    ON dsh.client_favorite_store_offer_audit(client_actor_id, created_at DESC);
