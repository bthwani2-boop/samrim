# Focus — Product, End-to-End Design and Governance Truth

OWNER_ROLE: PRODUCT_JOURNEY_EXPERIENCE_GOVERNANCE
AUTHORITY_ASSIGNED_BY: 00-ORCHESTRATOR.md
SELF_CERTIFICATION: FORBIDDEN


## 1. Product/System truth is required value, not inherited implementation

Reconstruct required behavior from evidence:

```text
ACTORS
CAPABILITIES
JOURNEYS
STATES / TRANSITIONS / ALLOWED ACTIONS
OWNERSHIP / AUTHORIZATION
PERSISTED FACTS
FINANCIAL CONSEQUENCES
EXTERNAL INTEGRATIONS
OBSERVABLE OUTCOMES
```

Do not infer canonical Product/System truth solely from current routes, screens, docs, tables, packages or historical governance.

## 2. Complete end-to-end capability chain

For each material capability trace as applicable:

```text
PRODUCT MEANING
→ ACTOR / JOURNEY / STATE
→ DATA/STORAGE TRUTH
→ CANONICAL DOMAIN/BACKEND OWNER
→ API / EVENT / COMMAND
→ CANONICAL CONTRACT
→ GENERATED BINDING
→ FRONTEND QUERY/MUTATION/STORE
→ VIEW MODEL / COMPONENT
→ SCREEN / ROUTE
→ USER ACTION
→ MUTATION
→ PERSISTED READBACK
→ VISIBLE FINAL STATE
```

Any unjustified break is a parity gap. A UI-only, API-only, backend-only or database-only success is not closure when the capability crosses layers.

## 3. One business meaning, one authority

Search for duplicated meaning across:

```text
BACKEND SERVICES
FRONTEND STORES/HOOKS/VIEW MODELS
CONTROL PANEL
MOBILE APPS
SHARED/CORE LIBRARIES
CONFIG
DATABASE DEFAULTS/POLICIES
CONTRACTS/DTOs/ENUMs
DOCS/GOVERNANCE
TEST FIXTURES/MOCKS
```

Choose one canonical mutable authority and make other layers derived consumers/adapters.

Frontend may own presentation/navigation/transient editing state, but not a second mutable source for permissions, eligibility, serviceability, financial/order state, allowed actions, pricing, fees, workflow transitions or business validation.

## 4. Every screen/flow re-earns existence

For every material screen/route/flow ask:

```text
WHAT_REQUIRED_CAPABILITY_DOES_IT_SERVE?
WHICH_ACTOR/JOURNEY?
WHAT_CANONICAL_BACKEND/DATA/CONTRACT_SUPPORTS_IT?
WHAT_QUERY/MUTATION/STORE_DOES_IT_USE?
WHAT_STATES/ACTIONS/READBACK_DOES_IT_REPRESENT?
IS_BUSINESS_TRUTH_HARDCODED_LOCALLY?
IS_A_MOCK/FALLBACK_HIDING_A_BACKEND_GAP?
IS_THIS_RESPONSIBILITY_DUPLICATED_BY_ANOTHER_SCREEN_UNDER_ANOTHER_NAME/PATH?
```

If no required journey exists, delete the flow. If duplicate, migrate navigation/consumers to the winner and delete the losing screen/route/files.

## 5. Actors and authorization

Actor identity, role, permission, scope and lifecycle require canonical ownership.

Do not allow applications, screens or local stores to invent role/permission truth independently.

Security-sensitive decisions require backend/persistence/contract/runtime proof where applicable, not UI hiding.

## 6. Journey completeness

For every required journey account for applicable:

```text
ENTRY
LOADING/PENDING
SUCCESS
EMPTY/MISSING
VALIDATION_FAILURE
AUTH/AUTHZ_FAILURE
BUSINESS_REJECTION
CONFLICT/CONCURRENCY
OFFLINE/DEGRADED
RETRY/IDEMPOTENCY
DUPLICATE/REPEATED_SUBMISSION
UNKNOWN_OUTCOME
PARTIAL/INDETERMINATE_STATE
PROCESS_RESTART/RESUME
STALE_CLIENT/STALE_READ
CROSS_SERVICE_HANDOFF
OUT_OF_ORDER/DUPLICATE_EVENT
CANCELLATION/COMPENSATION/REVERSAL
CANONICAL_READBACK
CROSS_SURFACE_CONSISTENCY
```

Do not add UX compensation for broken domain ownership; repair the higher root.

A journey is not complete only because its happy path terminates.

```text
UNKNOWN MUST REMAIN UNKNOWN UNTIL RECONCILED
DO_NOT_FABRICATE_SUCCESS_FROM_TIMEOUT_OR_MISSING_CONFIRMATION
```

### 6.1 Material surface-interaction census

For every materially affected user/operator surface, enumerate applicable interactive entrypoints rather than proving only that the screen renders:

