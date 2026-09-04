# Focus — Code, Architecture and Repository Organization

OWNER_ROLE: CODE_ARCHITECTURE_REPOSITORY_ORGANIZATION
AUTHORITY_ASSIGNED_BY: 00-ORCHESTRATOR.md
SELF_CERTIFICATION: FORBIDDEN


## 1. Structural target

Repository structure must express real semantic ownership, not accumulated history.

```text
ONE MATERIAL RESPONSIBILITY → ONE CANONICAL OWNER
ONE OWNER → ONE JUSTIFIED MINIMUM NECESSARY CONTAINER SET
NO DUPLICATE RESPONSIBILITY TREES
NO SHADOW SERVICES/PACKAGES
NO PASS-THROUGH LAYERS WITHOUT UNIQUE VALUE
NO "shared" OR "core" AS OWNERSHIP REFUGE
NO FILE/DIRECTORY/PACKAGE KEPT ONLY BECAUSE IT EXISTS
```

## 2. Semantic responsibility outranks names/paths

```text
DIFFERENT_NAME != DIFFERENT_RESPONSIBILITY
DIFFERENT_PATH != DIFFERENT_RESPONSIBILITY
DIFFERENT_LANGUAGE != DIFFERENT_RESPONSIBILITY
USED != CANONICAL
```

Detect structural duplication through decisions, data flow, writers/readers, state semantics, contracts, runtime behavior and consumer outcome—not filename similarity.

If different containers implement the same material meaning, cluster them together, select the canonical owner, migrate required value and delete losers.

## 3. Canonical container map

For every material responsibility determine:

```text
SEMANTIC RESPONSIBILITY
→ CANONICAL DOMAIN/SERVICE OWNER
→ CANONICAL PACKAGE/BOUNDARY
→ CANONICAL DIRECTORY
→ MINIMUM NECESSARY CANONICAL FILE SET
→ CANONICAL SYMBOLS
```

Target `MINIMUM NECESSARY FILES`, not `MINIMUM POSSIBLE FILES`. Do not manufacture god files, but do not preserve artificial fragmentation.

## 4. Naming and path truth law

Names and paths are architecture. A file that contains correct code under a misleading name/path is still noncanonical.

Every surviving material container must prove:

```text
NAME_MATCHES_ACTUAL_RESPONSIBILITY
PATH_MATCHES_CANONICAL_OWNER
DIRECTORY_NAME_MATCHES_BOUNDARY
PACKAGE_NAME_MATCHES_OWNERSHIP
PUBLIC_EXPORT_NAME_MATCHES_SEMANTICS
TEST/FIXTURE/MOCK NAME MATCHES CANONICAL OWNER
GENERATED NAME/LOCATION MATCHES GENERATOR LINEAGE
MIGRATION NAME/SEQUENCE MATCHES CANONICAL MIGRATION CONTRACT
```

Reject or refound misleading/generic historical names such as these when they do not represent a genuinely canonical cross-cutting role:

```text
utils
helpers
common
misc
shared
core
legacy
old
new
final
final2
v2/v3 without real version semantics
tmp/temp
copy
backup
compat
adapter/wrapper when no unique boundary responsibility exists
```

Do not preserve an old import path with an internal alias/re-export just to avoid updating consumers.

```text
REHOME/RENAME
→ UPDATE ALL IMPORTS/EXPORTS/ROUTES/MANIFESTS/TESTS
→ DELETE OLD PATH
→ PROVE OLD PATH REACHABILITY=0
```

At closure:

```text
MISLEADING_MATERIAL_FILENAMES=0
MISLEADING_MATERIAL_DIRECTORIES=0
MISPLACED_MATERIAL_FILES=0
UNJUSTIFIED_GENERIC_CONTAINER_NAMES=0
OLD_INTERNAL_PATH_ALIASES=0
```

## 5. File responsibility and size/complexity law

Line count is a structural smell signal, not a substitute for semantic analysis.

For hand-maintained source files, apply these default escalation gates unless the artifact type has a stronger domain-specific rule:

```text
>400 LOGICAL LOC  → MANDATORY COHESION / SPLIT REVIEW
>700 LOGICAL LOC  → PRESUMED NONCANONICAL; SPLIT/REFOUND UNLESS STRONGLY JUSTIFIED
>1000 LOGICAL LOC → CLOSURE BLOCKER BY DEFAULT FOR HAND-MAINTAINED SOURCE
```

Exceptions require positive proof, for example:

```text
DETERMINISTIC GENERATED OUTPUT
DECLARATIVE SCHEMA/SPEC WHERE SPLITTING WOULD REDUCE CANONICAL CLARITY
DATA/MIGRATION ARTIFACT WITH DOMAIN-JUSTIFIED ATOMICITY
OTHER EXPLICITLY PROVEN SINGLE-RESPONSIBILITY CASE
```

