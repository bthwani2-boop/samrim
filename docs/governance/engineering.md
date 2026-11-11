# Engineering and Delivery

ARTIFACT_CLASS: DURABLE_GOVERNANCE
SEMANTIC_OWNER: docs/governance/engineering.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Change and Delivery Policy

- Current user/business outcome drives work order; do not exhaust one surface/domain backlog.
- When materially refounding or extending a technology/tool/platform boundary, evaluate current stable primary-source capabilities that can delete meaningful custom complexity or risk; do not upgrade solely for recency and do not retain an older mechanism solely from inertia.
- Implement the smallest coherent cross-surface vertical slice that proves the earliest unresolved shared boundary, across every materially affected surface and owner. Use end-to-end journeys for integration proof, not as a parallel execution backlog.
- Core-first does not mean speculative foundation first.
- Preserve changeability, not speculative machinery: future capability or scaffolding is not implemented without current need, while materially costly-to-reverse current identities, boundaries, persistent data shapes and external contracts require explicit reversibility/evolution-cost classification and a defensible migration/extension/cutover path for evidence-backed evolution risks.
- Readiness precedes mutation when a decision-critical unknown can change owner, migration, safety or proof.
- A cutover includes all material consumers, migrations/contracts/config/tests/verifiers and deletion of losing paths.
- Temporary compatibility exists only for a proven current coexistence need and must have one owner, known consumers, a bounded lifetime or exit condition, and a deletion trigger. It must not become a second truth/writer or permanent default. Without those conditions, delete it rather than preserve it "just in case".
- Smallest diff is not the goal; simplest complete canonical system is.
- Structural/refoundation cleanup preserves externally registered deployable identity such as app package/bundle IDs, Expo/EAS project identity, URI/deep-link schemes, signing relationships and provider app/client bindings unless changing that identity is itself explicitly authorized.
- A candidate closes only from exact-state evidence with zero known material defect in its authorized cone.
- Current increment closure proves the admitted current outcome; it does not imply capability exhaustion, a permanently final domain model or permanent rejection of future Product breadth that has not yet been examined or admitted.
- Repository mutation authority never implies build distribution, store submission, release, staging or Production authority.

### Refoundation readiness, feature preservation and evidence

Before any material clean-slate batch, map each affected admitted `CAPABILITY_ID` in `product.md` to the actual source producers, public/private consumers, state owner, contracts, tests and runtime dependencies. Enumerate relevant subfeatures even if they are not separately named Product capabilities: privacy-safe Captain opportunity heatmaps, merchant short-form video and its processing/approval, private Order video/audio, multi-Store administration, product import/export, quick pricing, campaigns, media, notifications, financial reports, Store-scoped delegation, public deep links and recovery. This is a **dated implementation-coverage crosswalk**, not another semantic owner or permanent parallel feature registry.

Classify every material observed subfeature as KEEP, REFOUND, MERGE, REPLACE, APPROVED_RETIRE or UNRESOLVED. Do not approve deletion, storage reset or full migration closure while any required feature is missing its target owner, bound consumers, proof and safe disposition. A feature may remain gated/not released but cannot silently disappear from the target. Distinguish existing and working, source-only, mocked, released, partial and not tested; validate privacy, ownership, exact actor and application surface, not merely a screen. Evaluate the actual supported official Expo/React Native module or existing native component before adding custom UI machinery; Tamagui is the existing Expo design component foundation when suitable, while the Control Panel uses its existing Ant Design provider. No parallel token/theme, Studio engine or platform-specific catalogue may arise from a design migration.

Refoundation readiness is a **start gate**, not a claim the rebuilt system is done: authorized exact worktree/HEAD and ownership, protected concurrent edits, canonical decisions reconciled, known feature preservation/proof paths, safe isolated runtime and data boundaries, and one bounded first slice. Product end-to-end PASS comes later from real devices/browser/services, owner-backed state, negative/security, financial and recovery evidence as applicable. Capture truthful PASS/FAIL/BLOCKED/NOT_RUN/INVALIDATED per affected claim; never claim universal 100% safety or quality without impossible exhaustive evidence.

### Structural cleanup within refoundation slices

Every affected implementation slice must apply the placement and naming contract in `REPOSITORY-STRUCTURE.md` while building the capability, **not** postpone cleanup to a final cosmetic phase. Before changing structure, identify actual producers, consumers, imports/exports, public routes, generated API clients, schema/migration ownership, tests, active runtime configuration and protected data. Choose the smallest correct action: keep, direct reuse, move/rename, merge, replace or remove. Record only the slice-specific evidence necessary to prove that choice.

