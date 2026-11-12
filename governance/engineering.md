# BThwani — Engineering, Policy Admission and Refoundation Quality

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/engineering.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Staged work and authority
**Current program sequence is mandatory:** (1) finish and reconcile root `governance/`, `AGENTS.md`, `REPOSITORY-STRUCTURE.md`, temporary `docs/REFOUNDATION-PLAN.md`, and stage-appropriate `.github/` guards; (2) review and approve a coherent **governance cutover**; (3) only then create the agreed new **Product implementation** baseline, SQL, apps and services, then (4) accept end-to-end evidence. The separately authorized, **tool-only and exact-version-preserving** pnpm/TypeScript/Biome workspace foundation may be prepared before cutover: it cannot implement Product rules, add apps/services, modify SQL, or establish financial, security or migration readiness.

An in-scope governance phase does **not** authorize touching protected DBs, Docker, branch 41, source production deployments, signing, remote pushes or deleting applied migrations. No PASS for code correctness follows from passing a governance syntax check. Plans and archived ZIP prompts are evidence, not policy sources.

## Policy admission rule: configure the real choice, not every constant
For each recurring, legitimately Operator-editable Product rule at its actual owner, classify:
- **ADD NOW:** current operational need, bounded approved values and scope, one owner writer, safe authority and real server enforcement; add a policy control in the existing Operator Policies UX when service and contracts exist.
- **DEFER:** possible future useful setting but no actual admitted implementation, contract, safe validation or reason to expose it today; preserve one owner-side extension point but no inactive pretend switch.
- **DO NOT ADD:** identity/security/ledger invariants, ordinary merchant/reference/catalog records, personal preferences, internal service implementation constants, or matters not lawfully changeable by an Operator.

No generic rule engine, global JSON decision dictionary, parallel policies database, wrapper services or second set of client defaults. Control Panel groups are navigation only and may grow as needed.

**One safe update contract:** owner-backed read → authorized mutation with expected version, scope, effective date, attribution, reason and idempotency → owner persisted readback → verification against the next eligible business flow. Unknown POST outcomes require readback before retry; rollback is a new effective version. Config startup must not overwrite an Operator-approved active value.

**Precedence:** published approved global default → applicable relation/city/type policy as needed → explicitly supported Store-specific exception → accepted, effective Store-specific WLT agreement for financial obligations. No fallback when policy is missing or ambiguous unless an explicit safe service-owned default is approved and verifiable. No change to confirmed Order/fee history.

Do not let a configurable setting override security, customer consent, immutable ledger, publication or dispatch admission. A policy can safely disable a supported capability, but enabling a different unsupported payment/fulfillment combination needs code and tests first.

## SQL and service refoundation — later phase, strict evidence now
- Derive each database owner schema from accepted meanings and invariants, not a blind copy of old SQL or old file tree. Read every applicable migration and validate which facts/data constraints are needed, obsolete or duplicate.
- Build one canonical fresh baseline **per service owner** and a separately verified upgrade/migration story for any protected legacy DB. Applied histories and real funds, users, sessions, orders and media may not be dropped or modified for tidiness. Prove fresh, upgraded, rollback/restore isolated, indexes, constraints, RLS/roles, owned writers, encoding, financial conservation and authorization.
- Preserve valid code/API contracts/tests/operations from donor through a source-driven slice census: KEEP / MOVE / MERGE / REFOUND / REPLACE / APPROVED_RETIRE / UNRESOLVED. Track material subfeatures (privacy-safe Captain opportunity map, storefront deep links, notifications, media, video, catalog imports, financial reports, conversations, promotions, multi-Store access, bounded support and recovery) as well as the 26 Product capability IDs.
- No permanently parallel relation-specific Store, catalog, cart, Order, price, settlement, media or permission engines; temporary migration coexistence needs a documented, tested exit. Do not delete old functionality until consumers/readback are proven and old state is safely transitioned.

