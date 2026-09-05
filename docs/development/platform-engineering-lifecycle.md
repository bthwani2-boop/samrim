# Platform Engineering and Delivery Lifecycle Guide

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_AND_OPERATIONS_GUIDANCE  
EXECUTION_AUTHORITY: NONE  
PRODUCT_SEMANTIC_AUTHORITY: NONE  
CURRENT_IMPLEMENTATION_AUTHORITY: LIVE_REPOSITORY_SOURCE_AND_RUNTIME  
MUTABLE_EXTERNAL_POLICY_AUTHORITY: CURRENT_OFFICIAL_PLATFORM/STORE_DOCUMENTATION

## 1. Purpose

This guide describes a rigorous end-to-end method for taking a multi-surface full-stack platform from an empty target repository to production operation and public mobile-store distribution when a legacy/donor system already exists.

It is a working guide, not a second source of Product truth, architecture authority, release authority, or campaign execution authority.

Authority remains with:

- `governance/**` for durable Product/System/Engineering meaning;
- executable source/contracts/configuration for current implementation state;
- `tools/prompting/bthwani-orchestrator/**` for the active refoundation campaign;
- current official Apple/Google/platform documentation for mutable store and platform rules.

When this guide conflicts with a canonical semantic owner, executable source, or current official platform rule, this guide is stale and must be corrected.

## 2. Core engineering model

The preferred lifecycle is:

```text
PIN DONOR EVIDENCE
+ DEFINE PRODUCT TRUTH
+ DEFINE NON-GOALS
+ DEFINE OWNERSHIP / TRUST / DATA BOUNDARIES
        ↓
BUILD THE MINIMUM JOURNEY-READY SUBSTRATE
        ↓
PROVE IT WITH ONE REPRESENTATIVE REAL VERTICAL SLICE
        ↓
DELIVER BUSINESS JOURNEYS VERTICALLY
        ↓
HARDEN SECURITY / RELIABILITY / OPERATIONS
        ↓
QUALIFY RELEASE CANDIDATES
        ↓
BETA / STORE REVIEW / CONTROLLED RELEASE
        ↓
PRODUCTION OBSERVATION / SUPPORT / INCIDENT RESPONSE
        ↓
CONTINUOUS JOURNEY DELIVERY
```

The two failure modes to avoid are:

```text
BUILD_EVERYTHING_HORIZONTALLY
→ integrate late
→ discover incompatible assumptions
```

and:

```text
BUILD_NO_FOUNDATION
→ start journeys immediately
→ refound architecture every week
```

The target state before broad feature development is a **journey-ready platform**: enough technical substrate exists that the next real journey requires its own Product/UX/domain/data/API/surface/test work, not another repository/auth/config/migration/build-system redesign.

## 3. Product vision, authorized slice, and deferred scope

A complete Product vision and incremental delivery are not opposites.

```text
TARGET_PRODUCT_VISION
        !=
AUTHORIZED_PRODUCT_SCOPE
        !=
ACTIVE_PRODUCT_SLICE
        !=
CURRENT_IMPLEMENTATION_STATE
```

Use two independent controls:

```text
QUALITY DEPTH  = how completely/correctly the authorized work is closed
PRODUCT BREADTH = how much Product functionality is authorized now
```

A Level-4-quality slice can therefore be intentionally small.

```text
SMALL BREADTH
+ CANONICAL OWNER/DATA/CONTRACT/RUNTIME
+ COMPLETE REQUIRED SURFACES/READBACK
+ FAILURE/SECURITY/TEST EVIDENCE
= VALID VERTICAL INCREMENT
```

Do not interpret “incremental” as permission to create disposable domain models, `v1` tables, fake APIs, temporary state machines, placeholder Product screens, shadow DTOs, or compatibility structures that must later be refounded.

A surface may also be **host-ready but business-deferred**: its deployable identity, bootstrap, authentication/session binding, shell, runtime configuration, and build proof can exist while its domain features remain deliberately absent.

When an active slice reaches its fixed point:

```text
FREEZE THE PROVEN BASELINE
→ RUN CUMULATIVE AFFECTED REGRESSION
→ STOP PRODUCT EXPANSION
→ ACTIVATE THE NEXT SLICE DELIBERATELY
```

Do not auto-activate the next feature simply because it appears next in the long-term roadmap.

### Slice admission gate

Before activating another Product slice, prove:

```text
PREVIOUS_BASELINE_REQUIRED_EVIDENCE=GREEN
NEW_SLICE_HAS_CLEAR_PRODUCT_OUTCOME
CANONICAL_OWNER/WRITER=KNOWN
NO_SECOND_SOURCE_OF_TRUTH_REQUIRED
NO_DISPOSABLE_ARCHITECTURE_REQUIRED
DONOR/EXTERNAL_EVIDENCE_CONE_IS_ACQUIRABLE
SLICE_CAN_CLOSE_VERTICALLY_AT_REQUIRED_QUALITY_DEPTH
```

