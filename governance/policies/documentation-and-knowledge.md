# Documentation and Knowledge-System Policy

ARTIFACT_CLASS: DURABLE_DOCUMENTATION_KNOWLEDGE_POLICY
SEMANTIC_OWNER: governance/policies/documentation-and-knowledge.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Scope

This policy owns durable quality/authority rules for Governance, human Docs, agent-routing adapters and derived knowledge views.

It does not own Product capabilities, implementation state or campaign execution. Those remain with their canonical semantic owners, executable source/runtime and the Orchestrator respectively.

## Authority partition

~~~text
GOVERNANCE   = DURABLE PRODUCT/SYSTEM/ARCHITECTURE/POLICY MEANING
DOCS         = HUMAN DEVELOPMENT/OPERATIONS GUIDANCE
ORCHESTRATOR = EXECUTION/RECOVERY/VERIFICATION/CLOSURE LAW
SOURCE       = CURRENT IMPLEMENTATION/CONFIGURATION/RUNTIME TRUTH
AGENT ROUTER = NON-AUTHORITATIVE NAVIGATION
~~~

A document may summarize another owner for usability only when the owner remains clear and the summary does not introduce a competing rule.

## Governance completeness

Governance is semantically complete when a qualified developer or coding agent can determine, without reverse-engineering accidental implementation structure:

- platform purpose/surfaces/actors/trust model;
- canonical bounded-context ownership;
- durable capability and journey meaning;
- writer/readback authority;
- data/contract/integration boundaries;
- financial ownership/invariants;
- security/privacy boundaries;
- app-host versus service responsibilities;
- UX/RTL/accessibility/design meaning;
- runtime/reliability/provider/delivery/tooling policies.

File count or document size is not completeness.

Every material discovered responsibility receives one durable disposition:

~~~text
DURABLE_CAPABILITY
SUBCAPABILITY
POLICY
TECHNICAL_MECHANISM
DERIVED_PROJECTION
EXPLICIT_NON_GOAL
DEAD/INVALID_WITH_REASON
~~~

Durable responsibilities have exactly one semantic owner.

## Capability and journey separation

Capabilities own stable problem/outcome/actor/owner/state/action/invariant/failure/acceptance meaning. Journeys compose actor/system steps across capabilities.

~~~text
CAPABILITY != SCREEN
CAPABILITY != ROUTE
CAPABILITY != TECHNICAL PACKAGE
JOURNEY != CAPABILITY REGISTRY
TARGET CAPABILITY/JOURNEY != ACTIVE IMPLEMENTATION STATE
~~~

Every durable capability must be mapped to at least one material journey/system outcome or explicitly justified as a system/administrative responsibility. Every material journey step must resolve to a durable owner or an explicit external/technical mechanism.

## Current-state exclusion

Durable Governance/Docs must not hand-maintain current implementation inventories that executable source can answer more accurately, including:

- live route/operation/table/column lists;
- generated-client inventories;
- CI/run status;
- current provider health;
- current environment values;
- active campaign frontier;
- branch/session-specific state.

~~~text
CURRENT STATE → SOURCE/RUNTIME/HISTORY
DURABLE MEANING → GOVERNANCE
~~~

## Docs portability and staleness

Docs are portable human guidance. They must not depend on obsolete machine-local paths, historical branch names, campaign-only instructions or losing donor topology as current authority.

When Docs mention executable commands, paths, ports, environment variables or configuration, verify them against the same repository candidate or clearly label them as historical/reference material.

~~~text
STALE_COMMAND/PATH_GUIDANCE = DEFECT
CAMPAIGN_STATE_IN_DURABLE_DOCS = FORBIDDEN
DOCS_PARALLEL_PRODUCT/CONTRACT/DATA_AUTHORITY = FORBIDDEN
~~~

Historical donor examples may live only in an explicitly non-authoritative reference area and must not masquerade as current implementation guidance.

## Developer reconstruction acceptance

The Docs system is adequate when a new qualified developer can find how to:

