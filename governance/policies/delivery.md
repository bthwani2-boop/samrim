# Software Delivery, Promotion, and Release Policy

ARTIFACT_CLASS: DURABLE_DELIVERY_POLICY
SEMANTIC_OWNER: governance/policies/delivery.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
Owner: Delivery / Release Governance

## 1. Scope and boundary

This policy owns **how an approved engineering change becomes an integrated, built, promoted and released software candidate**. It owns source identity, evidence freshness, remote qualification, review/integration, artifact provenance, environment promotion, deployment, native-store/OTA release, emergency release and release records.

It does **not** redefine Product semantics, architecture, database correctness, security/privacy, runtime reliability or frontend behavior. Those meanings remain with their specialized governance owners. Delivery asks whether the required evidence for those owners is current and attributable to the candidate being promoted.

No CI workflow, vendor, cloud, repository layout or current tool name is itself delivery policy authority.

## 2. Normative language

- **MUST / MUST NOT** — required for the affected promotion/release claim.
- **SHOULD / SHOULD NOT** — default; deviation needs an explicit evidence-based reason.
- **MAY** — optional when appropriate.

Missing, stale, cancelled, ambiguous or materially incomplete required evidence is not PASS.

## 3. Canonical lifecycle

```text
CHANGE INTENT
-> ENGINEERING IMPLEMENTATION + LOCAL EVIDENCE
-> REMOTE QUALIFICATION
-> REVIEW / INTEGRATION CANDIDATE
-> EXACT CANDIDATE VERIFIED
-> PROTECTED RELEASE SOURCE
-> CONTROLLED BUILD + IMMUTABLE ARTIFACT IDENTITY
-> STAGING / PRE-PRODUCTION QUALIFICATION when applicable
-> PRODUCTION / STORE READINESS
-> DEPLOYMENT / SUBMISSION / ROLLOUT
-> POST-DEPLOYMENT / POST-RELEASE EVIDENCE
-> RELEASE CLOSED
```

A phase is complete only when its exit claims are proven for the exact candidate. Documentation or a previous green run is not technical evidence for a changed candidate.

## 4. Core delivery invariants

### Immutable candidate identity

Every promotion candidate is identified by immutable source identity, normally a full commit SHA. Branch names are routing labels, not evidence identity.

### Evidence freshness

Evidence is attributable to the candidate/materials/configuration/artifact it proves. If a materially relevant source, base/merge result, generated output, dependency graph, migration set, build input, security-sensitive configuration or binary changes, affected evidence becomes stale and is rerun.

### One release lineage

Production/store releases retain one attributable lineage:

```text
source identity
-> reviewed/integrated source
-> build inputs
-> build execution
-> artifact/binary identity
-> provenance/SBOM/signature where required
-> pre-production evidence
-> approval authority
-> production/store rollout
-> post-release evidence
```

### No hidden prerequisites

Undocumented machine edits, ad-hoc database changes, local package installs, manual generated-file changes, hidden environment tweaks or untracked source cannot be release prerequisites.

### No promotion with a known material defect

A known material defect in the effective release scope blocks promotion until corrected or handled by an explicitly authorized exception/risk process that is actually permitted for that class of defect. A label such as emergency does not erase non-waivable security, financial, data-integrity or platform obligations.

### Evidence classes are not interchangeable

Static analysis does not prove runtime behavior; unit tests do not prove deployment; deployment success does not prove Product journey health; store approval does not prove correctness/security; documentation does not prove implementation.

## 5. Local exit

Before remote promotion, prove the smallest complete evidence set required by the materially affected governance claims. As applicable this includes locked/reproducible dependency/toolchain setup, generation, build/type/lint, domain tests, contracts, database/migration tests, integration, frontend/mobile checks, runtime/journey behavior, security/authorization, accessibility/localization and failure/recovery behavior.

A candidate that only works in an already-mutated developer machine is not locally qualified. Persistent changes follow `data-and-migrations.md`; security/privacy follows `security.md`; runtime/reliability follows `runtime-reliability.md`; frontend/client behavior follows `frontend-and-client.md`.

Known workarounds, duplicate/shadow authority, half migration, undeclared prerequisite or stale affected evidence block local exit.

## 6. Remote qualification

Remote qualification independently proves reproducibility and required repository-defined evidence outside the developer workspace.

Required remote work must:

