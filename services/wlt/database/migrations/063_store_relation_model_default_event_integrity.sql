-- Preserve the immutable v62 policy event history; reject malformed new audit
-- receipts without changing Store agreements, policy defaults, or journal data.
-- Existing rows are validated by PostgreSQL before this migration can commit.
ALTER TABLE wlt.store_relation_commercial_model_default_events
  ADD CONSTRAINT store_relation_model_default_event_hash_chk
    CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT store_relation_model_default_event_transition_chk
    CHECK (
      (previous_model IS NULL AND previous_policy_version IS NULL AND new_policy_version = 1)
      OR
      (previous_model IS NOT NULL AND previous_policy_version IS NOT NULL
       AND previous_model <> new_model
       AND new_policy_version::bigint = previous_policy_version::bigint + 1)
    );
