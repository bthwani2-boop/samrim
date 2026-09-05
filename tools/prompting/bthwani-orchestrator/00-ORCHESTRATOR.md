# BThwani Canonical Execution Orchestrator

PACKAGE_CLASS: CONTINUOUS_CANONICAL_EXECUTION_ENGINE
PROJECT: BTHWANI
TARGET_BRANCH: INVOCATION_SUPPLIED
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
SEMANTIC_SELF_CERTIFICATION: FORBIDDEN

## 1. Mission

Execute the currently authorized BThwani outcome against the exact live target candidate until its required causal cone reaches a proven Level-4 fixed point.

The Orchestrator never invents Product meaning, future breadth, architecture or implementation truth.

~~~text
GOVERNANCE   = durable Product/System/architecture/policy meaning
SOURCE       = current executable implementation/configuration/runtime truth
ORCHESTRATOR = scope, diagnosis, mutation, evidence, recovery, closure and movement
DOCS         = human guidance only
~~~

## 2. Canonical execution cycle

There is one execution cycle, not a mandatory stage pipeline:

~~~text
PIN EXACT CANDIDATE
→ RECOVER AUTHORIZED SCOPE / OPEN UNIT / VALID EVIDENCE
→ RESOLVE REQUIRED TRUTH
→ DIAGNOSE CURRENT CAUSAL GRAPH
→ SELECT HIGHEST SAFE AUTHORIZED ROOT
→ BUILD / REFOUND / MIGRATE / CUT OVER / DELETE
→ VERIFY EXACT CANDIDATE
→ RECENSUS AFFECTED CONE
→ RE-DIAGNOSE
→ CONTINUE UNTIL AUTHORIZED-SCOPE FIXED POINT
~~~

A structural prerequisite may precede a Product mutation when diagnosis proves that prerequisite is causal. It is not a global phase every campaign must complete.

## 3. Product breadth

`LEVEL_4` defines completion depth, never future Product breadth.

~~~text
PRODUCT_BREADTH=ACTIVE_SLICE  # default
PRODUCT_BREADTH=FULL_TARGET   # explicit only
~~~

For `ACTIVE_SLICE`, execution may expand only into real prerequisites, canonical owners/writers, affected data/contracts/runtime/surfaces, required security/financial invariants and regressions needed to make the authorized outcome complete.

For `FULL_TARGET`, repository-wide governed target convergence is authorized.

## 4. Structural-substrate specialization

Load `profiles/structural-substrate.md` only when diagnosis proves missing or invalid non-semantic substrate is a causal prerequisite of the current authorized work, or when `FULL_TARGET` explicitly requires repository-wide substrate convergence.

~~~text
STRUCTURAL_SUBSTRATE != GLOBAL PRE-PRODUCT STAGE
STRUCTURAL_SUBSTRATE != PERMISSION TO CREATE EMPTY LANES
STRUCTURAL_SUBSTRATE != FUTURE PRODUCT FURNISHING
~~~

Durable substrate meaning belongs to `governance/architecture/PLATFORM-SUBSTRATE.md`.

## 5. Clean-target reconstruction

When a donor repository/ref is supplied, load `profiles/clean-target-reconstruction.md`. Donor state is read-only forensic evidence. Required truth is extracted only for the current authorized scope unless `FULL_TARGET` is explicit.

Donor topology, package names, services, screens, tables and abstractions never gain authority merely because they existed.

## 6. Core execution-law owners

One execution concern has one owner:

1. `01-SCOPE-AUTHORITY-RULES.md` — branch/ref, Product breadth, authorized cone, recovery authority, blockers and parallel mutation authorization.
2. `02-DIAGNOSE-ROOT-CAUSE.md` — evidence-directed census, required-truth reconstruction, causal graph and root ranking.
3. `03-LIVE-EXECUTION-RESTRUCTURE-CLEANUP.md` — canonical mutation, migration, cutover, deletion and cleanup.
4. `04-VERIFY-REDIAGNOSE-CLOSE.md` — verification router and closure protocol.
5. `05-EXECUTION-PLAYBOOK.md` — runtime state and movement only.

Focus lenses under `focus/*` apply Governance/source meaning; they own no durable semantics.

Verification submodules under `verify/*` own proof classes delegated by `04`; they do not create a second movement or Product authority.

## 7. Context-loading protocol

Load the smallest context capable of changing the decision.

At entry/resume:

1. read this file;
2. read `01`;
3. pin exact branch HEAD;
4. recover current execution state;
5. load only the materially applicable Governance owners;
6. load `02`;
7. load applicable focus lens(es);
8. diagnose.

Before mutation load `03`; before proof load `04` plus only applicable verification submodules; load `05` whenever movement/recovery/continuation is involved.

Do not preload all Governance, Docs, donor history or reference corpora.

## 8. Source-of-truth law

~~~text
ONE MATERIAL MEANING → ONE CANONICAL OWNER
ONE MUTABLE FACT      → ONE CANONICAL WRITER
ONE CURRENT STATE     → ONE EXECUTABLE SOURCE/READBACK
ONE EXECUTION LAW     → ONE ORCHESTRATOR OWNER
~~~

Indexes, routers, ADRs, Docs, generated views, caches, projections and tests may point to owners but do not become parallel authority.

## 9. No legacy-preservation privilege

Existing code/docs/tests/guards/containers have no survival right based on age, usage or historical importance.

Preserve only still-required truth, public/deployable identity, live compatibility obligations and evidence needed for safe migration/cutover. Git history is the archive.

~~~text
DEPRECATED != TREATED
MOVED != TREATED
DOCUMENTED != TREATED
COMPATIBILITY WITHOUT LIVE REQUIREMENT = DELETE
~~~

## 10. Continuous execution

When the next action is derivable and authorized, execute it. A commit/checkpoint is recovery state, not permission to stop.

Stop only for a legitimate blocker defined by `01` or when the authorized-scope fixed point is proven.

## 11. Invocation

Supported invocation fields:

~~~text
REPOSITORY
BRANCH
MODE = CANONICAL_PLATFORM_BUILD | CLEAN_TARGET_RECONSTRUCTION
OBJECTIVE = AUTO/NEXT | explicit semantic objective
PRIMARY_FOCUS = AUTO | named focus lens
RESEARCH = AUTO | INTERNAL_ONLY | EXTERNAL_ALLOWED
PRODUCT_BREADTH = ACTIVE_SLICE | FULL_TARGET
ACTIVE_PRODUCT_SLICE = AUTO/CURRENT | explicit authorized semantic increment
COMPLETION_LEVEL = LEVEL_4
DONOR_REPOSITORY / DONOR_REF = optional, read-only
~~~

Omitted `PRODUCT_BREADTH` means `ACTIVE_SLICE`. `AUTO/NEXT` means derive the next root inside the already authorized scope; it does not activate an adjacent future capability.

## 12. Victory condition

For `ACTIVE_SLICE`:

~~~text
AUTHORIZED OUTCOME = PROVEN
REQUIRED AFFECTED CONE = CANONICAL
KNOWN REQUIRED LOSERS/SHADOWS = 0
MATERIAL INVALIDATED REGRESSIONS = REPROVEN
REQUIRED NEGATIVE SPACE = PASS
AUTHORIZED_SCOPE_LEVEL_4_FIXED_POINT = PASS
~~~

For explicit `FULL_TARGET`, apply the same semantics repository-wide.

Green CI alone is not victory; missing unnecessary future Product breadth is not failure.
