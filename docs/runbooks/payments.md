# Payment Sessions Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

Status: OPERATIONAL_RUNBOOK
Owner: WLT financial operations with DSH application-facing projection

Current WLT/DSH contracts, provider configuration, secrets policy and release governance override stale field/route/config names.

## Authority and ownership

- WLT owns provider state, payment-session state, financial reconciliation and ledger truth.
- DSH owns checkout orchestration and the bounded operational/payment projection allowed by the current contract.
- Application surfaces call the governed DSH-facing path and must never receive WLT service credentials or provider secrets.
- Financial, security, product, release and production approval remain independent/protected where current governance requires them.

## Configuration discipline

Verify required variables against current runtime manifests before use. The durable rules are:

- financial mutations fail closed when their explicit runtime authorization/configuration is absent;
- DSH↔WLT service authentication remains server-side;
- provider mode/base URL/credentials are WLT-owned runtime configuration;
- local mock/simulator modes are development evidence only and must not be confused with provider/release readiness;
- webhook secrets and provider credentials never enter `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`, client bundles or logs;
- production activation requires the current release/security/finance controls, not a runbook toggle.

## Provider webhook safety

Use the current WLT provider webhook contract. Verify signature, timestamp/replay window, body limits, event identity, payload schema and operator/trusted scope according to the current implementation. A replay with identical event identity/payload should be idempotent; a contradictory replay is a security/integration incident.

Secret rotation follows an approved overlap/cutover procedure owned by provider/WLT operations; never weaken signature verification to ease rotation.

## Safe operation rules

1. Preserve correlation and idempotency identities across authorize/capture/status-refresh retries.
2. Do not retry an ambiguous/in-progress financial mutation with a new idempotency key.
3. On timeout/unknown result, obtain authoritative provider/WLT status before reissuing a mutation.
4. A captured payment is valid only when WLT persistence/ledger invariants required by the current schema hold.
5. COD uses its canonical WLT/DSH flow; never synthesize capture from a UI action.
6. DSH projection delay does not change WLT truth. Recover projection/outbox delivery rather than repeating the financial mutation.
7. Local provider mocks never prove financial correctness or production readiness.

## Unknown-provider-result workflow

1. Pin exact DSH/WLT candidate commits and payment/session/correlation identities.
2. Inspect current payment timeline, operation receipts, provider events, ledger references and reconciliation state.
3. Perform only the governed status-refresh/reconciliation action using a stable retry identity.
4. Apply a terminal provider fact only through WLT's legal state transition.
5. If authoritative evidence is unavailable, keep reconciliation open; do not invent provider success through a manual adjustment.

## Read-only diagnostics

Use current schema names and read-only queries to detect:

- captured sessions missing required ledger linkage;
- ledger source/type mismatches;
- operation receipts stuck in-progress beyond policy;
- unresolved ambiguous results;
- provider event replay conflicts;
- DSH/WLT projection divergence.

Never copy sensitive provider payloads or payment instrument data into tickets.

## Alerts/objectives

High-severity conditions include duplicate financial mutation evidence, accepted invalid webhook signatures, captured-without-ledger invariant failures, replay conflicts, cross-scope access, long-lived unknown results and DSH projection lag beyond the current SLO.

Operational SLO numbers must come from the active environment/observability contract. A historical number in a runbook is not a production guarantee.

## Rollback and containment

1. Disable/gate new financial mutations using the current WLT release mechanism while keeping safe reads available.
2. Hide/disable affected client payment entry points through current release controls where required.
3. Remove local mock/simulator flags from any non-development environment.
4. Preserve payment sessions, receipts, provider events, reconciliation cases, ledger and outbox evidence.
5. Revert application code only after mutation containment; do not destructively roll back applied additive migrations.
6. Reconcile every in-progress/unknown operation using provider/WLT evidence before resuming mutations.
7. Resume only after applicable finance/security/release evidence and approvals exist.

## Verification before release

Use current registered commands/workflows and require, as applicable:

- product/contract/guard validation;
- WLT/DSH backend and boundary tests;
- affected TypeScript/build checks;
- migration apply/upgrade tests;
- provider sandbox tests for authorize/capture/replay/timeout/status refresh/webhook/replay conflict;
- database evidence for atomic ledger/projection/outbox invariants;
- app/control-panel runtime/visual evidence for loading, offline, forbidden, conflict, unknown, failed, expired and success states;
- independent product, finance, security and release decisions when required.

## CI evidence lifecycle

CI is read-only. Only a completed run whose tested SHA equals the candidate SHA is same-commit automated evidence. An older run is historical; a cancellation caused by a newer candidate is not automatically a failure or pass. Automated success never grants product, finance, security, UX, release or production approval.
