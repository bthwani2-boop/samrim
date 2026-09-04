# Testing and Verification

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE

## Principle

A passing test proves only the claim it exercises.

Classify affected tests/fixtures/mocks/snapshots/guards:

- VALID_CANONICAL_SPEC;
- OBSOLETE_BEHAVIOR;
- DUPLICATE_COVERAGE;
- WRONG_LAYER_SPEC;
- LOSING_TOPOLOGY_TEST;
- MISSING_PREVENTION;
- BROKEN_TEST_INFRA.

Delete/refound obsolete assurance in the same unit as the fix.

## Evidence ladder

Use the smallest evidence that proves the claim, but do not substitute a weaker class:

- compile/typecheck/static analysis;
- schema/contract validation;
- unit/domain tests;
- database migration/invariant checks;
- integration tests;
- runtime smoke;
- end-to-end/journey;
- visual/accessibility;
- security/privacy;
- financial/reconciliation;
- release/deployment evidence.

## Vertical verification

Material capability closure follows the action through owner, storage, transport, contract, generated binding, presentation, app composition, mutation and persisted/observable readback.

## Negative space

Search for old writers/readers, stale exports/config, wrappers/aliases, obsolete tests/mocks, duplicate contracts and wrong-owner paths after cutover.

Use the current root verification entrypoints exposed by `package.json`, including `pnpm workspace:verify`, `pnpm foundation:verify-static`, and `pnpm foundation:runtime:close` as applicable. Do not infer retired aggregate commands from historical documentation.
