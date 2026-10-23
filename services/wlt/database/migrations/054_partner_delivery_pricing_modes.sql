-- The Store owns its Partner Captain delivery pricing. Each accepted Store
-- agreement freezes FREE, FIXED or DISTANCE; historical rates default to DISTANCE.
ALTER TABLE wlt.store_commercial_agreement_rates
 ADD COLUMN delivery_pricing_mode text NOT NULL DEFAULT 'DISTANCE',
 ADD COLUMN delivery_fixed_fee_minor bigint NOT NULL DEFAULT 0,
 ADD CONSTRAINT store_agreement_partner_delivery_pricing_chk CHECK (
   delivery_pricing_mode IN ('DISTANCE','FIXED','FREE')
   AND delivery_fixed_fee_minor BETWEEN 0 AND 20000
   AND (
     (fulfillment_mode <> 'PARTNER_CAPTAIN'
        AND delivery_pricing_mode='DISTANCE' AND delivery_fixed_fee_minor=0)
     OR (fulfillment_mode='PARTNER_CAPTAIN' AND
        ((delivery_pricing_mode='DISTANCE' AND delivery_fixed_fee_minor=0)
         OR (delivery_pricing_mode='FREE' AND delivery_fixed_fee_minor=0)
         OR (delivery_pricing_mode='FIXED' AND delivery_fixed_fee_minor>0)))
   )
 );
