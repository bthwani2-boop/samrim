# Target — DSH and WLT

TEMPORARY_TARGET_SPECIALIZATION: YES
GENERAL_EXECUTION_AUTHORITY: NONE
DURABLE_AUTHORITY: NONE
## 1. DSH ownership

DSH owns operational commerce/delivery truth when proven, including:

```text
catalog
store
assortment/inventory operational semantics
cart
checkout orchestration
order
pickup
delivery
dispatch
serviceability
address
support
notification inbox/preferences/topic/delivery operational state
marketing/promotion operational semantics
rating
special-request operational semantics
client/partner/captain/field operational journeys
```

Authentication/session, financial truth, generic provider management, source-domain business-event meaning, channel/vendor transport execution, and generic search are not DSH-owned merely because DSH screens consume them. DSH Notifications specifically owns canonical inbox/preferences/topic/delivery-attempt state; originating domains retain event meaning and replaceable adapters execute channel delivery.

## 2. WLT ownership

WLT is an independent shared financial bounded context and must remain reusable by DSH plus future services/apps.

WLT owns, when proven:

```text
wallet/balance authority
ledger
payment
refund
settlement
commission
payout
reconciliation
COD financial lifecycle
collateral
financial pricing/funding/eligibility
financial-provider/rail transaction state
```

WLT must not be a DSH submodule.

## 3. WLT frontend

Reusable WLT-owned UI/controller/view-model/data-access belongs under:

```text
services/wlt/frontend/<financial-capability>
```

Examples:

```text
wallet
payment
refund
settlement
commission
payout
reconciliation
collateral
```

WLT frontend consumes WLT contracts/generated bindings and remains host-neutral. It must not import DSH app routes, DSH private implementation, or a specific app host.

DSH Checkout may compose WLT Payment without becoming payment authority:

```text
DSH owns checkout orchestration
WLT owns payment state/rules/financial effects
APP owns route composition
```

## 4. DSH frontend refoundation

App-shaped DSH feature trees and `frontend/shared` are losing umbrellas after value extraction.

Actor-specific presentation is allowed under a real capability only where material differences exist:

```text
order/
  presentation/client
  presentation/partner
  presentation/captain
  presentation/control-panel
```

Do not duplicate one working presentation merely to mirror actor names.

`services/dsh/frontend/wlt-boundary` must not remain a WLT feature tree inside DSH. Move WLT-owned wallet/payment/refund/settlement/commission/payout/etc. value to WLT; retain only genuinely DSH-specific translation/orchestration under an explicit DSH integration boundary.

Generic web/runtime declarations such as CSS-module typings must be owned by the actual web/app/package TypeScript runtime scope, not by DSH merely because they were historically located under `services/dsh/frontend`.

## 5. Capability naming

Prefer stable semantic nouns.

DSH examples:

```text
catalog store cart checkout order delivery dispatch pickup serviceability address support marketing promotion rating special-request
```

WLT examples:

```text
wallet ledger payment refund settlement commission payout reconciliation pricing collateral cod promotion-funding
```

Names presumed noncanonical absent independent proof:

```text
home-discovery
account
finance
truth
governance
boundary
shared
common
central
client-*
partner-*
captain-*
field-*
```

Mechanisms such as saga/outbox/worker/cache/retry/provider/handler/controller are not top-level business domains.

## 6. Backend topology

Conceptual target:

```text
backend/
├── cmd/
└── internal/
    ├── runtime/
    ├── transport/http/
    ├── integrations/
    └── <semantic-capabilities>/
```

`cmd/*/main.go` owns process startup only. HTTP transport decodes/extracts trusted context/calls capability/encodes; it must not own SQL, state machines, permission truth, or financial policy.

Avoid mechanical enterprise layers (`domain/application/usecase/repository/helpers/utils/common`) when cohesive Go packages suffice.

DSH high-priority structural candidates to resolve from live evidence:

```text
centralcatalog + catalogapproval           → catalog
checkoutpaymentsaga/checkoutfinanceoutbox  → checkout or WLT integration mechanism
internal/http                              → transport/http
legacy workforceclient → delete after required participant truth is rehomed to DSH; identity/platform/maps/WLT clients → integrations/*
large multi-responsibility main.go         → thin cmd + runtime composition
```

WLT technical containers to challenge:

```text
http                   → transport/http
health                 → runtime/health
dshnotify + dshoutbox  → integrations/dsh
provider               → integrations/payment-rails or precise financial integration owner
shared                 → decompose/delete
```

## 7. WLT semantic boundaries

```text
SETTLEMENT     = what is owed and settlement lifecycle
PAYOUT         = actual disbursement/destination/provider execution
RECONCILIATION = proof/matching internal vs external financial truth
COD            = reservation/collection/finalization financial flow
COMMISSION     = commission policy/lifecycle/posting/query when independently justified
```

Do not collapse these merely to reduce directories.

## 8. Contracts and generation

Each service has one canonical composition root:

```text
services/dsh/contracts/dsh.openapi.yaml
services/wlt/contracts/wlt.openapi.yaml
```

Each semantic capability has one canonical contract owner. Physical files may split for cohesion, but must not become parallel authorities.

```text
CANONICAL_OPENAPI_SOURCE
→ ONE_REPRODUCIBLE_COMPOSER
→ ONE_REPRODUCIBLE_GENERATOR_LINEAGE
→ JUSTIFIED_GENERATED_OUTPUTS
```

No manually synchronized module/operation/DTO/enum/status/action registries.

Mixed runtime/evidence files such as operation-state style artifacts must re-earn a unique live responsibility; durable metadata belongs with canonical sources and proof belongs in tests/evidence.

