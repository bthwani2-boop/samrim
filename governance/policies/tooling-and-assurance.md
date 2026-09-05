# Tooling, Automation, and Assurance Policy

ARTIFACT_CLASS: DURABLE_TOOLING_ASSURANCE_POLICY
SEMANTIC_OWNER: governance/policies/tooling-and-assurance.md
EXECUTION_AUTHORITY: NONE
CLOSURE_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Scope

This policy owns durable rules for repository automation, generators, inspection tools, guards, CI helpers, evidence producers and derived machine-readable views.

It does not own Product semantics, repository topology, current readiness, current implementation inventory or completion state.

~~~text
TOOLS = AUTOMATION + DERIVATION + INSPECTION + EVIDENCE

TOOLS != PRODUCT TRUTH
TOOLS != ARCHITECTURE OWNER
TOOLS != CURRENT IMPLEMENTATION AUTHORITY
TOOLS != CLOSURE AUTHORITY
~~~

## Placement and lifecycle ownership

Tool placement follows the responsibility whose lifecycle it serves:

~~~text
SERVICE-SPECIFIC TOOL → owning service testing/tools/scripts area
APP-SPECIFIC TOOL     → owning app area when app lifecycle controls it
CROSS-REPOSITORY TOOL → tools/
~~~

A tool must not become a generic top-level owner merely because several scripts can technically be colocated.

Examples:
- financial provider simulators follow the WLT/testing owner when WLT semantics drive them;
- Identity provisioning/test helpers call canonical Identity/DSH APIs rather than reimplementing role/business truth;
- app/mobile deployment helpers remain app/tooling mechanisms and do not define Product taxonomy.

## Derived artifacts versus manual authority

A registry, manifest, map, matrix, report or generated inventory may survive only when it has a unique machine-consumed/tooling role that cannot be obtained more safely from stronger canonical sources.

Prefer:

~~~text
CANONICAL SOURCE
→ DETERMINISTIC DERIVATION
→ NON-AUTHORITATIVE TOOL VIEW
~~~

Forbidden:
- manually maintained ownership maps that restate Governance/source;
- manual route/capability/binding registries when executable sources can derive them;
- readiness manifests that self-certify runtime state;
- generated artifacts edited as a second source of truth;
- tool-specific Product capability names that conflict with Governance.

If a derived artifact can be regenerated and has no unique runtime role, it is not a durable authority.

## Material tooling artifact admission

Before adding or retaining a material guard/script/registry/manifest/report/matrix/workflow helper, prove:

1. a concrete current problem or consumer;
2. one canonical lifecycle owner;
3. unique value not already supplied by compiler/type system/linter/database constraint/test/generator/runtime/tool;
4. no parallel Product/architecture/current-state authority;
5. deterministic/reproducible behavior where applicable;
6. clear failure semantics;
7. deletion/update ownership;
8. lower total complexity than the simpler alternative.

~~~text
CAN_BE_DERIVED + NO_UNIQUE_RUNTIME_ROLE
→ DO_NOT_HAND_MAINTAIN
~~~

## Guard survival law

A custom guard is justified only when it enforces a durable invariant that cannot be enforced more directly or simply by a stronger mechanism.

Preferred order when materially equivalent:

~~~text
TYPE/COMPILER/SCHEMA/DB CONSTRAINT
→ CANONICAL GENERATOR/VALIDATOR
→ FOCUSED TEST
→ DEPENDENCY GRAPH/RUNTIME ASSERTION
→ CUSTOM GUARD
~~~

A guard tied to a losing topology, obsolete path, retired campaign rule or compatibility shape must be rewritten/rehome/deleted with that structure. A guard is never a reason to preserve the wrong architecture.

## Baselines, allowlists and suppressions

Known-debt baselines, suppressions and allowlists are not final-state cleanliness.

Any surviving suppression follows `standards-and-quality.md`: narrow scope, explicit rationale, proven intentional condition/false positive and an expiry/removal trigger when temporary.

Final canonical baseline requires:

~~~text
KNOWN_DEBT_BASELINE_ENTRIES=0
UNJUSTIFIED_ALLOWLISTS=0
CAMPAIGN_ONLY_SUPPRESSIONS=0
~~~

unless a durable intentional condition is explicitly governed and visible.

## Wrapper and duplicate cleanup

A wrapper that only forwards another tool without a unique stable interface, platform adaptation, compatibility window or policy responsibility is deleted after consumer cutover.

Duplicate PowerShell/JS/shell utilities that perform the same job should converge on one implementation when doing so reduces complexity without losing required platform behavior.

Tool code is subject to the same cohesion/ownership standards as production code. A large script that reproduces business/state-machine/financial/authorization logic is a shadow implementation defect; it must call canonical APIs or be rehomed to the true owner.

## CI and assurance boundary

CI, static analyzers, security scanners, code review systems and custom guards are evidence producers.

~~~text
TOOL_GREEN != CANONICAL
CI_GREEN != CLOSED
MANIFEST_SAYS_OWNER != OWNER_PROVEN
~~~

Evidence output must be attributable to the exact candidate/source when material and should state what the tool does and does not prove.

Assurance machinery is repaired when:
- it is itself the defect/objective; or
- it blocks an indispensable evidence claim with no adequate alternative.

Do not create a shadow CI/assurance system merely to bypass a broken check.

## Dependency and module-boundary assurance

Where practical, enforce durable dependency direction mechanically:

~~~text
APP → APP PRIVATE DEPENDENCY = FORBIDDEN
SERVICE → APP                = FORBIDDEN
APP → SERVICE PRIVATE INTERNALS = FORBIDDEN
APP → SERVICE PUBLIC CLIENT/CONTRACT = ALLOWED
PACKAGE → SERVICE PRIVATE BUSINESS INTERNALS = FORBIDDEN
CROSS-SERVICE PRIVATE IMPORT = FORBIDDEN
CROSS-SERVICE PRIVATE DATABASE ACCESS = FORBIDDEN
~~~

The implementation mechanism may be Nx tags, Go import guards, package boundaries, tests or other simpler evidence; the durable rule is the dependency direction, not the current tool.

## Build/deployable assurance

A typecheck is not deployable-build proof.

For an affected candidate, exercise production-like outputs as applicable:
- Expo/mobile export or release-mode bundle;
- Control Panel production build;
- Go build/test/vet;
- contract/code generation;
- runtime composition/config validation.

Exact commands remain executable source/Docs truth.

## Tool discoverability

Repository tooling must be discoverable enough that a qualified developer/agent can determine:
- what belongs under `tools/`;
- what belongs with a service/app instead;
- canonical invocation paths;
- generated/derived outputs;
- how tools connect to package scripts/CI;
- how to add/remove a tool safely.

This guidance belongs in `tools/README.md` or an equivalent discoverable human guide; that file remains non-authoritative.

## Required conformance properties

Applicable tooling/assurance conformance requires; concrete candidate closure remains Orchestrator authority:

~~~text
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
ROOT_SCRIPTS/CI/AGENTS_CUTOVER=PASS
TOOLS_ARE_EVIDENCE_PRODUCERS_ONLY=PASS
DEPENDENCY_BOUNDARY_ASSURANCE=PASS
PRODUCTION_LIKE_BUILD_EVIDENCE=PASS_WHEN_APPLICABLE
~~~
