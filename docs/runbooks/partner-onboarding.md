# Partner Onboarding Support Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

Status: OPERATIONAL_RUNBOOK
Owner: DSH partner onboarding

Current capability governance, DSH contracts, Identity/Workforce ownership and WLT boundary rules override stale operational details.

## Triage keys

Capture the partner/store identifier, actor surface, operation, status/error code, correlation ID, idempotency identity presence, expected/current version and latest lifecycle status. Never request or paste raw bank/IBAN/payout identifiers, credentials, tokens or document bytes into an incident.

## First response

1. Confirm DSH health/readiness and database availability.
2. Read the canonical partner, readiness, store linkage, documents, field evidence and activation audit through an authorized scope.
3. For optimistic-concurrency conflict, reload committed state; do not replay a stale version.
4. For idempotency-key reuse with a contradictory payload, preserve the original retry identity and investigate; do not hide the conflict with a new local success path.
5. For readiness-gate failure, surface the exact missing items; do not bypass the gate.
6. For WLT unavailability, verify DSH contains only the governed financial reference/projection permitted by the contract; never create financial truth in DSH.
7. For publication issues, verify all current store/partner/catalog/readiness/marketing/serviceability gates required by capability governance.

## Outbox/reconciliation recovery

Inspect current pending/retry/dead-letter partner/WLT integration rows by their governed retry schedule. A stalled row should be investigated by correlation/request identity and source error. Preserve request hash/idempotency/correlation evidence. Never create or edit WLT ledger truth from DSH recovery tooling.

## Security/privacy escalation

Escalate immediately when evidence shows cross-scope access, unauthorized actor access to onboarding-private data, store/partner ownership mutation through an unauthorized generic path, publication-gate bypass, or raw payout/credential data stored or logged outside its canonical owner.

## Rollback

Prefer gating the defective mutation/publication transition while preserving reads and audit. Do not delete activation events, document reviews, field evidence, outbox state or other audit material to simplify recovery. Schema rollback requires the current migration policy and a forward-repair plan for already-written data.

## Closure evidence

Record exact candidate SHA, sanitized request/response metadata, relevant audit/outbox identifiers and post-recovery readback. A UI toast or local state change alone never closes the incident or journey.