Then implement the new slice and re-run every prior proof invalidated by shared owners, contracts, data, runtime, packages, or hosts.

## 4. Non-negotiable principles

1. **Donor is evidence, not target topology.**
2. **Product meaning precedes directory structure.**
3. **One durable fact has one canonical owner and one governed writer.**
4. **Use the minimum necessary number of deployable/runtime boundaries.**
5. **Repository strategy and runtime architecture are separate decisions.**
6. **A capability closes vertically across every materially affected layer and consumer.**
7. **Security, privacy, data evolution, accessibility, observability, and release engineering start before launch.**
8. **Static green does not prove runtime correctness; runtime green does not prove security, data migration, financial, or release correctness.**
9. **Public mobile clients require backward-compatible server evolution across their real support window.**
10. **External-provider timeout/ambiguity is not success and is not failure until authoritative evidence resolves it.**
11. **Build and release artifacts require attributable immutable identity and controlled inputs.**
12. **Mutable store/platform requirements are revalidated at every release.**
13. **Do not create framework/registry/event-bus/cache/service complexity before a concrete requirement proves it.**
14. **Parallel development is allowed; partial horizontal closure is not.** Independent journeys may proceed concurrently only when worksets, ownership, migration, integration, and verification boundaries are explicit. Each claimed outcome still closes as a complete vertical unit.

## 4. Reference baseline

Use context-appropriate standards rather than inventing a private assurance system.

Recommended baseline:

- NIST SP 800-218 Secure Software Development Framework (SSDF) for secure-development practices.
- OWASP ASVS 5.x for web/backend application-security verification requirements.
- OWASP MASVS + MASTG/MASWE for mobile security verification and testing.
- WCAG 2.2, normally Level AA where applicable for web accessibility, plus native platform accessibility semantics.
- OpenAPI or another machine-verifiable canonical interface description for HTTP APIs when appropriate.
- OpenTelemetry or equivalent standard telemetry interfaces when tracing/metrics are required.
- SLSA concepts for build provenance/attestation where supported and material.
- Platform-native Apple/Android security, privacy, permission, signing, and store requirements.
- Jurisdiction-specific legal/privacy/financial advice where the business model requires it; store compliance is not legal compliance.

Reference links are listed at the end of this guide.

---

# PHASE 0 — Authority, Product Scope, and Success Definition

Do not start with framework selection, database tables, or home-screen design.

Define at minimum:

```text
Markets / jurisdictions
Languages / directionality
Currencies / money precision
Actors and trust classes
Business model
Legal/operator entity
Commercial relationships
Fulfillment/delivery model
Payment/settlement model
Support/operations model
Data/privacy classes
Required mobile/web surfaces
External-system dependencies
Product success measures
Reliability/security risk class
Explicit non-goals
```

For each intended surface, state why it exists and what actor responsibility it serves.

Also define measurable outcomes. Examples:

```text
order completion rate
payment reconciliation objective
delivery completion objective
support-resolution capability
availability/latency goals where actually authorized
crash-free session target where actually authorized
```

Do not invent SLO/RPO/RTO numbers merely to fill a template. Missing numbers that are required for safe operation are a Product/operations decision gap.

### Exit gate

```text
PRODUCT_SCOPE_KNOWN=YES
PRIMARY_ACTORS_KNOWN=YES
REQUIRED_SURFACES_KNOWN=YES
CRITICAL_EXTERNAL_DEPENDENCIES_KNOWN=YES
NON_GOALS_EXPLICIT=YES
KNOWN_REQUIRED_JURISDICTIONAL_REVIEW_IDENTIFIED=YES
```

---

# PHASE 1 — Freeze and Census the Donor

Pin the donor to an immutable ref/commit and treat it as read-only evidence.

Do not migrate by folder name. Build a forensic inventory covering, as applicable:

```text
deployable apps
screens/routes/navigation
backend endpoints
contracts/events
database schemas/migrations
business invariants/state machines
authorization rules
financial flows
providers/integrations
jobs/cron/queues/outbox
notifications
offline/weak-network behavior
native capabilities/permissions
assets/fonts/icons/licenses
translations/content
tests/fixtures
operational scripts/runbooks
release identities/bundle/package IDs
signing/provider registrations
failure/retry/reconciliation behavior
known incidents/workarounds
```

Never copy secrets from the donor into the target.

Preserve evidence of external identities before deleting or changing anything that may be expensive or impossible to recreate, such as:

