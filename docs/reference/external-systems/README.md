# BThwani External Reference System

DOCUMENT_CLASS: NON_AUTHORITATIVE_EXTERNAL_REFERENCE
EXECUTION_AUTHORITY: NONE
PRODUCT_AUTHORITY: NONE
CURRENT_REPOSITORY_STATE_AUTHORITY: NONE


The external corpus exists to falsify BThwani assumptions and discover missing invariants, edge cases, state machines, failure/recovery behavior, security/financial rules and test scenarios. It is not a source of BThwani ownership or implementation state.

## 1. Purpose

BThwani may use mature open-source projects to accelerate refoundation without replacing the project, changing its product identity, or forcing a new primary technology stack.

The main value of external projects is not “download and install the whole platform”.

The main value is:

```text
DISCOVER_MISSING_LOGIC
DISCOVER_MISSING_EDGE_CASES
DISCOVER_MISSING_STATE_MACHINES
DISCOVER_MISSING_SECURITY_RULES
DISCOVER_MISSING_FINANCIAL_INVARIANTS
DISCOVER_MISSING_FAILURE/RETRY/RECONCILIATION_BEHAVIOR
DISCOVER_MISSING_TEST_SCENARIOS
DISCOVER_BETTER_GENERIC_TECHNICAL_COMPONENTS
```

Then BThwani must implement the required truth inside its canonical owners using BThwani’s existing languages, bounded contexts, contracts, and deployment identities unless a small external component independently passes the adoption gate in this document.

---

## 1A. BEST-IN-CLASS PRIORITY NAVIGATION

### 1A.1 Reference selection is not adoption selection

The selection rule for reference/falsification is intentionally broader than the selection rule for direct adoption.

~~~text
REFERENCE_SELECTION
!=
DEPENDENCY_ADOPTION_SELECTION
~~~

For reference use, do not reject a system merely because it is:

~~~text
PAID
COMMERCIAL
OPEN_CORE
GPL/AGPL
JAVA
PYTHON
RUBY
PHP
TYPESCRIPT
A DIFFERENT DATABASE
TOO_LARGE_TO_SELF_HOST
NOT_A_BTHWANI_STACK_MATCH
~~~

If the system is one of the strongest/mature references for the exact root and its public code/docs/design material can expose missing logic, edge cases, state machines, contracts, operational controls, or failure handling, it may be used as a reference.

For direct code reuse, dependency, or runtime adoption, the stricter license, stack, ownership, cost, maintenance, operations, and source-of-truth gates in this document still apply.

Therefore:

~~~text
BEST_REFERENCE
→ chosen for semantic maturity and falsification power

BEST_COMPONENT_TO_ADOPT
→ chosen only after adoption gates pass
~~~

A paid or differently licensed system may be a P1 reference while remaining forbidden for direct adoption.

### 1A.2 Anti-distraction priority law

The corpus is hierarchical. Do not browse every reference merely because it is listed.

For every active BThwani root/question:

~~~text
IDENTIFY_EXACT_QUESTION
→ SELECT_THE_RELEVANT_DOMAIN_PRIORITY_LIST
→ CONSULT_P1
→ ANSWER_SUFFICIENT_AND_NO_MATERIAL_UNKNOWN?
    YES → STOP_EXTERNAL_RESEARCH
    NO  → CONSULT_P2
→ ANSWER_SUFFICIENT_AND_NO_MATERIAL_UNKNOWN?
    YES → STOP_EXTERNAL_RESEARCH
    NO  → CONSULT_P3
→ CONTINUE_ONLY_IF_A_SPECIFIC_GAP/CONTRADICTION_REMAINS
~~~

Default maximum:

~~~text
ORDINARY_ROOT
→ P1 only if sufficient
→ P1 + P2 if incomplete
→ P1 + P2 + P3 only if still materially unresolved

FINANCIAL_OR_SECURITY_ROOT
→ minimum P1 + one independent P2 cross-check
→ P3 only on disagreement, missing invariant, or unresolved failure mode