## Existing platform/design foundations
- Keep and reconcile the existing Expo React Native / Tamagui design foundation for Customer, Merchant and Captain; a single semantic brand/token source shared only through proven multi-consumer packages. Root Arabic RTL, light/dark, accessible error recovery and low-click Store workflows. Rebuild visually and functionally when needed without duplicating theme/presentation state.
- Operator Control Panel stays on its actual Next.js/Ant Design foundation unless separately approved; it consumes the same brand semantics through appropriate adapters. Do not migrate it to Tamagui only for uniform library names.
- Keep provider, location, media, notification, payments and Docker adapters that serve a real current need. Do not install/upgrade additional packages without demonstrated necessity and authorization.
- Preserve issued mobile identifiers, signing, website URLs, link schemes, auth sessions and provider keys; migrations need tested path/consumer cutover and protect secrets.

## Testability, observability and release proof
- Local quality: run the narrowest applicable real owner checks, contracts, encoding and negative regression tests on the actual candidate. A changed SQL owner triggers its financial/storage integration tests, not only SQL format. Use `pnpm check`/the narrow relevant commands once code exists, guided by owner instructions; `pnpm verify` when final wide candidate warrants it.
- Validate from actual Owner readback and, where changed, real browser/Android/affected platform journey. iOS remains NOT_RUN without a genuine iOS run. UI snapshots/mock HTTP success are supplemental, not Owner evidence.
- For finance, login isolation, permissions, SQL migration, cash/COD/Mixed, settlement replay and concurrency, test negative actor/store access, no double debit, ledger conservation and failure recovery. Mandated independent risk review is not replaced by CodeRabbit or syntax green.
- CI: one stage-appropriate Foundation Guard while source-sparse; once code exists restore Fast Guard/Sonar/CodeRabbit via evidence-based changed-path routing, protected checks and explicit test/approval gates. Do not run full-product workflows against nonexistent sources or mark their absence PASS.
- DIL/README/temporary plans never become implementation proof. Bind pass/fail claims to the exact branch, HEAD, environment/runtime revision, affected test outputs and real database migration version.

## Governance readiness acceptance
A complete canonical `governance/` requires: (a) all 14 owner documents with substantive, reviewed decisions; (b) 26 distinct capability IDs exactly once in their legal owning documents; (c) all approved cross-owner policies and critical finance/identity/privacy invariants covered; (d) no competing active `docs/governance/` root, broken references or hidden contradictions; (e) a traceable disposition for material historical donor decisions and preserved external sources; (f) tested positive and negative stage-specific GitHub guards; and (g) independent review where the governance affects finance, security or protected migration.

Until those gates are met, keep `GOVERNANCE_CUTOVER: NOT_READY`. Even when ready, that means **policy-ready to begin code refoundation**, not delivered/production-ready. Avoid false claims of mathematical 100% defect-free correctness.

## Capacity, efficiency and non-speculative infrastructure

Start from the simplest correct **owner-preserving** runtime and locally isolated database/media environment. New shared cache, replica, stream/broker, schema partition, external search, pooler, orchestrator, service mesh or region is **not** a mandatory refoundation component. Require a measured material workload/recovery need, representative baseline (throughput, concurrency, P50/P95/P99, saturation, lock/query costs, error/retry rate, storage/bandwidth), evidence simpler fixes are inadequate, a unique owner and failure/rollback proof. Prefer correct indexes/queries, bounded server reads, payload reduction, limited fan-out, timeouts and transaction correctness before added machinery.

Any cache/projection/replica is **read-only derived state**, scoped to current Identity authorization, with freshness/invalidation and a rebuild path. Stale replicas/caches never authorize funds, permissions, Order acceptance or transaction completion. Background work uses owner-side durable task identity, bounded retries, idempotency and reconciliation; a queue or global lock service is not automatically needed because asynchronous work exists.

