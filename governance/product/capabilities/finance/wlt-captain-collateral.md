# Wlt Captain Collateral

ARTIFACT_CLASS: DURABLE_PRODUCT_CAPABILITY_GOVERNANCE
SEMANTIC_OWNER: governance/product/capabilities/finance/wlt-captain-collateral.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_CAPABILITY_INDEX: governance/product/CAPABILITIES.md
CAPABILITY_ID: WLT_CAPTAIN_COLLATERAL

## Scope

This file is the **sole editable durable semantic owner** of `WLT_CAPTAIN_COLLATERAL`. Capability taxonomy/schema/admission law remains in `../../CAPABILITIES.md`; cross-capability journey semantics remain in `../../JOURNEYS.md`.

### WLT_CAPTAIN_COLLATERAL

**Problem.** Captain collateral/exposure can be confused with available balance, COD capacity or debt and be released while obligations remain.

**Required outcome.** WLT owns versioned collateral policy, captain collateral positions and releasable excess as financial truth backed by a proven captured captain top-up/ledger source.

**Primary actors.** captain, authorized finance/operator, WLT system.

**Canonical ownership.** WLT collateral/wallet/ledger truth; DSH only consumes eligibility/readback needed for operations.

**Material surfaces.** app-captain readback, control-panel finance, dispatch eligibility integration when applicable.

**Durable states.** collateral policy enabled/disabled and versioned; collateral position `active → released`; release records reason/time and cannot silently mutate source funding history.

**Forbidden/negative invariants.**
- no collateral position without proven eligible captured funding source;
- no client/operator direct balance edit;
- no release while pending/held/COD reserve/outstanding debt or required minimum makes it ineligible;
- no DSH writer for collateral/wallet truth;
- no released position reused as active exposure.

**Failure/recovery.** policy disabled, invalid input/source, position not found, insufficient/restricted state, conflicting obligations; canonical WLT reread/reconciliation determines next legal action.

**Acceptance expectations.** wallet summary distinguishes available/pending/held/COD/collateral/debt; release is atomic/auditable and preserves ledger/source lineage.

**Target state.** WLT owns versioned collateral policy and positions with explicit backing source, exposure constraints and atomic release eligibility.
**Primary success measure.** collateral positions whose backing, active/released state and release eligibility reconcile to wallet/ledger obligations.
**Guardrail measures.** unbacked collateral; release with pending/held/COD/debt obligations; direct balance edit; released position reused; DSH collateral writer.
**Business invariants**
- every position references eligible captured WLT funding/ledger evidence;
- collateral is distinct from available, pending, held, COD reserve and debt;
- release is atomic, versioned and blocked by current obligations/minimum policy;
- DSH consumes eligibility/readback only.
**Actor responsibility envelope**
- `captain` — reads own collateral/exposure; forbidden: mutate balance or release eligibility directly.
- `finance operator` — applies authorized policy/release actions with audit; forbidden: bypass obligations.
- `WLT` — sole collateral/wallet/ledger writer.
**Surface semantics**
- `app-captain`, `control-panel`, and dispatch integration readback when applicable.
- `backend` and `database` — required WLT policy/position/ledger lineage.
- technical presentation binding — implementation evidence only.
