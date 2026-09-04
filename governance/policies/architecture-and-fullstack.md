# Architecture, Layer Ownership, and Full-Stack Integrity Policy

ARTIFACT_CLASS: DURABLE_ARCHITECTURE_POLICY
SEMANTIC_OWNER: governance/policies/architecture-and-fullstack.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Architecture follows meaning

Derive structure in this order:

```text
Product Capability
-> Canonical Owner
-> Responsibility
-> Domain Boundary
-> Public Contract
-> Data Ownership
-> Dependency Direction
-> Runtime Boundary
-> Surface Composition
-> Directory
-> File
-> Symbol
```

Current folders/files do not become architecture authority by existing. A move/rename without re-ownership, rewiring, migration and cleanup is not an architectural fix.

## Layer responsibility contract

| Layer | Allowed durable responsibility | Must not become |
|---|---|---|
| Product/capability governance | outcome, actors, responsibility, journey, states/invariants, durable ownership | implementation inventory |
| Domain/backend | business decisions, legal transitions, invariants, authorization policy, idempotency/concurrency rules | transport/UI convenience layer |
| Application/handler | trusted context, validation boundary, command/query orchestration | parallel domain owner |
| Repository/data access | persistence translation and atomic data access | copied business policy |
| Database | durable state, constraints, relational/data integrity, indexes, transactional invariants | alternate domain workflow owner without explicit authority |
| Migration/backfill | forward evolution, reconciliation, ownership/data cutover | runtime business path or seed replacement |
| Contract/OpenAPI/event | cross-boundary request/response/event semantics | private implementation dump |
| Generated code | reproducible derivative of canonical source | hand-maintained authority |
| API/client adapter | protocol/transport mapping, error/shape adaptation | business truth owner |
| Controller/hook/view-model | UI orchestration, request lifecycle, canonical readback, presentation derivation | backend/domain policy clone |
| Screen/TSX | composition, rendering, ephemeral interaction state, formatting, navigation wiring, accessibility semantics | persisted business authority or raw data-access owner |
| Design system / shared presentation layer | reusable presentation semantics/primitives | Product/domain owner |

For every materially affected symbol/file/module/package/directory, establish as applicable:

`PURPOSE | OWNER | RESPONSIBILITY | ALLOWED LOGIC | FORBIDDEN LOGIC | INPUT AUTHORITY | OUTPUT SEMANTICS | DEPENDENCIES | CONSUMERS | SOURCE OF TRUTH | LIFECYCLE`.

This is an impact-analysis principle, not a requirement to maintain a repository-wide governance inventory of files.

## Full-stack vertical integrity

A material capability is not proven because a screen, endpoint and table each exist. Valid binding requires:

```text
STRUCTURAL_BINDING
+ SEMANTIC_BINDING
+ RUNTIME_VERTICAL_BINDING when runtime behavior is claimed
= VALID_FULL_STACK_BINDING
```

Trace as applicable:

```text
Product/Journey
-> Surface/Screen
-> Controller/ViewModel
-> API Adapter/Generated Client
-> Canonical Contract
-> Authentication/Authorization
-> Backend Application Handler
-> Domain/Canonical Business Owner
-> Repository/Provider Boundary
-> DB Schema/Constraints/Indexes
-> Migration/Backfill/Cutover
-> Persisted/External State
-> Canonical Readback
-> ALL affected Consumers/Surfaces
```

Static import/operation reachability proves only structure. It cannot prove permissions, persisted behavior, concurrency, failure recovery, provider outcome, migration state or cross-surface readback.

## Contracts, events, and generated bindings

For a materially affected boundary trace:

```text
canonical schema/OpenAPI/event
-> generated/manual binding
-> caller
-> auth/authz/context
-> handler/application boundary
-> domain owner
-> persistence/event/provider effect
-> response/error semantics
-> committed readback
-> every affected consumer
```

The canonical external contract owns cross-boundary meaning; implementation-local DTOs/types do not independently redefine it. Inspect enum/nullability/default/error drift, ambiguous IDs/scopes, inconsistent operation/event identity, contract bypass, shadow endpoints, stale generated clients, payloads leaking private models and incompatible consumer assumptions.

