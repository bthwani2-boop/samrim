# Contributing

## Branch policy

`main` is the protected canonical promotion branch. Direct development on `main` is forbidden after the foundation commit.

Active refoundation and implementation occurs on `a`. Temporary branches may be created from `a` for isolated parallel work and must converge back into `a` before canonical promotion.

## Pull requests to main

A pull request targeting `main` must:

- represent a coherent canonical promotion;
- pass all required repository checks;
- contain no secret values or machine-local bindings;
- account for migration/cutover and loser deletion when replacing an authority;
- include verification evidence and state what remains unproven;
- resolve review conversations before merge.

Green CI is evidence, not by itself proof of canonical closure.
