# Change Qualification and Integration Policy

ARTIFACT_CLASS: DURABLE_ENGINEERING_POLICY
SEMANTIC_OWNER: governance/policies/delivery/change-qualification.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
PARENT_POLICY_ROUTER: governance/policies/delivery.md

## Local exit

Before remote promotion, prove the smallest complete evidence set required by the materially affected governance claims. As applicable this includes locked/reproducible dependency/toolchain setup, generation, build/type/lint, domain tests, contracts, database/migration tests, integration, frontend/mobile checks, runtime/journey behavior, security/authorization, accessibility/localization and failure/recovery behavior.

A candidate that only works in an already-mutated developer machine is not locally qualified. Persistent changes follow `../data-and-migrations.md`; security/privacy follows `../security.md`; runtime/reliability follows `../runtime-reliability.md`; frontend/client behavior follows `../frontend-and-client.md`.

Known workarounds, duplicate/shadow authority, half migration, undeclared prerequisite or stale affected evidence block local exit.

## Remote qualification

Remote qualification independently proves reproducibility and required repository-defined evidence outside the developer workspace.

Required remote work must:

- check out the intended immutable candidate;
- use controlled/locked inputs appropriate to the claim;
- avoid mutating tracked source as a verification side effect;
- use least-privilege credentials/permissions;
- isolate untrusted code from privileged release credentials;
- distinguish required FAIL/ERROR/CANCELLED/PENDING/missing evidence from PASS;
- expose enough attributable output to diagnose failures.

Affected verification is preferred for iteration when applicability is proven; full/deep verification runs when shared authority, risk, conformance/evidence policy or the verification system itself requires it. A tool being configured is not evidence that it ran successfully.

## Pull request, review, and integration

A pull request or equivalent review boundary must make the material change reviewable: intent/cause, affected Product/domain surfaces, contracts, data/migrations, security/privacy/financial effects, runtime/config/provider effects, compatibility/cutover/deletion and evidence.

Unresolved material requested changes or review findings block integration. A material candidate change invalidates approvals/evidence that no longer cover the new candidate.

Self-review is not represented as independent review. If independent human review is unavailable, that limitation remains explicit rather than being replaced by fake approval metadata.

The canonical release source comes from an authorized protected integration/release authority. Feature branches do not gain production authority merely because their own checks pass.

When base/head/merge semantics materially change the tested candidate, the integrated result receives the evidence required for that resulting source identity.

## Deployable identity preservation during repository refoundation

A repository/path/package refactor must not silently create a new externally recognized deployable identity or detach an existing app/service from required platform lineage.

For every materially affected deployable, classify and preserve or intentionally migrate as applicable:

~~~text
MOBILE PACKAGE/BUNDLE IDENTIFIER
EXPO/EAS PROJECT/UPDATE/CREDENTIAL IDENTITY
URI SCHEME / DEEP-LINK IDENTITY
SIGNING / ENTITLEMENT BINDINGS
WEB HOSTING PROJECT / BUILD ROOT / BASE PATH
PUBLIC OR CALLBACK ENDPOINT IDENTITY
OBSERVABILITY PROJECT / RELEASE IDENTITY
EXTERNAL PROVIDER PROJECT / WEBHOOK BINDING
~~~

A folder move, package rename, workspace flattening or build-root change is not allowed to alter those identities accidentally. If an identity intentionally changes, migration/cutover, compatibility and release evidence must cover the resulting external effect.

~~~text
REPOSITORY_PATH_CHANGE != DEPLOYABLE_IDENTITY_CHANGE
DEPLOYABLE_IDENTITY_CHANGE → EXPLICIT_MIGRATION
~~~

Whether a native rebuild, OTA/update, hosting redeploy or credential rebinding is required is derived from the actual affected platform configuration/fingerprint, not inferred merely from source-folder movement.
