# Contributing

## Branch policy

`main` is the protected canonical promotion branch. Direct development on `main` is forbidden unless the applicable delivery policy and current human authorization explicitly permit it.

Active refoundation and implementation occurs on the exact working branch supplied by the current invocation and live Git state. Temporary branches may be created only under the applicable Orchestrator branch/mutation rules, with explicit integration ownership and exact-candidate reconciliation before canonical promotion.

Durable contributor guidance must not encode a temporary campaign branch as permanent repository truth.

## Pull requests to main

When a pull request is the approved promotion mechanism, a pull request targeting `main` must:

- represent a coherent canonical promotion;
- pass all required repository checks;
- contain no secret values or machine-local bindings;
- account for migration/cutover and loser deletion when replacing an authority;
- include verification evidence and state what remains unproven;
- resolve review conversations before merge.

Green CI is evidence, not by itself proof of canonical closure.
