# WLT PostgreSQL migrations — retained upgrade history

New, empty, isolated WLT development databases are now built from the current
`../schema/` domain baseline followed by the strictly isolated `../sandbox/`
functions, not by replaying the numbered historical files below. The existing
numbered migrations remain immutable compatibility and upgrade fixtures; they
are not a competing definition of the fresh schema. See also
`infra/verify-isolated-postgres.ps1` for the actual disposable baseline test.

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
`004_sandbox_customer_funding.sql` adds an execute-only synthetic posting
function. Provision `bthwani_wlt_sandbox` before applying it. The routine
requires that database login and the disposable database name at execution
time. The HTTP reader receives no additional grants.
`005_sandbox_customer_funding_reversal.sql` appends at most one linked
reversal for each original sandbox posting. PostgreSQL checks the original
actor, reference, amount, currency and effective ordering, then projects the
opposite debit and credit legs. The existing history projection includes the
original funding ID on reversal entries. Deploy the updated reader and SDK
together before recording reversals in a preview.

A journal row carries both funding legs in whole YER. Funding identity and
provider reference uniqueness reject duplicate postings. Triggers reject
changes to posted rows. Keep applied migrations immutable.

The CI suite bootstraps this database from scratch and posts a synthetic
journal entry before applying `002` and `003`. It verifies the prior funds and
new postings through separate connections and checks the reader's privileges.
It restores the schema and journal into a second database in the same
disposable container. The restore checks projected amounts, funding history,
journal balance, reversal links, reader scope and refusal of sandbox writes
in the restore.
Historical financial migration requires independent reconciliation and
restore evidence under [data and recovery policy](../../../../governance/safety.md).
