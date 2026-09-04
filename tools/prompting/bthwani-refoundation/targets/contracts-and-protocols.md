# Target — Contracts and Cross-Service Protocols

## 1. Service contracts remain sovereign

Business/API contracts live with the service that owns the semantics:

```text
services/dsh/contracts/
services/wlt/contracts/
services/identity/contracts/
services/workforce/contracts/
services/platform-control/contracts/
```

Root `contracts/` must not become a second business-contract registry or manual mirror.

## 2. Root contracts role

Canonical role:

```text
contracts/
├── protocol/
├── catalog/
├── tests/
├── package.json       # only while real verification/tooling role remains
└── project.json       # only while real workspace/Nx role remains
```

### `protocol/`

Owns only stable cross-service wire primitives actually reused across bounded contexts.

Examples when proven:

```text
HTTP error envelope
correlation ID convention
idempotency header convention
pagination primitives
service-to-service trust/auth headers
transport-level Money value object only if truly protocol-wide
```

It must not own balance, fee, settlement, commission, order, store, actor, workforce, or other business schemas.

### `catalog/`

Contains generated/non-authoritative API discovery artifacts only.

## 3. Demolish `shared/common` contract dumping

Current common-style contract content must be decomposed by protocol responsibility. Do not preserve a monolithic `common.openapi.yaml` merely because several services reference it.

Conceptual target examples:

```text
protocol/http/errors.openapi.yaml
protocol/http/correlation.openapi.yaml
protocol/http/idempotency.openapi.yaml
protocol/http/pagination.openapi.yaml
protocol/trust/service-auth.openapi.yaml
protocol/value-objects/money.openapi.yaml   # only if protocol-wide proof passes
```

Physical split is not mandatory if it harms clarity; semantic ownership must nonetheless remain explicit and non-business.

## 4. Generated API catalog

A repository-wide OpenAPI index must not be a manually synchronized authority.

If an aggregate catalog is useful:

```text
SERVICE CONTRACT METADATA
→ DETERMINISTIC GENERATOR
→ contracts/catalog/openapi-index.generated.yaml
```

The generated catalog:

```text
OWNS_NO_RUNTIME_PATHS
OWNS_NO_DOMAIN_SCHEMAS
OWNS_NO_OPERATION SEMANTICS
IS_NOT_CLIENT_GENERATION_SOURCE_FOR_SERVICES
IS_NOT_MANUALLY_MAINTAINED
```

If no material consumer needs it, delete it rather than preserving ceremony.

## 5. Service composition roots

Each service should expose one canonical contract composition root, for example:

```text
dsh.openapi.yaml
wlt.openapi.yaml
identity.openapi.yaml
workforce.openapi.yaml
platform-control.openapi.yaml
```

Capability modules may be split physically for cohesion but remain one semantic owner.

## 6. Contract/generation lineage

For generated clients/bindings:

```text
CANONICAL SERVICE CONTRACT
→ VALIDATE/COMPOSE
→ GENERATE
→ REPRODUCIBLE OUTPUT
→ CONSUMERS
```

No manually maintained DTO/enum/status/allowed-action/operation maps may compete with the service contract/domain source.

Derived metadata needed by tooling must be generated.

## 7. Protocol primitive admission

A root protocol primitive survives only if:

```text
USED_BY_MULTIPLE_BOUNDED_CONTEXTS
WIRE_SEMANTICS_ARE_IDENTICAL
NO_DOMAIN_OWNER_IS_MORE_CORRECT
NO_BUSINESS_POLICY_IS_EMBEDDED
VERSIONING/CHANGE_IMPACT_IS_UNDERSTOOD
```

Do not centralize merely to avoid duplication. Independent but coincidentally similar domain concepts may remain local.

## 8. Verification

Fail closed on:

```text
UNRESOLVED_$refs
DUPLICATE_OPERATION_ID
DUPLICATE_ROUTE_WITH_CONFLICTING_OWNER
CONFLICTING_SCHEMA_DEFINITIONS
STALE_GENERATED_OUTPUT
MANUAL_CATALOG_DRIFT
SERVICE CONTRACT REFERENCING_OLD_core_PATH
SERVICE CONTRACT REFERENCING_OLD_shared/common_PATH_AFTER_CUTOVER
```

## 9. Exit gate

```text
ROOT_contracts_BUSINESS_AUTHORITY=0
MANUAL_MASTER_API_INDEX=0
GENERIC_common_CONTRACT_DUMP=0
DUPLICATE_PROTOCOL_PRIMITIVE_AUTHORITIES=0
HAND_MAINTAINED_GENERATED_MIRRORS=0
UNRESOLVED_REFS=0
OLD_core/shared_CONTRACT_PATHS=0
NONDETERMINISTIC_CLIENT_GENERATION=0
```