P4/P5/P6
→ specialist fallback or adversarial falsification only
→ never routine reading
~~~

This prevents corpus breadth from becoming execution delay.

### 1A.3 Stop condition

External reference research for a specific question stops when all are true:

~~~text
QUESTION_HAS_A_CLEAR_ANSWER
APPLICABLE_INVARIANTS_IDENTIFIED
APPLICABLE_EDGE_CASES_IDENTIFIED
FAILURE/RECOVERY_BEHAVIOR_IDENTIFIED
BTHWANI_OWNER_IDENTIFIED
BTHWANI_GAP_CLASSIFIED
NO_MATERIAL_CONTRADICTION_REMAINS
NO_HIGH_RISK_UNKNOWN_REMAINS
~~~

Do not continue to P2/P3 merely to collect more examples.

### 1A.4 Specialist override

Priority is by question, not brand prestige.

Examples:

~~~text
"How should unknown payment outcomes be handled?"
→ PAYMENTS P1/P2

"How should stale captain GPS be classified?"
→ TELEMETRY/DISPATCH P1

"How should fine-grained relationship authorization work?"
→ AUTHORIZATION P1

"How should refunds hit an internal ledger?"
→ LEDGER/WALLET P1
~~~

### 1A.5 Ranking meaning

~~~text
P1 = DEFAULT FIRST REFERENCE
P2 = FIRST FALLBACK / INDEPENDENT CROSS-CHECK
P3 = SECOND FALLBACK / DIFFERENT ARCHITECTURAL VIEW
P4 = SPECIALIST OR FALSIFICATION SOURCE
P5+ = DEEP SPECIALIST / LAST-RESORT REFERENCE
~~~

Ranking means reference efficiency for BThwani, not a universal claim that one product is objectively superior to every other product.

---

## 1C. ROOT-TO-REFERENCE ROUTER

Use this table to avoid broad browsing.

| BThwani root/question | Start here | First fallback | Specialist/deep fallback |
|---|---|---|---|
| Cart / checkout / order | Shopify | Adobe Commerce | commercetools / Saleor |
| Partner / marketplace | Mirakl | Mercur | Sharetribe |
| Catalog / inventory | Shopify | Adobe Commerce | commercetools / Saleor |
| Dispatch | Fleetbase | Uber Engineering | DoorDash Engineering |
| Captain GPS / geofence | Traccar | Google Maps | Mapbox |
| Routing | Google Maps | Mapbox | Valhalla / OSRM |
| Route optimization | VROOM | Google/Mapbox optimization docs | Valhalla |
| Payment provider lifecycle | Stripe | Adyen | Hyperswitch |
| Unknown financial result | Adyen | Stripe | Hyperswitch |
| Wallet / ledger | Modern Treasury | TigerBeetle | Formance |
| Reconciliation | Modern Treasury | Adyen | Blnk / Formance |
| Identity / sessions | Keycloak | ZITADEL | Ory |
| Relationship authorization | OpenFGA | Keycloak AuthZ | Ory Keto |
| Notification workflow | Knock | Courier | Novu |
| Push delivery | OneSignal | Expo/FCM official docs | Novu |
| Product search | Algolia | Elasticsearch | OpenSearch / Typesense |
| Durable workflow | Temporal | Restate | Cadence |
| Tracing / telemetry contract | OpenTelemetry | Grafana | Sentry |
| Error/release observability | Sentry | OpenTelemetry | Grafana |
| Backoffice operations | Odoo | ERPNext | Dynamics concepts |
| Workforce / HR | Odoo HR | ERPNext HR | OrangeHRM |
| Support | Zendesk | Intercom | Chatwoot |
| Feature flags / rollout | LaunchDarkly | OpenFeature | Unleash |
| Promotions / loyalty | Shopify | Talon.One | Voucherify |
| Payment fraud/risk | Stripe Radar | Adyen Risk | Sift |
| Object storage | S3 semantics | R2 | MinIO |
| Secrets | Vault | AWS Secrets Manager | SOPS |
| OpenAPI contract | OpenAPI spec | oapi-codegen | Redocly / Pact |
| Real integration proof | Testcontainers-Go | WireMock | Toxiproxy / Pact |

