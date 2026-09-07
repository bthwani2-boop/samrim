# BThwani Governance

ARTIFACT_CLASS: DURABLE_GOVERNANCE_INDEX
SEMANTIC_OWNER: governance/GOVERNANCE.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## 1. Authority boundary

Governance contains only durable BThwani Product/System/architecture/policy meaning.

~~~text
GOVERNANCE   = DURABLE MEANING / OWNERSHIP / POLICY
SOURCE       = CURRENT EXECUTABLE IMPLEMENTATION / CONFIGURATION / RUNTIME
ORCHESTRATOR = AUTHORIZED EXECUTION / RECOVERY / EVIDENCE / CLOSURE
DOCS         = HUMAN DEVELOPMENT / OPERATIONS GUIDANCE
GIT HISTORY  = HISTORICAL RATIONALE / FORENSICS
~~~

Governance does not own campaign stages, branch state, current route/table/config inventories, CI status, runtime health or execution order.

## 2. One-source law

~~~text
ONE MATERIAL MEANING       → ONE EDITABLE SEMANTIC OWNER
ONE MATERIAL MUTABLE FACT  → ONE CANONICAL WRITER
ONE CROSS-BOUNDARY CONTRACT→ ONE EXECUTABLE PROVENANCE
INDEX / ROUTER             → ROUTING ONLY
DERIVED VIEW / QUERY       → NON-AUTHORITATIVE
HISTORICAL RATIONALE       → GIT HISTORY
~~~

Agreement between duplicate rules does not make duplication acceptable.

## 3. Project model

- `project/PLATFORM.md` — what BThwani is, target surfaces and bounded-context orientation.
- `project/GLOSSARY.md` — canonical vocabulary.
- `project/ACTORS-TRUST-AND-SCOPE.md` — Human Actor, Identity Role, Product Persona, organization/scope/trust distinctions.

## 4. Product model

- `product/PRD.md` — product-level definition, non-goals and cross-product requirements.
- `product/CAPABILITIES.md` — capability schema, admission law and routing only.
- `product/capabilities/**/*.md` — exactly one editable owner file per capability.
- `product/JOURNEYS.md` — cross-capability journey meaning.
- `product/FINANCIAL-MODEL.md` — financial sovereignty and cross-capability money semantics.
- `product/COMMERCIAL-AND-PARTNER-MODEL.md` — partner/store/commercial relationships.
- `product/EXPERIENCE-AND-DESIGN.md` — durable UX, accessibility, RTL and Design-System meaning.

## 5. Architecture model

- `architecture/SYSTEM-CONTEXT.md` — bounded contexts and dependency orientation.
- `architecture/OWNERSHIP-AND-SOURCE-OF-TRUTH.md` — canonical owner/writer/readback map.
- `architecture/REPOSITORY-TOPOLOGY.md` — physical placement and container admission.
- `architecture/APP-SERVICE-COMPOSITION.md` — deployable-host versus service-capability responsibility.
- `architecture/DATA-CONTRACTS-AND-INTEGRATIONS.md` — cross-boundary data/contract/protocol architecture.
- `architecture/RUNTIME-AND-CONFIGURATION.md` — configuration/runtime architecture.
- `architecture/PLATFORM-SUBSTRATE.md` — durable non-semantic substrate requirements independent of campaign stages.

## 6. Engineering policies

- `policies/engineering.md` — cross-cutting engineering constitution and routing.
- `policies/architecture-and-fullstack.md` — full-stack structural integrity, layer/dependency/indirection rules.
- `policies/data-and-migrations.md` — data mutation, schema evolution, migrations/backfills/reconciliation.
- `policies/frontend-and-client.md` — client/presentation engineering boundaries.
- `policies/providers-and-integrations.md` — provider/integration behavior and unknown-outcome rules.
- `policies/runtime-reliability.md` — startup/readiness/failure/recovery/performance/observability behavior.
- `policies/security.md` — authentication, authorization, secrets, privacy and security boundaries.
- `policies/standards-and-quality.md` — standards, testing, dependency/adoption and quality adequacy.
- `policies/tooling-and-assurance.md` — tooling, generated/derived assurance and CI evidence.
- `policies/documentation-and-knowledge.md` — knowledge authority, portability and anti-duplication.
- `policies/delivery.md` + `policies/delivery/*.md` — delivery policy family.

## 7. No live ADR tree

Durable current rules live in their current semantic owner. Historical decision rationale is preserved by Git history rather than a second live ADR hierarchy.

If rationale becomes materially necessary for current engineering, it must be summarized in the current owner without duplicating the rule.

## 8. Current-state exclusion

Do not hand-maintain in Governance:

- current routes/endpoints/operation IDs;
- current tables/columns/migrations;
- generated-client inventories;
- current package/dependency/runtime versions unless the durable policy itself requires a range/class;
- branch/session/campaign state;
- current CI/run status;
- current provider health/config values.

Executable source/runtime is authoritative for those facts.

## 9. Semantic completeness

Every material responsibility has exactly one durable disposition:

~~~text
CAPABILITY
SUBCAPABILITY OF NAMED OWNER
DURABLE POLICY
TECHNICAL MECHANISM OWNED ELSEWHERE
DERIVED PROJECTION / READ MODEL
EXPLICIT NON-GOAL
~~~

A folder, donor artifact, route, screen, provider or table does not automatically earn capability or service status.

## 10. Developer reconstruction acceptance

Governance is complete only when a qualified developer or execution agent can determine, without reverse-engineering accidental repository structure:

- what BThwani is and is not, including explicit non-goals;
- deployable surfaces, Human Actors, Identity roles, Product personas and trust/scope boundaries;
- the canonical owner and writer of every material durable fact;
- admitted capabilities, cross-capability journeys and required/excluded surfaces;
- financial ownership, conservation, unknown-outcome and reconciliation semantics;
- authentication, authorization, privacy, secret and privileged-operation boundaries;
- app-host versus service-capability responsibility;
- data, migration, contract, generated-binding and cross-service integration expectations;
- provider/control-plane/data-plane ownership and ambiguity handling;
- experience, Arabic/RTL, accessibility and localization requirements;
- runtime, reliability, quality, delivery and release policy boundaries.

The acceptance test is semantic, not file-count based:

~~~text
UNACCOUNTED_MATERIAL_PRODUCT_RESPONSIBILITIES=0
UNOWNED_DURABLE_FACTS=0
UNMAPPED_REQUIRED_ACTORS/JOURNEYS=0
UNMAPPED_REQUIRED_FAILURE/RECOVERY_SEMANTICS=0
UNMAPPED_REQUIRED_SECURITY/PRIVACY/FINANCIAL_INVARIANTS=0
DUPLICATE_DURABLE_MEANING_AUTHORITIES=0
IMPLEMENTATION_INVENTORY_AS_GOVERNANCE_AUTHORITY=0
~~~

When history or donor evidence reveals still-required meaning that current owners do not represent, Governance is incomplete until that meaning is deliberately owned, superseded, or rejected with reason. Historical file survival is never required.

## 11. Change/survival law

A Governance artifact survives only if it owns unique current durable meaning and is not better represented by another owner or executable source.

~~~text
REQUIRED CURRENT DURABLE MEANING
+ UNIQUE RESPONSIBILITY
+ CORRECT OWNER
+ NO PARALLEL AUTHORITY
+ NO CAMPAIGN/HISTORICAL RESIDUE
= SURVIVES
~~~

Otherwise delete it. Git is the archive.
