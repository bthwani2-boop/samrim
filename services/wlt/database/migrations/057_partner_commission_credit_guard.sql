-- Credit exposure is governed separately from funds that WLT owes merchants.
-- Local-development defaults are provisional until Finance approves commercial terms.
CREATE TABLE wlt.partner_commission_credit_policies (
  partner_actor_id text PRIMARY KEY,
  maximum_receivable_minor bigint NOT NULL CHECK (maximum_receivable_minor>=0),
  maximum_age_days integer NOT NULL CHECK (maximum_age_days BETWEEN 1 AND 365),
  state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','DISABLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  updated_by_actor_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO wlt.partner_commission_credit_policies
 (partner_actor_id,maximum_receivable_minor,maximum_age_days,state,version,updated_by_actor_id)
 VALUES ('platform-default',200000,7,'ACTIVE',1,'system:local-development-bootstrap');
