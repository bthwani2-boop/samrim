DOCUMENT_CLASS: HUMAN_DEVELOPMENT_AND_OPERATIONS_GUIDANCE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
PARENT_GUIDE: docs/platform-engineering-lifecycle/README.md

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
