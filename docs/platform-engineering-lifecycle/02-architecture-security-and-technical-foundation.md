DOCUMENT_CLASS: HUMAN_DEVELOPMENT_AND_OPERATIONS_GUIDANCE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
PARENT_GUIDE: docs/platform-engineering-lifecycle/README.md

# PHASE 3 — Domain, Data, and Runtime Boundary Design

Only now choose bounded contexts and deployables.

Prefer fewer runtime boundaries until independent lifecycle, scaling, security, regulatory, availability, data-ownership, or team constraints prove another deployable is justified.

A modular monolith can be correct. A small service set can be correct. Many microservices are not a maturity badge.

For every durable fact define:

```text
semantic owner
canonical writer
persistence owner
public contract
authorized readers
projection/cache rules
audit/reconciliation requirements
```

Rules:

```text
APP != BUSINESS TRUTH OWNER
CACHE != BUSINESS TRUTH OWNER
SEARCH/ANALYTICS != MUTATION AUTHORITY
SERVICE A != DIRECT WRITER OF SERVICE B DATA
PROJECTION != SECOND TRUTH
```

Physical database layout is a deployment decision. Data authority can be isolated through separate databases, schemas, credentials, or another proven mechanism. What is mandatory is that another owner cannot silently mutate private durable truth.

### Architecture decision test

Before creating another service, queue, cache, workflow engine, shared package, or plugin system, prove:

```text
UNIQUE_RESPONSIBILITY
+ REAL_CONSUMER/BOUNDARY
+ MATERIAL_OPERATIONAL_VALUE
+ LOWER_COMPLEXITY_THAN_ALTERNATIVE
+ CLEAR_FAILURE/OWNERSHIP MODEL
```

Otherwise do not add it.

---

# PHASE 4 — Threat Modeling, Privacy, and Compliance Design

Security is part of architecture.

Build data-flow/trust-boundary models for material flows and ask, at minimum:

```text
Who calls?
How is identity authenticated?
How is authorization derived?
What object/scope can be changed?
What can be replayed?
What if a token/device/session is stolen?
What if two writers race?
What if the client changes price/scope/role/context?
What if a dependency lies, times out, duplicates, or reorders?
What if a privileged operator is compromised?
What if logs expose PII/secrets?
What if a database/provider result is ambiguous?
```

Use abuse/misuse cases, not only happy-path diagrams.

## Privacy/data inventory

For every personal/sensitive data class identify:

```text
collection purpose
legal/business basis as applicable
minimum fields
source
storage location
encryption requirement
authorized roles
third-party sharing
retention
deletion/anonymization
audit requirements
backup implications
telemetry/logging restrictions
user disclosure/consent where required
```

Permission requests on mobile must be purpose-limited and requested as late as practical. Provide a usable fallback when a permission is optional to core functionality.

Account deletion, export, retention, and support procedures are Product/data journeys when the platform/store/legal model requires them; they are not store-submission paperwork to add at the end.

### Exit gate

```text
CRITICAL_TRUST_BOUNDARIES_MODELED=YES
PRIVILEGED_MUTATIONS_THREAT_MODELED=YES
SENSITIVE_DATA_INVENTORY_EXISTS=YES
THIRD_PARTY_DATA_FLOWS_ACCOUNTED=YES
REQUIRED_ACCOUNT_DELETION/RETENTION_SEMANTICS_DEFINED=YES
KNOWN_HIGH_RISK_UNMITIGATED_DESIGN_FINDINGS=0
```

---

# PHASE 5 — Repository, Toolchain, and CI Foundation

Choose repository strategy based on coordinated change patterns and ownership. A monorepo is often effective for a unified multi-surface platform, but only with enforced dependency boundaries.

Establish:

```text
repository topology
toolchain versions
package manager
lockfiles
formatter/linter
type/compiler strictness
code generation
dependency policy
test commands
build commands
native build identities
environment/config conventions
code ownership/review routing
```