All request-facing replicas remain stateless for **canonical** business state, sessions, media, locks and schedules. A second instance must not split Order assignments, financial credits or user authorization. Add replicas, zones, regions or serverless only after current workload and recovery needs justify them. Recovery needs a real restore drill with recorded RPO/RTO, not the mere existence of a backup or green container health.

## External financial rails by environment

**Local:** WLT may use an explicitly isolated development-only Cash-In simulator to prove internal Customer/Captain funding, payment splits and failure/retry behavior against a real **synthetic owner-backed ledger**. This proves internal WLT code, not live external transfers.

**Stage:** External rails remain disabled until an approved provider contract/sandbox, authenticated callbacks, correlation, unknown-outcome handling and reconciliation are actually verified. Never point Stage at the local simulator or turn on real credits from mock callbacks.

**Production:** Provider funding, refunds, transfers or payout APIs are **not** enabled by a policy toggle, brand label or successful UI test. They require explicit provider permission, signed contract and real end-to-end financial/security acceptance. A separately authorized COD-only release may leave Cash-In disabled. Live electronic Cash-In must never be credited by a dev-only mock. Providers supply technical rails only; WLT remains authoritative for every internal balance and ledger entry.

## Evidence provenance and reference adoption

Use current source/contracts/runtime for implemented facts and relevant official primary technology sources for mutable versions. Donor archives, competitor observations and OSS links can reveal patterns, but are neither Product decisions nor permission to copy proprietary design/code. Choose ADOPT, DEFER or REJECT for a **concrete** opportunity after evaluating maturity, security/license, compatibility, operational cost, rollback and BThwani-specific proof. No permanent technology radar, vendor catalog or research backlog is required by governance.

## Mandatory operator-policy inventory at implementation time

For every changeable domain parameter discovered in branch-41 code, SQL, configuration, UI or historic operational manual, the legal owner must classify it as (a) **CONFIGURABLE_APPROVED** with a single owner-backed policy and one Operator Policies control, (b) **SAFETY_INVARIANT** with an unchangeable verified enforcement rule, or (c) **FUTURE_UNIMPLEMENTED** which remains unavailable until admission. A temporary plan may inventory each parameter; no second policy catalog or shadow writer is created.

Representative CONFIGURABLE_APPROVED candidates: service radius (historical 30 km), distance/price bands, dispatch radius and offer count, timeout/ETA escalation, Store admission and publication eligibility, registration relation options, fulfillment-mode eligibility, Order/cancellation limits and compensation ceilings, commission/subscription values, COD activation/coverage parameters, transfer/settlement limits, catalog import/video thresholds and promotion boundaries. The exact list and admissible ranges must be proven during each affected Owner implementation slice, not guessed from constant names.

An Operator Policies edit must be followed by an owner readback and an eligible real business path confirming the version. Missing/unsupported values reject safely. Immutable security/financial/consent guarantees may not be configured off. No speculative generic policy VM, additional service, duplicated rules table or client-side truth is justified by this inventory.

## API-01 — OpenAPI organization and semantic-equivalence gate

**Decision:** one legally owned `OpenAPI 3.1` entry document per service under that owner's `services/<owner>/contracts/openapi/`. The index should remain small and describe API metadata, auth, tags and scoped Path Item references; group operations in **flat `paths/*.yaml` by cohesive actual domain** (not a directory per endpoint). Reuse the existing donor layout where already adequate; do **not** split 23 functioning DSH path files or create empty Identity/WLT folders merely to match an aesthetic diagram. Shared schemas/parameters/responses live in the smallest **single** compatible owner location (index components unless a tested shared components file is genuinely needed). Each operation has one `operationId`, one effective method/path, one schema meaning and one authorization contract.

**Contract preservation on reorganization:** freeze before/after bundled and normalized contract snapshots and compare all `paths`/`methods`/`operationId`, security schemes/scopes, path/query/header parameters, request/response/status/error schemas, version semantics, pagination, idempotency and validation constraints. Validate references/JSON Pointers against the **exact pinned** existing bundler/lint/generator versions. Existing Go/TypeScript clients and Next BFF must regenerate from **the one** legal source without hand-editing derived clients. Breaking business changes must be separated from file moves, owner-reviewed and independently verified where they affect identity, order authorization or money. Neither the OpenAPI index nor generated clients implement commercial policy.

