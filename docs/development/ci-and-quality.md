# CI and Quality

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

CURRENT_WORKFLOW_TRUTH_SOURCE: .github/workflows and repository scripts

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

## Documentation parity

Use:

~~~text
pnpm docs:verify:all
~~~

It combines command parity with executable configuration parity. Command parity rejects stale/nonexistent root commands; configuration parity checks pinned Node/pnpm/Go/PowerShell guidance, documented Identity configuration keys, and avoids hand-maintained local port claims.

## Knowledge-system verification

For the knowledge layer, use:

~~~text
pnpm knowledge:verify:all
~~~

It intentionally combines three independent checks:

1. canonical ownership/invariant/authority/anti-contradiction checks;
2. internal Markdown reference and orphan-document checks;
3. adversarial agent knowledge-contract checks for high-risk questions.

A pass from only one layer is not a full knowledge-system pass. CI keeps these steps separately visible for failure attribution even though local development exposes one combined command.

The checks are evidence producers only; they do not self-certify Product/runtime closure.
