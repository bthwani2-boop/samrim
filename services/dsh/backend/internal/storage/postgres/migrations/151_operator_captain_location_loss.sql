-- Mission GPS loss is an operational exception, never proof of delivery failure.
ALTER TABLE dsh.operator_order_cases DROP CONSTRAINT ops_case_reason_chk;
ALTER TABLE dsh.operator_order_cases ADD CONSTRAINT ops_case_reason_chk
  CHECK (reason IN ('PARTNER_DELAY','DISPATCH_UNAVAILABLE','DELIVERY_BLOCKED',
                   'CAPTAIN_LOCATION_LOST','CUSTOMER_CONTACT','PAYMENT_EXCEPTION','OTHER'));
