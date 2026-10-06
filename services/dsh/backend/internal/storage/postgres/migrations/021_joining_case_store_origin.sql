ALTER TABLE dsh.joining_cases
    ADD COLUMN first_store_latitude numeric(9,6),
    ADD COLUMN first_store_longitude numeric(10,6),
    ADD CONSTRAINT joining_cases_store_origin_pair_chk
        CHECK ((first_store_latitude IS NULL AND first_store_longitude IS NULL)
            OR (first_store_latitude IS NOT NULL AND first_store_longitude IS NOT NULL)),
    ADD CONSTRAINT joining_cases_store_origin_latitude_chk
        CHECK (first_store_latitude IS NULL OR first_store_latitude BETWEEN -90 AND 90),
    ADD CONSTRAINT joining_cases_store_origin_longitude_chk
        CHECK (first_store_longitude IS NULL OR first_store_longitude BETWEEN -180 AND 180);
