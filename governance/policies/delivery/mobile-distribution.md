# Native and Mobile Distribution Policy

ARTIFACT_CLASS: DURABLE_ENGINEERING_POLICY
SEMANTIC_OWNER: governance/policies/delivery/mobile-distribution.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_POLICY_ROUTER: governance/policies/delivery.md

## Native/mobile release requirements

Production mobile application identity is stable and governed. Version/build identifiers satisfy current platform rules. Signing/upload/store credentials follow least privilege and are not source-code secrets.

The final production-configured binary is pre-release tested through an appropriate platform distribution path before public rollout. A rebuilt binary is a new candidate.

Requested permissions/capabilities/entitlements and privacy/data declarations must match actual code/SDK/runtime behavior. Third-party SDKs that affect privacy, tracking, permissions, signing, background execution or store policy are included in release assessment.

Backend contracts remain compatible with supported public mobile versions through their real rollout/support window.

### Apple

Each submission revalidates current official Apple requirements. Qualify the correct bundle/application identity, version/build, signing/entitlements, privacy usage declarations, privacy manifests/Required Reason APIs where applicable, protected-resource behavior and final dependency/native set. Use TestFlight or another appropriate Apple pre-release path for the final candidate when applicable. Store metadata, privacy answers, review access, content/legal declarations and screenshots must represent actual current behavior. A changed binary after rejection is a new candidate.

### Google Play

Each submission revalidates current official Google Play requirements, including current target-API/account eligibility rules. Qualify the correct package/application identity, versionCode/versionName, AAB/native requirements, manifest/permissions/components, signing, Data safety/privacy declarations and applicable special-policy declarations. Use appropriate Play test tracks/device evidence for the final candidate when applicable. A changed AAB after rejection is a new candidate.

Staged/phased rollout is preferred for material-risk updates when supported and monitored with predefined stop/mitigation criteria.

## OTA / over-the-air updates

OTA for React Native/Expo or equivalent is a production deployment mechanism, not a shortcut around governance. OTA must:

- target a compatible installed native runtime/build;
- use the same required source/review/security/quality/release authority as other production changes;
- not evade store review for native permission/capability/policy changes;
- provide deterministic rollback/republish strategy;
- isolate development/staging/production channels and application identities.