A successful cutover preserves approved behavior and legally protected records, migrates dependent reads/writes and test contracts, proves role/Store isolation and error recovery where affected, and removes redundant paths after verified replacement. Check the exact candidate for stale imports, dead routes, name collisions, duplicate engines, hidden shadow writers and orphaned source/config/tests. Do not equate fewer files with a simpler system; retain necessary platform adapters and meaningful separation. No speculative directory scaffolding, wrapper, second State Manager or second authoritative registry is justified merely by future flexibility.

### Admission of operator-editable policies

Every admitted feature change or review should consider whether it contains a **currently useful, operator-changeable commercial or operational decision**. Do not wait for a separate request to expose a genuine policy, but do not turn every constant, preference or business record into an operator setting. Classify the affected decision at the smallest useful scope:

- **ADD NOW:** there is a real recurring operational/business reason to change the value without a code release; an authorized operator can understand and safely control it; the rule has a clear canonical service owner, enforced server-side in the actual workflow, and a small bounded, validated set of options or values.
- **DEFER:** configurability might become useful, but current use, authorized scope, safe behavior or supporting capability is not yet established. Preserve a defensible evolution path without prebuilding a generic policy mechanism or an inactive switch.
- **DO NOT ADD:** the value is ordinary Store/customer/catalog/reference data, a personal or presentation preference, an internal implementation detail, or a non-negotiable security, privacy, authorization, accounting or data-integrity invariant. Keep it with the appropriate existing owner.

Before adding a policy, check whether an existing owner-backed policy or native management workflow already covers the decision, whether changing it has meaningful operational benefit, which actor may approve it, what Store/model or other scope it actually needs, and which prior orders, agreements, customer rights and safety conditions must remain unaffected. Prefer one default per real business scope; introduce per-Store exceptions or more granular scopes only with demonstrated need. The four or other navigation groups displayed by the Operator Policies workspace are presentation, not a fixed limit or new domain authority.

When **ADD NOW** is justified, extend the existing Operator Policies workspace rather than introducing a second policy engine, generic rule language or shadow database. The canonical owner provides the effective value, authorized and validated change, trustworthy readback, and proportionate version/audit/concurrency/recovery evidence. The UI explains the current setting and its effect with minimal fields and a clear save/retry path. Test the real consumer of that policy, including an unauthorized or invalid change and any material negative path; an editable control alone is not proof that the policy works.

**Policy does not grant capability or bypass protection.** A switch never enables unimplemented or unapproved publication, checkout, marketplace access, financial terms or paid services. Identity continues to own actor authority, DSH its Store/commerce/operational decisions, and WLT its financial agreements and ledger. Required reviews and approvals remain at their legal owners; historic Order and agreement facts cannot be rewritten by a later policy update. Administrative flexibility is not authority to remove those boundaries.

Keep the classification lightweight and proportional to the feature. Record the reason when it materially changes product behavior or accepted scope; do not create a parallel registry, mandatory ceremony or speculative policies merely to document the assessment.

### Policy defaults, runtime eligibility and owner-backed bootstrap

Approved configuration defaults are delivered by their **existing service owner** (DSH operational/discovery/Store policies, WLT agreements/fees/collection, Identity admission); they are not duplicated in the Control Panel, a compiled client config or an extra cross-service policy engine. An isolated fresh development bootstrap may install one reviewed, versioned owner-backed default set through a canonical migration/seed/owner API appropriate to that domain. Exact local settings, active agreement terms, deployment values and synthetic records remain distinguishable. Restarting an app must not overwrite policies changed by an authorized Operator; previously accepted Store contracts and Order snapshots are immutable to later defaults.

For admitted scoped policies prefer effective resolution: approved general default → applicable Store relation default → expressly authorized Store exception **only where the actual owner supports it**. A Store's accepted WLT contract supersedes any mutable default for its financial obligations; no policy overrides authorization, publication, sanctions, ledger integrity or consent. A role change or deployment version cannot silently activate a deferred payment rail, independent checkout, subscription invoice or unsupported entitlement.

