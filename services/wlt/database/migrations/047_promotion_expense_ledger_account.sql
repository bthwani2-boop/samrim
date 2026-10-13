-- Admit the WLT-owned platform-funded promotion expense in the canonical
-- ledger allowlist. Migration 045 introduced the frozen funding row, but the
-- settled partner earning already posts BTHWANI_PROMOTION_EXPENSE.
-- Keep adopted 031 and later migration history unchanged.
ALTER TABLE wlt.ledger_entries
    DROP CONSTRAINT ledger_entries_code_chk,
    ADD CONSTRAINT ledger_entries_code_chk CHECK (account_code IN (
        'CAPTAIN_CASH_RECEIVABLE',
        'CUSTOMER_PAYMENT_CLEARING',
        'PARTNER_WALLET',
        'CAPTAIN_WALLET',
        'FIELD_WALLET',
        'PLATFORM_COMMISSION_INCOME',
        'FIELD_ACQUISITION_REWARD_EXPENSE',
        'EXTERNAL_SETTLEMENT_CASH',
        'PARTNER_COMMISSION_RECEIVABLE',
        'CUSTOMER_WALLET',
        'BTHWANI_PROMOTION_EXPENSE'
    ));
