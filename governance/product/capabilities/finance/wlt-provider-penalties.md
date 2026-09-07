# Wlt Provider Penalties

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/finance/wlt-provider-penalties.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: WLT_PROVIDER_PENALTIES

## Scope

This file is the **sole editable durable semantic owner** of `WLT_PROVIDER_PENALTIES`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

### WLT_PROVIDER_PENALTIES

**Problem.** Captain/field penalties can become manual arbitrary balance edits or be reversed after their debt/wallet state has materially changed.

**Required outcome.** WLT applies a governed versioned penalty policy to an eligible captain/field source, posts the monetary effect through wallet/debt plus balanced ledger, and permits only state-safe reversal.

**Primary actors.** authorized operator/system, captain or field provider as affected actor/read-only consumer.

**Canonical ownership.** WLT penalty/debt/wallet/ledger truth; DSH may supply trusted incident/actor evidence.

**Material surfaces.** control-panel finance/incident workflow and bounded captain/field financial readback.

**Durable semantics.** policy is enabled/versioned with provider actor type, amount, currency and reason; penalty records source incident and split between wallet-applied amount and debt; reversal restores exact governed financial effect only when live debt state still matches the reversible snapshot.

**Forbidden/negative invariants.**
- no generic manual balance decrement;
- no unsupported actor type;
- no duplicate posting for same mutation identity;
- no reversal after partial settlement/state drift without explicit reconciliation;
- no non-WLT ledger writer;
- no penalty without reason/audit/source evidence.

**Failure/recovery.** wallet unavailable, policy disabled/invalid, debt state conflict, duplicate/idempotency conflict, reversal state drift; reconcile live wallet/debt before any new financial mutation.

**Acceptance expectations.** original and reversal postings balance, debt/wallet split is reproducible, audit/source lineage is preserved and affected readback is consistent.

**Target state.** WLT owns versioned captain/field monetary-penalty policy, posting/debt split and state-safe reversal from trusted source evidence.
**Primary success measure.** penalty/reversal operations with exact source lineage and balanced reproducible wallet/debt/ledger effects.
**Guardrail measures.** direct balance decrement; duplicate posting; unsupported actor; reasonless penalty; reversal after incompatible debt/state drift; non-WLT ledger write.
**Business invariants**
- penalty policy is versioned and actor/type/currency/reason scoped;
- one logical mutation identity yields one financial effect;
- wallet-applied and debt portions are balanced and auditable;
- reversal is permitted only against compatible live debt/state or after explicit reconciliation.
**Actor responsibility envelope**
- `operator/system` — initiates only authorized evidence-backed penalty/reversal intent; forbidden: arbitrary balance edit.
- `captain/field actor` — reads bounded affected financial outcome; forbidden: mutate policy/posting.
- `WLT` — sole penalty/debt/wallet/ledger writer and reconciler.
**Surface semantics**
- `control-panel` and bounded `app-captain`/`app-field` readback where applicable.
- `backend` and `database` — required WLT policy/posting/debt/reversal lineage.
- technical presentation binding — implementation evidence only.
