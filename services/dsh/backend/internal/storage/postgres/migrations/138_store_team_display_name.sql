ALTER TABLE dsh.store_access_grants ADD COLUMN display_name_ar TEXT NOT NULL DEFAULT '';
ALTER TABLE dsh.store_access_grants ADD CONSTRAINT store_access_grants_display_name_len_ck CHECK (char_length(display_name_ar) <= 80);
