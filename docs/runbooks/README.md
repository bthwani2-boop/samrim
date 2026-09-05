# BThwani Operational Runbooks

DOCUMENT_CLASS: OPERATIONAL_RUNBOOK_INDEX
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

## Precedence

Runbooks explain diagnosis, containment, recovery and operational verification. They do not redefine Product/domain ownership, legal state transitions, financial truth, authorization or current implementation.

```text
GOVERNANCE OWNER
→ LIVE EXECUTABLE SOURCE / CONTRACT / CONFIG / RUNTIME
→ APPLICABLE RUNBOOK
```

If a runbook conflicts with executable behavior, fix the runbook unless the executable behavior itself violates Governance.

## Router

### Access
- `access/identity.md`

### Commerce
- `commerce/client-addresses.md`
- `commerce/stores.md`
- `commerce/orders.md`
- `commerce/catalog-promotions-ratings.md`
- `commerce/special-requests-and-support.md`

### Partner
- `partner/partner-onboarding.md`

### Fulfillment
- `fulfillment/dispatch.md`

### Communications
- `communications/communications-and-media.md`

### Finance
- `finance/checkout-wlt.md`
- `finance/payments.md`
- `finance/wallet-reconciliation.md`
- `finance/settlements-and-payouts.md`
- `finance/provider-unknown-outcomes.md`

### Platform
- `platform/systemic-platform-recovery.md`

Conditional/future mechanisms that are not executable today do not belong in current runbooks. Preserve historical rationale in Git or non-authoritative external/donor reference material only when it still has evidence value.

Mobile/EAS, observability and release procedures belong under `../development/`.

## Runbook law

Every operational runbook declares:

```text
DOCUMENT_CLASS: OPERATIONAL_RUNBOOK
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
```

A runbook must:

- identify the applicable semantic owner(s);
- use current public/operational interfaces rather than direct table edits as the normal path;
- distinguish unknown/pending from success/failure;
- preserve idempotency, correlation and financial/security evidence;
- avoid secrets and unnecessary PII in logs/tickets;
- verify canonical readback after recovery;
- use current configuration for thresholds rather than historical constants;
- contain no Product roadmap, Orchestrator stages/closure gates or hand-maintained current route/table/schema registry.

A runbook may mention an implementation path only when operationally useful and must not become a second implementation authority.