```text
bundle/package identifiers
store application records
provider application/client identifiers
callback/redirect registrations
push-notification identities
signing relationships/certificates
domain/DNS ownership
public keys/fingerprints
data migration lineage
```

Secret values themselves remain in approved secret stores.

## Donor classification

Classify each material donor item into exactly one useful disposition:

```text
A. REQUIRED PRODUCT/SYSTEM TRUTH
   behavior/invariant/state/edge case that must survive

B. REQUIRED EXTERNAL IDENTITY / COMPATIBILITY FACT
   bundle/package/store/provider/signing/public compatibility identity

C. PROVEN USEFUL PATTERN
   idea worth reimplementing, but donor container/implementation is not authority

D. REUSABLE CODE/ASSET CANDIDATE
   reusable only after ownership, license, provenance, security, architecture,
   dependency, and maintenance suitability are proven

E. OBSOLETE
   no longer required

F. ARCHITECTURAL / SECURITY / QUALITY DEBT
   explicitly rejected; do not recreate
```

The rule is:

```text
SALVAGE REQUIRED TRUTH
!=
PRESERVE DONOR CONTAINER
```

### Exit gate

```text
DONOR_REF_PINNED=YES
DONOR_MUTATION=0
KNOWN_MATERIAL_DONOR_SURFACES_CENSUSED=YES
CRITICAL_EXTERNAL_IDENTITIES_ACCOUNTED=YES
SECRET_COPYING_TO_TARGET=0
LICENSE/ASSET_PROVENANCE_GAPS_IDENTIFIED=YES
```

---

# PHASE 2 — Product Capabilities, Actors, and Journeys

Build a capability model before service decomposition.

For every material capability define:

```text
problem/outcome
actors
allowed/forbidden actions
canonical owner
canonical writer
required surfaces
preconditions
trusted context
durable states
legal transitions
idempotency/concurrency requirements
failure/recovery semantics
external effects
security/privacy constraints
financial effects when applicable
canonical readback
acceptance criteria
```

Create an Actor × Capability × Surface map to reveal actual surface obligations.

Then model end-to-end journeys. A journey is not a screen sequence; it is a system outcome:

```text
ENTRY
→ UNDERSTAND
→ ACTION
→ AUTHORIZATION
→ DOMAIN DECISION
→ DURABLE / EXTERNAL EFFECT
→ CROSS-SURFACE HANDOFF
→ FEEDBACK
→ CANONICAL READBACK
→ FAILURE / UNKNOWN / RECOVERY
→ TERMINAL OUTCOME
```

For every material journey explicitly cover:

```text
happy path
validation failure
forbidden path
conflict/concurrency
duplicate/replay
dependency timeout
partial failure
offline/weak network
unknown external outcome
retry/recovery
cancellation/reversal where legal
later readback
audit/support visibility
```

### Exit gate

```text
UNOWNED_MATERIAL_CAPABILITIES=0
UNMAPPED_REQUIRED_ACTORS=0
UNMAPPED_REQUIRED_SURFACES=0
UNDEFINED_MATERIAL_STATE_TRANSITIONS=0
UNDEFINED_CRITICAL_FAILURE/RECOVERY_SEMANTICS=0
```

---

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

# PHASE 10 — Identity and Access Foundation

If most material journeys require authenticated actors, close Identity/access early because all later authorization depends on it.

Do not interpret this as a universal law that every product must force authentication before all Product work. Public discovery or another anonymous journey may legitimately exist.

For an authenticated multi-role platform, verify as applicable:

```text
canonical actor identity
authentication/activation
credential lifecycle
role/admission model
sessions/refresh/rotation
logout/revocation
abuse/rate controls
device/session policy
service authentication
operator/admin provisioning
authorization boundary
session expiry/recovery
```

Authentication proves who the caller is. Business authorization remains with the owner of the protected business truth unless a distinct authorization owner is explicitly admitted.

---

# PHASE 11 — UI/UX Foundation and Deployable App Shells

Build a small design/experience foundation before broad business screens:

```text
brand/semantic tokens
typography
spacing/radius/elevation
RTL/LTR/localization foundation
accessibility baseline
responsive/device rules
content/terminology rules
loading/error/empty/offline patterns
core reusable primitives
```

Do not prebuild domain components and dashboards before real journeys prove them.

Deployable app shells should establish:

```text
bootstrap
session restore
signed-out/auth boundary
authenticated shell
routing/navigation substrate
safe-area/platform integration
theme
RTL
error boundary
offline/weak-network handling
deep-link entry
notification entry
runtime configuration
accessibility baseline
```

A shell can be intentionally neutral before business journeys arrive. Avoid fake Product screens/data just to make the app look complete.

---

# PHASE 12 — Representative Golden Vertical / Walking Skeleton

