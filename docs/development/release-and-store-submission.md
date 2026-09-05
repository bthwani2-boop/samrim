# Release and Mobile Store Submission

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_AND_OPERATIONS_GUIDANCE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_TRUTH_SOURCE: LIVE_BUILD_RELEASE_CONFIG_AND_ARTIFACTS
MUTABLE_EXTERNAL_POLICY_TRUTH_SOURCE: CURRENT_OFFICIAL_APPLE_AND_GOOGLE_DOCUMENTATION

## Purpose

Use this guide for human release-candidate preparation, mobile-store submission, compatibility choreography, controlled launch and post-release observation.

Durable delivery requirements belong to `governance/policies/delivery.md`; security/privacy to `governance/policies/security.md`; runtime/recovery to `governance/policies/runtime-reliability.md`; current package/bundle/build/signing/configuration truth belongs to executable source and platform accounts.

## Candidate attribution

For a release candidate, preserve the materially applicable identity:

```text
SOURCE SHA
LOCKFILE / DEPENDENCY RESOLUTION
TOOLCHAIN
GENERATED INPUTS
BUILD RECIPE
BUILD-TIME CONFIG CLASS
NATIVE PACKAGE/BUNDLE IDENTITY
SIGNING/UPLOAD RELATIONSHIP
BUILD/ARTIFACT IDENTITY
STORE-DISTRIBUTED VERSION
```

Store signing/repackaging may make the distributed binary differ from a local intermediate artifact. Prove attributable source/build identity instead of claiming false byte equality.

## Compatibility choreography

Do not use a blanket “backend always first” rule. For a server capability required by a public mobile client, the normal safe pattern is:

```text
EXPAND DB/CONTRACT COMPATIBLY
→ DEPLOY BACKWARD-COMPATIBLE SERVER SUPPORT
→ VERIFY CURRENT SERVER BEHAVIOR
→ RELEASE/ACTIVATE CLIENT
→ OBSERVE SUPPORTED VERSION WINDOW
→ REMOVE OLD CONTRACT/SCHEMA ONLY WHEN SUPPORTED CLIENTS ARE SAFE
```

A dormant client-first release can also be valid when it cannot activate against an incompatible server.

```text
PUBLIC CLIENT MUST NOT REQUIRE UNAVAILABLE SERVER BEHAVIOR
SERVER MUST NOT BREAK STILL-SUPPORTED PUBLIC CLIENTS
```

## Preproduction and beta

Use staging/preproduction only as a rehearsal of the claims being tested, not as a second Product/runtime truth. Keep credentials isolated and data synthetic/safe.

For native mobile, exercise official distribution paths when material: Google Play testing tracks and TestFlight or their current successors. Test upgrade/fresh-install, authentication, notifications, deep links, location/native permissions and materially affected journeys on representative real devices.

## Store package

Before submission verify current executable/store truth for:

- package/application ID and Apple bundle ID;
- signing/upload identities;
- app name/icon/screenshots/previews;
- description and release notes;
- privacy policy/support URLs;
- age/content rating;
- country/region availability;
- data/privacy declarations;
- account deletion flows where applicable;
- review instructions and review/demo access;
- native permissions/usage descriptions;
- export/encryption declarations where applicable.

Metadata/screenshots must describe actual current behavior.

## Mutable store-policy snapshot

Snapshot reviewed: **2026-09-05**. Revalidate official policy at every submission.

### Google Play

For ordinary Android mobile apps, Google currently requires new apps and app updates submitted from **2026-08-31** to target **Android 16 / API level 36 or higher**. Existing apps generally need **Android 15 / API level 35 or higher** to remain available to new users on devices running newer Android versions; Google documents an extension path to **2026-11-01** for affected apps.

For personal developer accounts created after **2023-11-13**, Google currently requires a closed test with at least **12 continuously opted-in testers for at least 14 days** before applying for Production access.

Official sources:
- https://support.google.com/googleplay/android-developer/answer/11926878
- https://support.google.com/googleplay/android-developer/answer/14151465

### Apple App Store

Apple currently states that since **2026-04-28**, App Store Connect uploads must be built with **Xcode 26 or later** using the applicable **26-generation platform SDK**.

Official source:
- https://developer.apple.com/news/upcoming-requirements/

Do not copy other mutable store requirements into durable Governance. Check current official Apple/Google documentation at submission time for privacy, deletion, permissions, signing, review, testing, phased/staged release and SDK requirements.

## Submission and controlled launch

Submit the exact qualified build/source lineage. Keep required reviewer-access backend services and review credentials working where review requires them.

Use testing tracks, country/region controls, server-side feature admission and staged/phased update rollout when the current platform supports them and risk justifies them. Mobile-store rollout is not a reliable instant rollback mechanism; server compatibility and kill/fail-safe behavior must carry that constraint.

## Launch observation

Observe both technical and Product outcomes that the released slice can materially affect:

```text
CRASH / ANR / ERROR / LATENCY
AUTHENTICATION / SESSION / OTP FAILURE
PROVIDER / QUEUE / RECONCILIATION FAILURE
JOURNEY COMPLETION / ORDER / PAYMENT / DELIVERY OUTCOME
SUPPORT / OPERATOR INCIDENTS
RELEASE VERSION / BUILD ATTRIBUTION
```

Use the applicable operational runbook for incidents. Do not invent financial reconciliation or direct database repair during launch response.

## Cleanup after proven cutover

After the supported compatibility/rollout window closes, remove stale feature flags, compatibility paths, deprecated contract/schema surfaces and release-only mechanisms that no longer own unique value.
