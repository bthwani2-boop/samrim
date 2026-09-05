# Donor Reconstruction Patterns — Historical Reference

DOCUMENT_CLASS: NONAUTHORITATIVE_DONOR_REFERENCE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

ARCHITECTURE_AUTHORITY: NONE

## Purpose

This file preserves useful historical extraction patterns discovered while refounding BThwani from the donor repository. It is not a target topology, current repository inventory, migration plan or survival authority.

Always resolve the current canonical owner from Governance and the current implementation from live source before acting.

~~~text
DONOR PATH = FORENSIC CLUE
DONOR PATH != TARGET PATH AUTHORITY
~~~

## General extraction rule

~~~text
INSPECT REQUIRED VALUE
→ CLASSIFY SEMANTIC OWNER
→ PRESERVE / REFINE / REIMPLEMENT / REGENERATE / REJECT
→ BUILD DIRECTLY AT CURRENT CANONICAL OWNER
→ DO NOT RECREATE A KNOWN LOSING CONTAINER MERELY TO MOVE IT AGAIN
~~~

## Historical path-pattern map

These mappings describe common donor losing-shape classes, not guaranteed current paths.

| Donor/historical shape | Extraction direction |
|---|---|
| core/identity | Identity actor/authentication/role/session truth → canonical Identity owner; DSH operational participant facts stay/go to DSH; financial facts stay/go to WLT |
| generic human/workforce/people container | Split facts to proven owners; do not recreate a generic people service without independent capability/lifecycle proof |
| core/platform-control | Preserve only proven platform-wide control-plane semantics; independent service remains conditional on service-admission evidence |
| core/providers | Split control-plane metadata from domain data-plane execution; rebuild semantic ports/adapters under operation-owning services |
| shared/ui-kit | Reuse qualified domain-neutral visual-system value under the canonical Design System |
| shared/control-panel | Surface-specific operator UI → apps/control-panel; domain-neutral reusable primitives/patterns → Design System |
| shared/data-runtime | Decompose by precise technical/data owner; never preserve/rename a generic runtime-data bucket by default |
| shared/resilience | Keep only proven reusable technical mechanisms; operation-specific retry/fallback/reconciliation policy remains with the operation/integration owner |
| apps/<app>/runtime | Flatten into direct app host only when runtime is a pass-through parent with no independent responsibility; preserve deployable identity/bindings |
| services/dsh/frontend/app-* or equivalent | Business semantics → DSH; surface-specific feature UI → consuming app; public client/contract lineage → service; domain-neutral UI → Design System |
| services/wlt/frontend/app-* or equivalent | Financial semantics → WLT; surface-specific feature UI → consuming app; public client/contract lineage → WLT |
| service-owned Control Panel feature subtree | Surface-specific feature UI → apps/control-panel/src/features/<capability>; business owner remains the service |
| monolithic common contract dump | Service business schemas → service contract owner; only genuinely cross-service protocol primitives remain cross-service |
| manually maintained API catalog | Generate from canonical service contracts or remove when no consumer requires it |
| manual capability/permission/readiness manifest | Derive from canonical contract/code/owner source when possible; keep only unique non-authoritative tooling config |
| provider simulator under generic Infra | Simulator behavior/fixtures → owning service testing; Infra composes environment only |
| service-specific tool under root tools/ | Rehome to service/app lifecycle owner unless genuinely cross-repository |
| guard enforcing core/, shared/, apps/*/runtime or other losing topology | Rewrite for canonical invariant or delete after consumer/evidence replacement |
| pass-through wrapper script/tool | Remove after callers use the canonical underlying tool unless the wrapper has a unique stable interface/platform role |

## App extraction patterns

Historical app refoundation established several reusable checks:

- route/shell/native/build responsibility belongs to the app host;
- business state machines, serviceability, authorization and financial truth do not move into the app merely because their screens do;
- Account, Home, Settings and aggregate Search are composition/information architecture by default, not automatic bounded contexts;
- notification source event truth remains with the source domain;
- DSH Notifications owns inbox/preferences/topic/delivery-attempt truth when that capability is active;
- native/deep-link route translation belongs to the app;
- no runtime feature/journey registry is required merely to auto-discover routes;
- a host may remain technically ready while business-deferred.

## Service/backend extraction patterns

~~~text
cmd/process entrypoint → startup/composition only
transport/http         → decode/trusted-context/validation/call/encode
capability/domain      → state machine/policy/business semantics
repository/database    → persistence under owner invariants
integrations           → semantic external/cross-service adapters
runtime                → process/runtime technical composition
~~~

Do not preserve large main.go, HTTP mega-domain authority or mechanism-named top-level business packages solely because they existed in the donor.

Mechanism names such as saga, outbox, worker, cache, retry, handler or controller do not become Product capability owners.

## Contract extraction patterns

~~~text
CANONICAL SERVICE CONTRACT
→ VALIDATE/COMPOSE
→ GENERATE
→ REPRODUCIBLE CLIENT/BINDING
→ CONSUMERS
→ DRIFT CHECK
~~~

Useful anti-patterns:
- hand-maintained cross-boundary DTO mirrors;
- duplicate operation/status/action registries;
- one monolithic cross-service business OpenAPI file;
- private restricted parser/generator when mature standards-compatible tooling is sufficient;
- generated files treated as editable truth.

## DSH/WLT extraction patterns

- DSH owns operational commerce/delivery/support/serviceability truth.
- WLT remains an independent financial bounded context and sole internal financial-truth writer.
- WLT must not become a DSH submodule.
- DSH may expose application-facing WLT-backed readback without becoming financial authority.
- financial reference or projection data must be classified as canonical truth, rebuildable derived projection or invalid mutable shadow—never left ambiguous.
- one data owner uses one canonical migration history unless an independently owned storage/deployment boundary proves otherwise.
- technical mechanisms such as checkout finance outbox/saga belong under their capability/integration owner rather than becoming top-level business domains.

Exact current capability semantics are owned by Governance, not this reference.

## Identity extraction patterns

- one cross-boundary human identifier: actor_id;
- actor and role are distinct;
- current high-level role admission is a direct actor↔role binding unless a stronger abstraction is independently required;
- Identity owns authentication/session/security eligibility; DSH owns operational participant/eligibility/scope; WLT owns financial truth;
- do not carry role arrays, generic tenant/context/grant frameworks, consumer-authored actor IDs or caller-header service identity into the canonical model;
- stale non-production donor/candidate schema does not justify compatibility columns or dual read/write authority.

Exact Identity invariants live in governance/product/CAPABILITIES.md and Security policy.

## Provider extraction patterns

~~~text
CLASSIFY CONTROL PLANE VS DATA PLANE
→ PROVE DOMAIN SEMANTIC PORT
→ MOVE/REBUILD VENDOR ADAPTER UNDER OPERATION OWNER
→ MOVE SECRET VALUE TO PROTECTED SECRET BINDING
→ KEEP NON-SECRET secret_ref/metadata ONLY WHEN REQUIRED
→ PRESERVE RESULT PROVENANCE
→ CUT OVER CONSUMERS
→ DELETE GENERIC INVOCATION AUTHORITY
~~~

Unknown financial/external mutation results are reconciled against the original provider before any alternate mutation is attempted.

## Tooling extraction patterns

Historical cleanup classified each material tool/guard/registry/manifest as:

~~~text
KEEP_PROVEN
HARDEN
DERIVE
REHOME
MERGE
SPLIT
REIMPLEMENT
REGENERATE
DELETE
~~~

Useful survival questions:
- does the tool have a real current consumer?
- is its output derivable from a stronger owner?
- does it enforce a durable invariant or only a historical path?
- does it duplicate another tool?
- is it service/app-specific but misowned at repository root?
- does it reproduce business logic rather than call canonical APIs?
- can compiler/schema/database/test/runtime evidence enforce the invariant more directly?

## Historical metadata and contract convergence examples

The donor contained several metadata/contract fragment classes that are useful forensic clues but must not survive as manual parallel truth without a unique machine-consumed role.

High-risk metadata examples:

~~~text
capabilities.ts
capability-map.ts
surface-map.ts
authorization-capabilities.json
backend-route-classification.json
service.manifest.ts
manual operation arrays
manual capability→permission maps
manual surface/route capability registries
backendRuntimeReady / frontendReady style closure fields
~~~

Disposition pattern:

~~~text
permission vocabulary / identity semantics → canonical Identity/Security owner
server authorization enforcement           → owning backend/service
operationId + declared security metadata    → canonical service contract when contract-level
surface/app composition metadata            → derived consumer metadata only when required
runtime/closure declarations                → executable evidence or delete
empty/duplicate classification artifacts    → delete
~~~

Historical WLT contract-fragment convergence examples:

~~~text
payment-session overlay + checkout handoff overlay
→ payment

settlement-operations + settlement portion of mixed settlement/commission fragments
→ settlement

commission portion of mixed settlement/commission fragments
→ commission only when independently justified

payout-destination + payout-failure boundary fragments
→ payout

commercial-summary + commercial fragments
→ commercial only if one cohesive responsibility is proven

store-onboarding-fee
→ commercial or precise fee-policy owner

special-request financial quote fragments
→ pricing when WLT owns the financial quote semantics

actor-shaped finance fragments
→ distribute to wallet / commission / payout / other actual financial owner

captain-collateral
→ collateral

dispatch-financial-eligibility
→ actual WLT financial eligibility owner
~~~

These are semantic convergence hints only. Always re-pin donor/current evidence and never assume the historical filenames still exist.

## Final reference boundary

This file survives only as long as the historical donor patterns materially help forensic reconstruction or future audits.

If a row conflicts with current Governance or executable source:

~~~text
CURRENT CANONICAL OWNER WINS WITHIN ITS AUTHORITY CLASS
THIS HISTORICAL REFERENCE IS STALE
~~~
