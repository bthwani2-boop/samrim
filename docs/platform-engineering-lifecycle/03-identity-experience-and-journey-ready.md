DOCUMENT_CLASS: HUMAN_DEVELOPMENT_AND_OPERATIONS_GUIDANCE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
PARENT_GUIDE: docs/platform-engineering-lifecycle/README.md

# PHASE 10 — Identity and Access Foundation

If most material journeys require authenticated actors, close Identity/access early because all later authorization depends on it.

Do not interpret this as a universal law that every product must force authentication before all Product work. Public discovery or another anonymous journey may legitimately exist.

For an authenticated multi-role platform, verify as applicable:

```text
canonical actor identity
actor-class authentication policy
phone verification / managed activation / normal authentication / recovery separation
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