Operator edits must be read from and written through the original owner with validation, version/effective date, attribution, audit and owner readback. A safe rollback creates a new explicit effective version; it does not erase history, retroactively modify fees or rewrite pending transactions. Verify a changed default on the **actual new eligible Store/order** and check existing agreements unaffected; the administrative screen or seed fixture is not enough. Retain a bounded list of actually supported controls rather than a generic rule interpreter.

## Quality Policy

Quality is the correctness of the approved outcome for its intended actors and materially affected use, not a score, tool count or universal checklist.

- A mock, screenshot, isolated HTTP response or passing component test proves only the seam it exercises. A connected outcome requires the materially affected handoffs to reach canonical owner readback.
- Where available, expected results for a material claim come from an applicable contract, invariant or canonical readback independent of the implementation decision being tested. Higher-consequence claims need relevant negative, authorization, failure, concurrency or recovery evidence.
- Synthetic proof state is isolated and created through canonical owner operations. Reuse valid state when safe. Direct persistence mutation is limited to persistence, fault or recovery claims; synthetic state never becomes Product truth.
- Performance and capacity claims use a representative end-to-end workload and realistic bounded data. Do not infer scale from toy fixtures or impose one threshold on unrelated resources.
- User-facing correctness includes rendered behavior and materially applicable interaction, recovery, RTL, responsive and accessibility needs. The Experience and Design policies own those durable semantics; AGENTS.md owns agent execution.
- Text integrity is a cross-surface invariant: source files, build scripts, APIs, persistence boundaries and rendered text must preserve Unicode correctly. UTF-8 without BOM is the canonical repository text encoding; external legacy encodings are decoded explicitly once at their ingestion boundary. No double decoding or lossy transcoding is permitted.
- Encoding faults (including Mojibake) are diagnosed at their first corrupted boundary by comparing original bytes, source text, transport and rendering before mutation. Restore from a trusted source or a provably reversible transform; do not bulk replace, guess lost characters, rewrite byte-adopted migrations or mutate persistent customer data without owner-backed proof and an authorized safe recovery path.
- Run one baseline text-integrity scan, then block confirmed UTF-8 corruption on new or modified repository text using the existing local/candidate check path. Exclude binaries, avoid repeating whole-repository scans during routine development and review ambiguous multilingual content without destructive automatic repair.
- Material UI additions and changes preserve the canonical design foundation through structural checks and representative behavioral/rendered proof in the existing required integration checks. A failed applicable design check blocks merge; a written design rule alone is not enforcement.
- Use a small set of approved visual baselines where rendered stability has material value. Keep the browser/rendering environment reproducible, review intentional baseline changes with the affected behavior, and never update expected images automatically to hide a regression. Visual comparisons supplement interaction and canonical-readback proof rather than replacing them.

## Performance, Capacity and Scalability

### Purpose and admission

BThwani starts with the simplest correct deployable arrangement: local development and initially one operational server; add replicas, external infrastructure or geographic redundancy **only for measured business, capacity, availability or recovery needs**. Preserve the ability to scale without maintaining unused scaling machinery today. The canonical service/data owner remains authoritative regardless of deployment topology. `docs/governance/architecture.md` owns service and data boundaries; `docs/governance/safety.md` owns data protection and recovery safety; this `docs/governance/engineering.md` owns capacity and release decisions.

Admit any capacity mechanism only after identifying the affected user outcome, measured root bottleneck or explicit recovery objective, simpler alternatives, data consistency, security/privacy, deployment and rollback cost, owner, failure behavior, and the smallest independent proof that it improves the actual workload. A new mechanism must be removable, observable, and justified over an existing simpler solution. Future mechanisms below are **conditional decisions, not tasks, installed dependencies, or requirements to create infrastructure now**.

### Measurement and optimization order

Use representative load, data cardinality, device/network and failure conditions. Examine applicable throughput, concurrency, P50/P95/P99 latency, error rate, resource/connection/lock saturation, downstream time, retries/queue lag, data staleness and cost per useful transaction. Set journey-specific latency and capacity budgets; do not impose one global threshold. Test steady, burst, stress, soak, degraded/recovery and restart cases only when the actual claim calls for them. Plan capacity headroom for material burst, failover and maintenance needs.

Prefer removing unnecessary synchronous work, query/N+1 and payload waste, fixing indexes/transactions, enforcing bounded reads, batching lawful I/O, reducing expensive client work, controlling concurrency/deadlines, and profiling the measured hotspot **before** adding a cache, worker tier, replica, broker or orchestrator. Keep direct reads/owners until there is a proven reason to project or replicate. Every candidate must be measured against its baseline, including operational and developer complexity.

