# CI and Quality

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE
CURRENT_WORKFLOW_AUTHORITY: .github/workflows and repository scripts

## Principle

CI produces evidence; it does not define Product/System truth or closure by itself.

## Developer workflow

Before relying on a remote check, run the smallest applicable local verification. Use full verification when the affected cone crosses services/contracts/database/runtime or when repository policy requires it.

## Guard admission

A custom guard/script/workflow must enforce a unique durable invariant not already enforced better by compiler/schema/test/runtime tooling.

Obsolete topology guards, debt baselines, pass-through wrappers and campaign-only checks must be removed when their role ends.

## Security/supply chain

Dependency changes require exact package/version/license/security/maintenance review appropriate to risk. Generated artifacts and lockfile changes must be reproducible and reviewed together with the source change.

## Failure handling

A red workflow is a finding to diagnose; do not suppress/allowlist a failing canonical invariant merely to recover green status.
