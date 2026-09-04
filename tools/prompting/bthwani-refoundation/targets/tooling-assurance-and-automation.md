# Target — Tooling, Assurance and Automation

## 1. Mission

Refound top-level `tools/` into a small, coherent automation/evidence layer. Tools may inspect, generate, orchestrate development actions and produce evidence; they must never become Product, architecture, ownership, readiness or closure authority.

```text
TOOLS = AUTOMATION + DERIVATION + INSPECTION + EVIDENCE
TOOLS != PRODUCT TRUTH
TOOLS != ARCHITECTURE OWNER
TOOLS != MANUAL REPOSITORY TOPOLOGY REGISTRY
TOOLS != CLOSURE AUTHORITY
```

## 2. Canonical top-level tooling taxonomy

Prefer responsibility-oriented grouping such as:

```text
tools/
├── README.md
├── dev/
├── ci/
├── contracts/
├── mobile/
├── analysis/
├── performance/
├── quality/
└── prompting/
    ├── bthwani-orchestrator/
    └── bthwani-refoundation/   # temporary until verified fixed point
```

Do not create folders merely to mirror this illustration.

Ownership law:

```text
SERVICE-SPECIFIC TOOL → services/<service>/testing|tools|scripts
APP-SPECIFIC TOOL     → apps/<app>/... when app lifecycle owns it
CROSS-REPOSITORY TOOL → tools/
```

Examples: WLT financial simulators belong with WLT testing; Identity fixtures/provisioning helpers use Identity/Workforce canonical APIs; DSH database helpers belong with DSH database tooling.

## 3. Manual authority demolition

Manual registries are forbidden when they restate architecture/product topology that can drift from executable owners.

High-risk classes include:

```text
ownership manifests claiming repository authority
aggregate ownership maps duplicating service/data truth
frontend binding registries manually listing screens/controllers/routes/capabilities
manual capability/readiness/closure registries
mobile manifests that mix deployment identity with Product feature taxonomy
manual contract/operation/status/action mirrors
```

Treatment:

```text
PRESERVE REAL TOOL-SPECIFIC NEED
→ DERIVE FROM CANONICAL EXECUTABLE SOURCES WHEN POSSIBLE
→ KEEP ONLY MINIMAL NONAUTHORITATIVE TOOL CONFIG WHEN DERIVATION IS IMPOSSIBLE
→ DELETE PARALLEL ARCHITECTURE/PRODUCT AUTHORITY
```

## 4. Mobile tooling separation

Stable deployable facts such as Expo/EAS project ID, slug, scheme, Android package and iOS bundle identity belong to app-owned build/deployment configuration.

Native technical capability validation may inspect app config/plugins/dependencies.

Product feature/capability taxonomy belongs to Governance/services, not `tools/mobile/*`.

A mobile tool must not decide that concepts such as `homeDiscovery`, `account`, `finance`, `operations` or actor-prefixed features are canonical Product owners.

### 4.1 General material-artifact admission

Before creating or retaining a material Guard/Script/Registry/Manifest/Report/Matrix/Generated Inventory/Workflow Helper prove:

```text
UNIQUE_RESPONSIBILITY
CANONICAL_OWNER
REAL_CONSUMER
WHY_NOT_DERIVABLE
WHY_NOT_EPHEMERAL_CI_EVIDENCE
VALIDATION_METHOD
UPDATE_TRIGGER
INVALIDATION_TRIGGER
RETIREMENT_CONDITION
NO_PARALLEL_AUTHORITY
```

```text
CAN_BE_DERIVED + NO_UNIQUE_RUNTIME_ROLE
→ DO_NOT_HAND_MAINTAIN
```

Do not manufacture a permanent registry merely because temporary execution evidence is useful.

## 5. Guard survival law

Every custom guard must prove a unique durable invariant that cannot be enforced more directly/simply by compiler, type system, linter, contract generator, database constraint, dependency graph, test or runtime check.

Classify each guard:

```text
KEEP_DURABLE_UNIQUE_PREVENTION
REWRITE_FOR_NEW_CANONICAL_TOPOLOGY
REHOME_TO_OWNER
REPLACE_WITH_DIRECT_EXISTING_MECHANISM
DELETE_OBSOLETE
DELETE_CAMPAIGN_ONLY
```

A guard that enforces losing `core/`, `shared/`, `apps/*/runtime`, `shared/ui-kit`, app-shaped DSH or other superseded topology is a blocker, not assurance.

## 6. Baseline/allowlist debt law

Ratchet baselines, suppressions and allowlists may be temporary migration mechanisms only when a real bounded transition requires them.

For the final canonical baseline:

```text
KNOWN_DEBT_BASELINE_ENTRIES=0
UNJUSTIFIED_ALLOWLISTS=0
CAMPAIGN_SUPPRESSIONS=0
```

Do not preserve known violations merely because a guard can grandfather them.

## 7. Pass-through and duplicate tool cleanup

Wrappers that only import/forward another tool with no unique interface, policy, compatibility window or cross-platform adaptation should be removed after consumer cutover.

Likewise merge duplicate scripts, PowerShell/JS wrappers and diagnostics when one canonical implementation can serve the same purpose.

Large tool files receive the same cohesion test as production code. A development/provisioning script that reproduces domain business logic must be refounded to call canonical APIs rather than remain a shadow implementation.

## 8. CI and assurance boundary

CI, scanners, verification scripts, Graphify, Sonar/CodeQL/Semgrep helpers and evidence classifiers are evidence producers.

```text
TOOL_GREEN != CANONICAL
CI_GREEN != CLOSED
MANIFEST_SAYS_OWNER != OWNER_PROVEN
```

Tool outputs must be attributable to exact candidate/source where material and must state what they do not prove.

## 9. Tool documentation and discoverability

`tools/README.md` must explain:

```text
what belongs under tools/
what must live with a service/app instead
canonical invocation paths
which outputs are generated/derived
which files are temporary
how to add/remove a tool
how tools connect to CI/root package scripts
```

Root package scripts, CI workflows, path filters, Nx/workspace config and agent adapters are part of the affected cone for tooling moves.

## 10. Tooling closure gate

```text
TOOLS_README/TAXONOMY=PASS
TOOLS_PRODUCT_AUTHORITY=0
TOOLS_ARCHITECTURE/OWNERSHIP_AUTHORITY=0
MANUAL_BINDING/TOPOLOGY/READINESS_REGISTRIES=0_OR_PROVEN_MINIMAL_TOOL_CONFIG
MOBILE_PRODUCT_TAXONOMY_IN_TOOLS=0
GUARDS_ENFORCING_LOSING_TOPOLOGY=0
SERVICE/APP_SPECIFIC_TOOL_MISOWNERSHIP=0
PASS_THROUGH_WRAPPERS=0
DUPLICATE_TOOL_IMPLEMENTATIONS=0
FINAL_KNOWN_DEBT_BASELINES=0
CAMPAIGN_ONLY_GUARDS/HELPERS=0
ROOT_SCRIPTS/CI/AGENTS CUT_OVER=PASS
TOOLS_ARE_EVIDENCE_PRODUCERS_ONLY=PASS
```