- check out the intended immutable candidate;
- use controlled/locked inputs appropriate to the claim;
- avoid mutating tracked source as a verification side effect;
- use least-privilege credentials/permissions;
- isolate untrusted code from privileged release credentials;
- distinguish required FAIL/ERROR/CANCELLED/PENDING/missing evidence from PASS;
- expose enough attributable output to diagnose failures.

Affected verification is preferred for iteration when applicability is proven; full/deep verification runs when shared authority, risk, closure policy or the verification system itself requires it. A tool being configured is not evidence that it ran successfully.

## 7. Pull request, review, and integration

A pull request or equivalent review boundary must make the material change reviewable: intent/cause, affected Product/domain surfaces, contracts, data/migrations, security/privacy/financial effects, runtime/config/provider effects, compatibility/cutover/deletion and evidence.

Unresolved material requested changes or review findings block integration. A material candidate change invalidates approvals/evidence that no longer cover the new candidate.

Self-review is not represented as independent review. If independent human review is unavailable, that limitation remains explicit rather than being replaced by fake approval metadata.

The canonical release source comes from an authorized protected integration/release authority. Feature branches do not gain production authority merely because their own checks pass.

When base/head/merge semantics materially change the tested candidate, the integrated result receives the evidence required for that resulting source identity.

## 8. Controlled build and supply-chain provenance

Release artifacts are produced from controlled attributable source/build inputs, not an untracked developer workspace. Build-critical inputs include as applicable source SHA, lockfiles, toolchain/compiler, base-image digest, build recipe, generated-contract/code inputs, build-time configuration class and native signing inputs.

Every release artifact/binary has immutable identity such as digest/checksum/build identity. Mutable tags/versions may be aliases but do not replace immutable identity.

For artifact classes that can be promoted unchanged between environments, build once and promote the same digest. If production rebuilds it, previous staging evidence does not prove the new artifact.

Native binaries may legitimately differ across development/staging/production because of signing, application identity, entitlements or other platform inputs. In that case prove same approved source and locked dependency/build recipe, explicit environment-specific inputs and final production-binary qualification; never pretend two binaries are identical.

Production-critical artifacts should carry machine-verifiable provenance and SBOM/attestation/signature where materially applicable and supported. Signing/attestation identities remain protected and least-privileged.

## 9. Environment model

Environment is deployment/configuration state, not a fork of Product truth.

- **Local** may use disposable/synthetic state, localhost/LAN, development diagnostics and explicit sandbox/mocks while preserving business/auth/financial/data semantics required for meaningful verification.
- **Staging/pre-production** is a production rehearsal: isolated credentials/data, production-representative runtime/deployment/config/identity/network/provider semantics to the extent required by the claims being proven.
- **Production** uses hardened configuration, production identities/providers/data controls, required observability/recovery and approved immutable release artifacts.

No environment may silently introduce alternate business rules, authorization bypass, parallel financial truth, dev-only fallback or hidden runtime dependency.

## 10. Database and migration promotion

`data-and-migrations.md` owns migration/data correctness. Delivery owns promotion timing and candidate compatibility.

Before a stateful release, prove the applicable migration set/revision, representative upgrade or fresh-install claim, compatibility window for versions that can coexist, destructive-change prerequisites, required backfill/cutover completion and viable recovery/forward-fix path. Ad-hoc console SQL is not the normal production migration authority.

A backup indicator alone is not proof that the required restore/PITR/reconciliation path works for the affected failure class.

## 11. Staging / pre-production acceptance

A release candidate enters staging/pre-production acceptance only after required source, engineering, remote evidence, review/integration and controlled-build claims are current.

Staging proves the claims that cannot be established statically/local-only, as applicable:

- deployment mechanism and configuration loading;
- startup/liveness/readiness/dependency behavior;
- affected end-to-end Product journeys;
- authorization/isolation/session/provider behavior;
- migration compatibility and restart/recovery;
- failure modes, retry/idempotency/concurrency;
- observability and release identity;
- material performance/capacity risk;
- rollback/forward-recovery feasibility.

An experimental staging deployment is not `STAGING_ACCEPTED` until these applicable claims are satisfied.

## 12. Production readiness and deployment

Production deployment starts only when:

- the exact source/artifact/binary remains the qualified candidate;
- required engineering/security/quality/delivery evidence is current;
- production configuration/identities/secrets/provider endpoints are valid for the release;
- migration/recovery/monitoring/capacity prerequisites are ready where material;
- required release authority/approval exists;
- no conflicting production deployment owns the same target;
- current mutable external platform/store requirements are revalidated where applicable.

