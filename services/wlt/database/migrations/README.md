# WLT PostgreSQL migrations

`001_customer_funding_journal.sql` is a fresh baseline for the disposable
`bthwani_wlt_test` database. Provision the separate `bthwani_wlt_owner` and
`bthwani_wlt_reader` roles first. Run the migration as the owner. The
reader receives schema access and SELECT on the wallet balance projection.
`002_customer_funding_history.sql` extends this *without rewriting the applied
baseline*: it grants SELECT only on a reduced posted-funding view (actor,
funding ID, amount and time; no provider identifiers). The runtime still has
no ledger write or raw-journal SELECT privileges.
`003_customer_funding_history_paging.sql` adds an owner-owned ordered index for
stable keyset pages; it neither changes posted funding nor grants new permissions.

A journal row carries both funding legs in whole YER. Funding identity and
provider reference uniqueness reject duplicate postings. Triggers reject
changes to posted rows. Keep applied migrations immutable.

The CI suite bootstraps this database from scratch, tests the reader's
privileges and checks the journal and balance through separate connections.
It restores all migrations and the journal into a second database in the same
disposable container and verifies the projected amounts, funding history and
reader scope there.
Historical financial migration requires independent reconciliation and
restore evidence under [data and recovery policy](../../../../governance/safety.md).
