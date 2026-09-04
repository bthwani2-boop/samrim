# Target — Identity and Workforce

## 1. Service placement

Refound:

```text
core/identity  → services/identity
core/workforce → services/workforce
```

Both are real peer bounded contexts/services when their current independent lifecycle/runtime/storage/contract responsibilities remain proven. Their former location under `core/` does not grant special architectural rank.

Package/export names must lose `core-` after consumer cutover.

A path move alone is not closure. Rebuild canonical internals, migrate data/contracts/clients/runtime consumers, then delete old roots and aliases.

## 2. Identity authority

Identity owns security-sensitive identity truth such as:

```text
actor identity
authentication
credentials/verification
session create/refresh/revoke
roles/permissions identity vocabulary
identity activation/security state
device/session authorization semantics where applicable
```

Apps bind platform storage/native callbacks; they do not reproduce session policy. DSH, WLT, Workforce, and Platform Control consume Identity rather than maintaining parallel auth truth.

Identity does not become owner of Workforce engagement, DSH operational assignment, WLT financial state, or app navigation merely because those systems authorize actors through Identity.

## 3. Identity topology refoundation

Refound `core/identity` into a coherent service rather than copying inherited internal layout.

Conceptual target when applicable:

```text
services/identity/
├── backend/
│   ├── cmd/
│   └── internal/
│       ├── runtime/
│       ├── transport/http/
│       ├── integrations/
│       └── <cohesive-identity-capabilities>/
├── contracts/
├── clients/generated/
├── frontend/          # only reusable host-neutral identity presentation/controllers
├── database/
└── tests/testing/
```

Possible semantic capabilities must be derived from live evidence rather than manufactured mechanically; examples may include actor, authentication, session, activation/access, authorization vocabulary, or device/session trust when those are truly separate cohesive responsibilities.

Technical/lifecycle mechanisms such as HTTP, token parsing, cache, rate limiting, background cleanup, device adapters, OTP sender adapters, or audit plumbing are not top-level business domains.

`cmd/*/main.go` remains thin startup. Large `internal/http` server/readiness/config files require cohesion review and rehome into runtime/transport/capability/integration owners rather than moving intact.

## 4. Identity contracts/generated-client law

Identity has one canonical service contract composition root when externally exposed, e.g.:

```text
services/identity/contracts/identity.openapi.yaml
```

Physical capability files may split for cohesion but remain one semantic authority.

```text
IDENTITY CANONICAL CONTRACT
→ VALIDATE/COMPOSE
→ DETERMINISTIC GENERATED CLIENT/BINDING
→ DSH/WLT/WORKFORCE/APPS/PLATFORM CONSUMERS
```

Forbidden parallel authorities include hand-maintained duplicate auth DTOs, roles/permissions enumerations, session-state interpretations, action maps, or consumer-local copies that can drift from canonical Identity semantics.

Authorization vocabulary and contract metadata do not replace server enforcement; consuming services remain responsible for enforcing permissions on their own protected operations using trusted Identity context/policy.

## 5. Identity database/security law

For each durable Identity/security fact prove:

```text
FACT
CANONICAL TABLE/COLUMNS
CANONICAL WRITER
READBACK/REVOCATION PATH
CONSTRAINTS/INDEXES
RETENTION/LIFECYCLE
PII/SECRET CLASSIFICATION
AUDIT REQUIREMENTS
LOSING STORAGE AUTHORITIES
```

Multiple mutable session/credential/actor authorities for the same meaning are forbidden.

Development/bootstrap credentials or historical examples must not define normal Identity credential policy. Credential/verification strength, rate limits and abuse controls derive from current Identity/Security requirements.

Each Identity deployment/storage boundary uses one globally ordered canonical migration lane unless a truly independent storage/deployment boundary proves otherwise.

Heightened security closure must prove applicable:

```text
CREDENTIAL/VERIFICATION SECRET MATERIAL IS NOT EXPOSED TO CLIENTS/LOGS/AUDIT PAYLOADS
SESSION/TOKEN CREATE-REFRESH-REVOKE SEMANTICS ARE SINGLE-AUTHORITY
SERVER-SIDE AUTHORIZATION CONTEXT CANNOT BE FORGED BY CLIENT INPUT
ACTOR/OPERATOR CONTEXT ISOLATION
REPLAY/EXPIRY/REVOCATION BEHAVIOR
BRUTE-FORCE/RATE-LIMIT OR EQUIVALENT ABUSE CONTROL WHERE REQUIRED
DEVICE/SESSION TRUST SEMANTICS WHEN USED
SECURITY-SENSITIVE CHANGES ARE AUDITABLE
PII ACCESS/MASKING/MINIMIZATION WHERE REQUIRED
RUNTIME SECRET REFERENCES ARE NOT RAW TRACKED VALUES
```

Do not weaken security constraints for local development convenience.

## 6. Identity integrations and frontend boundary

External messaging/verification/provider execution belongs under explicit Identity integrations only when Identity owns the semantic operation, for example:

```text
integrations/messaging/sms
integrations/messaging/email
integrations/verification-provider
```

Vendor details implement semantic ports and follow `providers-and-integrations.md`.

Reusable Login/Profile/security presentation may live under Identity frontend when host-neutral and genuinely reused. App route/shell/deep-link/native SecureStore/keychain/browser bindings remain in app roots.

## 7. Workforce conceptual correction

Do not encode employment relationship and operational role as one mutually exclusive axis.

Inherited concepts such as:

```text
workforce_kind = employee | captain | field
```