Never split merely to satisfy a number. Never keep a God File merely because splitting is inconvenient.

Evaluate together:

```text
RESPONSIBILITY_COUNT
COHESION
COUPLING
IMPORT FAN-IN/FAN-OUT
PUBLIC EXPORT COUNT
CYCLOMATIC/COGNITIVE COMPLEXITY WHERE AVAILABLE
NESTING
MUTABLE STATE OWNERSHIP
CROSS-DOMAIN DEPENDENCIES
TESTABILITY
CHANGE CO-VARIANCE
```

A small file can still be noncanonical if it is a useless wrapper, alias or fragment. A larger file can survive only when one cohesive responsibility genuinely requires it.

At closure:

```text
UNJUSTIFIED_OVERSIZED_HAND_MAINTAINED_FILES=0
UNJUSTIFIED_GOD_FILES=0
UNJUSTIFIED_MULTI_RESPONSIBILITY_FILES=0
UNJUSTIFIED_DEEP_NESTING=0
UNJUSTIFIED_CIRCULAR_DEPENDENCIES=0
UNJUSTIFIED_CROSS_DOMAIN_COUPLING=0
```

## 6. Topology audit

Audit every material:

```text
TOP-LEVEL SURFACE
SERVICE
DOMAIN
PACKAGE
WORKSPACE
MODULE
DIRECTORY
FILE
PUBLIC EXPORT
ENTRYPOINT
ROUTE/ADAPTER BOUNDARY
```

Ask:

```text
WHAT UNIQUE RESPONSIBILITY DOES THIS CONTAINER OWN?
IS IT REQUIRED?
IS THIS THE CORRECT OWNER/PATH/BOUNDARY?
IS THE SAME MEANING OWNED ELSEWHERE UNDER ANOTHER NAME?
CAN IT BE ABSORBED INTO A STRONGER CANONICAL OWNER?
IS IT A WRAPPER/BRIDGE/SHIM/ALIAS/COMPATIBILITY SHELL?
SHOULD CHILDREN BE REHOMED AND THE CONTAINER DELETED?
WOULD WHOLE-SUBTREE REFOUNDATION REMOVE MORE DEBT CLEANLY?
```

## 7. File death test

A surviving file must prove a unique cohesive role in the canonical file set.

Delete/absorb files that are:

```text
RESPONSIBILITY-LESS
DUPLICATE RESPONSIBILITY
REEXPORT-ONLY
PASS-THROUGH-ONLY
FORWARDER-ONLY
SHIM/ALIAS-ONLY
HISTORICAL COMPENSATION
WRONG-OWNER CONTAINERS AFTER REHOME
EMPTY/NEAR-EMPTY AFTER MIGRATION
```

If required value exists inside a losing file:

```text
ABSORB/MOVE REQUIRED VALUE
→ MIGRATE ALL CONSUMERS
→ DELETE LOSING FILE
```

## 8. Highest-safe deletion and upward pruning

```text
DEAD LINE
→ CHECK SYMBOL
→ CHECK FILE
→ CHECK DIRECTORY
→ CHECK PACKAGE
→ CHECK SERVICE/BOUNDARY
→ CHECK TOP-LEVEL SURFACE
→ DELETE AT HIGHEST SAFE CANONICAL GRANULARITY
```

After deletion/merge/rehome/split, recursively re-evaluate parents and remove every parent that has lost unique responsibility.

## 9. Anti-fragmentation law

Forbidden stable shapes:

```text
A + B + SYNC WRAPPER
OLD SERVICE + NEW SERVICE + ROUTING BRIDGE
OLD PACKAGE + NEW PACKAGE + REEXPORT SHELL
MULTIPLE SHARED TREES WITH OVERLAPPING POLICY
SINGLE-SYMBOL FILES WITHOUT STRUCTURAL JUSTIFICATION
FORWARDER/ALIAS FILES PRESERVING OLD PATHS
LOCAL DOMAIN LOGIC COPIED INTO FRONTENDS
DUPLICATE ADAPTERS EMBEDDING THE SAME MUTABLE POLICY
```

At closure:

```text
RESPONSIBILITY_LESS_FILES=0
RESPONSIBILITY_LESS_DIRECTORIES=0
DUPLICATE_RESPONSIBILITY_FILES/TREES=0
UNJUSTIFIED_FILE_FRAGMENTATION=0
REEXPORT/PASS_THROUGH/FORWARDER/SHIM/ALIAS RESIDUE=0
EMPTY PARENTS=0
```

## 10. Package/workspace/service survival

A package/workspace/service survives only with coherent unique ownership and justified lifecycle/consumer boundaries.

Delete/collapse containers that are duplicate owners, compatibility holders, utility junk drawers, obsolete topology, or empty after migration.

Remove manifests, exports, dependencies, config and lockfile ownership associated only with the loser.

## 11. `core/**` and `shared/**`

Heightened burden of proof:

