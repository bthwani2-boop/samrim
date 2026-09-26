ALTER TABLE wlt.delivery_fee_policy_events
    ADD COLUMN expected_version integer NOT NULL DEFAULT 0,
    ADD COLUMN change_reason text NOT NULL DEFAULT 'legacy policy activation',
    ADD CONSTRAINT delivery_fee_policy_events_expected_version_chk CHECK (expected_version >= 0),
    ADD CONSTRAINT delivery_fee_policy_events_change_reason_chk CHECK (length(btrim(change_reason)) BETWEEN 5 AND 500);

ALTER TABLE wlt.field_commission_policies
    ADD COLUMN correlation_id text NOT NULL DEFAULT 'legacy-policy-event',
    ADD COLUMN expected_version integer NOT NULL DEFAULT 0,
    ADD COLUMN change_reason text NOT NULL DEFAULT 'legacy policy activation',
    ADD CONSTRAINT field_commission_policies_correlation_id_chk CHECK (length(btrim(correlation_id)) BETWEEN 1 AND 128),
    ADD CONSTRAINT field_commission_policies_expected_version_chk CHECK (expected_version >= 0),
    ADD CONSTRAINT field_commission_policies_change_reason_chk CHECK (length(btrim(change_reason)) BETWEEN 5 AND 500);
