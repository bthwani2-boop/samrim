DOCUMENT_CLASS: HUMAN_DEVELOPMENT_AND_OPERATIONS_GUIDANCE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
PARENT_GUIDE: docs/platform-engineering-lifecycle/README.md

INTERPRETATION_RULE: HUMAN_REFERENCE_ONLY; MODULE_NUMBER_IS_NOT_EXECUTION_ORDER; CHECKLIST_IS_NOT_CLOSURE_AUTHORITY

# Secure Build, Supply Chain, and Release Candidate Creation

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

# Production Infrastructure, Reliability, and Disaster Recovery

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

# Staging / Preproduction and Production Readiness Review

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

# Internal Pilot and Beta

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

# Mobile Store Preparation

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

# Release Choreography and Mobile Compatibility

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

# Store Submission and Controlled Launch

Submit the exact qualified source/build candidate and preserve attributable build identity.

For review-gated apps, maintain working review credentials/demo flows and keep required backend services available for reviewers.

For the first public Google Play Production release, use the testing tracks and country availability to reduce risk beforehand because Google staged rollout percentages are not offered for the first Production release.

For subsequent updates, use staged rollout when risk justifies it and define stop criteria before starting.

For Apple updates, consider phased release when suitable, understanding that users may still manually download the update.

Server-side canary/feature admission remains important because mobile-store rollout cannot guarantee immediate rollback of installed clients.

---

# Launch Observation and Incident Response

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

# Support and Operator Tooling

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

# Continuous Post-Launch Delivery

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