- genuinely cross-cutting and stable;
- multiple real consumers where relevant;
- no hidden domain-specific mutable policy;
- no duplicate service logic;
- no manual contract/business mirror;
- no use as a place to avoid choosing the true owner.

Rehome domain-owned truth out of `core/shared` and delete losing wrappers/paths.

## 12. Deployable-host versus capability ownership

Deployable apps/hosts own composition concerns:

```text
ROUTES
NAVIGATION
TABS/SHELL
DEEP LINKS
CROSS-CAPABILITY PAGE COMPOSITION
BOOTSTRAP/BINDING
NATIVE/OS ADAPTERS
APP-SPECIFIC ASSETS
BUILD/DEPLOYABLE CONFIG
```

Services/bounded contexts own reusable capability semantics and truth:

```text
BUSINESS/SYSTEM CAPABILITY SEMANTICS
BUSINESS RULES
DURABLE TRUTH
CANONICAL WRITERS
SERVICE CONTRACTS
GENERATED CLIENT LINEAGE
REUSABLE CAPABILITY PRESENTATION WHEN JUSTIFIED
```

```text
WHERE_IT_APPEARS != WHO_OWNS_IT
APP_HOST != BUSINESS_CAPABILITY_OWNER
services → apps = FORBIDDEN
apps → service public capability entrypoints = ALLOWED
```

Account, Home, Settings, dashboard and aggregate Search are composition/Information Architecture by default, not business-domain admission.

### 12.1 Semantic naming/admission law

A new semantic owner/package/topic is admitted only when all materially applicable conditions are proven:

```text
UNIQUE_STABLE_RESPONSIBILITY
CLEAR_CANONICAL_OWNER
NOT_A_PAGE_OR_ROUTE
NOT_AN_ACTOR_PREFIX
NOT_A_VENDOR_NAME_UNLESS_ADAPTER
NOT_AN_IMPLEMENTATION_MECHANISM
NOT_A_GENERIC_BUCKET
NOT_DUPLICATE_OF_EXISTING_OWNER
NAME_MATCHES_CONTRACT/BACKEND/FRONTEND MEANING
```

```text
ACTOR != CAPABILITY_OWNER
ROUTE != CAPABILITY_OWNER
SCREEN != CAPABILITY_OWNER
IMPLEMENTATION_MECHANISM != DOMAIN
```

Actor-specific names such as `client-orders`, `partner-orders` or `captain-orders` do not create separate canonical capabilities merely because presentation/permission differs.

Mechanism names such as `saga`, `outbox`, `worker`, `cache`, `retry`, `provider`, `handler`, `controller` or `repository` do not become business domains merely because many files exist beneath them.

## 13. Frontend structural ownership

For all web/mobile surfaces:

```text
SCREEN/JOURNEY OWNER IS EXPLICIT
STATE SOURCE IS CANONICAL
DATA ACCESS DOES NOT DUPLICATE DOMAIN POLICY
SHARED UI IS PRESENTATIONAL OR GENUINELY CROSS-SURFACE
NAVIGATION/ROUTE AUTHORITY IS NOT DUPLICATED
FORM VALIDATION DOES NOT BECOME SECOND BACKEND BUSINESS AUTHORITY
```

Duplicate screens/flows serving the same material responsibility must converge to a canonical flow unless real actor/journey/state distinctions justify separation.

## 14. Control/support surfaces

`.agents/**`, `.github/**`, `.opencodereview/**`, `docs/**`, `tools/**`, `governance/**` are ordinary architectural surfaces for survival purposes.

If a whole surface is mostly stale, duplicated, compensatory or confusing:

```text
EXTRACT UNIQUE REQUIRED VALUE
→ DELETE NONCANONICAL SURFACE/SUBTREE
→ RECREATE MINIMUM CANONICAL STRUCTURE
→ UPDATE REFERENCES
→ PROVE OLD SURFACE RESIDUE=0
```

Do not preserve a large control surface because deleting/rebuilding it feels aggressive.

## 15. Structural completion

An affected architecture unit is not closed until:

```text
LOSING SYMBOLS/FILES/DIRECTORIES/PACKAGES/SERVICES/SUBTREES REMOVED
REEXPORT/BRIDGE/ALIAS RESIDUE REMOVED
IMPORTS/EXPORTS POINT ONLY TO CANONICAL OWNERS
EMPTY/MEANINGLESS PARENTS PRUNED
WORKSPACE/MANIFEST/LOCKFILE OWNERSHIP UPDATED
UNUSED DEPENDENCIES REMOVED
NAMES/PATHS MATCH RESPONSIBILITIES
MISLEADING NAMES/PATHS=0
UNJUSTIFIED OVERSIZED/MULTI-RESPONSIBILITY FILES=0
UNJUSTIFIED FRAGMENTATION=0
NEGATIVE-SPACE SEARCH FINDS NO LOSING STRUCTURE
```