---

## 1D. REFERENCE QUERY CARD

Before consulting the corpus, reduce the root to a concrete question.

Example:

~~~text
ACTIVE_ROOT:
WLT payment unknown-result handling

QUESTION:
Provider timed out after a payment mutation. What state must BThwani persist and when is retry safe?

P1:
Adyen

P1_FINDINGS_REQUIRED:
- idempotency behavior
- timeout/transient semantics
- webhook/reconciliation behavior
- safe retry condition

P2_CROSS_CHECK:
Stripe

STOP_WHEN:
- canonical BThwani UNKNOWN state is defined
- reconciliation path is defined
- retry safety is defined
- provider provenance is defined
- tests can falsify duplicate charge / lost result
~~~

Another example:

~~~text
ACTIVE_ROOT:
Captain live location

QUESTION:
When must a position be considered stale and how should reconnect/out-of-order events behave?

P1:
Traccar

P2:
Google Maps/provider semantics only if needed

STOP_WHEN:
- position timestamp/provenance is defined
- freshness/staleness rule is defined
- out-of-order behavior is defined
- offline/reconnect behavior is defined
- DSH remains canonical delivery owner
~~~

This card is temporary reasoning/evidence, not a durable campaign-state ledger.

---

## 1E. Corpus expansion law

Do not add a new reference because it is popular.

A new reference enters this file only when it provides material value not sufficiently represented by the higher-priority corpus:

~~~text
NEW_REFERENCE_ADMISSION
=
UNIQUE_FALSIFICATION_VALUE
OR
UNIQUE_SPECIALIST_DEPTH
OR
CLEARLY_STRONGER_CURRENT_P1/P2
~~~

If a source merely duplicates existing P4/P5 material:

~~~text
DO_NOT_ADD
~~~

If an existing P1 becomes stale, inaccessible, materially weaker, or no longer exposes useful public evidence:

~~~text
RE-RANK
→ PROMOTE_STRONGER_REFERENCE
→ KEEP_LIST_SHORT
~~~

The goal is maximum semantic coverage with minimum browsing fan-out.

---


## Adoption and research policy

## 2. Non-negotiable stack preservation

External-source research does **not** authorize a platform rewrite.

The default canonical technology direction remains:

```text
BACKEND
→ Go

DATABASE
→ PostgreSQL / PostGIS

MOBILE
→ TypeScript
→ React Native
→ Expo

CONTROL PANEL
→ TypeScript
→ React
→ Next.js

PRIMARY BUSINESS BOUNDED CONTEXTS
→ DSH
→ WLT
→ Identity
→ Workforce
→ other independently proven services only
```

Therefore, the following are forbidden by default:

```text
REPLACE_GO_BACKEND_WITH_NODE_PLATFORM
REPLACE_GO_BACKEND_WITH_PYTHON_PLATFORM
REPLACE_GO_BACKEND_WITH_RUBY_PLATFORM
REPLACE_POSTGRESQL_WITH_AN_UNRELATED_DATABASE
REPLACE_EXPO_APPS_WITH_AN_EXTERNAL_MARKETPLACE_FRONTEND
REPLACE_DSH/WLT_WITH_A_MONOLITHIC_EXTERNAL_PLATFORM
ADOPT_A_WHOLE_PLATFORM_ONLY_BECAUSE_IT_IS_OPEN_SOURCE
```

A technology change is allowed only when the normal orchestrator/root-cause process independently proves that the current technology itself is the root defect and that migration is safer and materially better than refounding inside the existing stack.

---

## 3. Canonical usage model

Every external project must be classified into exactly one of these modes:

### 3.1 REFERENCE_ONLY