The first-party developer path should be reproducible:

```text
CLONE
→ BOOTSTRAP
→ VERIFY
→ RUN
```

without undocumented machine mutations.

## CI from the beginning

CI is not a pre-launch phase. Bootstrap required checks as soon as the foundation exists.

As applicable:

```text
format/lint
typecheck/compile/vet
unit/domain tests
database/migration verification
contract/codegen drift
integration tests
frontend/mobile tests
security static analysis
dependency/vulnerability scanning
secret scanning
license/policy checks
SBOM/provenance generation where material
mobile/web/backend production builds
artifact identity/digests
```

Verification jobs must fail closed on missing required evidence. A skipped/missing job is not PASS.

Privileged credentials must not be exposed to untrusted build code. Pin or otherwise control build dependencies/actions appropriate to risk.

---

# PHASE 6 — Environments, Infrastructure, Configuration, and Secrets

Define environment classes early:

```text
LOCAL
CI
DEV/SHARED DEVELOPMENT when needed
STAGING / PREPRODUCTION
PRODUCTION
```

Core Product/auth/financial semantics do not fork by environment.

Configuration varies by environment; secrets do not live in source/client bundles/logs.

Prefer Infrastructure as Code for production-critical infrastructure so the intended environment is reviewable and reproducible.

Establish only infrastructure that is currently justified, such as:

```text
runtime/containers
PostgreSQL
object storage
DNS/TLS
secret storage
backups
observability backend
CI/release infrastructure
provider sandboxes
```

Do not add Kafka/Redis/Elasticsearch/Kubernetes/service mesh merely because they are common in large companies.

Critical providers that could invalidate Product feasibility, cost, policy, or native architecture should receive early isolated feasibility spikes before many journeys depend on them.

---

# PHASE 7 — Database and Migration Substrate

Each canonical data owner has one governed migration history and one mutation authority.

Physical isolation may be:

```text
separate database
separate schema + credentials
other proven isolation
```

according to risk and deployment constraints.

Required behavior:

```text
ordered migrations
immutable applied migration identity
fresh-install proof
representative-upgrade proof
constraint/index verification
backfill/restart/reconciliation behavior
destructive-change safety
forward recovery
```

For risky schema/data evolution prefer:

```text
EXPAND
→ DEPLOY COMPATIBLE CODE
→ BACKFILL / RECONCILE
→ SWITCH WRITERS
→ SWITCH READERS
→ PROVE READBACK
→ CONTRACT / DELETE OLD PATH
```

Do not make arbitrary/destructive production schema mutation an implicit service-start side effect.

Backups are not proven until restore/recovery is exercised at a representative level.

---

# PHASE 8 — Contracts and Generated Bindings

Cross-boundary semantics have one canonical executable provenance.

For HTTP this may be OpenAPI; for events, a canonical event schema; for other protocols, an equivalent machine-verifiable contract.

The important rule is not dogmatic “spec-first” versus “code-first”. The rule is:

```text
ONE CANONICAL CONTRACT
→ DETERMINISTIC DERIVATION / VALIDATION
→ ZERO INDEPENDENT DTO TRUTH
```

Define:

```text
stable identifiers
request/response semantics
error model
auth/context requirements
nullability/defaults/enums
pagination where applicable
idempotency semantics
version/compatibility policy
deprecation/removal policy
```

Public mobile API evolution must assume old clients remain active after a server deployment.

---

# PHASE 9 — Minimal Backend Technical Chassis

Every deployable service/process should have only the technical substrate needed for safe operation:

```text
startup
configuration validation
graceful shutdown
liveness
readiness
dependency health semantics
database connectivity
HTTP timeouts
request/correlation identity
structured errors
structured logs
metrics/traces when justified
authentication integration
security middleware/headers where applicable
release identity
```

Do not turn this into a universal internal framework without proven recurring value.

---