Before scaling feature development, prove the architecture with one **real, representative** vertical outcome.

Do not choose a trivial toy slice if it does not test the architecture claims. The first slice should cover enough real boundaries to falsify the foundation, typically:

```text
Product requirement
→ UX/state model
→ authorization
→ DB migration
→ domain behavior
→ API contract
→ generated client
→ at least one real surface
→ real persistence/readback
→ runtime
→ CI
```

If cross-surface handoff is central to the platform architecture, the walking skeleton should exercise at least one cross-surface handoff.

The goal is not business breadth. The goal is proof that a real journey can enter the new house without refounding the house.

### Journey-ready gate

A platform is journey-ready only when a new journey does not require reopening foundational decisions such as:

```text
repository topology
auth/session architecture
database ownership/migration strategy
contract/codegen strategy
app bootstrap/shell model
runtime configuration model
basic CI/build path
core design/RTL/accessibility substrate
```

A normal new journey may still add its own:

```text
routes/screens
domain packages
migrations
contract operations
generated bindings
provider adapters
tests
navigation composition
telemetry
```

---

# PHASE 13 — Repeatable Journey Delivery Loop

For every real journey:

```text
SELECT JOURNEY
→ PIN CURRENT TARGET + DONOR CONE
→ EXTRACT REQUIRED DONOR TRUTH
→ CONFIRM PRODUCT/OWNER/INVARIANTS
→ MODEL UX + FAILURE/RECOVERY
→ IMPLEMENT DATA + DOMAIN
→ IMPLEMENT CONTRACT
→ GENERATE/VERIFY BINDINGS
→ IMPLEMENT ALL REQUIRED SURFACES
→ VERIFY AUTHORIZATION
→ VERIFY CANONICAL PERSISTED/EXTERNAL EFFECT
→ VERIFY AFFECTED READBACKS/HANDOFFS
→ VERIFY NEGATIVE/CONCURRENCY/RETRY PATHS
→ RUN RUNTIME/E2E
→ CLEAN LOSERS/RESIDUE
→ CLOSE EXACT CANDIDATE
```

Independent journeys may execute in parallel only when their affected data/contracts/runtime/surfaces are safely partitioned and the resulting integration candidate is reverified. Never redefine “parallel” to mean backend wave now and frontend wave later.

## Donor cone for each journey

Search only the donor material that can reveal requirements for the selected journey:

```text
screens/content
domain rules
DB invariants
contracts
tests
edge cases
provider behavior
offline/network behavior
historical failures
operational/support requirements
```

Record what survives and why. Do not inherit donor topology by default.

---

# PHASE 14 — Providers, Async Work, Notifications, and Financial Systems

## Providers

Terminate provider details at explicit semantic adapters/ports.

For every external integration define:

```text
owner
credentials
request/response contract
timeouts
retry/idempotency
rate/quota behavior
signature/verification
error normalization
unknown-result behavior
observability
reconciliation
sandbox/test strategy
```

Provider names must not become business-domain owners.

## Async work

Introduce queues/events only when asynchronous decoupling, durability, throughput, or failure isolation proves the need.

When database state and event publication must be atomic, a transactional outbox is a common valid pattern.

Workers/consumers must address:

```text
duplicates
idempotency
ordering where required
lease/visibility timeout
restart/replay
poison/dead-letter handling
backpressure
stuck-work detection
correlation
```

## Notifications

Notification delivery is not proof that source-domain mutation succeeded, and notification retry must not replay the source-domain mutation.

## Financial core

For authoritative wallet/ledger/payment/refund/settlement systems, use accounting-grade invariants.

As applicable:

```text
exact monetary representation
currency discipline
immutable/append-only journal semantics
double-entry accounting for ledger/wallet movement where appropriate
holds/releases
idempotent commands
provider evidence
reversals rather than arbitrary history rewrite
reconciliation
auditability
unknown external outcomes
separation of available/held/pending state
```

Never use floating-point arithmetic for authoritative money.

```text
PROVIDER_TIMEOUT != SUCCESS
PROVIDER_TIMEOUT != FAILURE
PROVIDER_TIMEOUT = UNKNOWN UNTIL RECONCILED
```

---

# PHASE 15 — Verification Architecture

Testing starts with the first capability and expands by risk.

Use the smallest evidence that can falsify a claim, then expand.

Applicable evidence includes:

```text
unit tests
domain/invariant tests
property/fuzz tests where valuable
database integration tests
migration/upgrade tests
contract/schema tests
service integration tests
concurrency/race tests
negative authorization tests
frontend/component tests
mobile interaction tests
accessibility tests
RTL/localization checks
multi-surface E2E
provider sandbox/fault tests
network degradation/offline
performance/load/capacity
restart/recovery
backup/restore
real-device testing
security review/penetration testing
```

