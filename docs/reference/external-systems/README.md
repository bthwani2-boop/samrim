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

Then BThwani must implement the required truth inside its canonical owners using BThwani’s existing languages, bounded contexts, contracts, and deployment identities unless the applicable durable Governance dependency/adoption policy independently approves a component.

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

For direct code reuse, dependency, or runtime adoption, direct reuse/adoption is evaluated by the applicable durable Governance architecture, standards, security, runtime, and delivery policies; this reference file supplies evidence only.

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
| Future HR / employee lifecycle reference only | Odoo HR | ERPNext HR | OrangeHRM |
| Support | Zendesk | Intercom | Chatwoot |
| Feature flags / rollout | LaunchDarkly | OpenFeature | Unleash |
| Promotions / loyalty | Shopify | Talon.One | Voucherify |
| Payment fraud/risk | Stripe Radar | Adyen Risk | Sift |
| Object storage | S3 semantics | R2 | MinIO |
| Secrets | Vault | AWS Secrets Manager | SOPS |
| OpenAPI contract | OpenAPI spec | oapi-codegen | Redocly / Pact |
| Design tokens / cross-platform styling | Style Dictionary | current DTCG guidance | platform-specific native/web outputs |
| Web accessibility primitives | Base UI | React Aria | shadcn RTL/composition reference |
| Control Panel UX patterns | Cloudscape | Saleor Dashboard | React Aria/shadcn interaction counterexamples |
| Component workbench | Storybook | native Storybook | rendered app evidence |
| Web visual/accessibility E2E | Playwright | axe-core | manual accessibility/device evidence |
| Mobile UI E2E | Maestro | platform-native/manual device evidence | provider/device specialist tooling |
| Generic icons | Lucide | platform-native symbols where appropriate | bespoke BThwani semantic icon wrapper |
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

## 2. Technology-stack reference boundary

The current technology and bounded-context direction is durable architecture/engineering Governance, not Reference authority.
See `governance/architecture/SYSTEM-CONTEXT.md`, `governance/architecture/REPOSITORY-TOPOLOGY.md`, `governance/policies/architecture-and-fullstack.md`, and `governance/policies/standards-and-quality.md`.

This corpus may compare alternatives and expose weaknesses in the current stack. It cannot approve, forbid, or execute a stack/domain replacement. Any such change must be governed at the durable owners and proven in executable source.

---

## 3. Reference-use classification

Classify external material for research as one of:

```text
REFERENCE_ONLY
BEHAVIORAL_INVARIANT_REFERENCE
TEST_ORACLE_REFERENCE
COMPONENT_CANDIDATE_FOR_GOVERNANCE_REVIEW
```

These labels control how evidence is consumed; they do not authorize dependency/runtime adoption. Direct reuse/adoption is decided only by applicable durable Governance after exact component/version/license/security/maintenance/ownership/operational evidence is reviewed.

---

## 4. Mandatory extraction workflow

Whenever a BThwani root touches an area covered by mature external systems:

```text
PIN_CURRENT_RELEVANT_EVIDENCE
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

## 10. Dependency-adoption policy boundary

This corpus may identify a component candidate and collect comparative evidence. Dependency/runtime adoption authority lives in `governance/policies/standards-and-quality.md`, with architecture, security, runtime, and delivery owners applied as relevant.

Do not duplicate the durable adoption checklist here. Record reference findings, then route the candidate to the canonical Governance review.

---

## 11. Cost evidence boundary

Cost, free-tier availability, and self-hosting feasibility are reference evidence, not architecture policy. Current pricing/trials must be revalidated when material. A paid/free label by itself neither approves nor rejects an architecture; the durable owner evaluates total operational, licensing, security, and replacement cost.

---

## 12. License evidence boundary

Before direct code/dependency reuse, obtain the exact current license/component/version and route it through durable dependency/security/delivery review. This file may record source links and observed license facts, but it does not issue legal approval or permanent license policy.

---

## 13. Provider/SaaS reference boundary

Provider products are compared here only as possible implementations behind BThwani semantic ports. Domain-specific port ownership, secret boundaries, retry/unknown-outcome semantics, and provider adoption rules live in `governance/policies/architecture-and-fullstack.md`, `governance/policies/runtime-reliability.md`, `governance/policies/security.md`, and the owning Product/System model.

A provider name never becomes a BThwani business owner merely because it appears in this corpus.

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

CURRENT CLIENT / PARTNER / CAPTAIN / FIELD OPERATIONAL PARTICIPANT STATE
→ DSH

FUTURE ENTERPRISE HR / EMPLOYEE LIFECYCLE
→ no current owner; requires independent bounded-context admission when concrete requirements exist

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

## 20. Reference prohibitions boundary

This file must remain non-authoritative: do not copy an external architecture wholesale, infer BThwani ownership from an external directory/model, turn reference notes into campaign state, or treat a public repository/free tier as permission for code reuse/adoption.

Normative engineering prohibitions belong to Governance and should be linked rather than duplicated here.

---

## 21. Reference-to-decision handoff

A reference result terminates by mapping evidence to the current BThwani semantic owner and one of: already covered, defective implementation, missing required behavior, not applicable, or component candidate for Governance review.

The actual keep/refound/implement/adopt/reject decision is made by the applicable durable Product/System/architecture/policy owner and then verified in executable source. This file does not decide the architecture.

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
- `identity-platform.md` — identity, authorization, notifications, future HR-reference material, feature/configuration and secrets references.
- `engineering-infrastructure.md` — workflows, observability, storage, API/contracts, integration testing and Go/PostgreSQL engineering candidates.
- `experience-design-ui-assurance.md` — design tokens, web/native UI primitives, RTL/accessibility, Storybook, Playwright/axe, Maestro, icons and Control Panel UX pattern references.
- `../donor-reconstruction-patterns.md` — non-authoritative historical donor path/convergence patterns for forensic reconstruction; never current topology authority.

Named AI/model routing is intentionally excluded: model names are transient and do not belong in durable reference policy.

```text
REFERENCE_SELECTION != ADOPTION_SELECTION
DONOR_VALUE != DONOR_AUTHORITY
REFERENCE_ONLY_BY_DEFAULT
STOP_RESEARCH_WHEN_THE_MATERIAL_QUESTION_IS_RESOLVED
```
