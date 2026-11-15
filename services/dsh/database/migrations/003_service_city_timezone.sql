-- Forward-only additive DSH service-city timezone.
-- Apply only to isolated DSH schemas after the canonical 001 baseline.
-- Missing authoritative zone is NULL: no guessed IANA value or 24/7 schedule.
-- __SCHEMA__ is replaced only by the existing validated migration runner.
ALTER TABLE __SCHEMA__.service_cities
    ADD COLUMN IF NOT EXISTS timezone_name text;
DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint AS c
        JOIN pg_namespace AS n ON n.oid=c.connamespace
        WHERE n.nspname='__SCHEMA__' AND c.conname='service_cities_timezone_name_valid'
    ) THEN
        ALTER TABLE __SCHEMA__.service_cities
            ADD CONSTRAINT service_cities_timezone_name_valid
            CHECK (
                timezone_name IS NULL
                OR (char_length(timezone_name) BETWEEN 3 AND 64 AND timezone_name ~ '^[A-Za-z0-9_+/-]+$')
            );
    END IF;
END;
$migration$;
-- Full IANA existence is validated by the DSH Go owner on read and write.
