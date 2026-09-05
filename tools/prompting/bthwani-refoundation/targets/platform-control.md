# Target — Platform Control

TEMPORARY_TARGET_SPECIALIZATION: YES
GENERAL_EXECUTION_AUTHORITY: NONE
DURABLE_AUTHORITY: NONE
## 1. Canonical placement

`core/platform-control` is not a canonical top-level Core package. If its independent service responsibility is proven from live evidence, refound it as:

```text
services/platform-control/
```

The move is not sufficient by itself. Preserve required control-plane truth, refound internal topology, cut over all consumers/runtime paths, and delete `core/platform-control` plus `@bthwani/core-platform-control` residue.

## 2. Service admission and scope

Platform Control is justified only for coherent cross-service control-plane responsibilities that require their own lifecycle, authorization, persistence, audit, and runtime/API boundary.

Candidate responsibilities when proven:

```text
platform variable/configuration governance
feature-flag governance
trusted operator-context control
change workflow/approval
progressive rollout state
pause/resume/abort/rollback/recovery
platform health/posture aggregation used by rollout gates
control-plane audit
external-integration/provider configuration control plane
```

Do not preserve a responsibility solely because a current manifest says Platform Control owns it. Reconstruct actual writers/readers/runtime behavior and re-earn each boundary.

## 3. Anti-god-service law

Platform Control must not become the central execution owner for unrelated service behavior.

Forbidden default ownership:

```text
payment execution
payout execution
map/geocoding/routing execution
SMS/email/push delivery execution
object-storage domain operations
DSH order/delivery policy
WLT financial policy
Identity authentication/session policy
DSH operational-participant policy
app route/navigation logic
service-private business feature flags encoded as a second domain policy authority
```

Platform Control may govern activation/configuration/change state while the owning service continues to execute and interpret its domain operation.

```text
CONTROL PLANE != BUSINESS DATA PLANE
```

## 4. Configuration ownership

For every variable/flag/config value prove:

```text
SEMANTIC_OWNER
CONTROL_PLANE_OWNER_IF_DIFFERENT
SOURCE OF DEFAULT
RUNTIME RESOLUTION PATH
MUTATION AUTHORITY
SCOPE/TENANCY/OPERATOR CONTEXT
TYPE/VALIDATION
SECRET_OR_NON_SECRET
VERSION/REVISION
AUDIT
ROLLBACK/RECOVERY
CONSUMERS
```

Platform Control must not invent business semantics for a flag merely because it stores or rolls out its value.

Domain-specific eligibility, pricing, permissions, financial state, serviceability, or allowed-action policy remains with the owning service/Identity authority.

## 5. External integration configuration

When cross-service provider/integration configuration governance is proven, Platform Control may own control-plane metadata such as:

```text
integration registration
capability binding
active/inactive state
non-secret parameters
secret_ref
configuration version
change/rollout state
audit
aggregated health/posture view
```

Actual vendor invocation remains under domain-specific integrations as defined in `providers-and-integrations.md`.

Platform Control must never store raw provider credentials in general application tables or expose them through API/frontend/audit state.

## 6. Backend topology

Conceptual target when applicable:

```text
services/platform-control/
├── backend/
│   ├── cmd/
│   └── internal/
│       ├── runtime/
│       ├── transport/http/
│       ├── integrations/
│       └── <cohesive-control-plane-capabilities>/
├── contracts/
├── clients/generated/
├── frontend/        # only reusable control-plane presentation if justified
├── database/
└── tests/testing/
```

`cmd` stays thin. HTTP transport must not own rollout/business policy. Large server/runtime files require cohesion review under orchestrator rules.

## 7. Frontend and Control Panel

Surface-specific Platform Control feature presentation belongs to the consuming app host by default:

```text
apps/control-panel/src/features/<capability>
  ↓ consumes
services/platform-control public contract/client
```

A host-neutral presentation abstraction may be extracted only after multiple real host consumers, explicit ownership and lower total complexity are proven. Do not create `services/platform-control/frontend/<capability>` merely because the business truth is service-owned.

Do not move Platform Control business/control truth into `apps/control-panel` merely because operators use it there; presentation location never changes canonical business ownership.

## 8. Contracts and generated clients

Platform Control keeps one canonical service contract composition root under `services/platform-control/contracts` when the service survives.

Manual manifests/status declarations such as `backendRuntimeReady`, `frontendReady`, lifecycle labels, or closure assertions must not become competing execution/evidence truth. Each field re-earns existence as either:

```text
DURABLE MACHINE-CONSUMED CONFIG/METADATA
DERIVED GENERATED METADATA
TEST/EVIDENCE CLAIM
OBSOLETE MANUAL DECLARATION → DELETE
```

Do not maintain hand-synchronized route/flag/variable/rollout registries across contract, backend, frontend, manifest and tests.

## 9. Database/runtime law

Platform Control persistence may own control-plane state but not duplicate each service's canonical runtime/business state.

Health/posture aggregation must be explicitly derived from source services/providers; it cannot become a shadow mutable health truth used inconsistently with actual runtime evidence.

Rollout/change mutations require applicable:

```text
authorization
operator-context isolation
idempotency
optimistic/concurrency control
audit trail
versioned desired/effective state
rollback/recovery semantics
runtime readback
```

## 10. Exit gate

At closure prove:

```text
core/platform-control=ABSENT
@bthwani/core-platform-control=ABSENT
PLATFORM_CONTROL_GOD_SERVICE=0
DOMAIN_DATA_PLANE_EXECUTION_IN_PLATFORM_CONTROL=0
RAW_PROVIDER_SECRETS_IN_PLATFORM_CONTROL_DB/API/AUDIT=0
BUSINESS_POLICY_DUPLICATED_AS_PLATFORM_FLAG_POLICY=0
MANUAL_READINESS/CLOSURE_MANIFEST_AS_EVIDENCE_AUTHORITY=0
DUPLICATE_CONFIG/FLAG/VARIABLE_AUTHORITIES=0
SHADOW_RUNTIME_HEALTH_AUTHORITY=0
CONTROL_PANEL_OWNS_PLATFORM_CONTROL_TRUTH=0
OLD_DOCKER/WORKSPACE/CONTRACT/CLIENT_PATHS=0
```
