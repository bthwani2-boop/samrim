-- Human employment does not grant operator access. Root approval starts Identity's existing review process.
CREATE TABLE dsh.hr_operator_access_requests (
  id text PRIMARY KEY,
  employee_id text NOT NULL UNIQUE REFERENCES dsh.hr_employees(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  requested_permissions text[] NOT NULL DEFAULT '{}',
  state text NOT NULL DEFAULT 'pending_review',
  operator_profile_id text UNIQUE,
  requested_by_actor_id text NOT NULL,
  linked_by_actor_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT hr_access_reason_chk CHECK (char_length(btrim(reason)) BETWEEN 8 AND 500),
  CONSTRAINT hr_access_state_chk CHECK (state IN ('pending_review','identity_profile_created')),
  CONSTRAINT hr_access_actor_chk CHECK (char_length(btrim(requested_by_actor_id)) BETWEEN 1 AND 128),
  CONSTRAINT hr_access_permissions_chk CHECK (requested_permissions <@ ARRAY['operations','partners','catalog','marketing','finance','platform_policies','hr']::text[]),
  CONSTRAINT hr_access_transition_chk CHECK (
    (state='pending_review' AND operator_profile_id IS NULL AND linked_by_actor_id IS NULL)
    OR (state='identity_profile_created' AND operator_profile_id IS NOT NULL AND linked_by_actor_id IS NOT NULL)
  )
);
CREATE INDEX hr_access_pending_idx ON dsh.hr_operator_access_requests(created_at DESC,id DESC) WHERE state='pending_review';
CREATE TABLE dsh.hr_operator_access_events (
  idempotency_key text PRIMARY KEY,
  request_id text NOT NULL REFERENCES dsh.hr_operator_access_requests(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('requested','identity_profile_created')),
  request_hash text NOT NULL,
  acting_actor_id text NOT NULL,
  correlation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hr_access_event_hash_chk CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT hr_access_event_correlation_chk CHECK (char_length(btrim(correlation_id)) BETWEEN 8 AND 128)
);
