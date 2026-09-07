# Release and Mobile Store Submission

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_AND_OPERATIONS_GUIDANCE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_TRUTH_SOURCE: LIVE_BUILD_RELEASE_CONFIG_AND_ARTIFACTS
MUTABLE_EXTERNAL_POLICY_TRUTH_SOURCE: CURRENT_OFFICIAL_APPLE_AND_GOOGLE_DOCUMENTATION

## Candidate attribution

Preserve materially applicable source SHA, dependency resolution, toolchain, generated inputs, build recipe/config class, native package/bundle identity, signing/upload relationship, artifact/build identity and store-distributed version.

Store signing/repackaging may change bytes; prove attributable source/build lineage rather than false local/store byte equality.

## Compatibility choreography

For server capability required by a public mobile client, the normal safe shape is:

```text
EXPAND DB/CONTRACT COMPATIBLY
→ DEPLOY BACKWARD-COMPATIBLE SERVER SUPPORT
→ VERIFY SERVER
→ RELEASE/ACTIVATE CLIENT
→ OBSERVE SUPPORTED VERSION WINDOW
→ REMOVE OLD CONTRACT/SCHEMA WHEN SUPPORTED CLIENTS ARE SAFE
```

A dormant client-first release can also be valid when it cannot activate against an incompatible server.

## Preproduction and store package

Use staging/preproduction as rehearsal, not a second Product truth. Keep credentials isolated and data synthetic/safe. Exercise official distribution paths when material and test fresh install/upgrade, auth, notifications, deep links, native permissions/location and affected journeys on representative real devices.

Before submission verify current executable/store truth for package/application ID, Apple bundle ID, signing/upload identities, name/icon/screenshots/previews, description/release notes, privacy/support URLs, content rating, regions, privacy/data declarations, account deletion, review instructions/access, permissions/usage descriptions and export/encryption declarations as applicable.

## Mutable store-policy snapshot

Snapshot reviewed: **2026-09-05**. Revalidate official policy at every submission.

### Google Play

For ordinary Android apps, Google currently requires new apps and updates submitted from **2026-08-31** to target **Android 16 / API level 36 or higher**. Existing-app availability requirements and extension paths are mutable and must be rechecked.

For personal developer accounts created after **2023-11-13**, Google currently requires a closed test with at least **12 continuously opted-in testers for at least 14 days** before applying for Production access.

Official sources:
- https://support.google.com/googleplay/android-developer/answer/11926878
- https://support.google.com/googleplay/android-developer/answer/14151465

### Apple App Store

Apple currently states that since **2026-04-28**, App Store Connect uploads must be built with **Xcode 26 or later** using the applicable **26-generation platform SDK**.

Official source:
- https://developer.apple.com/news/upcoming-requirements/

Do not copy mutable store requirements into durable Governance.

## Operational go-live readiness

Before a materially risky production/store launch, verify the operational responsibilities needed for the exact candidate are actually ready, as applicable:

- incident/decision owner and escalation path;
- current runbook for the material failure classes;
- observability/alerts that identify the affected release/correlation;
- safe rollback or forward-fix path;
- migration/restore/reconciliation procedure where durable or financial truth is affected;
- provider credentials/quota/readiness for the intended environment;
- support/operator visibility and governed actions needed to investigate real incidents;
- reviewer/demo access where a platform review requires it;
- unresolved legal/privacy/compliance decisions identified by the Product/business model are resolved by the appropriate authority rather than guessed by engineering.

A deployment command, store approval, backup checkbox, or monitoring dashboard alone is not operational readiness.

## Submission, rollout and observation

Submit the exact qualified build/source lineage. Keep reviewer-access services/credentials working when required.

Use test tracks, regions, server-side feature admission and staged/phased rollout when supported and justified. Store rollout is not an instant rollback mechanism; server compatibility and kill/fail-safe behavior must account for that.

Observe technical and Product outcomes: crash/ANR/error/latency, auth/session/challenge failures, provider/queue/reconciliation failures, journey/order/payment/delivery outcomes, support/operator incidents and release/build attribution.

Use operational runbooks for incidents. After the compatibility window closes, remove stale flags, compatibility paths, deprecated contracts/schema and release-only mechanisms that no longer own unique value.
