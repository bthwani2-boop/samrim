-- Old versions retain their immutable historical fee components. New versions are
-- exclusively distance-band based; NULL distinguishes legacy records, not a zero tariff.
ALTER TABLE wlt.delivery_fee_policies
  ADD COLUMN distance_bands jsonb;
ALTER TABLE wlt.delivery_fee_policies
  ADD CONSTRAINT delivery_fee_band_structure_chk CHECK (
    distance_bands IS NULL OR
    (jsonb_typeof(distance_bands)='array' AND jsonb_array_length(distance_bands) BETWEEN 1 AND 30)
  );
