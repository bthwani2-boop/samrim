# First Representative Change

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: LIVE_REPOSITORY_SOURCE_AND_RUNTIME

Use this path for a developer's first material change.

## 1. Read ownership

Start with `AGENTS.md`, then load only the materially applicable semantic owners.

Use source-derived lookup when the task concerns one capability/journey/owner:

~~~text
pnpm knowledge:query -- capability <CAPABILITY_ID>
pnpm knowledge:query -- journey <J_ID>
pnpm knowledge:query -- owner <keyword-or-path>
~~~

Always include the applicable ownership/policy owner; do not load the whole capability/journey corpus merely by habit.

## 2. Pin current state

Work from the exact intended repository/branch head. Do not rely on stale local or historical assumptions.

## 3. Define the affected cone

Identify consuming app feature/shell work, owning service backend/data/contract/generated-client lineage, runtime/config, tests, docs/governance and external integrations affected by the change. Surface-specific feature UI stays in the app host; service ownership of business truth does not create a service frontend tree.

## 4. Implement vertically

Change the canonical source/owner first. Update contract/generated lineage, consumers and readback as required.

## 5. Verify

Use applicable static/domain/integration/runtime/journey/security/financial/accessibility evidence.

## 6. Negative-space cleanup

Remove obsolete aliases/wrappers/exports/tests/config/path references created unnecessary by the change.

## 7. Re-read the result

Verify the user/system action produces the required canonical effect and all required consumers observe the committed result.
