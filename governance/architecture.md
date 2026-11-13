# BThwani — Ownership, Policy-Driven Operations and Integration Law

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/architecture.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
IMPLEMENTATION_STATE_AUTHORITY: NONE

## One author, one engine, one effective truth
Each changing business fact has **one semantic owner, one authorized writer and one reliable owner-backed readback**. Each core function has **one canonical engine**; a separate Store relation, URL, screen, team or SQL table name is not justification for a duplicate.

| Owner | Exclusive business truths | Not permitted to delegate to the UI |
| --- | --- | --- |
| Identity | actor identifiers, sessions, admission, authentication and platform permissions | authorization assertion / root credential semantics |
| DSH | Store, relation, publication, catalog, Offer, authoritative quote and price, cart, Order, serviceability, dispatch, fulfillment, operational policy, bounded employee records and assignments | Order writer, Store ownership, publication, employee authorization bypass or entitlement engine |
| WLT | Store financial agreements, policy-controlled fees, collector liabilities, wallets, immutable ledger, COD exposure, payouts and settlement | money writer, balances and agreement acceptance |

The single bounded `employees` administration engine for BThwani company and Merchant employees is a **logical capability inside DSH**, not a fourth service or a second HR engine. `governance/hr.md` owns its approved employment semantics; DSH owns the implementation and persisted employment facts, Identity owns actor credentials/platform permissions, DSH Store-grant rules own Store access, and WLT owns any actual financial postings. Employment never grants a role automatically. Separate organizational scoping prevents one Merchant from reading another Merchant's or company personnel records.

The Operator Policies area is **one management UX** that composes owner-backed controls. It never owns a business policy store, deploys a generic policy server, evaluates authoritative prices on the client, or creates a synchronizer that rewrites DSH/WLT.

## Policy-driven architecture — authoritative distinction
A commercial or operational choice that an authorized Operator legitimately changes over time is governed through the **existing owning service**. Examples: Store relation availability, eligible fulfillment modes, delivery prices, commercial fee defaults, collector responsibility and settlement periods. The requirement is **no code deployment for a supported policy value change** — not arbitrary runtime code execution, and not unconditional activation of features that have not passed acceptance.

Separate four things:
1. **Policy definition and permitted values**: one bounded contract owned by the relevant service and constrained by immutable security, accounting and legal invariants.
2. **Effective owner-backed policy**: a versioned, auditable record scoped no more broadly than necessary. Precedence is approved global default → relation / city / business scope as applicable → explicitly authorized Store exception, with no imaginary fallback when no valid policy exists.
3. **Store-specific legal/financial agreement and publication**: immutable accepted WLT agreement version and DSH publication/eligibility decisions that may be stricter than an Operator's default.
4. **Confirmed transaction snapshot**: the effective policy/agreement facts, price and payment allocation frozen at Order confirmation; subsequent policy edits cannot retroactively change them.

A simple four-choice presentation does not imply a four-dimensional generic policy table. Each owner defines its **own** named setting and validator; no shared rule interpreter, shadow cache writer or second policy engine. A UI policy group is navigation, not a semantic owner.

## Safe change protocol
For any policy write: authenticated authorized Operator → owner validates scope, permitted values, feature readiness, affected active agreements and request version → atomic write with idempotency/attribution and effective date → durable owner readback → next eligible operation evaluates the new effective version. When outcome is uncertain after network failure, read owner state and never blindly retry with a fresh idempotency identity.

A safe rollback is a new attributable, effective version. Do not erase versions, rewrite previous Order/contract facts, or reset policies on service restart. A fresh isolated bootstrap may install initial defaults once via the owner's reviewed migration/seed, but a mutable deployed default lives in the owner database, not in compiled UI branches.

**Policy changeability is not an override of integrity:** permission checks, money conservation, Store-scoped identity, privacy and legal consent cannot become optional toggles. Subscription, externally collected Direct payment, wallet or platform Captain for a Direct Store are only selectable if the complete real owner-backed flow is implemented, legally admitted, and proof-gated.

## Store model and transport
One Merchant may manage multiple Stores. Every Store has one DSH Store identity and one relation (`MARKETPLACE` / `DIRECT`). WLT independently assigns `COMMISSION` / `SUBSCRIPTION` and collector obligations through accepted agreement and controlled effective policy. DSH selects one of the admitted fulfillment modes if Store, Captain, geographic, checkout, financial and safety gates allow it. Direct and marketplace orders enter the **same** DSH Order engine. Store publication/eligibility, listing placement, public web presentation, wallet and cash settlement are separate facts and require separate checks.

