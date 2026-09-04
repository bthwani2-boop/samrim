# Development Runtime

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
CURRENT_RUNTIME_AUTHORITY: live repository scripts/configuration
PRODUCT_AUTHORITY: NONE

## Runtime modes

### Daily development
Run only the actively changed app/service and the smallest needed dependencies. Heavy infrastructure remains off unless required.

### Focused integration
Run the exact service dependencies/simulators required by the current capability.

### Full integration
Use repository-owned orchestration for migrations, readiness, smoke, integration and journey verification.

Useful root entrypoints include `pnpm runtime:full:up`, `pnpm runtime:full:smoke`, `pnpm runtime:full:down` and the current scripts exposed by `package.json`.

## Ports/endpoints

Exact ports, container names and environment values are executable configuration. Do not copy them into durable docs as an independent authority. Inspect current runtime config/scripts.

## Database

Development engine is PostgreSQL/PostGIS. Managed PostgreSQL may be used for fast daily state while local/container PostgreSQL remains a reproducible integration path.

External development services receive synthetic/test data only.

## Docker

Docker is reproducible development/integration infrastructure, not mandatory daily runtime and not Product authority.

## Cache

Redis/Valkey is off by default unless a proven requirement exists. Cache/coordination state must not become business truth.

## External failure

Mocks/simulators must exercise real BThwani authorization/state/accounting/idempotency. Timeout or missing confirmation is not proof of failure/success; unknown outcomes remain reconcilable.
