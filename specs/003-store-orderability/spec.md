# Feature Specification: Store Orderability — Merchant / Operator / Customer

**Existing branch**: `refoundation/clean-house-20261112` (no new branch)
**Date**: 2026-11-14
**State**: IN_PROGRESS; requires runtime and cross-owner evidence
**Canonical journey**: `STORE_ORDERABILITY` in `governance/journeys.md`
**Capability ID**: `STORE_OPERATIONAL_AVAILABILITY` in `governance/product.md` and `governance/stores.md`

## User stories

1. Merchant with a currently verified Identity session and a current DSH `store_operations` grant views and changes the operational schedule and a temporary pause. A simultaneous change must conflict, not silently win. The DSH readback persists and attributes actor, reason, version and idempotency key.
2. Operator with a verified Identity session and actual `operations` permission may intervene on Store availability, but not change contractual mode admissions. Other operators, strangers, stale sessions and merchants from another Store fail closed.
3. Customer sees the one current DSH Store/mode orderability decision, distinct from publication and public discovery; the actual DSH checkout confirmation recomputes eligibility and rejects newly closed/paused/unserviceable methods without changing the method or price.
4. Failure, retry, account/Store switch, invalid schedule, overnight opening interval, unknown outcome and revoke must not produce permissive fallback, duplicate audit or cross-account state.

## Rules / invariants

- Identity is the only session/role/permission owner; DSH owns Store, schedule, operational pause, approved fulfillment mode, orderability, mutation/audit and confirmation. WLT agreement or custody is never altered by availability.
- Derived states: `OPEN_FOR_ORDERS`, `CLOSED_BY_SCHEDULE`, `PAUSED`, `OPERATIONALLY_UNAVAILABLE`. No client-editable derived state or fabricated round-the-clock schedule.
- Store publication, city/vertical, eligible Offer, selected fulfillment method admission, method operational readiness and fulfillment serviceability remain independent checks; an unavailable method cannot be replaced silently.
- Weekly hours use an explicit IANA Store timezone and validated local time; overnight and overlapping intervals are handled deterministically. Invalid/missing information fails closed.
- Policy-owned pause and preparation bounds are provided by DSH Operator Policies at operation time; they are not hardcoded business defaults.
- Cross-store authorization and stale-session rejection happen at the owner boundary, not just by disabling the UI. Expected version and stable operation ID make retries safe.
- No donor data, Root Owner, finance state, shared volumes or production connection is used.

## Testable acceptance

- **SC-01** Real Identity session and DSH Store-scope authorization: correct Merchant and Operator allowed; other Store/role/revoked session denied.
- **SC-02** DSH persistent Store schedule, pause and method status readback retains version, actor, reason, UTC and selected Store timezone across restart.
- **SC-03** Derived orderability for published/open eligible Store, closed schedule, pause, blocked method/city/Offer, overnight boundaries and invalid timezone; public published Store remains visible while not orderable.
- **SC-04** Transactional expected-version concurrency and repeated operation ID produce exactly one durable mutation/audit; reused operation ID with different payload fails.
- **SC-05** Checkout confirmation uses fresh DSH decision; stale client offer/quote fails and does not create an Order or WLT effect.
- **SC-06** Merchant, Operator and Customer UI show authoritative data, Arabic RTL with light/dark, accessible inputs, loading/empty/denied/error/retry, and safe account/Store context switching on Web and affected Android.
- **SC-07** Isolated PostgreSQL fresh baseline, appropriate upgrade/restore proof and owner-scoped permissions, errors and contract/client compatibility pass.
- **SC-08** Positive, negative, interruption/recovery, security and independent engineering/business reviews plus final Git revision/Push SHA evidence are complete.

**No closure claim** until every applicable SC has actual owner-backed proof on the final revision, including Android when claimed. iOS and production are separately not authorized/tested.


## Increment: review and reuse historical city operational limits (2026-11-24)

Trace: BTH-11; STORE_OPERATIONAL_AVAILABILITY; SC-04/SC-06; governance/stores.md and governance/engineering.md. On the active development checkout, an authorized operator can compare an immutable DSH historical version against the currently verified city policy and copy its pause/preparation limits into the existing edit form as an unsubmitted draft. No new policy writer, new scope, historical mutation, implicit reason, automatic save or bypass of current version/identity verification. The draft action is unavailable for another city, the current or a newer version, missing current evidence, a pending/uncertain command or a required reread. The operator must enter a new reason and use the existing versioned DSH command for any actual change. Historical data is not an active policy. Acceptance: correct current/history values, scope isolation, no write on draft, reason cleared and existing expected-version/reconciliation semantics retained; owner/API and browser proof remain separate.

## BTH-15 increment — city delivery policy replacement
An authorized Operator can replace the current DSH city radius and cumulative distance tariff together using the existing policy owner, an expected current version, a stable operation ID and a reason. Immutable commands attribute actor and retain the resulting snapshot; conflicts, inactive cities, missing evidence and malformed tariffs fail closed. Independent readback must agree or be newer; future geographic/advisory checkout reads use the same version, not a payable WLT quote. No production activation or changed tariff formula.

**SC-HISTORY-PAGING (BTH-11).** An Operator can revisit a newer history page or retry the same page after a failed read. Each action reads the same city through the existing scoped DSH contract. A failed read clears displayed audit rows and draft actions until fresh readback confirms the page.