### Data and database boundaries

Use owner-local indexes and representative plans; indexes carry write/storage cost. Use bounded reusable connections sized for workload and replicas. An external pooler is conditional on measured connection churn or exhaustion; it is not the default. Data mutation, transactions, durable migrations and backups remain owned by canonical services. Preserve fresh-bootstrap and existing-state upgrade safety.

Admit a standby/failover arrangement when the approved recovery/availability requirement cannot tolerate a host failure, proving promotion, split-brain prevention, reconnection and recovery; synchronous acknowledgement is exceptional when recovery-point benefit outweighs write latency and availability coupling. Read replicas require proven read pressure and explicit staleness policy; **never** use stale replica reads for security, money, mutation authority or canonical completion claims.

Owner-local materialized projections, logical replication/CDC and analytics stores are conditional on a measured query, migration, integration or analytics purpose and retain a documented canonical writer and rebuild/reconciliation path. Partitioning needs demonstrated table/index/retention behavior and a useful partition key. Archive cold records only when policy and measurable cost allow durable readback and retention. Sharding is a last resort after indexing, bounded queries, archiving, caching, projections and ordinary capacity options prove insufficient; require explicit cross-shard transaction/identity/uniqueness/repair ownership.

### Caches, search and asynchronous work

A cache is disposable derived state, not a second business writer. Prefer no cache, or safe process-local caching, until a shared cache's cross-replica benefit is proven. For admitted caches specify authorization scoping, freshness, invalidation/TTL, rebuild, stampede/negative-cache limits, failure behavior, observability and retirement; never serve stale financial, permission, orderability or canonical transaction truth as authoritative. Cache-aside is the ordinary simple derived-read default; stale-while-revalidate is only for expressly stale-tolerant presentation.

Prefer owner-local relational/full-text/geospatial search and bounded projections. Admit external search or warehouse only when the approved functionality or workload requires it; define acceptable lag, reindex/rebuild, protected scope and canonical readback, without leaking private data or allowing search to become a writer.

For background work, keep durable handoff, attribution, idempotency, ordering where needed, bounded retries, poison-message recovery and reconciliation in the canonical owner. In-process workers are fine while failure isolation and restart proof hold. Separate workers only for material load or lifecycle isolation; add a broker/queue only where durable outbox/worker processing fails a proven need. Dead-letter processing requires an owned bounded recovery path. Replayable stream platforms require demonstrable ordering, replay, fan-out or throughput needs and are not baseline infrastructure.

### Request, media and user-facing efficiency

Collections must be bounded, deterministically ordered and paginated; cursor/keyset paging is appropriate for deep or concurrent datasets. Return bounded summary representations; compress/conditionally fetch only where bandwidth gains justify processing cost. Propagate end-to-end deadlines, bounded safe retries with backoff, and cancellation. Batch compatible independent operations and cap parallel fan-out. Protect expensive routes with appropriate input limits, concurrency, quotas and backpressure. Load shedding must preserve canonical integrity and prioritize accepted critical operations. Hedged duplicate requests are exceptional, read-only/idempotent, measured and strictly bounded.

Durable media ownership must not depend on a disposable app filesystem. Validate authorization, content type, size, metadata privacy and storage relationship. Signed/direct and resumable uploads are conditional on real bandwidth, file-size or unstable-network pressure; maintain post-upload validation and durable ownership. Generate rebuildable right-sized derivatives where beneficial. Video processing exists only for an admitted video capability. CDN/edge caching is conditional on measured traffic/geographic benefit, with versioned identity and safe invalidation.

Mobile and web surfaces should use paged queries, bounded memory, purposeful caching, efficient images and list virtualization where workload requires them. Deduplicate repeated reads and cancel obsolete requests where they waste work. Bound polling; adjust continuous location-update frequency to the real tracking need to avoid unnecessary battery/network use. Offline mutation queues require explicit idempotency, replay and conflict-recovery semantics. Measure perceived loading, low-bandwidth/high-latency behavior, offline/error recovery, network and battery usage, and accessibility before optimizing. Do not introduce alternate client business authority or speculative prefetch networks.

### Runtime, deployment and failure domains