Repair generated-code defects at the authoritative schema/generator/template, regenerate deterministically and verify affected consumers. Hand-maintained generated forks are forbidden final state.

Breaking contract/event semantics require explicit affected-consumer migration/cutover. A compatibility path is allowed only for a proven compatibility window with owner, scope, observability/evidence where needed, cutover condition and removal trigger. Indefinite dual endpoints/fields/event meanings are parallel authority.

## Dependency direction

Dependencies flow toward stable owners/boundaries. Material defects include circular ownership, lower layers importing surface/runtime implementations, domain logic depending on transport/UI, direct persistence/provider access bypassing owner, cross-surface copied business logic, public APIs leaking private models, re-export chains hiding ownership and historical package boundaries with no current responsibility.

Correct the highest authoritative boundary; do not add inversion layers or wrappers without unique material value.

## Shared code and indirection

A shared abstraction requires a genuinely shared stable concept, clear owner, real multiple consumers and no leakage of domain authority. Generic `shared/common/utils/helpers` directories are not automatically wrong, but mixed ownership or unclear consumers is a defect.

Each wrapper/adapter/facade must own unique value such as protocol translation, security boundary, lifecycle/state, orchestration, bounded compatibility, testable transformation or runtime isolation. Pass-through indirection with no unique responsibility should be merged/inlined/deleted after consumer proof.

## Naming and discoverability

A competent engineer should be able to locate the canonical owner, public contract, configuration schema, runtime entrypoint and derived/generated path for a material concept without guessing among multiple plausible authorities.

Misleading names, stale aliases, duplicate commands/exports, historical folder names and convenience re-export chains are defects when they can direct future reads/writes to the wrong owner. After rename/move/cutover, repair consumers/references and remove obsolete aliases unless a bounded compatibility requirement proves otherwise.

## Semantic duplication and parallel truth

Inspect beyond textual clones: duplicated decision rules, authorization, validation, state mapping, DTO/contract mapping, writer logic, config/routing authority and UI state authority. Remove duplicated authority at the canonical owner before optimizing harmless textual repetition.

Compatibility windows require a proven need, owner, bounded scope, cutover condition and removal trigger. `keep both in sync` is not a permanent architecture.

## Structural finishing

Before a materially affected structural change is considered complete, inspect its negative space for ownerless artifacts, misplaced files, stale imports/exports, dead aliases, duplicate authorities, pass-through wrappers, obsolete dependencies, generated forks, legacy paths and unfinished moves/splits/merges. Known material residue tied to the change remains unresolved.


## App-host and integration ownership

Deployable apps own route hierarchy, navigation, tabs/shell, deep links, cross-capability composition, bootstrap/session binding, native/OS adapters, app assets and build/deployable configuration. Services/bounded contexts own business/system capability semantics, durable truth, canonical writers, service contracts and reusable capability presentation when justified.

```text
WHERE_IT_APPEARS != WHO_OWNS_IT
APP_HOST != BUSINESS_CAPABILITY_OWNER
services → apps = FORBIDDEN
apps → service public capability entrypoints = ALLOWED
```

External integrations terminate at domain-specific semantic ports/adapters. A vendor name, provider mechanism or generic Providers container does not become a business owner. Platform Control may own governed cross-platform enablement/configuration only where explicitly assigned; secret values remain in approved runtime secret storage.


## Financial rail versus biller fulfillment

External money movement and external bill/recharge fulfillment are distinct semantic responsibilities:

```text
FinancialRail
→ moves or authorizes external money

BillerGateway
→ fulfills telecom / electricity / water / internet / recharge / other biller service
```

Do not hide bill/recharge fulfillment inside a generic payment/provider abstraction merely because both depend on an external vendor.

The operation-owning domain defines the semantic port. External vendor adapters implement that port. A vendor or generic Providers container never becomes the domain owner.

For ambiguous external fulfillment or financial mutation:

```text
TIMEOUT != FAILURE
MISSING_CONFIRMATION != SUCCESS
UNKNOWN MUST REMAIN UNKNOWN UNTIL RECONCILED
```

Do not blindly retry through an alternate provider until duplicate external effect is proven impossible.