Read architecture, state machines, APIs, tests, failure handling, product flows, database models, and invariants.

Do not copy or import code.

Use this mode by default for:

```text
whole marketplace platforms
whole logistics platforms
whole ERP/banking platforms
copyleft projects
projects in a materially different stack
projects with mixed/open-core licensing
```

### 3.2 SELECTIVE_LOGIC_REFERENCE

Extract a specific behavioral invariant or workflow, then implement it natively inside BThwani.

Example:

```text
EXTERNAL PROJECT
→ refund state machine is stronger than ours
→ identify invariant
→ map invariant to WLT owner
→ implement in Go/PostgreSQL/contracts/tests
→ no external platform dependency introduced
```

### 3.3 SMALL_COMPONENT_CANDIDATE

A focused library/tool may be adopted when it removes substantial custom plumbing and passes all gates.

Examples:

```text
Testcontainers-Go
sqlc
pgx
oapi-codegen
Watermill
OpenTelemetry-Go
```

None is automatically required.

### 3.4 COMPONENT/SERVICE_ADOPTION

A self-contained external engine may be integrated behind a semantic BThwani port only when it owns no BThwani business truth and can be replaced without rewriting the domain.

Examples that may be evaluated in the future:

```text
routing engine
GPS/telemetry engine
object-storage implementation
search engine
observability backend
```

The domain must depend on a semantic port, never directly on the vendor/project.

### 3.5 WHOLE_PLATFORM_REPLACEMENT

Forbidden by default.

This mode requires explicit proof that:

```text
CURRENT_BTHWANI_BOUNDARY_IS_A_PROVEN_LOSER
REPLACEMENT_MATCHES_REQUIRED_TRUTH
STACK_MIGRATION_COST_IS_ACCEPTABLE
ALL_FIVE_SURFACES_CAN_CUT_OVER
DSH/WLT/IDENTITY/WORKFORCE_BOUNDARIES_REMAIN_CORRECT
DATA_MIGRATION_IS_PROVEN
LICENSE_IS_ACCEPTABLE
LOCK_IN_IS_ACCEPTABLE
LEVEL_4_CLOSURE_GETS_FASTER_NOT_SLOWER
```

Absence of this proof means: do not replace.

---

## 4. Mandatory extraction workflow

Whenever a BThwani root touches an area covered by mature external systems:

```text
PIN_LIVE_h
→ IDENTIFY_CURRENT_BTHWANI_OWNER
→ IDENTIFY_REQUIRED_PRODUCT_TRUTH
→ SELECT_RELEVANT_EXTERNAL_REFERENCES
→ EXTRACT_BEHAVIORAL_INVARIANTS
→ EXTRACT_EDGE_CASES
→ EXTRACT_FAILURE_MODES
→ EXTRACT_SECURITY/FINANCIAL_RULES
→ EXTRACT_TEST_ORACLE_SCENARIOS
→ COMPARE_WITH_BTHWANI
→ CLASSIFY_EACH_FINDING
→ IMPLEMENT_ONLY_PROVEN_GAPS
→ VERIFY_WITH_BTHWANI_CONTRACTS/DATA/RUNTIME
→ PROVE_NO_NEW_SHADOW_AUTHORITY
```

Each finding must terminate in one of:

```text
PRESENT_AND_CANONICAL
PRESENT_BUT_DEFECTIVE
PRESENT_BUT_IN_WRONG_OWNER
MISSING_AND_REQUIRED
NOT_APPLICABLE
REFERENCE_COMPONENT_CANDIDATE
REJECTED
```

“Interesting” is not a terminal state.

---

## 5. What to extract from external projects

### Product/business logic

Look for:

```text
actors
roles
permissions
state machines
allowed actions
order lifecycle
seller lifecycle
captain lifecycle
dispatch lifecycle
checkout lifecycle
payment lifecycle
refund lifecycle
commission lifecycle
settlement lifecycle
payout lifecycle
reconciliation lifecycle
inventory effects
serviceability rules
cancellation rules
timeout behavior
failure recovery
idempotency
concurrency rules
```

