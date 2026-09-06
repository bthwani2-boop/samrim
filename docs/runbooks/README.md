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

Current operational runbooks strictly document active, executable services in the repository. Future domain capabilities (Commerce, Finance, Fulfillment, Communications, Partner Operations) remain governed exclusively under `governance/product/capabilities/` and will introduce operational runbooks only when executable implementations are materialized.

### Access & Identity
- `access/identity.md` — Covers human actor authentication, session management, managed role onboarding/activation, operator reenrollment, emergency recovery, and delivery.

### Platform
- `platform/systemic-platform-recovery.md` — Covers platform incident response, schema conformance verification, local runtime reset, and emergency containment.

Conditional, speculative, or unbuilt domain operations that are not executable today do not belong in current runbooks.

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
