-- WLT owns one prospective fee-model suggestion for each DSH Store relation.
-- This policy never replaces accepted Store agreements or posts charges.
CREATE TABLE wlt.store_relation_commercial_model_defaults (
  relation_model text PRIMARY KEY CHECK (relation_model IN ('BTHWANI_PARTNER', 'INDEPENDENT_STORE')),
  commercial_model text NOT NULL CHECK (commercial_model IN ('COMMISSION', 'SUBSCRIPTION')),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_changed_by_actor_id text NOT NULL CHECK (length(btrim(last_changed_by_actor_id)) BETWEEN 1 AND 128),
  last_change_reason text NOT NULL CHECK (length(btrim(last_change_reason)) BETWEEN 8 AND 500)
);
CREATE TABLE wlt.store_relation_commercial_model_default_events (
  idempotency_key text PRIMARY KEY CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 128),
  request_hash text NOT NULL,
  relation_model text NOT NULL REFERENCES wlt.store_relation_commercial_model_defaults(relation_model) ON DELETE RESTRICT,
  previous_model text CHECK (previous_model IS NULL OR previous_model IN ('COMMISSION', 'SUBSCRIPTION')),
  new_model text NOT NULL CHECK (new_model IN ('COMMISSION', 'SUBSCRIPTION')),
  previous_policy_version integer CHECK (previous_policy_version IS NULL OR previous_policy_version > 0),
  new_policy_version integer NOT NULL CHECK (new_policy_version > 0),
  changed_by_actor_id text NOT NULL CHECK (length(btrim(changed_by_actor_id)) BETWEEN 1 AND 128),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 500),
  correlation_id text NOT NULL CHECK (length(btrim(correlation_id)) BETWEEN 8 AND 128),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- No default is silently invented: each relation starts unconfigured.
-- An authorized operator may explicitly choose a proposed model.