### API/contracts

Look for:

```text
resource boundaries
operation semantics
request/response ownership
error models
idempotency keys
webhook semantics
pagination
filtering
authorization metadata
versioning
event schemas
```

Do not mirror an external API merely because it exists.

### Database/data integrity

Look for:

```text
canonical writer
uniqueness constraints
foreign-key semantics
transaction boundaries
ledger/posting rules
optimistic/pessimistic locking
outbox boundaries
reconciliation evidence
audit/provenance
derived projection rules
```

### UX/journeys

Look for:

```text
missing screens
missing journey states
recovery paths
empty states
error states
offline states
operator workflows
partner onboarding
captain workflow
refund/dispute visibility
financial status explainability
```

UX reference does not transfer business authority to the app.

### Testing

Look for:

```text
integration scenarios
race-condition tests
retry tests
replay tests
financial balance tests
double-submit tests
timeout/unknown-result tests
webhook replay tests
migration tests
real-database tests
cross-service contract tests
```

---

## 10. Adoption gate for any external dependency

No dependency may be added until all applicable questions are answered:

```text
1. WHAT_PROVEN_ROOT_REQUIRES_THIS?
2. WHAT_BTHWANI_TRUTH_DOES_IT_OWN?
3. SHOULD_IT_OWN_THAT_TRUTH?
4. DOES_IT_REPLACE_A_PROVEN_LOSER?
5. DOES_IT_REMOVE_SUBSTANTIAL_CUSTOM_PLUMBING?
6. CAN_THE_DOMAIN_DEPEND_ON_A_SEMANTIC_PORT_INSTEAD?
7. IS_THE_LICENSE_ACCEPTABLE_FOR_THE_EXACT_VERSION/COMPONENT?
8. IS_IT_FREE_TO_USE_IN_THE_REQUIRED_MODE?
9. CAN_LEVEL_4_BE_REPRODUCED_WITHOUT_A_PAID_SAAS_DEPENDENCY?
10. DOES_IT_PRESERVE_GO/POSTGRES/EXPO/NEXT_DIRECTION?
11. DOES_IT_CREATE_A_SECOND_SOURCE_OF_TRUTH?
12. DOES_IT_CREATE_A_SECOND_GENERATOR/REGISTRY/WRITER?
13. DOES_IT_ADD_RUNTIME/OPERATIONS_COMPLEXITY?
14. IS_MAINTENANCE_ACTIVE_ENOUGH?
15. CAN_IT_BE_REMOVED/REPLACED_WITHOUT_REWRITING_BUSINESS_LOGIC?
16. DOES_IT_MAKE_THE_CURRENT_ROOT_FASTER_TO_CLOSE?
```

Adoption is allowed only when the answer set proves a net reduction in canonical complexity.

---

## 11. Zero-cost rule

BThwani refoundation must not require buying source code or a commercial source license merely to achieve canonical closure.

Default preference order:

```text
1. EXISTING_BTHWANI_CODE_IF_CANONICAL
2. NATIVE_REFOUNDATION_IN_EXISTING_STACK
3. PERMISSIVE_FREE_OSS_COMPONENT
4. LOCAL_SIMULATOR / SELF_HOSTED_FREE_TOOL
5. FREE_EXTERNAL_SANDBOX WHEN USEFUL
6. COMPLEX_COPYLEFT_REFERENCE_ONLY
7. PAID_SOURCE_OR_REQUIRED_PAID_SAAS = NOT_A_DEFAULT_CLOSURE_DEPENDENCY
```

Free-tier availability is operational convenience, not architectural truth.

---

## 12. License handling

Before direct code reuse or dependency adoption:

```text
FETCH_CURRENT_LICENSE
→ VERIFY_EXACT_REPOSITORY
→ VERIFY_EXACT_COMPONENT
→ VERIFY_EXACT_VERSION/TAG
→ CHECK_NOTICE/ATTRIBUTION_REQUIREMENTS
→ CHECK_COPYLEFT/SOURCE_DISTRIBUTION_IMPLICATIONS
→ RECORD_DECISION_IN_NORMAL_DEPENDENCY_REVIEW_EVIDENCE
```

Default engineering policy:

```text
MIT / BSD / Apache-2.0
→ easiest direct-candidate class, still verify

MPL
→ conditional; inspect file-level obligations

GPL / AGPL / strong copyleft
→ reference-only by default unless explicitly approved after license review

mixed / open-core / commercial add-ons
→ reference-only by default; verify component boundaries before use

unknown / no license
→ no code reuse
```

This is an engineering risk policy, not legal advice.

---

## 13. Provider and SaaS rule

External providers must remain adapters behind semantic ports.

Examples:

```text
DSH
→ Geocoder
→ RoutePlanner

WLT
→ PaymentGateway
→ PayoutRail

Identity / Notification owner
→ SmsSender
→ EmailSender
→ PushSender

Media owner
→ ObjectStorage
```

Forbidden:

```text
GenericProvider.execute(...)
ProviderManager as a business god service
Vendor-specific domain models
Vendor-specific business truth
Provider credentials as general business records
Blind financial fallback
```

Development may use real sandboxes/free tiers where practical, but Level-4 closure must have a reproducible path that does not depend on buying access to a SaaS provider.

---

## 14. Mapping external knowledge to BThwani owners

```text
MARKETPLACE / SELLER / STORE / CATALOG / ORDER
→ DSH semantic capability owner

CHECKOUT ORCHESTRATION
→ DSH Checkout

PAYMENT / LEDGER / REFUND / COMMISSION / SETTLEMENT / PAYOUT / RECONCILIATION
→ WLT

AUTHENTICATION / SESSION / ACTOR / SECURITY-SENSITIVE AUTHORIZATION
→ Identity

PERSON / ENGAGEMENT / EMPLOYEE / OPERATIONAL WORKFORCE STATE
→ Workforce

ROUTE / APP SHELL / NAVIGATION / DEEP LINKS / NATIVE INTEGRATION
→ apps/*

DESIGN PRIMITIVES
→ proven design-system package

EXTERNAL REQUEST EXECUTION
→ adapter under the domain/service that understands the operation

CROSS-SERVICE WIRE LAW
→ sovereign service contract / proven root protocol owner
```

External project directory names must never determine BThwani ownership.

---

## 18. Testing/reference oracle law

External projects are valuable as adversarial test oracles.

A missing external scenario should become a BThwani test only when the scenario is materially applicable to BThwani.

High-value test families:

```text
DOUBLE_SUBMIT
DUPLICATE_WEBHOOK
OUT_OF_ORDER_WEBHOOK
TIMEOUT_WITH_UNKNOWN_REMOTE_RESULT
RETRY_AFTER_UNKNOWN
CONCURRENT_BALANCE_MUTATION
REFUND_AFTER_PARTIAL_FULFILLMENT
REVERSAL_AFTER_FAILURE
SETTLEMENT_VS_PAYOUT_SEPARATION
CAPTAIN_OFFLINE/RECONNECT
STALE_GPS
PARTNER_SUSPENDED_DURING_ACTIVE_ORDER
CATALOG_MUTATION_WITHOUT_AUTHORITY
MIGRATION_FROM_OLD_SCHEMA
REAL_POSTGRES_READBACK
CONTRACT_GENERATION_REPRODUCIBILITY
```

---

## 20. Explicit prohibitions