are noncanonical when they imply that being an employee excludes being a Captain/Field actor.

Refound Workforce around orthogonal concepts:

```text
PERSON
+
ENGAGEMENT
+
OPERATIONAL_ROLE_ASSIGNMENT
```

### Person

Represents the workforce person linked to a canonical Identity actor.

### Engagement

Represents the legal/organizational working relationship, for example when required:

```text
employee
independent-contractor
agency-worker/third-party-worker
```

These are engagement classifications, not operational roles.

### Operational role assignment

Represents what the person is operationally assigned to perform, for example:

```text
captain
field-agent
support-agent
operations-agent
```

A person may therefore be:

```text
Engagement = EMPLOYEE
Role       = CAPTAIN
```

or:

```text
Engagement = INDEPENDENT_CONTRACTOR
Role       = CAPTAIN
```

without duplicating the person or forcing a false mutually exclusive profile type.

## 8. Workforce ownership

Workforce may own, when proven:

```text
workforce person reference to Identity actor
engagement type/status
employee/contract identifiers
hire/start/end dates
organizational affiliation
supervision/reporting relationship
qualifications/licenses/documents
workforce availability/leave/shift facts
workforce lifecycle/status
role assignment metadata that belongs to workforce administration
```

Do not make Workforce the owner of DSH operational task truth or WLT financial truth merely because workforce actors participate.

Workforce-sensitive documents/PII require explicit access, retention, audit and masking/privacy treatment according to the actual data classification.

## 9. Service boundary split

```text
IDENTITY
  who is this actor and how are they authenticated/authorized?

WORKFORCE
  what is this person's working relationship, qualification, availability, and organizational lifecycle?

DSH
  what operational commerce/delivery/field work is assigned/performed?

WLT
  what wallet/commission/payout/collateral/financial consequences exist?
```

Operational role eligibility may require Workforce evidence, but DSH remains owner of DSH operational assignment/state. Financial consequences may reference Workforce/DSH evidence, but WLT remains financial authority.

## 10. Workforce topology

Do not mechanically create directories, but organize proven capabilities around real meanings such as:

```text
person
engagement
role-assignment
qualification
availability
document
organization-affiliation
```

Technical boundaries:

```text
transport/http
runtime
integrations/identity
integrations/dsh
integrations/wlt
```

`internal/dshclient` style packages should become explicit integrations, not pseudo-domains.

Large HTTP server/worker files and giant baseline SQL require cohesion review under orchestrator size rules; do not split merely by LOC, but do not preserve multi-responsibility files for convenience.

Workforce contracts/generated clients/database migrations follow the same sovereign-service lineage and one-canonical-migration-lane laws as other services.

## 11. Migration law for inherited profile exclusivity

Before changing current employee/captain/field profile constraints:

```text
CENSUS_ALL_CURRENT_WORKFORCE_FACTS
→ MAP_EACH_FACT_TO_PERSON/ENGAGEMENT/ROLE/QUALIFICATION/AVAILABILITY/OTHER_OWNER
→ IDENTIFY_DUPLICATE_OR_DERIVED_FACTS
→ DESIGN_CANONICAL_KEYS/CONSTRAINTS
→ TRANSFORM/BACKFILL_DETERMINISTICALLY
→ VERIFY_COUNTS/RELATIONSHIPS/INVARIANTS
→ CUT_OVER_WRITERS
→ CUT_OVER_READERS
→ DELETE_OLD_MUTUAL_EXCLUSIVITY/PROFILE_AUTHORITIES
```

Do not simply relax constraints and keep ambiguous duplicate models.

## 12. Independent service providers versus external technical providers

Do not overload the word `provider`.

A human independent contractor/service provider belongs to Workforce engagement/role semantics.

A technical external provider (payment/maps/SMS/etc.) belongs to integration/provider architecture in `targets/providers-and-integrations.md`.

Use explicit names such as `independent-contractor`, `captain`, `payment-rail`, `maps-adapter` rather than generic `provider` when ambiguity exists.

## 13. Exit gate

At closure prove:

```text
core/identity=ABSENT
core/workforce=ABSENT
core-* PACKAGE NAMES=0
IDENTITY_HTTP/RUNTIME_MEGA_CONTAINER_TOPOLOGY=0
PARALLEL_AUTH/SESSION/CREDENTIAL/ACTOR_AUTHORITIES=0
MANUAL_DUPLICATE_IDENTITY DTO/ROLE/PERMISSION/SESSION REGISTRIES=0
IDENTITY_CONTRACT/GENERATED_CLIENT_DRIFT=0
IDENTITY_SECURITY/PII/REVOCATION/AUDIT_GAPS=0
WORKFORCE_RELATIONSHIP_AND_OPERATIONAL_ROLE_CONFLATION=0
FALSE_EMPLOYEE_VS_CAPTAIN/FIELD_MUTUAL_EXCLUSIVITY=0
DSH_OPERATIONAL_TRUTH_OWNED_BY_WORKFORCE=0
WLT_FINANCIAL_TRUTH_OWNED_BY_WORKFORCE=0
STALE_DSHCLIENT/HTTP_MEGA_PACKAGE_TOPOLOGY=0
OLD_DB_CONSTRAINTS/PROJECTIONS_PRESERVING_LOSING_MODEL=0
PARALLEL_IDENTITY/WORKFORCE_MIGRATION_AUTHORITIES=0
OLD_CONTRACT/CLIENT/WORKSPACE/DOCKER PATHS=0
```