Request-serving replicas must be **stateless with respect to canonical business state**: no correctness-critical local session, mutable file, in-process lock or scheduler ownership that fails when a second instance is added. Store material state through its canonical database/object/owner boundary and prove duplicate requests, concurrency, restart and different-instance readback before actual horizontal expansion.

Scale services horizontally only for demonstrated capacity, availability, maintenance or burst requirements, proving health, routing, state isolation, startup/readiness, shared external state and idempotency. Autoscaling is conditional on workload variability and meaningful saturation signals with bounded cost. Managed/serverless containers are evaluated for compatible runtime lifetimes, connections, cold starts and operational savings; functions are for independently bounded short-lived work. A general container orchestrator requires proven coordination needs beyond simpler deployment tooling. Service mesh is exceptional when repeated cross-service network/security policy cannot be handled simply. An API/edge gateway is conditional on multiple actual services requiring consolidated edge routing, auth, WAF or quota controls.

Multi-zone redundancy is conditional on a real production availability/RTO requirement; prove data/storage/routing behavior through a zone/host failure. Multi-region is a high bar for geography, disaster recovery or legal residency; explicitly price replication lag, cost and recovery. Active-active cross-region writes require a proven domain-specific conflict and consistency model and are not a default evolution target.

Use bounded concurrency and pressure control to prevent cascades. Circuit breakers, bulkheads and priority lanes require evidence that ordinary timeouts/backpressure are insufficient. Prefer constraints, transactions, idempotency and versioned state transitions to distributed locks; locks or elected leaders need proof that simpler multi-worker processing cannot meet correctness. Optional work must not starve critical canonical activity.

### Observability, security, release and recovery

Monitor relevant request rate/errors/duration (RED), resource utilization/saturation/errors (USE), and owner-specific state such as queue age, lag, cache hit ratio and reconciliation backlog. Trace cross-owner paths only when necessary for diagnosis, with bounded correlation context; profile measured compute/memory/lock bottlenecks. Avoid secret/PII and high-cardinality actor/request identifiers in metric labels. Define business-appropriate SLI/SLO and error budget where operating production claims warrant them.

Scaling never weakens least-privilege authorization, tenant/store isolation, fraud/rate protection, encryption, retention, financial conservation, audit attribution or secrets handling. Backups need tested restore and appropriate recovery-point/recovery-time guarantees before production adoption. An unreadable backup or unreconciled fallback cannot substantiate a recovery claim.

Feature flags, canary rollouts and blue/green deployment are conditional on specific rollout risk reductions; every temporary flag or compatibility lane has a retirement condition. Use bounded expand → migrate/dual-read if necessary → cut over → prove → contract for compatibility-dependent schema evolution. Track an immutable release from source to built and deployed artifact; SBOM/signing/provenance are admitted as risk justifies them, not as local development ceremonies.

### Closure

A performance or scalability change is closed only when the **authorized user/business outcome** and claimed capacity/recovery improvement are demonstrated on representative bounded data and traffic; canonical writers/readback, security/financial invariants, stale/duplicate/failure handling, operator observability, realistic cost and safe rollback are accounted for as applicable. Compare against the actual baseline, prove the materially affected scenario, delete superseded mechanisms after consumer cutover, and do not add an unrelated infrastructure project. No metric, technology name, or green isolated benchmark proves product-wide scalability.

## Providers and Integrations Policy

### Financial rail activation by environment

- **Local development:** use WLT's development-only Cash-In simulator/provider mock to exercise Customer and BThwani Captain funding, failures, retries, unknown outcomes and WLT ledger readback. This is synthetic accounting proof, not evidence of external funds or a certified provider integration. A live provider API, contract or credentials are **not prerequisites to completing local development**.
- **Local P0 financial proof:** exercise the admitted COD, internal-Wallet and Mixed payment paths, refunds/adjustments, commissions, Captain coverage and settlements as applicable, including authorization, idempotency, concurrency, balanced ledger entries and owner-backed recovery. Simulation does not waive those checks and does not prove real external transfer or reconciliation.
- **Governed Stage integration:** after a provider and its official test contract/environment are approved, verify server-side adapter, callback authenticity, timeout/unknown outcome, idempotency and reconciliation against official sandbox evidence. Without that integration, external Cash-In remains disabled on Stage; development mocks must not be enabled there.
- **Production activation:** never allow a development simulator/mock to credit actual customer or Captain funds. Real electronic Cash-In requires approved provider contracts, authenticated evidence, settlement reconciliation and independent financial/security review before enablement. An independently approved COD-only public launch may leave electronic Cash-In disabled; no UI or API may advertise it as available. WLT remains the sole owner of internal balance and ledger in every phase.
- These are **phase-specific acceptance gates**, not a requirement to build an unused provider adapter now or to promote local synthetic balances to shared/production data. Stage and Production transitions require separate authorization.

