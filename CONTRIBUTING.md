# Contributing

## Branch policy

`main` is the canonical promotion branch. Direct development on `main` is forbidden unless applicable delivery policy and current human authorization explicitly permit it.

Material implementation/refoundation work occurs on the exact working branch supplied by current human authorization and live Git state. Temporary branches require explicit integration ownership, exact-head discipline, and reconciliation of foreign movement before integration.

Durable contributor guidance must not encode a temporary working branch as permanent repository truth.

## Pull requests to main

When a pull request is the approved promotion mechanism, it must:

- represent a coherent canonical promotion;
- pass required repository checks;
- contain no secret values or machine-local bindings;
- account for migration/cutover and loser deletion when replacing an authority;
- include exact-candidate verification evidence and state what remains unproven;
- resolve review conversations before merge.

Green CI is evidence, not by itself proof that the authorized objective is complete.
