# WLT PostgreSQL migrations

`001_customer_funding_journal.sql` is a fresh baseline for the disposable
`bthwani_wlt_test` database. Provision the separate `bthwani_wlt_owner` and
`bthwani_wlt_reader` roles first. Run the migration as the owner. The
reader receives schema access and SELECT on the wallet balance projection.

A journal row carries both funding legs in whole YER. Funding identity and
provider reference uniqueness reject duplicate postings. Triggers reject
changes to posted rows. Keep applied migrations immutable.

The CI suite bootstraps this database from scratch, tests the reader's
privileges and checks the journal and balance through separate connections.
It restores the journal into a second database in the same disposable
container and verifies the projected amounts and reader scope there.
Historical financial migration requires independent reconciliation and
restore evidence under [data and recovery policy](../../../../governance/safety.md).
