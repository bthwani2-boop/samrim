# Target — Infrastructure and Runtime Composition

TEMPORARY_TARGET_SPECIALIZATION: YES
GENERAL_EXECUTION_AUTHORITY: NONE
DURABLE_AUTHORITY: NONE
## 1. Infra responsibility

`infra/` remains a canonical top-level root only for environment/deployment composition.

Allowed responsibilities when real:

```text
local container orchestration
local data-plane provisioning
local observability tooling
deployment/IaC configuration
secret-store/runtime binding
shared infrastructure network/volume composition
```

Forbidden ownership:

```text
business/domain logic
service database schema/migrations
app configuration contract ownership
provider business semantics
financial test behavior/fixtures
tracked secret values
business DTO/contracts
```

## 2. Local environment target

Prefer environment-oriented topology over technology-only dumping:

```text
infra/local/
├── compose/
├── postgres/
├── observability/
└── <other-proven-local-infrastructure>/
```

Do not create directories for inactive technology merely to document that it is unused.

## 3. Compose

Local compose may start:

```text
PostgreSQL
MinIO/object storage emulator
Mailpit
Valkey/Redis only when an active need exists
Jaeger/OTel tooling
service APIs
provider simulators
```

Compose owns orchestration, dependency/health wiring, networks, ports, and local environment binding. It does not own service business behavior.

After `core/` migration, all Docker build paths must point to canonical `services/*` locations.

Dockerfiles remain with the deployable service/app they build unless a genuinely shared image responsibility proves otherwise.

## 4. Provider simulators

Simulation behavior belongs with the integration owner:

```text
services/wlt/testing/provider-simulators/...
services/dsh/testing/provider-simulators/...
```

Infra compose only mounts/starts those assets.

Move current financial simulator mappings out of generic infra ownership while preserving their valid failure/timeout/duplicate/unknown-outcome scenarios.

## 5. Environment files and app config

App `.env.example`/configuration schema belongs with the app when it defines app runtime inputs.

Service env/config schema belongs with the service.

Infra may bind values but must not become the semantic owner of `NEXT_PUBLIC_*`, Expo app runtime contract, DSH/WLT service config, or Identity auth policy.

Tracked examples contain names/descriptions/placeholders only, never secrets.

## 6. Secrets

Production/provider secrets must resolve from a protected secret store or equivalent deployment-secret mechanism.

Infra/deployment owns binding/wiring, not the secret's business meaning.

Repositories and general application databases store secret references/metadata, not raw secret values by default.

## 7. PostgreSQL local provisioning

Infra may create local database instances/users/databases/extensions required to boot services.

Service schema/migrations remain under `services/<service>/database` and run through the service's canonical migration lane.

Audit duplicate local databases such as separate runtime/local variants for the same service. If they do not represent an independent required datastore, converge to one local service database and delete shadow authority.

Do not weaken authentication/constraints simply for local convenience.

## 7A. Journey-ready service data substrate

Before the first DSH/WLT business slice, each durable-data-owning service must have a real isolated database identity and migration/readiness path without premature business schema.

For the initial local target, one PostgreSQL server instance may host separate logical databases/users:

```text
PostgreSQL instance
├── identity database / identity user
├── dsh database      / dsh user
└── wlt database      / wlt user
```

Required invariant:

```text
IDENTITY_CREDENTIALS_CANNOT_READ_OR_WRITE_DSH/WLT_PRIVATE_DATA
DSH_CREDENTIALS_CANNOT_READ_OR_WRITE_WLT/IDENTITY_PRIVATE_DATA
WLT_CREDENTIALS_CANNOT_READ_OR_WRITE_DSH/IDENTITY_PRIVATE_DATA
```

Production may choose different physical topology; canonical ownership/isolation remains the same.

DSH/WLT readiness must prove their own required database connectivity/schema prerequisites once persistence is admitted. A generic process-alive response is not sufficient for a service claiming DB readiness.

Use one pinned canonical SQL migration toolchain across service migration lanes; the target implementation choice is `golang-migrate/migrate` unless later evidence proves a stronger fit. Production schema evolution is an explicit deployment/predeploy operation, not arbitrary hidden mutation on API process boot.

```text
DEVELOPMENT → bootstrap may invoke explicit migrate command
CI          → fresh database + migrate + tests
PRODUCTION  → explicit controlled migration/predeploy step
```

Do not create empty/fake `001_init` business tables or placeholder migrations merely to prove the lane exists.

## 8. Inactive/readme-only infrastructure

An infrastructure folder that contains only historical explanation that a technology is inactive must re-earn existence.

```text
NO_ACTIVE_CONFIG + NO_CONSUMER + NO_REQUIRED_POLICY_AUTHORITY
→ DELETE CONTAINER
```

Future technology decisions live in current architecture/config when adopted; live repository is not an archive of unused options.

## 9. Observability

Local observability tooling may stay under Infra when it is environment-level tooling. Service-specific instrumentation/semantic metrics remain with services/packages according to ownership.

Do not make Jaeger/OTel compose files the source of application tracing semantics.

## 10. Runtime/config audit

For every affected runtime role audit:

```text
env variables
base URLs/ports
feature flags
startup/bootstrap
health/readiness
workers/jobs/outboxes
secret references
observability
retry/backoff
native permissions/deep links/push when app-related
Docker/compose/deployment paths
```

Each role must have one canonical authority. Remove stale aliases, duplicate flags, dead workers, and obsolete endpoints after cutover.

## 11. Exit gate

```text
INFRA_OWNS_BUSINESS_LOGIC=0
INFRA_OWNS_SERVICE_SCHEMA=0
INFRA_OWNS_APP_CONFIG_CONTRACT=0
FINANCIAL_SIMULATOR_BEHAVIOR_UNDER_GENERIC_INFRA=0
TRACKED_SECRET_VALUES=0
OLD_core_DOCKER_PATHS=0
OLD_apps/*/runtime_BUILD_PATHS=0
DUPLICATE_LOCAL_DATABASE_AUTHORITY=0
CROSS_SERVICE_PRIVATE_DATABASE_ACCESS=0
SERVICE_DB_READINESS_FAKE_GREEN=0
PREMATURE_FAKE_BUSINESS_MIGRATIONS=0
INACTIVE_README_ONLY_INFRA_CONTAINERS=0
STALE_COMPOSE_FILES/PROFILES/PORTS=0
```
