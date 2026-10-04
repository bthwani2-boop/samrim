ALTER TABLE dsh.joining_cases
    ADD COLUMN wallet_provider_key text,
    ADD CONSTRAINT joining_cases_wallet_provider_key_chk
        CHECK (wallet_provider_key IS NULL OR length(btrim(wallet_provider_key)) BETWEEN 1 AND 64);

ALTER TABLE dsh.field_admissions
    ADD COLUMN wallet_provider_key text,
    ADD CONSTRAINT field_admissions_wallet_provider_key_chk
        CHECK (wallet_provider_key IS NULL OR length(btrim(wallet_provider_key)) BETWEEN 1 AND 64);

ALTER TABLE dsh.captain_admissions
    ADD COLUMN wallet_provider_key text,
    ADD CONSTRAINT captain_admissions_wallet_provider_key_chk
        CHECK (wallet_provider_key IS NULL OR length(btrim(wallet_provider_key)) BETWEEN 1 AND 64);