Do not optimize for test count. Optimize for coverage of material failure modes.

## Real-device matrix

Choose by risk and supported users, not by a ceremonial fixed list.

Include representative combinations of:

```text
low-resource Android
current mainstream Android
different screen classes
current iPhone
oldest materially supported iPhone/OS
slow/high-latency network
offline/reconnect
permission denied/revoked
location disabled
background/foreground
OS process kill/relaunch
large text/accessibility settings
expired/revoked session
battery/background restrictions where operationally relevant
```

Operational driver/captain applications may require especially strong background-location, battery-management, process-death, and intermittent-network verification.

---

# PHASE 16 — Secure Build, Supply Chain, and Release Candidate Creation

Production artifacts come from controlled attributable source and build inputs.

Capture, as applicable:

```text
source SHA
lockfiles
toolchain/compiler
base-image digest
build recipe
generated-code inputs
build-time configuration class
native signing inputs
artifact digest
SBOM
provenance/attestation
signature
```

A rebuild is a new artifact unless the build is reproducible and identity is proven.

For native applications, signing/store processing can legitimately produce a final distributed binary that differs from a local unsigned/intermediate artifact. Therefore the precise rule is:

```text
SAME APPROVED SOURCE
+ LOCKED/CONTROLLED BUILD INPUTS
+ ATTRIBUTABLE BUILD IDENTITY
+ TEST THE FINAL STORE-DISTRIBUTABLE CANDIDATE THROUGH THE PLATFORM TEST PATH
```

Do not falsely claim byte identity when signing/repackaging makes it untrue.

---

# PHASE 17 — Production Infrastructure, Reliability, and Disaster Recovery

Production-critical infrastructure should be reproducible and observable.

As applicable:

```text
production database
PITR/backup strategy
object storage
DNS/TLS
secret management
capacity/resource limits
autoscaling only when justified
rate limiting/WAF where useful
metrics/logs/traces
alerting
release identity
runbooks
on-call/incident ownership
```

Define SLO/SLI targets from actual Product/operations requirements.

## Restore proof

A backup checkbox is not recovery evidence.

Perform representative drills:

```text
BACKUP / SNAPSHOT
→ RESTORE INTO ISOLATED ENVIRONMENT
→ VERIFY SCHEMA
→ VERIFY DATA INTEGRITY
→ VERIFY REQUIRED JOURNEYS / RECONCILIATION
→ RECORD ACTUAL RECOVERY CHARACTERISTICS
```

For finance/audit-critical data, prove reconciliation after restore as applicable.

---

# PHASE 18 — Staging / Preproduction and Production Readiness Review

Staging is a production rehearsal, not a second development truth.

Use production-representative deployment/configuration/provider semantics to the extent necessary for the claims being tested, with isolated credentials and synthetic/safe data.

A Production Readiness Review should answer, as applicable:

```text
Can users enter/recover/delete accounts correctly?
Do session expiry/revocation paths work?
Can duplicate commands create duplicate durable/financial effects?
Are old mobile clients still compatible?
Can migrations recover from interruption?
Can we restore data?
Can we detect dependency/provider failure?
Can we diagnose an order/payment/actor/support case?
Can we rotate/revoke secrets and credentials?
Can we stop/mitigate a bad rollout?
Are alerts actionable?
Are runbooks usable?
Are support/operations trained?
Are privacy/store declarations consistent with actual code/SDK behavior?
Are critical external-provider credentials/quotas ready?
Are required legal/compliance approvals complete?
```

Unknown required evidence is not PASS.

---

# PHASE 19 — Internal Pilot and Beta

Start with controlled real users before broad production exposure where the Product permits it:

```text
developers
operations/support
selected partners
selected field/captain users
selected customers
```

Use real devices and production-like infrastructure. Exercise:

```text
real authentication
real notifications
real map/location behavior
real operational handoffs
provider sandbox or safely bounded real-provider paths
support workflows
upgrade/fresh-install
```

For native mobile, qualify the release candidate through official platform distribution paths such as Google Play testing tracks and TestFlight as appropriate.

---

# PHASE 20 — Mobile Store Preparation

Establish stable application identity early:

```text
Android package/application ID
Apple bundle ID
store application records
URL/deep-link identities
push-notification identity
signing/upload relationships
associated domains where needed
```

Do not recreate or rename them casually after external consumers/providers depend on them.

## Common store package

Prepare:

```text
app name
icon
screenshots/app previews
description/subtitle/keywords where applicable
privacy policy
support contact/URL
age/content rating
countries/regions
data/privacy declarations
account deletion path when required
review instructions
review/demo accounts
release notes
permissions/usage descriptions
export/encryption declarations where applicable
```

