-- Initial, explicit store-type policy decisions for already-registered types.
-- Exact approved names only; unknown/custom types remain OPERATIONS_ONLY.
-- Previous Orders retain their own immutable cancellation policy snapshot.
WITH prior AS MATERIALIZED (
 SELECT id,version,cancellation_mode
 FROM dsh.commercial_store_types
 WHERE lower(btrim(name_en)) IN
 ('supermarket','grocery shop','greengrocer','phones and accessories','electronics','pharmacy')
 AND cancellation_mode='OPERATIONS_ONLY'
 FOR UPDATE
),
changed AS (
 UPDATE dsh.commercial_store_types AS st
 SET cancellation_mode='CLIENT_BEFORE_ACCEPTANCE',
     version=st.version+1,
     updated_at=clock_timestamp()
 FROM prior
 WHERE st.id=prior.id
 RETURNING st.id
)
INSERT INTO dsh.store_type_cancellation_policy_audit
 (store_type_id,previous_mode,resulting_mode,expected_version,resulting_version,
  acting_actor_id,reason,idempotency_key,request_hash,correlation_id)
SELECT prior.id,prior.cancellation_mode,'CLIENT_BEFORE_ACCEPTANCE',prior.version,prior.version+1,
 'system:initial-policy-migration-137','Initial approved self-cancellation for eligible Store Types',
 'initial-store-type-policy-137:'||prior.id,md5('initial-store-type-policy-137:'||prior.id),
 'migration:137:initial-cancellation-types'
FROM prior JOIN changed USING(id);
