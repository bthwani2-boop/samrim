# First Representative Change

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE

Use this path for a developer's first material change.

## 1. Read ownership

Start with:

- governance/project/PLATFORM.md
- governance/product/PRD.md
- governance/product/CAPABILITIES.md
- governance/product/JOURNEYS.md
- governance/architecture/OWNERSHIP-AND-SOURCE-OF-TRUTH.md
- applicable policies

## 2. Pin current state

Work from the exact intended repository/branch head. Do not rely on stale local or historical assumptions.

## 3. Define the affected cone

Identify apps, service frontend/backend, database, contract/generated client, runtime/config, tests, docs/governance and external integrations affected by the change.

## 4. Implement vertically

Change the canonical source/owner first. Update contract/generated lineage, consumers and readback as required.

## 5. Verify

Use applicable static/domain/integration/runtime/journey/security/financial/accessibility evidence.

## 6. Negative-space cleanup

Remove obsolete aliases/wrappers/exports/tests/config/path references created unnecessary by the change.

## 7. Re-read the result

Verify the user/system action produces the required canonical effect and all required consumers observe the committed result.
