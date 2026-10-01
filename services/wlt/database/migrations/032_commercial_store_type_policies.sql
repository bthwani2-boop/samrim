UPDATE wlt.field_acquisition_reward_policies
SET state='RETIRED', retired_at=COALESCE(retired_at, clock_timestamp())
WHERE state='ACTIVE';

ALTER TABLE wlt.field_acquisition_reward_policies
    DROP CONSTRAINT field_acquisition_reward_policies_scope_chk,
    ADD CONSTRAINT field_acquisition_reward_policies_scope_chk
        CHECK ((scope_type = 'DEFAULT' AND scope_id IS NULL) OR (scope_type IN ('VERTICAL', 'STORE', 'STORE_TYPE') AND length(btrim(scope_id)) BETWEEN 1 AND 128)),
    DROP CONSTRAINT field_acquisition_reward_policies_active_vertical_chk,
    ADD CONSTRAINT field_acquisition_reward_policies_active_store_type_chk
        CHECK (state <> 'ACTIVE' OR (scope_type = 'STORE_TYPE' AND length(btrim(scope_id)) BETWEEN 1 AND 128));

ALTER TABLE wlt.field_acquisition_entitlements
    ADD COLUMN commercial_store_type_id text,
    ADD CONSTRAINT field_acquisition_entitlements_commercial_type_chk
        CHECK (commercial_store_type_id IS NULL OR length(btrim(commercial_store_type_id)) BETWEEN 1 AND 128);