- bootstrap the repository/environment;
- navigate repository ownership/topology;
- identify capability/journey/owner;
- add/change app routes and feature presentation;
- develop service/domain behavior;
- evolve database/migrations;
- evolve contracts/generated clients;
- run tests/verification;
- configure runtime/secrets/providers;
- build mobile/control-panel/services;
- use Design System/RTL/accessibility guidance;
- inspect observability/evidence;
- locate runbooks and external references.

Several topics may be coherently routed to one guide. Completeness is semantic, not one-file-per-topic.

## Runbook boundary

Runbooks own diagnosis, containment, recovery and operational procedure. They never:

- bypass canonical state transitions;
- fabricate an unknown external/financial outcome;
- write another service's private data directly merely for recovery convenience;
- redefine Product/security/financial truth;
- become hidden permanent deployment/configuration authority.

A runbook that requires an emergency mechanism must route to an explicitly governed mechanism with audit/reconciliation/recovery semantics.

## Semantic-parity preservation

When consolidating/deleting old Governance/Docs/agent instructions:

~~~text
CENSUS MATERIAL MEANING
→ MAP EACH ATOM TO CANONICAL OWNER
→ PRESERVE / REFINE / MERGE / REHOME / SUPERSEDE / REJECT_WITH_REASON
→ VERIFY NO REQUIRED MEANING LOST
→ DELETE LOSER
~~~

Filename parity is irrelevant. Required semantic/operational value is what must survive.

A later shorter document may replace several old files only when the same still-valid meaning is represented or deliberately superseded.

## Agent routing and selective loading

Root/nested agent adapters must remain routing-only and declare non-authority.

Large canonical catalogs may be queried through deterministic source-derived tooling when this reduces context load. Such indexes/query outputs are derived views and must not become editable parallel registries.

A material task should load only the semantic/execution owners that can affect its decision, but skipping an applicable owner to avoid a constraint is forbidden.

## Knowledge verification

Knowledge verification should detect relationships and contradictions, not merely required phrases.

Applicable checks include:

~~~text
DUPLICATE_SEMANTIC_OWNER=0
CONTRADICTORY_PLACEMENT_RULES=0
DOCS_NORMATIVE_AUTHORITY=0
ORCHESTRATOR_PRODUCT_AUTHORITY=0
GOVERNANCE_EXECUTION_STATE=0
STALE_CURRENT_STATE_IN_DURABLE_DOCS=0
BROKEN_INTERNAL_REFERENCE=0
ORPHANED_REQUIRED_GUIDANCE=0
KNOWLEDGE_FALSE_GREEN=0
AGENT_AMBIGUITY=0
~~~

A verifier that passes while a known material contradiction exists is itself defective.

## External references

External/open-source systems, standards and donor material are reference/falsification inputs. They do not become BThwani authority by being documented.

Reference material should state:
- what question it helps answer;
- priority/use mode;
- whether it is reference-only or an adoption candidate;
- revalidation needs for mutable license/security/version/platform terms.

## Closure properties

Applicable knowledge-system closure requires:

~~~text
GOVERNANCE_ENTRYPOINT=PASS
DOCS_ENTRYPOINT=PASS
AGENT_ROUTING_ENTRYPOINT=PASS
ONE_DURABLE_OWNER_PER_MATERIAL_MEANING=PASS
CAPABILITY/JOURNEY_RESPONSIBILITY_COVERAGE=PASS
UNOWNED_MATERIAL_JOURNEY_STEPS=0
MANUAL_IMPLEMENTATION_INVENTORY_AUTHORITY=0
DUPLICATE_DURABLE_MEANING_AUTHORITIES=0
DOCS_PARALLEL_AUTHORITY=0
CAMPAIGN_BRANCH_SPECIFIC_RESIDUE=0
STALE_COMMAND/PATH_GUIDANCE=0
REQUIRED_HISTORICAL_SEMANTIC_VALUE_LOST=0
KNOWLEDGE_FALSE_GREEN=0
AGENT_AMBIGUITY=0
~~~