No new database, service, package or event bus is approved merely by this charter. Media/notification providers are technical adapters; their private assets and delivery receipts are derived from owner fact, never authoritative business state.

## Cross-owner consistency and boundaries
- A consumer does not query another owner's tables as a legal alternate API. A bounded read projection may be necessary if explicitly owned and reconstructed, but must not write the producer fact.
- Each mutation verifies the current authenticated actor, Store scope, legal agreement, availability and transaction version at the owner. A server-validated quote is recomputed or checked at checkout confirmation.
- Identity/DSH/WLT need explicit contracts for unknown outcomes, stable idempotency identities, timeouts and reconciliation across service boundaries. An HTTP 200 is not a verified ledger or published Order.
- Store identity retains historical meaning; relations and labels may evolve through versioned migration, never silent ID reinterpretation.
- The simplest correctly owned, tested implementation wins. DDD, Clean/Hexagonal, ports/adapters and SOLID are design tools, not mandates to add layers, wrappers or folders.

## Untrusted input and bounded handoff — retained source law

Every Owner treats UI payloads, generated DTOs, other-service data and authenticated requests as **untrusted for business authority** until it performs `PARSE → VALIDATE → NORMALIZE → AUTHORIZE → DOMAIN TRANSITION` at the actual mutation/read boundary. Schema/type correctness, trusted transport, a caller-authored Actor/Store ID or BFF menu filtering do not establish object-level authorization. Canonical Actor identifiers remain Identity-owned; a recipient contact in an Order is a purpose-limited DSH snapshot, never a second account or cross-service person identifier.

For an effect crossing Identity/DSH/WLT, the originating Owner commits its own lawful transition and a durable, **stable logical handoff identity**; the receiving Owner validates its own authority, applies an idempotent transition and exposes canonical readback. Unknown/partial outcomes reconcile before another attempt that could duplicate Orders, credits, cash liabilities or entitlements. Adapters for media, notification and external payment transport cannot grant business authority. Technical domains, caches and projections may scale reads but never introduce a second canonical writer. A new mechanism is only considered after proving that direct use of the existing Owner cannot express the distinct responsibility; named architectural patterns impose no automatic layer count.

## Acceptance boundary
This charter prescribes the **target** architecture; it does not claim current SQL, APIs, subscriptions, Direct checkout or routing support it yet. Implementation readiness requires evidence for affected consumers, single writer, permissions, persisted state, negative tests and the documented internal critical-risk assurance adopted by the human Product owner on 2026-11-13; no external reviewer signature is represented or required merely to select target policy. See `engineering.md` for gates and `docs/REFOUNDATION-PLAN.md` for temporary sequencing.


## Search, reporting and analytics are authorized projections, not competing writers

Operator counts, notifications, dashboards, reports, filtered search and cohort/funnel views are **read-only derived projections** of the legal Identity, DSH or WLT owner facts. An aggregation must identify its canonical owner/sources, event/status semantics, time basis and timezone, authorized city/Store/actor scope, exact currency/amount units, qualifying numerator/denominator, filter completeness and freshness/error state. A total from an entire dataset cannot be silently compared with a count computed from one loaded page. Sorting/filtering/pagination of growing collections is evaluated by the proper owner or an explicitly admitted scoped read projection, **never** by inventing parallel financial or Order authority.

One cross-owner report may compose lawful, versioned owner readbacks when a real user need justifies it, but must display uncertainty or lag instead of inventing consistent-at-one-instant money/Order totals. Financial period closure and settlement remain WLT facts. No analytics SDK, AI interpretation, new data warehouse, global-search service, always-on WebSocket or custom cache is automatically admitted by an old Control Panel requirements pack; evaluate necessity, privacy, latency and evidence during the affected implementation slice.

The Operator UI owns metric **presentation**, not underlying commercial definitions. A valid dashboard can expose actionable exceptions and deep links only to currently authorized exact records. Exports, cached thumbnails, contact search and activity feeds cannot broaden source permissions, log private PII in URLs or backfill data as though historical real events occurred.
