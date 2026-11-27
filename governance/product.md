# BThwani — Product Admission and Capability Scope

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/product.md
STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Purpose and Product target

BThwani is one multi-role delivery-commerce network for Customer, Merchant, Captain and authorized Operator, initially serving approved cities and business types. Participant admission, Store readiness, catalog, discovery, commerce, fulfillment, finance and bounded collaboration form a directed network of outcomes, not a mandatory global linear implementation sequence. [Platform](platform.md) owns actors/surfaces; [architecture](architecture.md) owns system and writer boundaries; [journeys](journeys.md) owns observable cross-owner scenarios.

A Merchant may own multiple canonical DSH Stores. [Store law](stores.md) governs DIRECT and MARKETPLACE: direct commerce is available only when eligible; marketplace discovery and commerce additionally require MARKETPLACE eligibility. Both use the same canonical Store, catalog, cart, Order and fulfillment engines. Eligible public Store presentation uses the same Customer Expo Web application. A relation change is not a new Store, second commerce engine, additional wallet or new application.

## Minimum complete and evolvable model

Represent every admitted material user and business truth losslessly in the target model, even when implementation is intentionally progressive. A concept is necessary when omitting or collapsing it would obscure its meaning, ownership, lifecycle, authority, contract, commercial or user behavior, failure/recovery or canonical readback, or would require overloaded fields, encoded naming, UI-only semantics, hidden exceptions, duplicated logic or shadow truth. Distinguish legitimate derived projections from authoritative facts under [architecture](architecture.md). An independently meaningful concept need not imply a separate table, service, feature or engine.

Do not silently contradict or reinterpret admitted meaning to fit a narrower implementation. A necessary concept may remain unimplemented outside the current delivery gate; speculative future possibilities alone justify neither concepts nor machinery. For materially costly-to-reverse identity, relation, state, ownership and public-contract decisions, preserve correct semantics and a defensible compatible migration, extension and cutover path. Apply [engineering](engineering.md) and [safety](safety.md) to actual changes. No speculative infrastructure or premature implementation of unadmitted breadth.

## Capability admission set — 26 existing IDs

This is the single admission census. Stable evidence-routing IDs retain historical spellings without preserving obsolete actor names or implementation designs. Each routes once to a substantive domain-owner CAPABILITY_ID section covering behavior, authority, failure/recovery and cross-owner boundaries.

| Canonical semantic owner | Admitted capability IDs |
| --- | --- |
| identity.md | IDENTITY_ACTIVATION_SESSIONS |
| hr.md | EMPLOYEE_HR |
| stores.md | PARTNER_ONBOARDING_STORE_PUBLICATION, STORE_RELATION_MODEL, STORE_OPERATIONAL_AVAILABILITY, STORE_SCOPED_ACCESS_DELEGATION |
| catalog.md | CENTRAL_CATALOG, CUSTOMER_STORE_CATALOG |
| commerce.md | SERVICEABILITY_ADDRESSES, CART_CHECKOUT, MULTI_STORE_CHECKOUT, ORDER_LIFECYCLE, ORDER_CONVERSATION, COMMERCE_PROMOTIONS, DISCOVERY_CONTENT |
| fulfillment.md | STORE_CAPTAIN_MEMBERSHIP, CAPTAIN_DISPATCH, STORE_CAPTAIN_HANDOFF, FINAL_MILE_DELIVERY, CUSTOMER_PICKUP |
| finance.md | STORE_COMMERCIAL_AGREEMENT, ORDER_PAYMENT_COLLECTION, CUSTOMER_BALANCE_FUNDING, CAPTAIN_BALANCE_FUNDING, PARTNER_CAPTAIN_EARNINGS_SETTLEMENT, CUSTOMER_BALANCE_MANUAL_WITHDRAWAL |

## Product invariants

- [Stores](stores.md), [catalog](catalog.md) and [commerce](commerce.md) own distinct relation, publication, operational availability, Offer stock, geographic serviceability and checkout eligibility. One Store Order belongs to exactly one Store even under a parent multi-Store intent. Confirmed transaction snapshots and attributable lawful adjustments remain distinct DSH facts, including actual fulfilled measure when applicable.
- Store relation, COMMISSION/SUBSCRIPTION model, collection responsibility, payment allocation and the three fulfillment types (BThwani Captain, Store-affiliated Captain, Customer Pickup) are independent. [Finance](finance.md) and [fulfillment](fulfillment.md) own their eligibility and transitions. No silent substitution or policy selection creates a missing capability.
- WLT owns money: internal balance, external rail, Customer payment allocation, cash custody, Store obligation and beneficiary settlement are distinct. A subscription entitlement requires actual supported capacity/service, exact accepted terms and Finance approval; it grants no actor role, Store ownership, publication, checkout readiness or payment privilege.
- Merchant is an actor and Store a resource. Store-affiliated Captain membership is not a new Identity role. [HR](hr.md) governs bounded company and Merchant personnel without a generic payroll or automatic Identity authority. A recipient distinct from the purchaser gains no purchasing or payment authority.
- Private Order communication/media, transactional notifications, catalog imports, promotions, bounded operations, Captain opportunities, financial reports, multi-Store Merchant work, secure links and Order-scoped feedback/incident/refund are material subfeatures to reconcile at their substantive owners, not standalone Products.
- Presentation and derived reads are not mutation authority. Success requires actual committed owner readback. Missing admitted breadth is not automatically a defect outside the authorized delivery scope.

## Exclusions and scope change

Current non-goals: standalone loyalty, social reviews/community, generic support/ticketing, advanced route optimization, generic analytics or notification Product, broad customer-profile/privacy orchestration, generic Merchant organization/team beyond bounded Store grants, generic multi-tenant SaaS beyond admitted Store Web hosting, ERP/POS replacement, speculative multi-currency, scheduled Customer Orders, point-to-point courier requests, generic returns/exchanges, electronics warranty claims, paid Customer membership, mandatory daily Store check-in and predictive/numeric Store capacity. Prescription-required or specially regulated pharmacy fulfillment needs explicit legal/operational admission; ordinary lawful pharmacy commerce does not activate it.

Under [progressive admission](README.md#progressive-capability-admission--2026-11-14-human-approval), new proposals may be analyzed, specified and implemented in bounded development without a separate preliminary vote. Actual Product adoption needs demonstrated current need, distinct responsibility not better owned by an existing capability, one owner/writer/readback, actors/surfaces, contracts, authorization, privacy/legal scope, failure/recovery and measurable acceptance. Consequential commercial/legal choices require their actual authority; no implicit binding terms or production activation. Changing a supported configurable default is not a new capability. The original 26 IDs are traceability, not a ceiling.

Archive, competitor and OSS existence are research, not approval. Do not revive retired acquisition/onboarding roles, enrollment surfaces or reward writers. Preserve independently verified binding historical liabilities with their actual owners.

## Progressive commercial intelligence within admitted capabilities

Improve existing actor work through owner-backed catalog quality/history, availability, discovery, Store readiness, content, factual metrics and actionable exceptions while stabilizing Orders, fulfillment and finance. No standalone analytics Product or fourth service. Apply [measurement law](architecture.md#measurement-integrity-and-intelligence-admission). Completed sales, contribution and settlement require qualifying DSH/WLT facts. Forecasting, replenishment, advanced personalization, predictive dispatch, assistants, supplier purchasing and new commercial models require demonstrated need, adequate data, scope and actual acceptance. Independently ready increments need not wait for unrelated work. Hypothetical results do not prove implementation or release.
