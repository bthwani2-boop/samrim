# BThwani Governance

ARTIFACT_CLASS: DURABLE_GOVERNANCE_INDEX
SEMANTIC_OWNER: docs/governance/README.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Authority boundary

Governance contains only current durable BThwani Product/System/Policy meaning.

```text
HUMAN AUTHORIZATION = current objective and mutation authority
SOURCE / RUNTIME    = current executable truth
GOVERNANCE          = current durable decision baseline
DOCS                = non-authoritative working guidance
REFERENCES          = evidence and falsification input
GIT                 = historical rationale
```

Governance is authoritative within the applicable durable semantic owner and challengeable by stronger fact-specific evidence. If stale, contradictory, incomplete or wrong, correct the canonical owner rather than creating an implementation-only exception.

The byte-preserved competitor observations under `docs/reference/competitors/` may contain historical references to the former externally pinned Governance. Those references are **not current instructions**: evaluate each observation only against the applicable owner routed here and the current executable BThwani implementation. Keep the frozen reference bytes intact; clarify authority outside the reference files.

## Canonical owner tree

The durable Product-scope owner is `docs/governance/product/overview.md`, bounded service/data ownership is `docs/governance/architecture.md`, and actor/surface terminology is `docs/governance/platform.md`. Capability-specific decisions remain with their distinct documents under `docs/governance/product/capabilities/`.

~~~text
docs/governance/
├── README.md            owner router
├── platform.md          roles / actors / surfaces
├── architecture.md      bounded services and data ownership
├── product/
│   ├── overview.md       admitted Product scope
│   ├── capabilities.md   capability routing
│   ├── journeys.md       cross-surface E2E scenarios
│   └── capabilities/     one file per durable capability
└── policies/            cross-cutting invariants
~~~

## Placement law

- `platform.md` answers: what is BThwani, who participates, and what trust/terms are canonical?
- `product/` answers: what current user/business outcomes and capabilities are admitted?
- `architecture.md` answers: which bounded owner owns each durable fact and how boundaries compose?
- `policies/` answers: which cross-cutting invariants apply across multiple owners?
- `docs` explains how humans/agents work; it owns no Product/System truth.
- `docs/reference` routes external evidence; reference existence never grants adoption authority.

If a fact cannot be placed without ambiguity, diagnose the owner split. Do not duplicate it.


## Cross-cutting policy routes

Routing only: each listed file owns its own durable invariants. Every policy must be indexed here, without duplicating policy law.

- `docs/governance/policies/security.md` — trusted authentication, authorization and safety invariants
- `docs/governance/policies/data.md` — canonical writers, migrations, integrity and retention
- `docs/governance/policies/finance.md` — WLT-owned money conservation, balance, collection and settlement
- `docs/governance/policies/reliability.md` — idempotency, failure handling, resilience and recovery
- `docs/governance/policies/experience.md` — owns durable information architecture, shell/navigation, interaction, RTL/localization, accessibility and recovery invariants.
- `docs/governance/policies/design.md` — owns durable cross-surface visual identity and design-language invariants; it is not an executable token or component registry.
- `docs/governance/policies/quality.md` — evidence, testing, assurance and justified closure
- `docs/governance/policies/scalability.md` — owns durable admission, escalation, proof and retirement rules for performance, capacity, scalability and load-management mechanisms; it does not own current topology, traffic, thresholds or provider choices.
- `docs/governance/policies/delivery.md` — bounded work, safe changes, integration and delivery
- `docs/governance/policies/integrations.md` — bounded external providers, rails and interoperability
- `docs/governance/policies/knowledge.md` — evidence, curation, freshness and durable sources

## One-source law

```text
ONE MATERIAL MEANING        → ONE EDITABLE SEMANTIC OWNER
ONE MATERIAL MUTABLE FACT   → ONE CANONICAL WRITER
ONE CROSS-BOUNDARY CONTRACT → ONE EXECUTABLE PROVENANCE
INDEX / ROUTER              → ROUTING ONLY
DERIVED VIEW                → NON-AUTHORITATIVE
HISTORICAL RATIONALE        → GIT HISTORY
```

## Survival law

A Governance artifact survives only when it owns unique current durable meaning that is not better represented by another owner or executable source.

```text
CURRENT DURABLE NEED
+ UNIQUE RESPONSIBILITY
+ CORRECT OWNER
+ NO PARALLEL AUTHORITY
+ NO HISTORICAL / FUTURE RESIDUE
= SURVIVES
```

Otherwise delete, merge, or rehome it. Git is the archive.
