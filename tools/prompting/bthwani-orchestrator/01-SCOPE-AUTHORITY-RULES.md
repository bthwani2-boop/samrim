# Scope, Authority, Exact-Head and Recovery Rules

OWNER_ROLE: BRANCH_SCOPE_RECOVERY_BLOCKERS_PARALLEL_AUTHORITY
AUTHORITY_ASSIGNED_BY: 00-ORCHESTRATOR.md
SELF_CERTIFICATION: FORBIDDEN
LOAD_TRIGGER: ENTRY_RESUME_OR_SCOPE_CHANGE

## 1. Mutation authority

Only the invocation repository/branch is mutable unless the human explicitly expands scope.

~~~text
TARGET BRANCH = MUTATION AUTHORITY
DONOR / OTHER BRANCHES = READ-ONLY FORENSIC INPUT BY DEFAULT
FORCE PUSH / BLIND MERGE / BLIND CHERRY-PICK = FORBIDDEN
~~~

A fast-forward write is valid only from the expected current HEAD.

## 2. Product-breadth authority

~~~text
PRODUCT_BREADTH=ACTIVE_SLICE | FULL_TARGET
LEVEL_4 != FUTURE PRODUCT AUTHORIZATION
~~~

`ACTIVE_SLICE` authorizes the named/current semantic outcome plus only its real causal prerequisites and complete affected cone.

The affected cone may include:

- canonical owner/writer/data/contract/runtime;
- required consumers/readbacks/surfaces;
- security/privacy/financial invariants actually exercised;
- migration/cutover dependencies;
- regressions caused by shared owners;
- structural prerequisites without which the authorized outcome cannot be canonical.

Unrelated future capabilities and unrelated repository cleanup remain outside mutation scope.

`FULL_TARGET` explicitly authorizes repository-wide governed convergence.

## 3. Exact-head discipline

Before every coherent mutation batch:

~~~text
RESOLVE LIVE TARGET HEAD
→ RECORD EXPECTED SHA
→ DIAGNOSE AGAINST THAT SHA
→ RECHECK SHA IMMEDIATELY BEFORE WRITE
~~~

Unexpected movement stops only the pending unsafe write:

~~~text
INSPECT FOREIGN DELTA
→ INVALIDATE AFFECTED EVIDENCE
→ RECONSTRUCT OPEN UNIT
→ RE-PIN
→ CONTINUE
~~~

## 4. Scope-directed accounting

Do not require a repository-wide census for every active slice.

Start with the authorized outcome and evidence-derived affected cone. Expand the census only when a finding proves a higher/shared/systemic dependency.

For explicit `FULL_TARGET` or a proven repository-wide structural root, repository-wide accounting is appropriate.

~~~text
ACTIVE_SLICE → MATERIAL CAUSAL CONE ACCOUNTING
SYSTEMIC ROOT → ROOT'S COMPLETE AFFECTED CONE
FULL_TARGET   → REPOSITORY-WIDE ACCOUNTING
~~~

A tracked artifact outside the current cone is neither “proven good” nor automatically a blocker.

## 5. Survival and legacy law

Inside the affected cone, a surviving artifact must have a current required responsibility, correct owner/location/boundary and no better canonical consolidation.

A proven loser may remain only while actively required for truth extraction, migration, compatibility with a real live consumer or safe cutover.

~~~text
LAST REQUIRED DEPENDENCY ENDS → DELETE LOSER
HISTORY/EXPLANATION ONLY       → USE GIT HISTORY
~~~

## 6. Structural prerequisite law

Structural work is pulled forward only when it is causally required.

Do not defer a proven prerequisite merely because it looks “infrastructure”, and do not force unrelated structural cleanup before a Product root.

A structural finding joins the current authorized cone when at least one is true:

- it blocks the canonical owner/path;
- it creates duplicate/shadow authority used by the slice;
- it affects the same mutable writer/data/contract/runtime;
- it contaminates migration/cutover/evidence for the slice;
- it is an ancestor/root whose continued existence makes the slice noncanonical.

Otherwise it remains outside the active slice unless `FULL_TARGET` is authorized.

## 7. Ephemeral execution state

Maintain enough transient state to recover and force the next action:

~~~text
EXACT_HEAD_SHA
PRODUCT_BREADTH
ACTIVE_PRODUCT_SLICE
AUTHORIZED_SCOPE
CURRENT_CAUSAL_ROOT
CURRENT_UNIT
UNIT_STATE
RECOVERY_FRONTIER
NEXT_REQUIRED_ACTION
CURRENT_BLOCKER_OR_NONE
VALID_EVIDENCE_STATE
~~~

This state is ephemeral and must not become a durable campaign ledger.

## 8. Recovery priority

Reconstruct from live HEAD, commit graph, material diffs, current reachability and nonstale evidence.

Open units are:

- `OPEN_CRITICAL` — partial authority/data/runtime/consumer cutover or other unsafe mixed state; normally resume first.
- `OPEN_SAFE_CHECKPOINT` — recoverable state with no unsafe mixed authority; may be preempted by a proven higher prerequisite/root.

## 9. Stop states

Mutation may stop only for:

~~~text
UNRESOLVED_IRREVERSIBLE_DATA_RISK
UNRESOLVED_EXTERNAL_LIVE_CONSUMER_CONTRACT
UNRECONCILED_TARGET_HEAD_MOVEMENT
MISSING_REQUIRED_HUMAN_PRODUCT_DECISION
MISSING_REQUIRED_SECRET_CREDENTIAL_OR_ENVIRONMENT
UNKNOWN_THAT_CAN_CHANGE_CANONICAL_TARGET_OR_SAFE_CUTOVER
EXTERNAL_PROVIDER_BLOCKER_PREVENTING_REQUIRED_PROOF_OR_CUTOVER
~~~

Large deletion, many callers, difficult migration, token/session length, commit boundaries and unfamiliar code are not stop states.

## 10. Continuation authorization

After a unit closes:

~~~text
NEXT ROOT INSIDE AUTHORIZED SCOPE → MAY CONTINUE
REQUIRED PREREQUISITE/REGRESSION  → MAY CONTINUE
ADJACENT FUTURE PRODUCT SLICE     → NOT AUTHORIZED
~~~

No human confirmation is required for derivable work already authorized.

## 11. Parallel mutation authority

Parallel mutation is allowed only for proven non-overlapping mutation cones.

~~~text
NON_OVERLAPPING CONES → PARALLEL ALLOWED
SHARED MUTABLE OWNER/DB/CONTRACT/RUNTIME/EXPORT → SERIALIZE
ONE INTEGRATION AUTHORITY PER TARGET BRANCH
EACH MUTATING UNIT → EXACT BASE SHA
FOREIGN DELTA → RECONCILE BEFORE WRITE/INTEGRATION
~~~

Read-only evidence acquisition may run at maximum safe parallelism.

## 12. Donor/research authority

When a donor exists:

~~~text
TARGET = MUTATION AUTHORITY
DONOR  = READ-ONLY FORENSIC EVIDENCE
~~~

Inspect only donor current/history capable of changing required truth for the authorized scope unless `FULL_TARGET` is explicit.

External research may resolve technical/standard/provider facts. It may not invent BThwani Product truth or authorize a new dependency/provider without applicable Governance.
