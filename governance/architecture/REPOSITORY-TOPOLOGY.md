# Repository Topology and Placement Authority

ARTIFACT_CLASS: DURABLE_ARCHITECTURE_GOVERNANCE
SEMANTIC_OWNER: governance/architecture/REPOSITORY-TOPOLOGY.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Purpose

This file owns BThwani's durable repository responsibility taxonomy and placement rules. It defines stable ownership classes, not current file inventory. Exact files/workspaces that exist on a candidate remain executable repository truth.

## Canonical top-level taxonomy

```text
apps/        deployable application hosts/composition
services/    bounded-context/service owners
packages/    proven reusable technical code only
contracts/   genuinely cross-service protocol primitives/generated catalogs only
infra/       environment/deployment composition only
governance/  durable Product/System/architecture/policy meaning
docs/        human development/operations/reference guidance
tools/       cross-repository automation/generation/inspection/evidence
```

These classes are durable architectural meaning. A top-level class may be physically absent only when the platform has no responsibility of that class; no alternative generic bucket may silently replace it.

## Forbidden generic ownership roots

Top-level `core/` and `shared/` are not canonical ownership classes.

Generic `common`, `shared`, `core`, `utils`, `helpers` or `platform` containers below canonical roots require positive proof of one cohesive responsibility and must not hide multiple domain/technical owners.

```text
GENERIC_BUCKET != CANONICAL_OWNER
PATH_EXISTENCE != OWNERSHIP_PROOF
```

## Deployable applications

Deployable hosts are direct roots:

```text
apps/app-client/
apps/app-partner/
apps/app-captain/
apps/app-field/
apps/control-panel/
```

This file owns their **repository placement and container admission only**. The durable responsibility split between app hosts and service capabilities is owned exclusively by `APP-SERVICE-COMPOSITION.md`.

A pass-through `apps/<app>/runtime/` wrapper with no independent sibling lifecycle is noncanonical. Preserve deployable identity while flattening; path cleanup never authorizes accidental Expo/EAS/package/bundle/scheme/update/hosting identity change.


## Services

A `services/<owner>/` container is admitted only when the corresponding semantic responsibility and required lifecycle/storage/API/runtime boundary are already justified by the applicable Governance owner.

Default repository shape:

```text
services/<owner>/
  backend/
  contracts/
  clients/
  database/
  tests/
```

This is a placement template, not permission to create empty lanes or a statement that every bounded context must be independently deployable. Subdirectories exist only when their technical responsibility is real.

Whether presentation belongs to an app host, a service, or a reusable presentation owner is **not defined here**; `APP-SERVICE-COMPOSITION.md` owns that semantic composition rule.

Identity, DSH and WLT are durable primary bounded-context responsibilities. Platform Control or any other peer service earns an independent `services/*` deployable only after its executable service-admission evidence is proven; donor/current folder names never grant admission.


## Packages

`packages/` contains cohesive reusable technical code only when all are true:

```text
MULTIPLE_REAL_CONSUMERS
COHESIVE_TECHNICAL_RESPONSIBILITY
NO_BUSINESS_TRUTH_AUTHORITY
NO_DEPLOYABLE_APP_OWNERSHIP
NO_SERVICE_STORAGE_AUTHORITY
LOWER_TOTAL_COMPLEXITY_THAN_LOCAL_OWNERSHIP
```

The Design System is the reusable visual-system technical owner. `packages/` must not become a renamed `shared/` dumping ground.

## Contracts

Service-owned business API/event semantics stay under `services/<owner>/contracts` with deterministic generated lineage.

Root `contracts/` is limited to stable genuinely cross-service wire/protocol primitives and generated/non-authoritative discovery catalogs when a real consumer requires them. It never owns business operations or becomes a gateway runtime.

## Infrastructure

`infra/` owns environment/deployment composition: local compose/provisioning, environment-level observability and real deployment/IaC wiring when present.

It must not own service schema/migrations, Product fixtures, provider business semantics, app configuration contracts or secret values.

## Governance, Docs and Tools

- Governance owns durable meaning/policy/ownership, never campaign/current implementation state.
- Docs own human development/operations/reference guidance, never Product/contract/data/current-runtime authority.
- Tools automate/generate/inspect/produce evidence, never Product/architecture/readiness/closure authority.
- Service/app-specific tooling stays with its semantic lifecycle owner unless the tool is genuinely cross-repository.

## Naming and public boundary law

Stable names describe semantic responsibility rather than actor/page/route/mechanism/technology.

Public exports/workspace boundaries expose semantic owners directly. Re-export chains, pass-through wrappers and aliases with no unique compatibility/interface role are removed after consumer cutover.

## Topology qualification

Repository topology is not qualified while any known material instance remains of:

```text
TOP_LEVEL_GENERIC core/shared OWNERSHIP
PASS_THROUGH_apps/*/runtime_WITHOUT_UNIQUE_ROLE
BUSINESS_AUTHORITY_IN_ROOT_contracts
BUSINESS_SEMANTICS_IN_infra
PACKAGES_AS_GENERIC_DUMPING_GROUND
SERVICE→APP_DEPENDENCY
APP_HOST_AS_BUSINESS_OWNER
DUPLICATE/AMBIGUOUS_OWNER_CONTAINERS
TEMPORARY_REFOUNDATION_FILE_AS_ONLY_DURABLE_TOPOLOGY_OWNER
```

Move/rename alone never satisfies topology. Required value is re-owned, consumers are cut over, losing containers are deleted, and exact current repository evidence proves the resulting dependency/ownership shape.