Screenshots and metadata must represent actual current behavior; promotional design may frame real experience but must not fabricate capabilities.

## Google Play — mutable requirements snapshot

**Snapshot date: 2026-09-05. Revalidate official policy at every submission.**

Current official requirements include:

- New apps and app updates submitted from 2026-08-31 must target Android 16 / API level 36 or higher for normal Android mobile apps.
- Existing apps generally need Android 15 / API level 35 or higher to remain available to new users on newer Android versions, subject to Google's current policy details and any granted extension.
- Play App Signing is the required signing path for new apps; keep the upload key separate where possible and protect it.
- Personal developer accounts created after 2023-11-13 currently must complete a closed test with at least 12 continuously opted-in testers for at least 14 days before applying for production access.
- Apps that support account creation must provide an in-app deletion request path and an external web deletion path, with required retention exceptions disclosed.
- Data Safety, privacy policy, permissions, content rating, app access/review instructions, and applicable special declarations must match actual behavior.
- Staged rollout is available for **updates**, not the first Production release.

## Apple App Store — mutable requirements snapshot

**Snapshot date: 2026-09-05. Revalidate official policy at every submission.**

Current official requirements include:

- Since 2026-04-28, App Store Connect uploads must be built with Xcode 26 or later using the applicable iOS/iPadOS 26 SDK or later for iOS/iPadOS submissions.
- Apps supporting account creation must offer in-app account deletion.
- Protected-resource permissions must be relevant and purpose-limited; optional permissions should have reasonable alternatives where possible.
- Privacy manifests / Required Reason API declarations and listed third-party SDK requirements must match the actual native dependency set.
- App Privacy responses, privacy policy, export-compliance responses where applicable, age rating, review information, and screenshots must be complete and truthful.
- TestFlight currently supports up to 100 internal testers and up to 10,000 external testers; external testing can require Beta App Review.
- Apple phased release for an **update** distributes automatic updates over seven days and can be paused; it is not a substitute for server-side safety controls.

---

# PHASE 21 — Release Choreography and Mobile Compatibility

Do not use the simplistic rule “backend must always deploy before mobile.” Use compatibility-aware choreography.

The safe default for a server capability required by a new mobile client is:

```text
1. EXPAND DB / CONTRACT COMPATIBLY
2. DEPLOY BACKWARD-COMPATIBLE SERVER SUPPORT
3. VERIFY PRODUCTION
4. RELEASE / ACTIVATE CLIENT
5. OBSERVE ADOPTION WINDOW
6. REMOVE OLD CONTRACT/SCHEMA ONLY AFTER SUPPORTED OLD CLIENTS ARE SAFE
```

Another valid pattern is shipping dormant client code first behind an inactive server-controlled feature, provided existing servers/clients remain compatible and the feature cannot activate prematurely.

The invariant is:

```text
NO PUBLIC CLIENT MAY DEPEND ON SERVER BEHAVIOR THAT IS NOT YET SAFE AND AVAILABLE
NO SERVER CHANGE MAY BREAK STILL-SUPPORTED PUBLIC CLIENTS
```

Feature flags are bounded transition/rollout mechanisms. Every material flag should have:

```text
owner
purpose
audience
default/failure behavior
observability
promotion/rollback condition
expiry/removal condition
```

---

# PHASE 22 — Store Submission and Controlled Launch

Submit the exact qualified source/build candidate and preserve attributable build identity.

For review-gated apps, maintain working review credentials/demo flows and keep required backend services available for reviewers.

For the first public Google Play Production release, use the testing tracks and country availability to reduce risk beforehand because Google staged rollout percentages are not offered for the first Production release.

For subsequent updates, use staged rollout when risk justifies it and define stop criteria before starting.

For Apple updates, consider phased release when suitable, understanding that users may still manually download the update.

Server-side canary/feature admission remains important because mobile-store rollout cannot guarantee immediate rollback of installed clients.

---

# PHASE 23 — Launch Observation and Incident Response

A successful deployment/store approval is not Product success.

Monitor both technical and Product health:

```text
TECHNICAL
- error rate
- latency
- saturation
- DB/connection state
- provider latency/failure
- job/queue/reconciliation lag
- mobile crashes/ANR
- iOS crashes
- auth/OTP failures

PRODUCT
- registration/auth completion
- journey completion
- order creation/completion
- cancellation/failure reasons
- payment unknown/reconciliation state
- delivery completion/latency
- support contacts
- retention/conversion where relevant
```

Before launch, define:

```text
incident commander/owner
severity model
rollout-stop authority
server rollback/forward-fix path
database recovery constraints
provider disable/fail-safe path
credential revoke/rotate path
financial reconciliation procedure
support/user communication path
post-incident follow-up
```

