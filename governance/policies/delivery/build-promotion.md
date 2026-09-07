# Build, Promotion and Deployment Policy

ARTIFACT_CLASS: DURABLE_ENGINEERING_POLICY
SEMANTIC_OWNER: governance/policies/delivery/build-promotion.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_POLICY_ROUTER: governance/policies/delivery.md

## Controlled build and supply-chain provenance

Release artifacts are produced from controlled attributable source/build inputs, not an untracked developer workspace. Build-critical inputs include as applicable source SHA, lockfiles, toolchain/compiler, base-image digest, build recipe, generated-contract/code inputs, build-time configuration class and native signing inputs.

Every release artifact/binary has immutable identity such as digest/checksum/build identity. Mutable tags/versions may be aliases but do not replace immutable identity.

For artifact classes that can be promoted unchanged between environments, build once and promote the same digest. If production rebuilds it, previous staging evidence does not prove the new artifact.

Native binaries may legitimately differ across development/staging/production because of signing, application identity, entitlements or other platform inputs. In that case prove same approved source and locked dependency/build recipe, explicit environment-specific inputs and final production-binary qualification; never pretend two binaries are identical.

Production-critical artifacts should carry machine-verifiable provenance and SBOM/attestation/signature where materially applicable and supported. Signing/attestation identities remain protected and least-privileged.

## Environment model

Environment is deployment/configuration state, not a fork of Product truth.

- **Local** may use disposable/synthetic state, localhost/LAN, development diagnostics and explicit sandbox/mocks while preserving business/auth/financial/data semantics required for meaningful verification.
- **Staging/pre-production** is a production rehearsal: isolated credentials/data, production-representative runtime/deployment/config/identity/network/provider semantics to the extent required by the claims being proven.
- **Production** uses hardened configuration, production identities/providers/data controls, required observability/recovery and approved immutable release artifacts.

No environment may silently introduce alternate business rules, authorization bypass, parallel financial truth, dev-only fallback or hidden runtime dependency.

## Database and migration promotion

`../data-and-migrations.md` owns migration/data correctness. Delivery owns promotion timing and candidate compatibility.

Before a stateful release, prove the applicable migration set/revision, representative upgrade or fresh-install claim, compatibility window for versions that can coexist, destructive-change prerequisites, required backfill/cutover completion and viable recovery/forward-fix path. Ad-hoc console SQL is not the normal production migration authority.

A backup indicator alone is not proof that the required restore/PITR/reconciliation path works for the affected failure class.

## Staging / pre-production acceptance

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

## Production readiness and deployment

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

## Rollback and forward recovery

Rollback and forward recovery are distinct. Prefer redeployment of a previous known-good immutable server/web/container artifact when technically valid; do not rebuild an old ref and call it the same artifact.

Application rollback does not imply database rollback. Mobile clients cannot generally be forcibly rolled back on all devices, so backend/API compatibility and governed server-side mitigation remain important through supported public-client windows.

Recovery must not re-enable superseded/shadow writers or bypass Product/Security/Data ownership.

## Web release requirements

For browser/web releases, qualify the actual production build/configuration for applicable caching/versioning, backend compatibility, session/cookie/CORS/security-header behavior, source-map/privacy handling, accessibility/RTL/browser behavior and removal of unintended development tooling. Public client configuration contains no server secret.
