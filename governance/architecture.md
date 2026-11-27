# BThwani — Ownership, Policy-Driven Operations and Integration Law

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/architecture.md
STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
IMPLEMENTATION_STATE_AUTHORITY: NONE

## One author, one engine, one effective truth

Each business fact has one semantic owner, one authorized writer and one authoritative readback. Presentation, integration, cache and reporting are not alternative authorities.

| Owner | Exclusive facts and operations |
| --- | --- |
| Identity | Actor identifiers, admission, authentication, sessions, platform permissions and their revocation |
| DSH | Store relation, publication, availability, catalog, Offer, authoritative quote/price, cart, Order, serviceability, dispatch, fulfillment, operational policy and bounded employment |
| WLT | Accepted commercial agreements, fees, collector liabilities, wallet, immutable ledger, COD exposure, payouts and settlement |

DSH owns bounded HR; Identity owns credentials and platform authority; DSH Store grants determine Store scope; WLT alone records financial effects. Company and Merchant employment are isolated. No fourth service or parallel HR engine follows from this capability.

The single Operator Policies experience composes owner-backed controls. It never becomes an independent rule engine, settings database, price calculator or synchronization writer.

## Policy-driven architecture — authoritative distinction

An authorized recurring commercial or operational choice shall be owner-configurable without source deployment. This includes supported Store relations, fulfillment modes, delivery price, fees, collection and settlement choices. A configurability requirement is not authorization to invent a generic rule system.

Distinguish four facts:

1. Definition: bounded owner contract, permitted values and scope.
2. Effective policy: versioned decision, approved global default, then authorized relation/city/business scope, then explicit Store exception as applicable. An absent or invalid policy must not create an imagined fallback.
3. Accepted WLT Store agreement and DSH publication/eligibility: separate constraints that may be stricter than general policy.
4. Confirmed transaction snapshot: agreed price, payment allocation, relevant policy versions and obligations frozen for that transaction. Later policy edits never retroactively rewrite it.