- External providers implement bounded semantic ports; availability never makes them Product/domain owners.
- External payment/wallet providers are rails around WLT-owned financial truth; provider balance or labels never become BThwani internal ledger truth.
- Normalize and validate external responses at the adapter boundary before owner state changes.
- Provider timeout/unknown result is represented explicitly and reconciled where effects may have occurred.
- A financial provider result that may have moved money remains `UNKNOWN` until query/reconciliation resolves it; a second movement is forbidden while duplicate effect remains possible.
- Refund, payout, reversal or query capability is never inferred from provider or product name; each capability is proven from the current provider contract at actual use.
- Provider identifiers are references, not replacements for BThwani canonical identity.
- Media and notification adapters own provider/storage/delivery mechanics only; the applicable DSH capability owns message/content/media relationship, publication/intent/read-state meaning.
- Adoption requires current need, fit, maturity/stability, compatibility, license/provenance, security/supply-chain, operational/recovery, migration/rollback and replaceability evidence as applicable.
- Newer or more popular is never adoption authority.
- Mutable provider/API/platform facts are revalidated at use from current primary sources.
- Discovery catalogs and OSS exemplars surface candidates; neither grants adoption authority.

## Knowledge Policy

### Durable knowledge

- New durable meaning updates the existing correct semantic owner when possible; learning does not mechanically create files.
- Wrong, stale or duplicate live meaning is corrected, merged or deleted; Git preserves history.
- Research output is distilled into current BThwani invariants, decisions, constraints or evidence requirements, then the transcript is discarded from live Governance.
- Mutable external facts are revalidated at actual use.
- Verifiers protect deterministic relationships/invariants and do not become prose or semantic authorities.
- Future Product concepts remain absent until admitted by current need.

### Evidence routing

For each material question, determine which evidence classes can materially change need, owner, boundary, risk, solution or proof:

```text
LIVE BTHWANI
CURRENT GOVERNANCE
DONOR / HISTORY
OSS / PRODUCT EXEMPLARS
YEMEN-MARKET / COMPETITOR EVIDENCE
PRIMARY TECHNOLOGY SOURCES
NORMATIVE / ASSURANCE SOURCES
EXPERIENCE / DESIGN SOURCES
CURRENT ECOSYSTEM / TOOLING DISCOVERY
```

Inspect applicable lanes adequately and skip clearly irrelevant lanes. Source count is not evidence strength. Authority, independence, directness, currentness and BThwani applicability determine weight.

Donor, OSS and competitors may reveal lost semantics, edge cases, state machines, failure/recovery behavior, experience patterns or test oracles. None grants adoption authority or the right to copy topology, visual identity or obsolete implementation.

### Technology opportunity and stability

BThwani must not remain on an unnecessarily costly mechanism merely because it already exists, and must not chase novelty merely because it is newer.

When a technology/tool/platform boundary is materially extended, refounded, costly to operate, deprecated, security-sensitive or blocking current work, inspect current primary evidence for alternatives or newly stable capabilities that can remove material custom complexity, risk or development cost.

A candidate is evaluated on:
- current material need and benefit;
- maturity/status (stable/GA/final versus beta/RC/canary/experimental/deprecated);
- compatibility and known regressions;
- security, license/provenance and maintenance;
- migration and rollback/exit cost;
- operational burden and complexity removed;
- claim-specific proof on BThwani.

The result is `ADOPT`, `DEFER` or `REJECT` for the current decision. Mutable versions and release status stay in current primary sources/executable configuration, not durable Governance.

Do not create a permanent technology-radar database, competitor matrix, dependency inventory or research backlog in Governance.

### External reference curation

The project's non-authoritative delivery, logistics, mapping and Yemen-localization OSS reference links are curated at `docs/reference/oss-logistics.md`. Use this source only for question-driven evidence and candidate discovery, never automatic adoption.

One external URL is curated in one canonical reference class unless a second occurrence has a materially different purpose.

Reference existence never authorizes adoption. Reopen prior research only when the current question, constraints or disconfirming evidence can materially change the decision.
