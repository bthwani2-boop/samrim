# Partner, Captain and Field Earnings Settlement

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: docs/governance/product/capabilities/finance/partner-captain-field-earnings-settlement.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
CAPABILITY_ID: PARTNER_CAPTAIN_FIELD_EARNINGS_SETTLEMENT

## Outcome

Partner, BThwani Captain and Field financial entitlements are derived from their canonical qualifying events and move through one governed WLT payout/settlement lifecycle to reconciled completion or an explicit exception. The Operator Finance workspace presents separate beneficiary sections while sharing the payout, execution and reconciliation controls that have the same financial semantics.

## Ownership

WLT owns earnings ledger, beneficiary eligibility/holds, payout intent, official destination state, immutable approved settlement snapshot, settlement batch, transfer evidence and reconciliation. DSH and Control Panel provide operational facts or bounded intent and consume WLT readback; they are never a second financial writer.

## Invariants

- earnings are created from one explicit qualifying owner event and are idempotent;
- economic entitlement is distinct from the Customer's payment-source allocation;
- outstanding Partner commission receivables from Store-collected pickup cash reduce that Partner's later eligible earnings before payout; they never offset another Partner's entitlement;
- a remaining Partner commission receivable may be cleared by a direct Partner remittance only after WLT records and reconciles the verified receipt;
- Store-collected sale proceeds already retained by the Partner do not become a second WLT Partner wallet credit;
- Partner/Captain/Field payout execution is currently a governed manual official-wallet transfer; a provider payout API is not implied;
- each external transfer has transfer-specific receipt/evidence, while a period/batch statement is retained once and matched statement rows may be linked to multiple transfers;
- generated spreadsheets are immutable execution artifacts and never a source of WLT financial truth;
- Partner, BThwani Captain and Field surfaces do not create, update, deactivate, replace or select official-wallet destination master data; Finance owns the governed provisioning/change workflow;
- official-wallet admission for Partner, BThwani Captain and Field collects a provider preference only. WLT derives the number and beneficiary name from current canonical Identity facts under `docs/governance/policies/finance.md`; stale Identity facts require reverification before payout approval or execution;
- a derived wallet number may be shown read-only; it is never an editable destination input;
- payout approval freezes an immutable beneficiary/destination/amount snapshot;
- external execution evidence is independently verified/reconciled before completion;
- an approved payout cannot silently follow a later destination change;
- WLT owns each Store's effective payout-recipient actor assignment and its version, effective time, audit and readiness; the default is the Partner owner, and the owner may explicitly assign one verified eligible owner or staff actor per Store;
- multiple Stores may share a beneficiary, but each Store assignment remains independently scoped and read back; a multi-Store selection creates individual canonical assignments rather than one global routing fact;
- recipient eligibility requires a canonical actor with current verified Identity facts, an active eligible relationship to that Store and a current Finance-approved WLT destination/provider;
- recipient assignment is owner-only and names a beneficiary relationship, never a wallet number, name or destination; delegated finance-read, report, payout-request or Store-management permissions cannot change it;
- payout-request authority permits only a bounded intent for authorized Store scope; WLT independently enforces eligibility, holds and all approval, execution and reconciliation boundaries;
- if the assigned staff member's Store relationship is suspended/revoked or ceases to be eligible, the Store's future payout readiness requires owner action; WLT must not silently keep paying that actor or silently fall back to the owner;
- a verified-phone or Identity change makes the affected destination require Finance reverification before a future payout; it never silently redirects a payout;
- recipient changes affect only future payout intents that have not been committed to an immutable snapshot; approved, executing, transferred and reconciled payouts retain their original beneficiary, destination and per-Store allocations;
- aggregated owner readback preserves per-Store attribution; a payout spanning different recipients or destinations is partitioned into separate canonical groups/transfers, never one transfer to multiple recipients;
- Field earning policy defines the qualifying event explicitly; attribution/publication alone does not silently become the permanent reward law;
- Store-affiliated Partner Captain compensation and cash custody remain outside this capability and WLT unless a separately governed integration is explicitly admitted;
- no surface edits ledger balances directly.

## Minimal recipient-assignment state semantics

The exact executable representation belongs to implementation, but current durable meaning must distinguish at least:

```text
DEFAULT_OWNER
SELECTED_VERIFIED_STAFF
RECIPIENT_REVIEW_REQUIRED
```

`DEFAULT_OWNER` routes future unpinned payout intents to the Partner owner without requiring an explicit assignment record. `SELECTED_VERIFIED_STAFF` records an owner-assigned eligible staff beneficiary. `RECIPIENT_REVIEW_REQUIRED` marks a Store whose recipient eligibility is broken (for example a suspended, revoked or otherwise ineligible staff relationship); future payout readiness for that Store stays blocked until the owner selects or explicitly reconfirms a legal recipient. Assignments enter `RECIPIENT_REVIEW_REQUIRED` fail-closed from canonical eligibility facts; every other transition is owner-initiated, versioned and audited. No transition rewrites a committed payout snapshot.

## Failure and recovery

Insufficient eligible amount, destination verification failure, duplicate payout, execution timeout/unknown, missing receipt, statement mismatch, duplicate statement import and reconciliation exception remain explicit and recover through WLT canonical readback. A Store entering `RECIPIENT_REVIEW_REQUIRED` does not mutate in-flight payouts; it blocks only future payout readiness until explicit owner action.
