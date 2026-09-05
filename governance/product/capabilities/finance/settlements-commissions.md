# Settlements Commissions

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/finance/settlements-commissions.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: SETTLEMENTS_COMMISSIONS

## Scope

This file is the **sole editable durable semantic owner** of `SETTLEMENTS_COMMISSIONS`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

### SETTLEMENTS_COMMISSIONS

**Problem.** Partner settlements and representative commissions require one auditable WLT-owned financial lifecycle backed by durable DSH operational evidence, versioned policies, deterministic calculation, explicit adjustments and read-only multi-surface readback.
**Problem frequency.** continuous
**Problem severity.** critical
**Target state.** WLT owns one evidence-backed idempotent settlement and commission lifecycle with policy versions, refund-aware calculation, adjustments, audit and scoped readback.
**Primary success measure.** verified evidence to canonical settlement or commission readback rate
**Guardrail measures.** caller supplied financial amount count; duplicate source settlement count; unverified completion evidence count; completed refund omitted from settlement count; commission without policy version count; reasonless adjustment count; negative wallet bucket count; cross-actor read count; unbalanced ledger transaction count

**Required outcome.** Every settlement and commission is deterministically calculated by WLT from durable evidence and a retained policy version, every adjustment has a reason and balanced financial effect, and every required surface reads only canonical scoped references.

**Primary actors.** partner, captain, field, finance_operator, dsh_service, wlt_service.

**Canonical ownership.** WLT financial truth; DSH provides operational evidence.

**Boundary/non-overlap.** SETTLEMENTS_COMMISSIONS owns earning/commission calculation, policy-version application and settlement/commission lifecycle. WLT_MONEY_MOVEMENT_PAYOUT_RECONCILIATION owns common wallet/ledger money movement, Cash-In/COD/payout execution and reconciliation primitives; the same financial fact may not be independently mutable in both capability implementations.

**Material deployable surfaces.** app-partner, app-captain, app-field, control-panel.

**Business invariants**
- WLT exclusively owns settlement commission wallet ledger refund and adjustment truth.
- DSH exclusively owns operational completion cancellation order store visit and representative evidence.
- Every financial mutation carries service authentication correlation and idempotency.
- Every visible success is read back from WLT or a governed DSH application projection backed by WLT.
- Every policy change and adjustment is append-only auditable.

**Forbidden/negative invariants**
- No DSH or frontend code calculates authoritative settlement fees or commission amounts.
- No caller supplied monetary value becomes commission truth.
- No completed refund remains in the payable settlement basis when policy requires its exclusion.
- No cancelled or unverified source is settled.
- No idempotency key represents different inputs.
- No wallet balance violates current financial invariants.
- No actor reads another actor financial detail.

**Acceptance expectations**
- DSH sends operational identities and immutable evidence only; it never sends an authoritative fee, settlement amount or commission amount.
- WLT verifies operational evidence and its own refund truth before calculation.
- A deterministic idempotency key cannot create duplicate financial effects for the same evidence.
- Every settlement and commission retains the exact policy version used for calculation.
- Every commission amount is calculated by the applicable WLT policy and is never accepted from an untrusted caller.
- Lifecycle transitions enforce legal source states and balanced wallet or ledger effects.
- Every deduction or adjustment is reasoned, operator-attributed and auditable.
- Partner captain and field reads are actor-scoped and mutation-free.
- No runtime mock fixture local financial calculation or duplicate financial truth owner remains.

**Named failure classes:** caller supplied amount, unverified evidence, cancelled source settled, completed refund ignored, duplicate settlement, duplicate commission, missing policy, stale policy ambiguity, reasonless adjustment, negative wallet bucket, cross-actor financial read, unbalanced ledger, frontend-only success.

**Actor responsibility envelope**
- `partner` — Authenticated partner viewing only its WLT settlement and commission references; permitted: read own settlement cycles, read own deductions and adjustments, read own commission references, refresh canonical WLT readback; forbidden: calculate commission locally, post or reverse a settlement, change a financial policy, read another partner financial record.
- `captain` — Authenticated captain viewing only personal commission lifecycle and adjustment reasons; permitted: read own commissions, read own pending confirmed settled rejected and reversed states, refresh canonical readback; forbidden: submit an amount, confirm settle reject reverse or adjust a commission, read another beneficiary record.
- `field` — Authenticated field representative viewing only personal visit commission lifecycle; permitted: read own visit commissions, read policy-derived amount and adjustment reasons, refresh canonical readback; forbidden: submit an amount, change visit evidence, mutate a commission state, read another representative record.
- `finance_operator` — Authorized control-panel operator managing policies and governed financial lifecycle actions; permitted: create or update a versioned policy with reason, initiate a settlement from DSH evidence, confirm reject settle or reverse an eligible commission, create a reasoned adjustment, read audit and reconciliation references; forbidden: supply settlement or commission truth amounts, approve an action created by the same actor where maker-checker applies, erase audit evidence, bypass mutation or service authentication gates.
- `dsh_service` — Operational truth owner providing durable completion and cancellation evidence; permitted: deliver immutable order and visit evidence, carry correlation and idempotency identifiers, proxy authorized read-only references; forbidden: calculate a WLT fee or commission, write WLT tables, declare refund completion, send mutable or unverifiable evidence.
- `wlt_service` — Sole financial truth owner for policy application settlement commission wallet ledger adjustment and audit; permitted: verify DSH evidence, verify WLT refund truth, calculate governed amounts, post balanced ledger effects, retain policy and adjustment versions, return canonical readback; forbidden: trust caller supplied financial amounts, settle unverified evidence, allow negative wallet buckets, reuse an idempotency key for different inputs.

**Surface semantics**
- `app-partner` — required; actors: partner; states: loading, empty, success, pending, settled, rejected, reversed, forbidden, offline, partial, error; actions: refresh, inspect cycle, inspect adjustment reason.
- `app-captain` — required; actors: captain; states: loading, empty, success, pending, confirmed, settled, rejected, reversed, forbidden, offline, error; actions: refresh, inspect commission, inspect adjustment reason.
- `app-field` — required; actors: field; states: loading, empty, success, pending, confirmed, settled, rejected, reversed, forbidden, offline, error; actions: refresh, inspect visit source, inspect adjustment reason.
- `control-panel` — required; actors: finance_operator; states: loading, empty, success, draft, active, inactive, pending, confirmed, settled, rejected, reversed, forbidden, conflict, offline, error; actions: create policy version, initiate settlement, confirm, settle, reject, reverse, adjust, inspect audit.
- `backend` — required; actors: finance_operator, dsh_service, wlt_service; states: authorized, forbidden, invalid, conflict, pending, confirmed, settled, rejected, reversed; actions: authenticate, validate evidence, calculate, enforce idempotency, post ledger, audit, read back.
- `database` — required; actors: wlt_service; states: versioned, immutable, idempotent, balanced, auditable, trusted-context-scoped; actions: enforce uniqueness, retain evidence, retain reasoned adjustment, prevent negative amount, retain policy version.
- technical presentation binding — required implementation evidence; actors: partner, captain, field, finance_operator; states: idle, loading, empty, success, forbidden, conflict, offline, partial, error; actions: map canonical states, classify errors, disable duplicate actions, refresh canonical readback.