All refs resolve; duplicate operationIds/routes/conflicting schemas fail closed.

### 8.1 DSH capability/security metadata convergence

Current or inherited metadata/control files must re-earn existence individually rather than remaining independent truth registries merely because tooling consumes them.

High-risk candidate classes include:

```text
capabilities.ts
capability-map.ts
surface-map.ts
authorization-capabilities.json
backend-route-classification.json
service.manifest.ts
manual operation arrays
manual capability→permission maps
manual surface/route capability registries
```

Canonical target:

```text
permission vocabulary/identity semantics → canonical Identity/Security owner
server authorization enforcement         → backend/service authority
operationId + declared security metadata  → canonical service contract when contract-level
surface/app composition metadata          → derived consumer metadata when needed
empty/duplicate classification artifacts  → delete
```

A manifest may survive only when it has a unique machine-consumed role that cannot be derived more safely from stronger canonical sources. Generated/derived metadata must be reproducible and non-authoritative.

### 8.2 WLT inherited contract convergence candidates

Do not preserve actor/consumer/lifecycle-shaped contract fragments as independent authorities. During live census, converge inherited material by actual financial owner, including when the current files still exist:

```text
payment-session capability overlay + DSH checkout handoff overlay
→ payment

settlement-operations + settlement portion of settlements/commissions fragments
→ settlement

commission portion of mixed settlement/commission fragments
→ commission when independently justified

payout-destination + payout-failure boundary fragments
→ payout

commercial-summary + commercial fragments
→ commercial only if one cohesive responsibility is proven

store-onboarding-fee
→ commercial or precise fee-policy owner

special-request financial quote fragments
→ pricing when WLT owns only financial quote semantics

actor-shaped finance fragments
→ distribute to wallet/commission/payout/etc.

captain-collateral
→ collateral

dispatch-financial-eligibility
→ actual WLT financial eligibility/financial owner
```

This is a semantic convergence map, not permission to assume current filenames still exist. Re-pin before treatment and preserve only required contract truth.

## 9. Database law

For every persisted fact prove:

```text
FACT
SERVICE_OWNER
CAPABILITY_OWNER
CANONICAL_TABLE/COLUMNS
CANONICAL_WRITER
READBACK_PATH
CONSTRAINTS/INDEXES
IDEMPOTENCY/AUDIT
SECURITY/PII_CLASSIFICATION
FINANCIAL_CLASSIFICATION
DERIVED_PROJECTIONS
LOSING_STORAGE_AUTHORITIES
```

One truth does not mean one table. Multiple mutable authorities for the same meaning are forbidden.

Each service must have one globally ordered canonical migration lane unless a real independent deployment/storage boundary positively proves the need for another lane. Historical migration chronology is executable architecture, not sacred structure; stale/parallel migration authorities must converge without losing applied durable truth.

Destructive schema change requires deterministic transform/backfill, roll-forward/cutover plan, reconciliation, reader/writer cutover, obsolete-schema deletion, and readback proof.

## 10. Financial shadow-truth and security gate

Treat financial references, duplicated balances, status refs, mutable copies, and projections as high-risk.

Allowed outcomes:

```text
REDUNDANT_MUTABLE_MIRROR → migrate/delete
NECESSARY_DERIVED_PROJECTION → explicit one-way non-authoritative rebuildable
CANONICAL_TRUTH_MISNAMED_AS_REFERENCE → rehome/rename
```

Before closing any material financial mutation prove:

```text
CANONICAL_FINANCIAL_OWNER
CANONICAL_LEDGER_WRITER
BALANCED_POSTING_WHERE_APPLICABLE
IDEMPOTENCY/EXACT_REPLAY
TRANSACTION_ATOMICITY
CONCURRENCY/LOCKING
OPERATOR_CONTEXT_ISOLATION
SERVER_AUTHORIZATION
AUDITABILITY
PROVIDER_RESULT_PROVENANCE
UNKNOWN_PROVIDER_RESULT_HANDLING
REFUND/REVERSAL_EFFECT
SETTLEMENT/PAYOUT_SEPARATION
RECONCILIATION_PATH
CANONICAL_READBACK
ZERO_PARALLEL_FINANCIAL_WRITERS
```

## 11. DSH/WLT exit gate

At closure prove zero known:

```text
DSH_APP_SHAPED_FEATURE_OWNERS
DSH_FRONTEND_SHARED_UMBRELLA
WLT_FEATURE_TREE_UNDER_DSH
APP_SHAPED_DSH_EXPORTS
DUPLICATE_OR_AMBIGUOUS_CAPABILITY_NAMES
HTTP_MEGA_DOMAIN_AUTHORITY
TOP_LEVEL_MECHANISM_PSEUDO_DOMAINS
MANUAL_CONTRACT/DTO/ENUM/OPERATION_MIRRORS
DUPLICATE_CAPABILITY/AUTHORIZATION/METADATA_REGISTRIES
DUPLICATE_WRITERS
PARALLEL_SERVICE_MIGRATION_AUTHORITIES
WLT_REFERENCE_SHADOW_TRUTH
ACTOR/CONSUMER_SHAPED_WLT_CONTRACT_AUTHORITIES
PERMANENT_PAYMENT/SETTLEMENT/PAYOUT_OVERLAY_FRAGMENTATION
WLT_FRONTEND_COUPLING_TO_DSH_OR_APP
UNVERIFIED_FINANCIAL_INVARIANTS
BACKEND↔CONTRACT↔FRONTEND↔APP_PARITY_GAPS
MISOWNED_GENERIC_WEB_TYPE_DECLARATIONS
```