Each owner implements its own typed semantics. The architecture does not prescribe a generic policy table, interpreter, duplicate settings store or per-domain configuration service. See [engineering admission](engineering.md#policy-implementation--changeable-parameter-discovery-and-validation-boundary).

## Safe change protocol

A policy mutation follows current Identity authentication and owner authorization → validation of scope, permitted values, operational/legal readiness, active agreements and expected version → atomic, attributed, reasoned and idempotent owner write with effective date and audit → durable owner readback → application by the next eligible operation.

Concurrent incompatible writes cannot both succeed. An uncertain response requires reconciliation by operation identity and owner readback before a retry that could create another effect. Rollback creates a new authorized version; prior accepted agreements, confirmed transactions and audit history remain intact. Startup and seed must never overwrite an effective accepted policy; an initial default is installed only through the authorized owner lifecycle.

Security, tenant isolation, consent, monetary conservation and retained rights are nonconfigurable invariants. Direct platform-Captain service, wallet, subscription or externally collected Direct payment may be enabled only after the actual complete owner flow is lawful, authorized and proven. UI selection or a policy row cannot establish readiness. Apply [safety](safety.md#policy-mutation-protections) for negative security evidence.

## Store model and transport

A Merchant may have several Stores; DSH owns MARKETPLACE/DIRECT relation, the single Order engine, eligibility, serviceability and fulfillment. WLT owns COMMISSION/SUBSCRIPTION terms, agreed collector and financial obligations. DSH fulfillment selection is constrained by Store, Captain, geography, checkout, finance and safety. Publication, listing, public Web presence, wallet and cash are distinct facts, not implied grants. See [Store](stores.md), [commerce](commerce.md), [fulfillment](fulfillment.md) and [finance](finance.md) for their exact domain semantics.

Media, notification and transport providers are adapters, not business authorities. A new mechanism, service, database, event bus or package requires demonstrated distinct necessity; vendor integration or Store relation alone is not such a need.

## Cross-owner consistency and boundaries

- Never use another owner's database as an integration interface. A justified, bounded, explicitly owned read projection may consume authorized owner facts but never write them.
- Every owner validates the current actor, Store scope, agreement, availability, expected version and other applicable invariants at its actual operation. Authoritative checkout price/eligibility is revalidated; neither client preview nor historical read grants a future write.
- Identifiers retain their fact type, owner and historical meaning. New relations are distinct facts, not repurposed identifiers. A necessary identity or contract migration must be explicitly versioned, reviewed, compatible and preserve historical references and rights.
- DDD, Clean/Hexagonal architecture and SOLID are design aids, not reasons to manufacture layers. Use the simplest native mechanism that fulfills the real contract and failure semantics.

## Untrusted input and bounded handoff — retained source law

All input, including authenticated transport, caller-supplied actor/Store identifiers, external provider payloads and AI output, is untrusted for business authority. Parse, validate, normalize, authorize and execute the domain transition at the actual owner. A recipient is a purpose-limited DSH Order contact snapshot, never a new purchasing account or payment principal.

An originating owner commits its lawful transition and a durable stable handoff identity. The receiving owner validates its own authority, performs its own idempotent transition and exposes durable readback. Timeouts, missing acknowledgments and partial effects are reconciled before retrying; no duplicate Order, credit, cash liability, entitlement or assignment. No consumer or cache may declare success for a missing owner effect. See [failure contract](safety.md#failure-contract-cross-owner-degraded-state-and-evidence).

## Search, reporting and analytics are authorized projections, not competing writers

Search, reporting, aggregation and intelligence consume authorized owner facts; underlying queries, filters and complete counts are owner-backed or explicitly bounded derived reads. Cross-owner reports combine lawful versioned readbacks and show lag or uncertainty rather than inventing a consistent instant. WLT alone closes financial periods and settlements. Operator UI owns presentation and may deep-link only to an actually authorized record. Exports, thumbnails, contact search and activity feeds never widen source permissions, disclose private identifiers through URLs or logs, or fabricate historical events.

No automatic analytics SDK, warehouse, global search, always-on socket, custom cache or AI provider follows from a historical requirements pack. Establish distinct need, privacy, latency, recoverability and measurable outcome before adoption.

### Measurement integrity and intelligence admission

Prefer the actual committed owner record and operation identity. Capture a separate observation (for example search attempt, impression or click) only when necessary. Define producer, purpose, schema/version, stable event identity, occurrence and receipt time, permitted scope/fields, retry/deduplication, retention, deletion and recovery. Detect missing, duplicate and late evidence; isolate synthetic data. Optional measurement failure cannot silently prevent lawful commerce or turn failure into reported success.

Each material metric has one versioned definition: sources, event/status qualification, distinct counting unit (parent versus Store Order), period/timezone, city/Store/actor scope, population, numerator/denominator, exclusions, units, completeness and freshness. Never compare a loaded page with full-population counts. Distinguish zero, unknown, unavailable, unobserved, partial, stale and not applicable; an unknown or zero denominator is not zero-percent performance. Prove reproducibility from actual owner facts, isolation, deduplication, correction and recovery. Rebuilding a projection cannot rewrite Order, inventory or ledger history.

Minimize PII, precise location, raw search terms, direct identifiers and confidential peer costs; identifiable cross-Merchant data is not a public metric. Collection of sensitive observations requires documented purpose, lawful access, retention and deletion. Suppress small-cohort disclosure when needed.

Progress from factual reads and deterministic diagnostics to recommendations, prediction and automation only when the capability warrants it. A recommendation states scope, source/as-of time, reason, limits, proposed action and accountable owner. Distinguish observation, estimate, forecast and achieved result. Prediction/optimization requires a defined outcome, adequate representative data, uncertainty, separated evaluation data and comparison with a simpler baseline; test cold-start, drift, error cost and affected groups. If proof is insufficient, expose the limitation or use a safe supported deterministic behavior. No universal data threshold or mandatory model stack.

AI output is advice, not authority, consent or a transaction. Any consequential price, inventory, purchase, financial, permission or customer-facing effect requires the actual owner action authority, validation, version, idempotency and durable readback. Automatic actions require express bounded admission, deterministic policy, audit, stop/recovery and negative tests. Verify provider/data boundaries, malicious input, tool misuse, unsupported output, timeout and fallback; evaluate material model/prompt/tool changes with existing actual outcome tests. No parallel business or engineering workflow.

## Acceptance boundary

This architecture defines owner law, not proof of deployed SQL, APIs, Direct commerce, routing or subscription readiness. Acceptance requires applicable owner tests, negative authorization and durable effects under [engineering](engineering.md) and [safety](safety.md). No external reviewer staffing requirement substitutes for evidence or blocks authorized development merely by absence.
