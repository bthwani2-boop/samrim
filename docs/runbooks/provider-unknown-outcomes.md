# External Provider Unknown-Outcome Runbook

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Trigger

Use when an externally consequential mutation times out, loses its callback/response, returns an ambiguous result or produces contradictory provider evidence.

## Rules

- timeout is not proof of failure;
- missing confirmation is not success;
- preserve operation/idempotency/provider reference;
- do not blind-fallback to another provider if duplicate external effect is possible;
- internal canonical state changes only through the operation-owning domain.

## Diagnose

1. identify owning domain and logical operation ID;
2. inspect canonical internal state/readback;
3. inspect provider provenance/reference;
4. query/reconcile authoritative provider evidence when supported;
5. classify proven success, proven failure/rejection, or still unknown.

## Recovery

For still-unknown outcomes, continue reconciliation rather than replaying a financially/operationally destructive mutation. Use compensation/reversal only when the owner state machine permits it.

## Verify

Prove external evidence, canonical internal state, audit/reconciliation status and required surface readback agree.
