# Architecture Decision Records

ARTIFACT_CLASS: DURABLE_DECISION_RATIONALE
SEMANTIC_OWNER: governance/decisions/
EXECUTION_AUTHORITY: NONE

## Purpose

ADRs preserve rationale for a small number of durable architectural/Product decisions whose context and trade-offs remain valuable after implementation changes.

They do not replace the current rule owner.

## Admission

Create an ADR only when the decision is materially cross-cutting or hard to reverse, alternatives/trade-offs matter for future maintainers, the rationale cannot be understood sufficiently from the current semantic owner, and the ADR will not become a mutable implementation registry.

## Required shape

An ADR records Context, Decision, Alternatives, Consequences and Supersession.

## High-value ADR subjects

Examples include repository taxonomy, app-host/service-capability separation, WLT independence, Identity/Workforce separation, provider control-plane/data-plane separation, contract sovereignty and design-system authority.

Git history remains the archive for ordinary implementation changes. Do not create ADRs merely to preserve obsolete files or campaign history.


## Current durable ADRs

- `0001-repository-taxonomy.md`
- `0002-app-host-service-capability-separation.md`
- `0003-wlt-financial-sovereignty.md`
- `0004-identity-workforce-separation.md`
- `0005-domain-specific-external-integration-ports.md`
- `0006-service-contract-sovereignty.md`
- `0007-design-system-authority.md`
