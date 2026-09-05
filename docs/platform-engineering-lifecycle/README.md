# Platform Engineering and Delivery Lifecycle Guide

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_AND_OPERATIONS_GUIDANCE  
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_TRUTH_SOURCE: LIVE_REPOSITORY_SOURCE_AND_RUNTIME

MUTABLE_EXTERNAL_POLICY_TRUTH_SOURCE: CURRENT_OFFICIAL_PLATFORM/STORE_DOCUMENTATION

## 1. Purpose

This guide describes a rigorous end-to-end method for taking a multi-surface full-stack platform from an empty target repository to production operation and public mobile-store distribution when a legacy/donor system already exists.

It is a working guide, not a second source of Product truth, architecture authority, release authority, or campaign execution authority.

Authority remains with:

- `governance/**` for durable Product/System/Engineering meaning;
- executable source/contracts/configuration for current implementation state;
- `tools/prompting/bthwani-orchestrator/**` for material repository execution, refoundation, recovery, verification and closure work when invoked;
- current official Apple/Google/platform documentation for mutable store and platform rules.

When this guide conflicts with a canonical semantic owner, executable source, or current official platform rule, this guide is stale and must be corrected.

## 2. How to use this guide

This directory is a **human reference map**, not a lifecycle state machine. For material repository work, the Orchestrator alone selects stages, execution order, active Product breadth, recovery state, verification gates and closure. Governance alone owns durable Product/System/architecture/policy meaning.

Use these modules only after resolving the applicable canonical owners. They explain practical questions, techniques, failure modes and evidence examples that may help a developer execute the already-authorized work. Module numbering is reading organization only and does not authorize or sequence a campaign.

```text
MODULE_NUMBER != EXECUTION_PHASE
DOC_CHECKLIST != CLOSURE_GATE
DOC_EXAMPLE != PRODUCT_DECISION
DOC_ORDER != ACTIVE_PRODUCT_SLICE
```

When a module states a durable requirement, the applicable Governance owner is authoritative. When it describes a command/configuration/current implementation fact, executable source is authoritative. When it describes execution movement, proof or closure, the Orchestrator is authoritative.

## 5. Reference baseline

Use context-appropriate standards rather than inventing a private assurance system.

Recommended baseline:

- NIST SP 800-218 Secure Software Development Framework (SSDF) for secure-development practices.
- OWASP ASVS 5.x for web/backend application-security verification requirements.
- OWASP MASVS + MASTG/MASWE for mobile security verification and testing.
- WCAG 2.2, normally Level AA where applicable for web accessibility, plus native platform accessibility semantics.
- OpenAPI or another machine-verifiable canonical interface description for HTTP APIs when appropriate.
- OpenTelemetry or equivalent standard telemetry interfaces when tracing/metrics are required.
- SLSA concepts for build provenance/attestation where supported and material.
- Platform-native Apple/Android security, privacy, permission, signing, and store requirements.
- Jurisdiction-specific legal/privacy/financial advice where the business model requires it; store compliance is not legal compliance.

Reference links are listed at the end of this guide.

---

## Lifecycle module map

Continue by need rather than loading the entire lifecycle every time:

1. `01-foundation-scope-and-donor.md` — scope vocabulary, donor inspection and Product/actor/journey discovery guidance.
2. `02-architecture-security-and-technical-foundation.md` — domain/data/runtime boundaries, threat/privacy design, repository/CI, environments, migrations, contracts, backend chassis.
3. `03-identity-experience-and-journey-ready.md` — Identity/access, UI/UX foundation, app shells, representative walking skeleton and repeatable journey loop.
4. `04-integrations-finance-and-verification.md` — providers, async work, notifications, financial systems and verification architecture.
5. `05-build-release-and-operations.md` — secure build, production infrastructure, staging, beta, stores, release choreography, launch/support and continuous delivery.
6. `06-evidence-gates-and-templates.md` — non-authoritative evidence checklist examples, donor/journey worksheets, complexity questions and references.

These modules are human guidance only. The Orchestrator decides execution/closure and Governance owns durable meaning.
