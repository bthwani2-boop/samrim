UPDATE wlt.field_commission_policies
SET state = 'RETIRED', retired_at = COALESCE(retired_at, clock_timestamp())
WHERE state = 'ACTIVE' AND scope_type <> 'VERTICAL';

ALTER TABLE wlt.field_commission_policies
    ADD CONSTRAINT field_commission_policies_active_vertical_chk
        CHECK (state <> 'ACTIVE' OR (scope_type = 'VERTICAL' AND length(btrim(scope_id)) BETWEEN 1 AND 128));
