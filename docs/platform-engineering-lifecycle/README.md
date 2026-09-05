# Platform Engineering Lifecycle Routing Map

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_AND_OPERATIONS_GUIDANCE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_TRUTH_SOURCE: LIVE_REPOSITORY_SOURCE_AND_RUNTIME
MUTABLE_EXTERNAL_POLICY_TRUTH_SOURCE: CURRENT_OFFICIAL_PLATFORM/STORE_DOCUMENTATION

## Purpose

This file is a cross-topic **routing map**, not an execution lifecycle, stage machine, checklist authority or duplicate engineering handbook.

For material repository execution, the Orchestrator owns stages/movement/evidence/closure. Governance owns durable meaning. Focused Docs own human procedures. Executable source/runtime owns current implementation truth.

## Lifecycle questions and canonical routes

| Question | Load |
|---|---|
| What Product outcome/actor/journey is required? | `governance/product/PRD.md`, `pnpm knowledge:query -- capability ...`, `pnpm knowledge:query -- journey ...` |
| What donor/history truth matters? | `docs/reference/donor-reconstruction-patterns.md`; Orchestrator clean-target profile when executing reconstruction |
| What architecture/owner/topology is canonical? | `governance/architecture/**`, especially ownership map and app/service composition |
| How do I change code/data/contracts safely? | focused `docs/development/**` guide + applicable Governance policy |
| How do Identity/access semantics affect the slice? | the relevant capability owner + `governance/project/ACTORS-TRUST-AND-SCOPE.md` + security policy |
| How do UX/RTL/accessibility/design apply? | `governance/product/EXPERIENCE-AND-DESIGN.md` + `docs/development/design-system.md` |
| How do providers/finance/async failure semantics apply? | provider policy + financial model + applicable capability owner |
| How is the candidate built/released to stores? | `docs/development/release-and-store-submission.md` + delivery policy + executable build config |
| How are incidents diagnosed/recovered? | `docs/runbooks/README.md` |
| What evidence proves current implementation? | `docs/development/repository-evidence.md`, CI/quality guide and Orchestrator verification owner when invoked |

## Anti-duplication rule

Do not add numbered lifecycle modules that restate focused guides, Governance policies or Orchestrator gates.

```text
LIFECYCLE MAP = ROUTING ONLY
FOCUSED GUIDE = HUMAN PROCEDURE
GOVERNANCE = DURABLE RULE
ORCHESTRATOR = EXECUTION/CLOSURE
SOURCE/RUNTIME = CURRENT IMPLEMENTATION TRUTH
```

If a lifecycle topic needs more detail, expand the focused owner that already owns that human procedure instead of creating a parallel lifecycle chapter.
