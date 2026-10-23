-- Captain goods exposure is independent from wallet COD coverage.
-- Conservative, adjustable LOCAL development values until Finance approves
-- production limits. One active operational assignment is allowed per captain.
CREATE TABLE dsh.captain_goods_custody_policies (
  id text PRIMARY KEY CHECK (id='platform'),
  single_order_cap_minor bigint NOT NULL CHECK (single_order_cap_minor>0),
  concurrent_cap_minor bigint NOT NULL CHECK (concurrent_cap_minor>=single_order_cap_minor),
  state text NOT NULL CHECK (state IN ('ACTIVE','DISABLED')),
  version integer NOT NULL CHECK (version>0),
  updated_by_actor_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO dsh.captain_goods_custody_policies
(id,single_order_cap_minor,concurrent_cap_minor,state,version,updated_by_actor_id)
VALUES ('platform',50000,50000,'ACTIVE',1,'system:local-development-bootstrap');