Production uses one canonical deployment authority with suitable concurrency control. Strategy may be rolling, canary, blue/green or justified controlled all-at-once according to risk/platform capability.

A successful deployment command is not release success. Post-deployment evidence verifies the materially affected technical, Product, security and observability claims and an observation period appropriate to risk.

## 13. Rollback and forward recovery

Rollback and forward recovery are distinct. Prefer redeployment of a previous known-good immutable server/web/container artifact when technically valid; do not rebuild an old ref and call it the same artifact.

Application rollback does not imply database rollback. Mobile clients cannot generally be forcibly rolled back on all devices, so backend/API compatibility and governed server-side mitigation remain important through supported public-client windows.

Recovery must not re-enable superseded/shadow writers or bypass Product/Security/Data ownership.

## 14. Web release requirements

For browser/web releases, qualify the actual production build/configuration for applicable caching/versioning, backend compatibility, session/cookie/CORS/security-header behavior, source-map/privacy handling, accessibility/RTL/browser behavior and removal of unintended development tooling. Public client configuration contains no server secret.

## 15. Native/mobile release requirements

Production mobile application identity is stable and governed. Version/build identifiers satisfy current platform rules. Signing/upload/store credentials follow least privilege and are not source-code secrets.

The final production-configured binary is pre-release tested through an appropriate platform distribution path before public rollout. A rebuilt binary is a new candidate.

Requested permissions/capabilities/entitlements and privacy/data declarations must match actual code/SDK/runtime behavior. Third-party SDKs that affect privacy, tracking, permissions, signing, background execution or store policy are included in release assessment.

Backend contracts remain compatible with supported public mobile versions through their real rollout/support window.

### Apple

Each submission revalidates current official Apple requirements. Qualify the correct bundle/application identity, version/build, signing/entitlements, privacy usage declarations, privacy manifests/Required Reason APIs where applicable, protected-resource behavior and final dependency/native set. Use TestFlight or another appropriate Apple pre-release path for the final candidate when applicable. Store metadata, privacy answers, review access, content/legal declarations and screenshots must represent actual current behavior. A changed binary after rejection is a new candidate.

### Google Play

Each submission revalidates current official Google Play requirements, including current target-API/account eligibility rules. Qualify the correct package/application identity, versionCode/versionName, AAB/native requirements, manifest/permissions/components, signing, Data safety/privacy declarations and applicable special-policy declarations. Use appropriate Play test tracks/device evidence for the final candidate when applicable. A changed AAB after rejection is a new candidate.

Staged/phased rollout is preferred for material-risk updates when supported and monitored with predefined stop/mitigation criteria.

## 16. OTA / over-the-air updates

OTA for React Native/Expo or equivalent is a production deployment mechanism, not a shortcut around governance. OTA must:

- target a compatible installed native runtime/build;
- use the same required source/review/security/quality/release authority as other production changes;
- not evade store review for native permission/capability/policy changes;
- provide deterministic rollback/republish strategy;
- isolate development/staging/production channels and application identities.

## 17. Emergency / break-glass release

An emergency path may reduce latency but does not erase immutable source/artifact identity, minimum applicable testing/security/data requirements, authorization, controlled rollout or post-deploy verification.

Record incident/severity reason, exact candidate, risks intentionally accepted by an authorized owner, minimum non-waivable evidence, release owner and follow-up restoration of any legitimately deferred evidence. Temporary bypasses are removed after the emergency.

## 18. Release records and auditability

Every production/store release has one authoritative durable release record in an approved system. It identifies as applicable source/integration identity, artifact/binary IDs, provenance/SBOM/attestation, migration/configuration revision, pre-production evidence, security/quality evidence, approvals, deployment/store identifiers, rollout strategy, previous known-good release, recovery reference and post-release result.

Do not duplicate logs/screenshots/reports in Git merely to create an archive when their authoritative system already retains them.

For an audit, every applicable delivery control resolves to exactly one of:

`PASS | FAIL | NEEDS_EVIDENCE | N/A_PROVEN`.

Silence, missing evidence or unknown status is never converted to PASS.

## 19. Release closure

A release is closed only when the exact released candidate/artifact/binary and materially affected Product/Engineering/Security/Data/Runtime/Delivery claims have current evidence, required rollout/post-release observation is complete, no known material release blocker remains and release identity/evidence are attributable.
