ALTER TABLE dsh.commerce_orders
    DROP CONSTRAINT commerce_orders_state_chk;

ALTER TABLE dsh.commerce_orders
    ADD CONSTRAINT commerce_orders_state_chk
    CHECK (state IN ('CREATED', 'PARTNER_ACCEPTED', 'PREPARING', 'READY_FOR_DISPATCH', 'CAPTAIN_ASSIGNED', 'IN_CUSTODY', 'DELIVERED', 'DELIVERY_FAILED', 'REJECTED'));

CREATE TABLE dsh.captain_admissions (
    id text PRIMARY KEY,
    actor_id text UNIQUE,
    contact_phone_e164 text,
    state text NOT NULL DEFAULT 'pending_identity',
    availability_state text NOT NULL DEFAULT 'unavailable',
    version integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT captain_admissions_state_chk CHECK (state IN ('pending_identity', 'eligible', 'suspended', 'terminated')),
    CONSTRAINT captain_admissions_availability_chk CHECK (availability_state IN ('available', 'unavailable')),
    CONSTRAINT captain_admissions_version_chk CHECK (version > 0),
    CONSTRAINT captain_admissions_phone_chk CHECK (contact_phone_e164 IS NULL OR contact_phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
    CONSTRAINT captain_admissions_identity_state_chk CHECK ((state = 'pending_identity' AND actor_id IS NULL AND contact_phone_e164 IS NOT NULL) OR (state <> 'pending_identity' AND actor_id IS NOT NULL AND contact_phone_e164 IS NULL)),
    CONSTRAINT captain_admissions_pending_availability_chk CHECK (state <> 'pending_identity' OR availability_state = 'unavailable')
);
CREATE UNIQUE INDEX captain_admissions_pending_phone_uq
    ON dsh.captain_admissions(contact_phone_e164)
    WHERE state = 'pending_identity';
CREATE INDEX captain_admissions_dispatch_idx
    ON dsh.captain_admissions(state, availability_state, updated_at, actor_id);

CREATE TABLE dsh.captain_admission_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    admission_id text NOT NULL,
    operation text NOT NULL,
    result_version integer NOT NULL,
    result_state text NOT NULL,
    result_actor_id text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT captain_admission_idempotency_facts_uq UNIQUE (idempotency_key, request_hash, admission_id, operation),
    CONSTRAINT captain_admission_idempotency_operation_chk CHECK (operation = 'create'),
    CONSTRAINT captain_admission_idempotency_state_chk CHECK (result_state IN ('pending_identity', 'eligible', 'suspended', 'terminated')),
    CONSTRAINT captain_admission_idempotency_version_chk CHECK (result_version > 0),
    CONSTRAINT captain_admission_idempotency_admission_fk FOREIGN KEY (admission_id) REFERENCES dsh.captain_admissions(id) ON DELETE RESTRICT
);
CREATE INDEX captain_admission_idempotency_admission_idx
    ON dsh.captain_admission_idempotency(admission_id, created_at DESC);

CREATE TABLE dsh.captain_admission_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    admission_id text NOT NULL,
    actor_id text,
    from_state text,
    to_state text NOT NULL,
    from_version integer,
    result_version integer NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT captain_admission_audit_event_type_chk CHECK (event_type IN ('captain_admission_created', 'captain_admission_bound', 'captain_admission_suspended', 'captain_admission_restored', 'captain_availability_changed')),
    CONSTRAINT captain_admission_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT captain_admission_audit_admission_fk FOREIGN KEY (admission_id) REFERENCES dsh.captain_admissions(id) ON DELETE RESTRICT,
    CONSTRAINT captain_admission_audit_version_chk CHECK (result_version > 0)
);
CREATE INDEX captain_admission_audit_admission_idx
    ON dsh.captain_admission_audit(admission_id, created_at DESC);