```text
ROUTE
PAGE/SCREEN
LAYOUT/SECTION
TAB
MENU
CARD/LIST/TABLE ACTION
DIALOG/MODAL/DRAWER
FORM/FIELD
BUTTON
ACTIONABLE ICON
LINK
GESTURE
FILTER
SEARCH
SORT
PAGINATION
REFRESH/PULL-TO-REFRESH
CONFIRMATION
NOTIFICATION ACTION
BACK ACTION
DEEP LINK
```

For every material action prove as applicable:

```text
VISIBILITY
ENABLED/DISABLED STATE
ACTOR/ROLE/SCOPE
INPUT
HANDLER/CONTROLLER
CANONICAL CAPABILITY OWNER
CONTRACT/API/EVENT
LOADING/PENDING STATE
DUPLICATE-ACTION / IDEMPOTENCY BEHAVIOR
BACKEND/SYSTEM EFFECT
PERSISTED/OBSERVABLE READBACK
ERROR MAPPING
RETRY/RECOVERY
NAVIGATION/FINAL VISIBLE RESULT
```

```text
RENDERED != WIRED
CLICKABLE != FUNCTIONAL
LOCAL_SUCCESS != PERSISTED_SUCCESS
VISIBLE_CONTROL_WITHOUT_REQUIRED_EFFECT = OPEN_FINDING
```

### 6.2 Operator/control-surface correlation

For any Product/System journey that materially requires operator observation, intervention, approval, support, reconciliation, investigation or audit, prove the applicable operator/control surface:

```text
END_USER/SERVICE ACTION
→ CANONICAL SYSTEM EFFECT
→ OPERATOR-VISIBLE STATE WHEN REQUIRED
→ ALLOWED OPERATOR ACTIONS
→ SERVER-SIDE AUTHORIZATION
→ AUDITABLE RESULT
→ CANONICAL READBACK
```

```text
CONTROL_PANEL_REQUIRED = WHEN_PRODUCT/OPERATIONS_REQUIRE_IT
```

Do not manufacture an admin surface for every capability. Do not close an operator-dependent capability while its required operational visibility or intervention path is missing.

### 6.3 Actor/scope/organization non-conflation

```text
ACTOR != ROLE
ROLE != ENGAGEMENT
ENGAGEMENT != ORGANIZATION
ORGANIZATION != AUTHORIZATION_SCOPE
PARTNER != TENANT_BY_DEFAULT
STORE != TENANT_BY_DEFAULT
OPERATOR_CONTEXT != TENANT
AUTHORIZATION_SCOPE != ORGANIZATION_ID
```

`TENANT` is admitted only when the Product/System model proves a real tenancy boundary with independent isolation/lifecycle semantics.

## 7. Human-experience root altitude

When a material root affects a user-facing journey, diagnose above local styling before patching presentation:

```text
USER/ACTOR_NEED
→ JOURNEY/TASK
→ INFORMATION_ARCHITECTURE
→ INTERACTION / FEEDBACK / RECOVERY
→ CONTENT / TERMINOLOGY
→ DESIGN_TOKEN / COMPONENT / PATTERN_AUTHORITY
→ SURFACE_COMPOSITION
→ RENDERED_BEHAVIOR
→ ACCESSIBILITY / LOCALIZATION / PERFORMANCE / USABILITY_EVIDENCE
```

High-leverage experience-root signals include:

```text
COMPETING_DESIGN/TOKEN_SOURCES
UNJUSTIFIED_LOCAL_STYLE/TOKEN_OVERRIDES
DUPLICATE_COMPONENT/PATTERN_AUTHORITY
INCONSISTENT_STATE/ERROR_SEMANTICS
MISSING_MATERIAL_COMPONENT_STATES
CROSS_SURFACE_DIVERGENCE_WITHOUT_PRODUCT_REASON
RENDERED_ONLY_DEFECTS
HIGH_RISK_USABILITY_ASSUMPTIONS_PRESENTED_AS_FACT
```

Do not patch a screenshot when the shared component, token, content vocabulary, journey semantics or Product authority is the actual Source-of-Fix.

This does not require design bureaucracy. It exists to promote the highest correct experience root and eliminate repeated local UI patches.

## 8. Accessibility, localization and performance

When material, account for:

```text
KEYBOARD/FOCUS/SEMANTIC_ACCESSIBILITY
SCREEN_READER_MEANING
CONTRAST/SCALING/REDUCED_MOTION WHERE APPLICABLE
ARABIC/RTL/LTR/NUMBER/DATE/CURRENCY SEMANTICS
RESPONSIVE/DEVICE-SIZE BEHAVIOR
LOADING/PERCEIVED_PERFORMANCE
RENDERING/NETWORK/STATE PERFORMANCE BOTTLENECKS
```

Do not create arbitrary numeric targets without a real Product/operations requirement. But do not claim a user-facing baseline correct while known material accessibility/localization/performance defects remain.

## 9. Durable truth vs mirrors

Material mutable Product truth must not live in synchronized mirrors.

Derived cache/read/frontend state must have explicit derivation/invalidation and cannot become a second writer.

