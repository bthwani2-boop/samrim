ALTER TABLE dsh.joining_cases
    DROP CONSTRAINT joining_cases_commission_rate_chk,
    DROP CONSTRAINT joining_cases_financial_terms_pair_chk,
    DROP COLUMN commission_rate_bps;

ALTER TABLE dsh.joining_case_financial_profile_outbox
    DROP CONSTRAINT joining_case_financial_outbox_commission_chk,
    DROP COLUMN commission_rate_bps;
