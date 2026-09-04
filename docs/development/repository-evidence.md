# Repository Evidence Model

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE
EXECUTION_AUTHORITY: NONE

## Exact-head rule

Every material verification/closure claim is tied to the exact repository/branch head that was tested.

Record enough information to reconstruct:

- exact commit SHA;
- claim;
- evidence source;
- result;
- what the evidence proves;
- what it does not prove;
- freshness/invalidation trigger.

## Head movement

If the branch moves after evidence is collected, invalidate only the affected evidence and reconcile the changed cone before writing/claiming closure.

## Evidence classes

Static, runtime, visual/accessibility, security/privacy, financial/reconciliation, data-migration and release/deployment evidence are not interchangeable.

## Git history

Git history is forensic past/archive. The current tree should not retain dead implementations merely for possible reference.

## Remote checks

Remote CI/Sonar/security results are evidence for their checks. They do not override Product/architecture ownership and do not make an incomplete capability closed.