CREATE TABLE dsh.captain_dispatch_offers (
    id text PRIMARY KEY,
    order_id text NOT NULL,
    captain_actor_id text NOT NULL,
    state text NOT NULL DEFAULT 'offered',
    expires_at timestamptz NOT NULL,
    version integer NOT NULL DEFAULT 1,
    idempotency_key text NOT NULL UNIQUE,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT captain_dispatch_offers_state_chk CHECK (state IN ('offered', 'accepted', 'rejected', 'expired', 'superseded')),
    CONSTRAINT captain_dispatch_offers_version_chk CHECK (version > 0),
    CONSTRAINT captain_dispatch_offers_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX captain_dispatch_offers_order_active_uq
    ON dsh.captain_dispatch_offers(order_id)
    WHERE state = 'offered';
CREATE INDEX captain_dispatch_offers_captain_idx
    ON dsh.captain_dispatch_offers(captain_actor_id, state, expires_at, created_at DESC);
CREATE UNIQUE INDEX captain_dispatch_offers_captain_active_uq
    ON dsh.captain_dispatch_offers(captain_actor_id)
    WHERE state = 'offered';
CREATE INDEX captain_dispatch_offers_order_idx
    ON dsh.captain_dispatch_offers(order_id, created_at DESC);

CREATE TABLE dsh.captain_assignments (
    id text PRIMARY KEY,
    order_id text NOT NULL,
    captain_actor_id text NOT NULL,
    accepted_offer_id text NOT NULL UNIQUE,
    state text NOT NULL DEFAULT 'assigned',
    version integer NOT NULL DEFAULT 1,
    custody_started_at timestamptz,
    terminal_result text,
    terminal_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT captain_assignments_state_chk CHECK (state IN ('assigned', 'in_custody', 'delivered', 'delivery_failed', 'reassigned')),
    CONSTRAINT captain_assignments_result_chk CHECK ((state IN ('delivered', 'delivery_failed') AND terminal_result IS NOT NULL AND terminal_at IS NOT NULL) OR (state NOT IN ('delivered', 'delivery_failed') AND terminal_result IS NULL AND terminal_at IS NULL)),
    CONSTRAINT captain_assignments_custody_chk CHECK ((state IN ('in_custody', 'delivered', 'delivery_failed') AND custody_started_at IS NOT NULL) OR (state IN ('assigned', 'reassigned') AND custody_started_at IS NULL)),
    CONSTRAINT captain_assignments_version_chk CHECK (version > 0),
    CONSTRAINT captain_assignments_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
    CONSTRAINT captain_assignments_offer_fk FOREIGN KEY (accepted_offer_id) REFERENCES dsh.captain_dispatch_offers(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX captain_assignments_order_active_uq
    ON dsh.captain_assignments(order_id)
    WHERE state IN ('assigned', 'in_custody');
CREATE UNIQUE INDEX captain_assignments_captain_active_uq
    ON dsh.captain_assignments(captain_actor_id)
    WHERE state IN ('assigned', 'in_custody');
CREATE INDEX captain_assignments_captain_idx
    ON dsh.captain_assignments(captain_actor_id, state, updated_at DESC);
CREATE INDEX captain_assignments_order_idx
    ON dsh.captain_assignments(order_id, created_at DESC);

CREATE TABLE dsh.captain_handoffs (
    assignment_id text PRIMARY KEY,
    order_id text NOT NULL,
    store_id text NOT NULL,
    state text NOT NULL DEFAULT 'pending',
    version integer NOT NULL DEFAULT 1,
    store_confirmed_at timestamptz,
    captain_picked_up_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT captain_handoffs_state_chk CHECK (state IN ('pending', 'store_confirmed', 'completed', 'superseded')),
    CONSTRAINT captain_handoffs_confirmation_chk CHECK ((state = 'pending' AND store_confirmed_at IS NULL AND captain_picked_up_at IS NULL) OR (state = 'store_confirmed' AND store_confirmed_at IS NOT NULL AND captain_picked_up_at IS NULL) OR (state = 'completed' AND store_confirmed_at IS NOT NULL AND captain_picked_up_at IS NOT NULL) OR state = 'superseded'),
    CONSTRAINT captain_handoffs_version_chk CHECK (version > 0),
    CONSTRAINT captain_handoffs_assignment_fk FOREIGN KEY (assignment_id) REFERENCES dsh.captain_assignments(id) ON DELETE RESTRICT,
    CONSTRAINT captain_handoffs_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
    CONSTRAINT captain_handoffs_store_fk FOREIGN KEY (store_id) REFERENCES dsh.stores(id) ON DELETE RESTRICT
);

CREATE TABLE dsh.captain_operation_idempotency (
    idempotency_key text PRIMARY KEY,
    request_hash text NOT NULL,
    operation text NOT NULL,
    admission_id text,
    order_id text,
    offer_id text,
    assignment_id text,
    result_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT captain_operation_idempotency_facts_uq UNIQUE (idempotency_key, request_hash, operation),
    CONSTRAINT captain_operation_idempotency_operation_chk CHECK (operation IN ('availability', 'dispatch', 'respond_offer', 'reassign', 'store_confirm', 'pickup', 'complete')),
    CONSTRAINT captain_operation_idempotency_version_chk CHECK (result_version > 0),
    CONSTRAINT captain_operation_idempotency_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
    CONSTRAINT captain_operation_idempotency_offer_fk FOREIGN KEY (offer_id) REFERENCES dsh.captain_dispatch_offers(id) ON DELETE RESTRICT,
    CONSTRAINT captain_operation_idempotency_assignment_fk FOREIGN KEY (assignment_id) REFERENCES dsh.captain_assignments(id) ON DELETE RESTRICT,
    CONSTRAINT captain_operation_idempotency_admission_fk FOREIGN KEY (admission_id) REFERENCES dsh.captain_admissions(id) ON DELETE RESTRICT
);
CREATE INDEX captain_operation_idempotency_order_idx
    ON dsh.captain_operation_idempotency(order_id, created_at DESC);

CREATE TABLE dsh.captain_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    correlation_id text NOT NULL,
    acting_actor_id text NOT NULL,
    order_id text,
    offer_id text,
    assignment_id text,
    captain_actor_id text,
    from_state text,
    to_state text NOT NULL,
    result_version integer NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT captain_audit_event_type_chk CHECK (event_type IN ('dispatch_offer_created', 'dispatch_offer_accepted', 'dispatch_offer_rejected', 'dispatch_offer_expired', 'captain_assignment_reassigned', 'store_handoff_confirmed', 'captain_pickup_completed', 'delivery_completed')),
    CONSTRAINT captain_audit_event_idempotency_uq UNIQUE (event_type, idempotency_key),
    CONSTRAINT captain_audit_result_version_chk CHECK (result_version > 0),
    CONSTRAINT captain_audit_order_fk FOREIGN KEY (order_id) REFERENCES dsh.commerce_orders(id) ON DELETE RESTRICT,
    CONSTRAINT captain_audit_offer_fk FOREIGN KEY (offer_id) REFERENCES dsh.captain_dispatch_offers(id) ON DELETE RESTRICT,
    CONSTRAINT captain_audit_assignment_fk FOREIGN KEY (assignment_id) REFERENCES dsh.captain_assignments(id) ON DELETE RESTRICT
);
CREATE INDEX captain_audit_order_idx
    ON dsh.captain_audit(order_id, created_at DESC);
