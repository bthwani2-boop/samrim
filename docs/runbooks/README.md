# BThwani Operational Runbooks

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK_INDEX
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Precedence

Runbooks explain diagnosis, containment, recovery and operational verification. They do not redefine Product/domain ownership, legal state transitions, financial truth, authorization or runtime implementation.

Use this precedence:

```text
governance durable semantic owner
→ live executable contracts/code/config/data/runtime
→ applicable runbook
```

If a runbook conflicts with a live executable path/command, correct the runbook. If implementation conflicts with durable governance, treat it as a product/architecture finding rather than silently changing the runbook to bless the drift.

## Runbook map

- `identity.md` — Identity availability, sessions/activation and safe support diagnostics.
- `client-addresses.md` — client addresses, serviceability, privacy lifecycle and conflicts.
- `partner-onboarding.md` — onboarding/readiness/publication support.
- `stores.md` — store discovery/publication/governance operations.
- `orders.md` — canonical order operational truth and incident recovery.
- `checkout-wlt.md` — checkout↔WLT handoff and unknown financial outcome handling.
- `dispatch.md` — captain offer/assignment/timeout/reassignment operations.
- `payments.md` — payment sessions/provider webhook/reconciliation safety.
- `wallet-reconciliation.md` — WLT-backed projection/reconciliation incidents.
- `settlements-and-payouts.md` — WLT settlement/payout/reconciliation incidents.
- `workforce.md` — workforce profile/engagement/eligibility incidents.
- `platform-control.md` — governed variables/change-set/rollout incidents.
- `provider-unknown-outcomes.md` — ambiguous external mutation/provider outcomes.
- `special-requests-and-support.md` — special-request and support/rescue incidents.
- `rollout-recovery.md` — progressive rollout containment/rollback/recovery.

Mobile build activation and Sentry setup live under `../development/`, not operational runbooks.

## Runbook law

A runbook must:

- identify its semantic owner(s);
- use current public/operational interfaces rather than direct table edits as the normal recovery path;
- distinguish unknown/pending from failure/success;
- preserve idempotency/correlation and financial/security evidence;
- avoid copying secrets or unnecessary PII into tickets/logs;
- verify canonical readback after recovery;
- use environment/configured thresholds rather than hardcoded historical numbers.

A runbook may mention an implementation path only when operationally useful and must not become a hand-maintained route/table registry.