Do not improvise financial reconciliation during an incident.

---

# PHASE 24 — Support and Operator Tooling

Operational/control surfaces are part of the platform, not privileged database editors.

Support/operators need governed visibility and actions for materially supportable objects, for example:

```text
actor
order
partner/store
captain/field participant
payment/settlement state
provider state
audit history
support history
correlation/release identity
```

Operator actions must invoke real governed capabilities. Avoid arbitrary “edit status”, direct balance edits, audit deletion, or raw-table mutation.

---

# PHASE 25 — Continuous Post-Launch Delivery

After launch:

```text
OBSERVE
→ MEASURE
→ TRIAGE SUPPORT/FAILURES
→ SELECT NEXT OUTCOME
→ CENSUS DONOR CONE
→ IMPLEMENT VERTICAL JOURNEY
→ VERIFY
→ RELEASE
→ OBSERVE
```

Delete stale flags, compatibility paths, deprecated fields/routes, unused providers, and dead experimental code after proven cutover.

Do not allow “temporary” release mechanisms to become permanent architecture.

---

# Canonical evidence gates

## A. Foundation / Journey-Ready Gate

```text
PRODUCT/ACTOR/OWNER MODEL=DEFINED
DONOR_CRITICAL_TRUTH_CENSUSED=PASS
CRITICAL_EXTERNAL_IDENTITIES_ACCOUNTED=PASS
TOOLCHAIN/BOOTSTRAP=PASS
CI_REQUIRED_BASELINE=PASS
ENV/CONFIG/SECRET_MODEL=PASS
DB/MIGRATION_SUBSTRATE=PASS
CONTRACT/GENERATION_SUBSTRATE=PASS
BACKEND_TECHNICAL_CHASSIS=PASS
IDENTITY/ACCESS_FOUNDATION=PASS_WHERE_REQUIRED
UI/UX/DESIGN/ACCESSIBILITY_FOUNDATION=PASS
DEPLOYABLE_APP_SHELLS=PASS
REPRESENTATIVE_GOLDEN_VERTICAL=PASS
KNOWN_FOUNDATION_DEFECTS=0
KNOWN_FOUNDATION_PARALLEL_TRUTH=0
```

## B. Journey Closure Gate

```text
PRODUCT_MEANING=PASS
OWNER/WRITER=PASS
UX_STATES=PASS
AUTHN/AUTHZ=PASS
DATA/MIGRATION=PASS_IF_APPLICABLE
DOMAIN_INVARIANTS=PASS
CONTRACT=PASS
GENERATED_BINDINGS=PASS
REQUIRED_SURFACES=PASS
PERSISTED/EXTERNAL_EFFECT=PASS
CANONICAL_READBACK=PASS
AFFECTED_CONSUMERS/HANDOFFS=PASS
DUPLICATE/RETRY/CONCURRENCY=PASS_IF_APPLICABLE
FAILURE/UNKNOWN/RECOVERY=PASS
ACCESSIBILITY/RTL=PASS_IF_APPLICABLE
RUNTIME/E2E=PASS
KNOWN_JOURNEY_RESIDUE=0
```

## C. Production Readiness Gate

```text
EXACT_RELEASE_CANDIDATE_IDENTIFIED=PASS
SECURITY/PRIVACY_EVIDENCE=PASS
MIGRATION/COMPATIBILITY=PASS
BACKUP/RESTORE=PASS_WHERE_REQUIRED
OBSERVABILITY/ALERTING=PASS
RUNBOOK/INCIDENT_OWNERSHIP=PASS
CAPACITY/PERFORMANCE=PASS_WHERE_REQUIRED
PROVIDER_READINESS=PASS
SUPPORT/OPERATIONS_READINESS=PASS
STORE/LEGAL_DECLARATIONS=PASS_IF_APPLICABLE
KNOWN_MATERIAL_RELEASE_BLOCKERS=0
```

## D. Store Submission Gate

```text
FINAL_STORE_BINARY/BUILD_IDENTITY=KNOWN
PACKAGE/BUNDLE_ID=CORRECT
VERSION/BUILD=CORRECT
SIGNING/ENTITLEMENTS=PASS
TARGET_SDK/API_POLICY=PASS
PERMISSIONS/USAGE_DESCRIPTIONS=PASS
PRIVACY/DATA_DECLARATIONS=PASS
ACCOUNT_DELETION=PASS_IF_REQUIRED
AGE/CONTENT_RATING=PASS
SCREENSHOTS/METADATA=TRUTHFUL
REVIEW_ACCOUNT/INSTRUCTIONS=PASS_IF_REQUIRED
BETA_TRACK_EVIDENCE=PASS
CURRENT_OFFICIAL_STORE_POLICY_REVALIDATED=PASS
```

