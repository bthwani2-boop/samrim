# BThwani Governance Index

ARTIFACT_CLASS: DURABLE_PROJECT_GOVERNANCE
SEMANTIC_OWNER: governance/GOVERNANCE.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Purpose

`governance/**` is the durable semantic constitution of BThwani: Product/System meaning, bounded-context ownership, cross-surface experience, engineering policy, security/privacy, data, runtime/reliability and delivery expectations.

It is not an execution engine, branch controller, CI authority, runtime-state inventory, route/table/operation registry or release approval mechanism. During the current refoundation campaign, execution order, mutation, recovery and closure remain owned exclusively by `tools/prompting/bthwani-orchestrator/00-ORCHESTRATOR.md`; branch-specific campaign details belong to that temporary execution authority, not durable Governance.

```text
GOVERNANCE   = DURABLE MEANING / POLICY / OWNERSHIP
DOCS         = HUMAN DEVELOPMENT / OPERATIONS GUIDANCE
SOURCE       = CURRENT IMPLEMENTATION STATE
ORCHESTRATOR = ACTIVE REFOUNDATION EXECUTION / CLOSURE
```

## Authority model

Material claims are interpreted by class:

1. current explicit human Product/System decisions;
2. the applicable durable semantic owner in `governance/**`;
3. executable contracts, schemas, code, configuration and runtime evidence for current implementation state;
4. `docs/**` for non-authoritative development/operations guidance;
5. historical/external material only as forensic/reference input.

A current implementation can reveal drift but does not silently redefine Product meaning. Governance cannot claim that a route, table, provider, test or deployment currently exists merely because a document says so.

## Canonical semantic owners

### Project orientation

- `project/PLATFORM.md` — platform classification, surfaces, actors, fulfillment/commercial modes and bounded contexts.
- `project/GLOSSARY.md` — ubiquitous language.
- `project/ACTORS-TRUST-AND-SCOPE.md` — actor/role/engagement/organization/scope/context trust model.

### Product

- `product/PRD.md` — platform requirements and non-goals.
- `product/CAPABILITIES.md` — durable capability semantic envelope, outcomes, actors, owner boundaries, state/acceptance/failure semantics and success measures.
- `product/JOURNEYS.md` — cross-capability actor/system journeys.
- `product/FINANCIAL-MODEL.md` — cross-capability WLT/financial model.
- `product/COMMERCIAL-AND-PARTNER-MODEL.md` — partner/store/commercial relationship model.
- `product/WORKFORCE-MODEL.md` — person/engagement/eligibility/operational-role model.
- `product/EXPERIENCE-AND-DESIGN.md` — durable UX, RTL/accessibility and design-system meaning.

### Architecture

- `architecture/SYSTEM-CONTEXT.md` — bounded contexts and dependency direction.
- `architecture/OWNERSHIP-AND-SOURCE-OF-TRUTH.md` — semantic owner/writer/readback map.
- `architecture/APP-SERVICE-COMPOSITION.md` — deployable-host versus service-capability responsibility.
- `architecture/DATA-CONTRACTS-AND-INTEGRATIONS.md` — data/contract/version/integration boundaries.
- `architecture/RUNTIME-AND-CONFIGURATION.md` — runtime/configuration classes and technical operating boundaries.
- `decisions/README.md` — ADR admission and rationale policy.

### Engineering policies

- `policies/engineering.md` — universal engineering constitution and owner routing.
- `policies/architecture-and-fullstack.md` — bounded contexts, dependency direction, app/host vs service ownership, contracts and structural integrity.
- `policies/data-and-migrations.md` — data authority, schemas, migrations, backfills, seeds and durable-data evolution.
- `policies/frontend-and-client.md` — client responsibility, state/readback, accessibility and presentation boundaries.
- `policies/runtime-reliability.md` — runtime/configuration, external systems, failure/recovery, observability and development-environment invariants.
- `policies/security.md` — identity, authorization, credentials, privacy, financial security and untrusted boundaries.
- `policies/standards-and-quality.md` — standards, testing, dependency/adoption, licensing and assurance adequacy.
- `policies/delivery.md` — candidate identity, promotion, rollout, release, rollback and delivery evidence.

## One-source laws

```text
ONE_REQUIRED_MEANING → ONE_SEMANTIC_OWNER
ONE_MATERIAL_MUTABLE_STATE → ONE_CANONICAL_WRITER
ONE_CROSS_BOUNDARY_PROTOCOL → ONE_EXECUTABLE_CONTRACT_PROVENANCE
DERIVED/CACHED/MATERIALIZED != AUTHORITATIVE
DOCS != DURABLE_PRODUCT_GOVERNANCE
TEST_GREEN != DURABLE_PRODUCT_GOVERNANCE
CI_GREEN != CLOSURE
```

Text may summarize another owner for navigation, but it must identify that owner and may not introduce a competing rule.

## What governance must not contain

Final Governance must not hand-maintain implementation inventories derivable from executable source: route lists, operation IDs, table/column inventories, generated-client inventories, screen/hook paths, CI results, current provider health, current environment values or campaign ledgers.

## Change and survival law

A governance artifact survives only when it owns required durable meaning that is current, nonduplicative, correctly placed and not better represented by executable source.

```text
REQUIRED_DURABLE_MEANING
+ UNIQUE_RESPONSIBILITY
+ CORRECT_SEMANTIC_OWNER
+ NO_PARALLEL_AUTHORITY
+ NO_TASK/BRANCH/SESSION_RESIDUE
= ADMISSIBLE
```

`DEPRECATED` or `SUPERSEDED` does not grant survival rights. Required historical decision rationale may survive as an ADR when the rationale itself remains valuable; otherwise Git history is the archive.

## Developer reconstruction test

Governance is sufficient only when a qualified developer can determine, without reverse-engineering accidental repository structure:

- what BThwani is and is not;
- deployable surfaces and primary actors;
- the canonical bounded-context owner of every material fact;
- required capabilities and cross-surface outcomes;
- financial ownership and failure/reconciliation semantics;
- authorization/trust boundaries;
- app-host versus service-capability responsibilities;
- contract/data/migration expectations;
- provider/integration boundaries;
- UX/RTL/accessibility requirements;
- runtime/reliability/security/quality/delivery policies.

Implementation commands and operating procedures remain in `docs/**`.