Manual DTO/enum/status/error/business mappings that duplicate canonical contract/domain semantics are parallel-truth candidates and should be migrated/deleted when redundant.

## 10. Forensic/reference value and experience salvage

Old branches, dead code, historical docs and external reference systems may contain required value without having any right to donate their authority or topology.

```text
DISCOVER_REQUIRED_VALUE
→ PROVE_CURRENT_PRODUCT/SYSTEM_RELEVANCE
→ EXTRACT_REQUIRED_BEHAVIOR / EXPERIENCE / INVARIANT / EDGE_CASE / FAILURE_MODE / ASSET
→ MAP_TO_CURRENT_CANONICAL_OWNER
→ REIMPLEMENT_OR_REHOME_AGAINST_CURRENT_CONTRACTS
→ VERIFY
→ DELETE/IGNORE_DONOR_SHAPE
```

```text
DONOR_VALUE != DONOR_AUTHORITY
GOOD_UX != RIGHT_TO_COPY_OLD_TOPOLOGY
REFERENCE_SELECTION != ADOPTION_SELECTION
NEVER_IMPORT_DONOR_AUTHORITY
NEVER_IMPORT_DONOR_TOPOLOGY_BY_DEFAULT
NEVER_IMPORT_DONOR_MOCK/FALLBACK_AS_PRODUCT_TRUTH
```

Refoundation must preserve required experience value without preserving a losing container:

```text
REFOUNDATION != AUTOMATIC_PRODUCT_REDESIGN
REFOUNDATION != AUTOMATIC_VISUAL_REDESIGN
DEMOLISHING_A_CONTAINER != PERMISSION_TO_LOSE_REQUIRED_EXPERIENCE_VALUE

CENSUS_REQUIRED_BEHAVIOR
→ CENSUS_APPROVED_INTERACTION_VALUE
→ CENSUS_REQUIRED_ASSETS
→ CENSUS_ACCESSIBILITY/RTL/PLATFORM_VALUE
→ REHOME_VALUE
→ ONLY_THEN_DELETE_LOSER
```

## 10A. Representation-preservation law

A format/file/schema/topology refactor that claims Product-semantic equivalence must preserve every still-valid semantic statement.

```text
REPRESENTATION_CHANGE
→ CENSUS_EXISTING_DURABLE_SEMANTICS
→ MAP_EACH_TO_NEW_OWNER/REPRESENTATION
→ EXPLICITLY_JUSTIFY_ANY_INTENTIONAL_SEMANTIC_REMOVAL
→ VERIFY_NO_REQUIRED_MEANING_LOST
```

```text
FORMATTING_CLEANUP != PERMISSION_TO_DROP_PRODUCT_MEANING
MERGE_DOCUMENTS != SEMANTIC_DELETION
SCHEMA_REMOVAL != REQUIREMENT_REMOVAL
```

## 11. Governance is not privileged

`governance/**` and governance-like docs are not automatically canonical because they describe process or Product intent.

For every governance artifact determine:

```text
DOES_IT_CONTAIN_UNIQUE_REQUIRED_DURABLE_TRUTH?
IS_THAT_TRUTH_ALREADY_OWNED_EXECUTABLY_ELSEWHERE?
DOES_IT_CONFLICT_WITH_LIVE_PRODUCT/SYSTEM_TRUTH?
DOES_IT_CREATE_A_SECOND_EXECUTION/APPROVAL/ROUTING_AUTHORITY?
WOULD_EXTRACT→DELETE→MINIMAL_RECREATE_BE_CLEANER?
```

Delete stale, duplicative, obsolete or confusing governance. Preserve/recreate only unique truth that the canonical baseline actually needs.

Do not automate governance prose merely to make it look authoritative.

## 12. Documentation

Documentation survives only when it owns unique required explanatory/operational truth not better represented elsewhere.

Stale/contradictory docs must be corrected, absorbed or deleted. Historical prose cannot control execution.

## 13. Product fixed-point proof

At final closure prove for every material capability:

```text
REQUIRED_CAPABILITY_ACCOUNTED_FOR
CANONICAL_OWNER/WRITER_ACCOUNTED_FOR
DATA/PERSISTENCE_ACCOUNTED_FOR
API/CONTRACT/GENERATED_LINEAGE_ACCOUNTED_FOR_WHERE_APPLICABLE
ALL_MATERIAL_SURFACES/SCREENS_ACCOUNTED_FOR
ACTION→MUTATION→READBACK_ACCOUNTED_FOR
NO_FRONTEND/BACKEND_SHADOW_BUSINESS_TRUTH
NO_ORPHAN_REQUIRED_SCREEN/API/BINDING/DATA
NO_PARALLEL_PRODUCT_TRUTH
NO_ORPHAN_JOURNEY
NO_KNOWN_REQUIRED_CAPABILITY_LOST_DURING_REFOUNDATION
NO_KNOWN_MATERIAL_ACCESSIBILITY/LOCALIZATION/EXPERIENCE_GAP_WHERE_APPLICABLE
```