## E. Release Closure Gate

```text
RELEASED_IDENTITY=ATTRIBUTABLE
POST_DEPLOY/STORE_HEALTH=PASS
CRITICAL_PRODUCT_JOURNEYS=PASS
MIGRATION/RECONCILIATION=PASS
OBSERVATION_WINDOW=COMPLETE_AS_REQUIRED
NO_KNOWN_MATERIAL_RELEASE_BLOCKER
ROLLOUT/FEATURE_FLAGS_HAVE_NEXT_DISPOSITION
RELEASE_RECORD=COMPLETE
```

---

# Donor Truth Ledger template

For each material donor discovery, record only enough to make the disposition auditable:

```text
DONOR REF:
SOURCE PATH / EVIDENCE:
PRODUCT/SYSTEM MEANING:
CURRENT TARGET OWNER:
CLASSIFICATION: A | B | C | D | E | F
MUST SURVIVE?:
WHY:
TARGET IMPLEMENTATION/CONTRACT:
SECURITY/PRIVACY/LICENSE NOTES:
VERIFICATION REQUIRED:
LOSING DONOR SHAPE TO REJECT:
```

This ledger is evidence/analysis, not a second Product authority.

# Journey Definition template

```text
JOURNEY:
ACTORS:
BUSINESS OUTCOME:
ENTRY:
PRECONDITIONS:
CANONICAL OWNER(S):
AUTHENTICATION:
AUTHORIZATION / OBJECT SCOPE:
DURABLE STATES:
LEGAL TRANSITIONS:
FORBIDDEN TRANSITIONS:
DATA OWNER / MIGRATION:
PUBLIC CONTRACT:
IDEMPOTENCY:
CONCURRENCY:
PROVIDERS:
FINANCIAL EFFECT:
NOTIFICATIONS / ASYNC:
REQUIRED SURFACES:
UX STATES:
FAILURE / UNKNOWN / RECOVERY:
CANONICAL READBACK:
SUPPORT / AUDIT:
SECURITY / PRIVACY:
OBSERVABILITY:
ACCEPTANCE:
NEGATIVE INVARIANTS:
DONOR REQUIRED TRUTH:
```

---

# Premature complexity rejection list

Do not create these merely “for future flexibility”:

```text
service per noun
generic workflow/saga engine
runtime feature/journey registry
generic plugin platform
generic authorization engine
generic tenant/context abstraction
generic repository/service framework
event bus without async requirement
cache without measured/coordination need
service mesh without operational need
huge shared UI/business library
fake business routes/tables/screens
shadow APIs/DTOs/state machines
permanent compatibility aliases
```

Admit them only when a concrete requirement proves they reduce total system complexity and have a clear owner/lifecycle.

---

# Reference links

Security / SDLC:
- NIST SSDF SP 800-218: https://csrc.nist.gov/pubs/sp/800/218/final
- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- OWASP MASVS: https://mas.owasp.org/MASVS/
- OWASP MASTG: https://mas.owasp.org/MASTG/

Accessibility:
- WCAG 2.2: https://www.w3.org/TR/WCAG22/

Supply chain:
- SLSA: https://slsa.dev/

Apple:
- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Upcoming Requirements: https://developer.apple.com/news/upcoming-requirements/
- Third-party SDK requirements: https://developer.apple.com/support/third-party-SDK-requirements/
- TestFlight: https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview
- Phased release: https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases

Google Play / Android:
- Target API requirements: https://support.google.com/googleplay/android-developer/answer/11926878
- Personal-account testing requirements: https://support.google.com/googleplay/android-developer/answer/14151465
- User data / account deletion: https://support.google.com/googleplay/android-developer/answer/10144311
- Play App Signing: https://developer.android.com/studio/publish/app-signing
- Release tracks: https://support.google.com/googleplay/android-developer/answer/9859348
- Staged rollouts: https://support.google.com/googleplay/android-developer/answer/6346149

## Final rule

The method can be summarized as:

```text
FOUNDATION FIRST
BUT ONLY THE FOUNDATION THAT A REAL JOURNEY NEEDS

THEN

ONE REPRESENTATIVE REAL VERTICAL SLICE
TO FALSIFY THE FOUNDATION

THEN

REAL JOURNEYS, END TO END,
WITH SAFE PARALLELISM WHERE PROVEN

THEN

PRODUCTION HARDENING, STORE QUALIFICATION,
CONTROLLED RELEASE, AND OPERATIONS

WHILE THE DONOR REMAINS A KNOWLEDGE MINE,
NEVER THE TARGET ARCHITECTURE
```