**Acceptance later, not now:** consumer inventory, contract diff, resolvable references, reproducible generated clients, owner API negative/positive integration proof and exact SHA before deleting old files. Contract implementation and actual refactor are **NOT_RUN** in the current governance phase.

## SQL-01 — Safe one-baseline-per-owner fresh bootstrap, protected upgrades

**Decision:** target **one derived Fresh Baseline for each of Identity, DSH and WLT** solely for a **new empty database**. The donor inventories **182 DSH + 30 Identity + 63 WLT = 275** historical SQL migrations, plus an existing WLT `fresh-baseline.sql` and its builder. Three Baseline entrypoints are **not** a three-file limit for the repository: old upgrades and new migrations may remain required. Never drop, squash, renumber, rewrite checksums or falsely mark history applied in a previously initialized database.

The owner-controlled **versioned migration series and real applied history** remain legal upgrade truth; the Fresh Baseline is a *reproducible derived artifact* of the reviewed final schema, with one defined epoch/starting version and explicit transition for databases that began on the older history. Prove fresh baseline installs produce the equivalent logical tables, constraints, indexes, functions, triggers, permissions, required reference data, schema owner isolation and platform behavior as an isolated correctly upgraded database. Disclose intentional dropped obsolete schema separately; do not copy retired independent-direct-order engines or truncate historic media merely because donor SQL once did.

**Technical impact:** branch-41 DSH's Go loader uses `go:embed migrations/*.sql` and its own schema version `182`; moving SQL to a target `database/migrations/` path **requires** changing the loader, embedded path, packaging, tests and deployed upgrade compatibility together. If that migration changes nothing useful, retain the existing load path. Existing WLT baseline builder is a source to evaluate and reuse, not to duplicate three times. A new migration epoch must be distinguishable from historical `001...` and cannot invent a clean applied history in live data.

**Before any protected migration/deletion:** secure authorization, independent finance/security/database review, isolated copy with verified backup/restore, mapping of historical Root Owner, actor/session/permission, Store/Order, media references, exact integer YER WLT balances and ledgers, cash COD custody, accepted agreements and payable liabilities. Test concurrent idempotency, rejected cross-Store/actor writes, replay/unknown outcome, fresh/upgrade schema parity and constrained failure/rollback. No direct production SQL/fixtures, schema wiping or "100% safe" assertion from document review. Actual PostgreSQL/bootstrap/migration work is **NOT_RUN**.

## POLICY-IMPLEMENTATION — Changeable parameter discovery and validation boundary

For every actual number, fee, timeout, Store gate, algorithm threshold and commercial default discovered in donor SQL/config/UX, classify it with **the existing legal owner** as `CONFIGURABLE_APPROVED`, `SAFETY_INVARIANT`, or `FUTURE_UNIMPLEMENTED`. Each configurable setting must state: exact canonical DSH/WLT owner; scope and precedence; validated range/type/unit and legal/financial constraints; initial effective approved value (or explicitly `UNDECIDED`); actor permission + independent financial approval if needed; version, effective date, audit and idempotency; affected future transactions vs previously frozen agreements/Orders; readback, conflict/unknown-result behavior; service contract/UI readiness state. **No source value is inferred from the date of a file alone.**

No UI toggle may enable unsupported finance rails, unavailable fulfillment, unreviewed customer compensation or bypass owner proof. Defaults are applied once through an owner-approved bootstrap and thereafter versioned as durable owner state. The single Operator Policies UI is a compositional surface only; no new global rules table/DSL/engine and no second policy editor. Each later implementation slice must prove change of an allowed value without source/code deployment and verify rejection of an unauthorized/out-of-range/racing value.