```text
DO_NOT_COPY_AN_EXTERNAL_ARCHITECTURE_WHOLESALE
DO_NOT_CHANGE_LANGUAGE_TO_MATCH_A_REFERENCE_PROJECT
DO_NOT_CHANGE_DATABASE_TO_MATCH_A_REFERENCE_PROJECT
DO_NOT_CREATE_A_GENERIC_PROVIDERS_SERVICE
DO_NOT_CREATE_A_GENERIC_SHARED_DUMP
DO_NOT_ADD_A_BROKER_WITHOUT_A_PROVEN_ROOT
DO_NOT_ADD_SQLC/PGX/TESTCONTAINERS/OAPI_CODEGEN_ONLY_FOR_MODERNIZATION
DO_NOT_ADD_TWO_TOOLS_FOR_THE_SAME_GENERATION/AUTHORITY_ROLE
DO_NOT_IMPORT_COPYLEFT_CODE_WITHOUT_REVIEW
DO_NOT_ASSUME_GITHUB_PUBLIC == PERMISSIVE_LICENSE
DO_NOT_ASSUME_FREE_TIER == DURABLE_FREE_ARCHITECTURE
DO_NOT_MAKE_EXTERNAL_PROJECTS_CANONICAL_BTHWANI_AUTHORITIES
DO_NOT_PRESERVE_A_LOSER_JUST_TO_MATCH_AN_EXTERNAL_PATTERN
DO_NOT_TURN_THIS_FILE_INTO_A_PROGRESS_LEDGER
DO_NOT_PIN_LIVE_h_STATE_IN_THIS_FILE
```

---

## 21. Decision rule

For every external idea/component:

```text
IF BTHWANI_ALREADY_HAS_CORRECT_CANONICAL_TRUTH
→ KEEP BTHWANI

IF BTHWANI_HAS_REQUIRED_TRUTH_BUT_IMPLEMENTATION_IS_DEFECTIVE
→ REFOUND_BTHWANI

IF REQUIRED_LOGIC_IS_MISSING
→ IMPLEMENT_IT_IN_THE_CANONICAL_BTHWANI_OWNER

IF A_SMALL_FREE_COMPONENT_REMOVES_MATERIAL_GENERIC_PLUMBING
AND LICENSE/MAINTENANCE/OPERATIONS/OWNERSHIP_GATES_PASS
→ ADOPT_BEHIND_THE_CORRECT_BOUNDARY

IF A_WHOLE_EXTERNAL_PLATFORM_REQUIRES_STACK/DOMAIN_REPLACEMENT
→ REFERENCE_ONLY BY DEFAULT
```

---

## 22. Final principle

```text
OPEN_SOURCE_IS_AN_ACCELERATOR_AND_ADVERSARIAL_REFERENCE
NOT_THE_NEW_BTHWANI_ARCHITECTURE
```

BThwani keeps its product truth, languages, bounded contexts, deployment identities, and canonical ownership.

External projects are used to:

```text
FIND_WHAT_WE_MISSED
PROVE_WHAT_WE_IMPLEMENTED_WEAKLY
BORROW_MATURE_INVARIANTS
BORROW_EDGE_CASES
BORROW_TEST_IDEAS
ADOPT_SMALL_GENERIC_COMPONENTS_WHEN_PROVEN
```

The objective is faster and more complete Level-4 refoundation with **less** custom accidental complexity, not replacement of BThwani with someone else’s platform.


## Reference files

- `commerce-fulfillment.md` — commerce, marketplace, delivery, maps, search, ERP/support/promotions plus detailed marketplace/logistics references.
- `finance-payments.md` — payment rails, wallet/ledger/accounting, fraud and financial comparison checklist.
- `identity-platform.md` — identity, authorization, notifications, workforce, feature/configuration and secrets references.
- `engineering-infrastructure.md` — workflows, observability, storage, API/contracts, integration testing and Go/PostgreSQL engineering candidates.

Named AI/model routing is intentionally excluded: model names are transient and do not belong in durable reference policy.

```text
REFERENCE_SELECTION != ADOPTION_SELECTION
DONOR_VALUE != DONOR_AUTHORITY
REFERENCE_ONLY_BY_DEFAULT
STOP_RESEARCH_WHEN_THE_MATERIAL_QUESTION_IS_RESOLVED
```
