# BThwani Performance, Capacity and Scalability Policy

ARTIFACT_CLASS: DURABLE_CROSS_CUTTING_POLICY
SEMANTIC_OWNER: docs/governance/policies/scalability.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Purpose

This policy owns BThwani's durable cross-cutting rules for admitting, escalating, proving and retiring performance, capacity, scalability and load-management mechanisms.

It answers one question:

> **When is additional performance or scaling machinery materially justified, and what must be true before, during and after its adoption?**

It does not own current implementation state, exact ports, current providers, current topology, current traffic, current latency measurements, current instance counts, current database sizes, current package choices, current cloud products or current deployment commands. Those remain executable/source/runtime truth.

It does not replace:

- `docs/governance/architecture.md` for bounded ownership, canonical truth and cross-owner composition;
- `docs/governance/policies/data.md` for durable data, migration, projection, paging and media-data invariants;
- `docs/governance/policies/reliability.md` for retry, idempotency, reconciliation, recovery and failure semantics;
- `docs/governance/policies/security.md` for authentication, authorization, abuse protection, secrets and privacy;
- `docs/governance/policies/quality.md` for applicability, evidence and closure proof;
- `docs/governance/policies/delivery.md` for change/cutover/compatibility/release authority;
- `docs/governance/policies/integrations.md` for external-provider admission and adapter boundaries.

Where one of those owners already defines an invariant, this policy routes to it and does not create a second authority.

---

## 1. Governing law

```text
MATERIAL USER / BUSINESS / OPERATING REQUIREMENT
→ MEASURE CURRENT BOTTLENECK OR CAPACITY RISK
→ REMOVE UNNECESSARY WORK
→ OPTIMIZE THE CURRENT CANONICAL OWNER
→ PROVE THE SIMPLEST COMPLETE FIX
→ ADD DISTRIBUTED / DERIVED / ELASTIC MACHINERY ONLY IF STILL REQUIRED
→ MEASURE AGAIN
→ RETAIN ONLY WHILE ITS MATERIAL RESPONSIBILITY SURVIVES
```

A technology is never admitted because it is fashionable, common at larger companies, available from a provider, or might become useful later.

```text
FUTURE POSSIBILITY ALONE ≠ ADOPTION EVIDENCE
MORE COMPONENTS ≠ MORE SCALABLE
LOWER LOCAL LATENCY ≠ SYSTEM CORRECTNESS
CACHE / REPLICA / SEARCH / ANALYTICS ≠ CANONICAL TRUTH
```

Correctness, security, privacy, financial integrity and canonical ownership are never traded away merely to obtain a faster benchmark.

---

## 2. Admission gate for any new scaling mechanism

A new cache, replica, broker, search engine, pooler, worker topology, autoscaler, serverless runtime, orchestrator, CDN, multi-region topology or equivalent mechanism may be admitted only when all applicable conditions are satisfied:

1. **Current material need** — a present Product, reliability, latency, throughput, capacity, availability, cost or operating requirement exists.
2. **Measured or hard-constrained cause** — the bottleneck/risk is observed by measurement or is imposed by a non-negotiable external limit.
3. **Simpler alternatives examined** — unnecessary work, bad queries, missing indexes, N+1 behavior, oversized payloads, unbounded concurrency, poor pooling or avoidable synchronous work have been addressed first where applicable.
4. **Canonical ownership preserved** — the mechanism cannot become a second writer or hidden source of truth.
5. **Consistency semantics declared** — staleness, ordering, read-after-write, retry and unknown-outcome behavior are explicit where applicable.
6. **Failure behavior declared** — the system defines what happens when the new component is slow, unavailable, partitioned, stale, full or partially successful.
7. **Observability exists before dependence** — enough signals exist to prove benefit and diagnose regressions.
8. **Representative proof exists** — performance/capacity evidence represents the material workload, not only a synthetic happy path.
9. **Operational cost is accepted** — on-call, upgrades, backup/recovery, security, capacity and provider cost are part of the decision.
10. **Rollback or exit exists** — the mechanism can be disabled, bypassed, rebuilt, replaced or removed without corrupting canonical truth.
11. **Negative-space census is clean** — no losing path, second writer, stale compatibility route or shadow cache authority survives without a current bounded need.

If a mechanism cannot satisfy these conditions, it is not admitted.

---

## 3. Performance and capacity measurement law

BThwani performance decisions are based on distributions and saturation, not one fast request.

Applicable measurements include:

- request rate and concurrency;
- success/error rate;
- P50, P95 and P99 end-to-end latency;
- owner-local handler time;
- database time and query count;
- database connection wait and pool saturation;
- lock/transaction wait;
- downstream Identity/WLT/other dependency time;
- response/request bytes;
- CPU, memory, goroutines/threads, filesystem and network saturation;
- worker backlog, oldest pending age and retry rate;
- cache hit, miss, eviction and fill latency;
- replication lag where replicas exist;
- search/index projection lag where derived search exists;
- queue depth and consumer lag where queues/brokers exist;
- object-storage/origin/CDN latency and hit ratio where applicable;
- autoscaling events and time-to-capacity;
- cost per material business unit such as request, order or delivery where operationally useful.

### 3.1 No universal latency number

Governance does not hard-code one latency number for every endpoint. Each material journey must derive its budget from user/business need, dependency topology, representative devices/networks and operating envelope.

A request budget should be decomposable so the dominant contributor is identifiable rather than hidden inside a single total duration.

### 3.2 Headroom

Production capacity must include defensible headroom for burst, failover, maintenance and normal variability. A system that is healthy only while every critical resource runs near saturation is not proven scalable.

### 3.3 Required test shapes when material

Depending on the claim, capacity evidence may include:

- load testing at expected steady-state;
- stress testing beyond expected load;
- spike/burst testing;
- soak testing for leaks, bloat, drift and queue accumulation;
- failover/degraded-dependency testing;
- recovery/restart testing;
- representative mobile/network conditions when user-perceived performance depends on them.

`docs/governance/policies/quality.md` remains the owner of proportional proof applicability and closure.

---

## 4. Optimization order before introducing distributed machinery

Prefer this order unless evidence proves a different root cause:

1. delete unnecessary synchronous work;
2. remove duplicate reads and N+1 access;
3. bound and minimize payloads;
4. fix query shape and data access;
5. add only query-justified indexes;
6. shorten transactions and remove avoidable lock contention;
7. use bounded connection pooling and connection reuse;
8. batch compatible work;
9. parallelize only independent I/O with bounded concurrency;
10. propagate deadlines and cancellation;
11. move non-response-critical effects behind an existing durable handoff/worker boundary;
12. optimize media delivery and HTTP caching where applicable;
13. introduce owner-local/process-local caching only for eligible derived reads;
14. introduce shared/distributed acceleration only when the simpler model is insufficient.

This ordering is a default diagnostic hierarchy, not a mandate to perform irrelevant work.

---

## 5. Canonical database scaling

A canonical database remains authoritative only for facts owned by the applicable bounded owner. Scaling mechanisms around it must not weaken owner isolation or create cross-owner database integration.

### 5.1 Query and index optimization — baseline

Before adding database-scale infrastructure:

- identify expensive/high-frequency queries from real statistics;
- inspect actual execution plans for material slow queries;
- keep planner statistics sufficiently representative;
- remove N+1 patterns through lawful batching/joining within the owner boundary;
- create compound, partial or covering indexes only when justified by actual access patterns;
- measure write amplification and storage cost introduced by indexes;
- keep transactions as narrow as correctness allows;
- identify lock and contention sources separately from CPU/query cost.

An index is not admitted merely because a column is queried.

### 5.2 Connection pooling — baseline

Every long-lived service using a connection-oriented database must use bounded, reusable connections.

Pool sizing must be driven by:

- database connection capacity;
- service replica count;
- transaction/query latency;
- expected concurrency;
- connection wait/saturation evidence.

Increasing the pool is not a valid fix when the database itself is saturated.

### 5.3 External connection pooler/proxy — conditional

Add a database connection proxy/pooler only when connection churn or aggregate connections across elastic/many application replicas are a material constraint that owner-local pooling cannot solve safely.

Required evidence includes connection pressure, connection-setup cost or autoscaling behavior. The pooler must not hide transaction/session semantics that the application depends on.

### 5.4 High-availability standby — pre-production when availability requires it

A standby/failover topology is admitted when Production availability and recovery requirements cannot tolerate loss of the single database host.

Before admission, prove:

- promotion/failover behavior;
- client reconnection behavior;
- recovery point and recovery time expectations;
- backup/PITR coexistence;
- split-brain prevention appropriate to the chosen platform;
- canonical readback after failover.

Replication is not a backup.

### 5.5 Read replicas — conditional on read pressure

Add read replicas only when read load or read-heavy workloads remain a material database bottleneck after query/index/payload/cache corrections.

Before routing a read to a replica, classify whether stale data is acceptable.

Critical canonical readback after a mutation, financial truth, authorization-sensitive state, inventory/availability decisions or other consistency-sensitive reads must not be routed to a lagging replica unless the owning semantics explicitly prove it safe.

Required signals include replica lag, replica availability and read-routing outcomes.

### 5.6 Synchronous replication — exceptional

Use synchronous acknowledgement only when the required recovery point justifies its additional write latency and availability coupling. Do not enable it merely because it sounds safer.

### 5.7 Logical replication / CDC — purpose-specific

Use selective/logical change propagation only for a proven migration, projection, integration or data-movement requirement. It does not replace the canonical writer and is not the default HA mechanism.

### 5.8 Materialized/database read projections — conditional

Use materialized or owner-local read projections when expensive repeated aggregation/read computation is proven and bounded staleness/rebuild semantics are acceptable.

### 5.9 Partitioning — conditional on table/index behavior

Partition only when table/index scale, pruning opportunity, retention, vacuum/maintenance cost or operational lifecycle creates a measured problem.

A partition key must align with dominant access/retention patterns. Partitioning that forces broad scans or operational complexity without measurable benefit is rejected.

### 5.10 Archival / hot-cold separation — conditional

Move cold historical data away from the hot operational path when retention volume materially harms operational performance/cost and policy allows it.

Archive state remains governed by retention, privacy, audit and recovery requirements. Archival is not deletion unless the applicable policy defines it as such.

### 5.11 Sharding — last-resort scale boundary

Do not shard because a table is merely "large".

Sharding is admitted only after simpler single-cluster options, indexing, query correction, archival, partitioning, caching and read scaling are insufficient for a proven capacity requirement.

Before sharding, prove:

- stable shard key and routing ownership;
- cross-shard transaction behavior;
- uniqueness/identity semantics;
- rebalance/move strategy;
- failure and partial-availability behavior;
- operational observability;
- backup/restore per shard;
- canonical readback across routing changes.

---

## 6. Cache policy and admission

A cache is a disposable acceleration layer, never canonical truth.

```text
CANONICAL OWNER → source of truth
CACHE           → rebuildable / expiring derived state
```

### 6.1 Cache eligibility

Prefer caching data that is:

- read-heavy;
- expensive or repetitive to obtain;
- safe to reconstruct;
- tolerant of bounded staleness;
- clearly invalidatable/versionable.

Use extreme caution for:

- wallet/balance truth;
- final payment state;
- authorization decisions;
- order-state transitions;
- scarce inventory during commit-sensitive decisions;
- financial reconciliation;
- any read whose staleness can authorize an invalid mutation.

### 6.2 Process-local cache — first cache option when sufficient

Use process-local cache when one process/replica can safely benefit and cross-replica cache coherence is unnecessary.

Do not introduce a distributed cache merely to cache a small immutable lookup table.

### 6.3 Shared distributed cache — conditional

Add a shared distributed cache when one or more of the following is materially true:

- multiple service replicas need the same hot derived data;
- process-local duplication creates unacceptable memory or miss cost;
- cross-instance coordination for cache state is required;
- the database remains read-saturated after simpler fixes;
- the required hit ratio materially improves latency/capacity/cost.

The cache must remain replaceable and rebuildable from canonical truth.

### 6.4 Cache-aside

Cache-aside is the preferred simple default for ordinary derived reads when a cache is admitted:

```text
READ CACHE
→ HIT: return derived value
→ MISS: read canonical owner
→ populate cache
→ return
```

Use another pattern only when its consistency/operational benefit is proven.

### 6.5 Invalidation and TTL

Each cached fact must define at least one bounded freshness mechanism:

- invalidation after canonical commit;
- versioned key/namespace;
- bounded TTL;
- rebuild from canonical state.

TTL alone is not sufficient when stale data can create a material correctness defect.

### 6.6 Stampede protection

Where many concurrent misses for the same hot key can overload the canonical owner, use bounded request coalescing/single-flight or an equivalent proven mechanism.

Cache failure behavior must also protect the canonical database from a sudden uncontrolled miss storm.

### 6.7 Negative caching

Cache "not found" only when absence is safe to cache and with a bounded freshness period. Never let negative caching hide newly created or newly authorized material state beyond the allowed freshness contract.

### 6.8 Stale-while-revalidate

Serving stale data while refreshing is allowed only for explicitly stale-tolerant presentation/discovery content. It is not an authorization, financial or canonical-readback strategy.

### 6.9 Cache metrics

When caching is material, observe:

- hit/miss ratio;
- fill latency;
- eviction rate;
- memory pressure;
- stale/invalidation failures;
- canonical fallback rate;
- fallback-induced database pressure.

A low-value cache whose operational cost exceeds its measured benefit should be removed.

---

## 7. API, transport and request-path efficiency

### 7.1 Bounded collections

Large collection reads must remain bounded and deterministic. Use a cursor/keyset strategy when deep offset cost, concurrent mutation or ordering stability makes offset paging materially unsuitable.

### 7.2 Payload minimization

Return only the representation required by the consumer. Large list responses should not carry full-detail payloads when a bounded summary representation satisfies the journey.

### 7.3 Compression and conditional transport

Use transport compression for compressible payloads when measured size/bandwidth savings justify CPU cost. Do not recompress already-compressed media without benefit.

Use HTTP validators/conditional requests where cacheable representations and consumer behavior make them materially useful.

### 7.4 Deadline budget propagation

An end-to-end request budget must not be silently multiplied at each downstream hop.

Where a request has a deadline, downstream database and service calls must inherit or receive a bounded sub-budget. Cancellation should propagate to work that no longer has a valid consumer, except where durable mutation/reconciliation semantics require the operation to finish or be recovered.

### 7.5 Retry discipline

Retries must obey `docs/governance/policies/reliability.md` and must not multiply traffic uncontrollably.

Where retries are safe and required, use bounded attempts and backoff/jitter appropriate to the failure class. Do not blindly retry unknown non-idempotent mutation outcomes.

### 7.6 Batching

Batch repeated compatible reads/calls when it reduces network/database round trips without violating ownership, authorization or result isolation.

### 7.7 Parallel I/O

Parallelize only independent operations and cap concurrency. Parallelizing dependent work or turning every request into unbounded fan-out is rejected.

### 7.8 Rate, concurrency and resource limits

Material endpoints must have bounded input/resource behavior appropriate to their abuse and capacity risk, including as applicable:

- request-body limits;
- upload size/type limits;
- pagination limits;
- per-actor/device/IP/credential rate controls;
- bounded concurrent expensive operations;
- downstream concurrency budgets.

Security-sensitive limits remain governed by `docs/governance/policies/security.md`.

### 7.9 Backpressure and load shedding

When demand exceeds safe capacity, preserve system integrity through bounded queues/concurrency and controlled rejection/degradation rather than allowing critical shared resources to collapse.

Low-priority derived/discovery work may be degraded before checkout, payment, canonical order transitions or other material critical paths when the Product semantics allow it.

### 7.10 Hedged requests — exceptional

Duplicate/hedged requests may be used only for idempotent/read-only operations with measured tail-latency benefit, strict duplication budgets and no amplified downstream overload. They are not a default latency technique.

---

## 8. Media and edge delivery

### 8.1 Durable binary ownership

Material media binaries should be owned by an admitted object/blob storage boundary rather than ephemeral application-container filesystems or relational rows, unless a bounded capability proves another model is simpler and correct.

Metadata and semantic relationships remain with their canonical bounded owner.

### 8.2 Direct/signed upload — conditional

Move upload bytes directly from client to object storage through short-lived bounded upload authorization when API bandwidth, memory, file size, upload frequency or horizontal scale makes proxying the full payload through the API materially inefficient.

The API/canonical owner still governs:

- actor authorization;
- allowed object namespace;
- maximum size/type;
- upload lifecycle/state;
- post-upload verification;
- semantic attachment;
- orphan cleanup/reconciliation.

Storage master credentials must not be exposed to clients.

### 8.3 Resumable/multipart upload — conditional

Add resumable/multipart upload when large files or unreliable/mobile networks make single-request upload failure materially costly.

### 8.4 Image derivatives — conditional

Generate/serve media variants sized for real presentation needs when original files materially waste bandwidth, decoding time, memory or CDN cost. The derivative is rebuildable; the canonical media relationship remains stable.

### 8.5 Video transcoding/adaptive streaming — capability-driven

Add transcoding and adaptive streaming only when video is an admitted Product capability and direct-file delivery cannot meet user/network/bandwidth requirements.

### 8.6 CDN/edge caching — conditional to expected traffic/geography

Use a CDN/edge layer when static/media/read traffic materially benefits from origin offload, geographic latency reduction or bandwidth/cost control.

Prefer immutable/versioned asset identities where possible. Cache invalidation/purge semantics must be explicit for mutable content.

### 8.7 Media privacy and validation

Uploads remain subject to security/privacy validation, including content-type/size validation and removal/avoidance of unnecessary sensitive metadata where material.

---

## 9. Asynchronous work, workers and messaging

### 9.1 Durable handoff first

Cross-owner and failure-sensitive asynchronous effects remain governed by the durable handoff, idempotency and reconciliation laws in `docs/governance/architecture.md` and `docs/governance/policies/reliability.md`.

A broker does not make an effect durable merely because a message was published.

### 9.2 In-process worker — acceptable while bounded

A worker may remain in the service process while its load, failure domain, lifecycle and scaling needs are compatible with that process and restart/recovery proof remains valid.

### 9.3 Separate worker process — conditional

Split a worker from the API runtime when one or more are materially true:

- worker load needs independent scaling;
- worker CPU/memory/I/O can starve request handling;
- worker failure/restart policy differs materially from the API;
- runtime scale-to-zero/lifecycle cannot guarantee required processing;
- deployment isolation materially improves reliability.

Do not split merely to increase process count.

### 9.4 Queue/broker — conditional

Add a queue/broker when the current durable database handoff/worker model cannot meet a proven requirement such as:

- sustained asynchronous throughput;
- many independent consumers/fan-out;
- buffering during downstream unavailability;
- independent consumer scaling;
- ordered/replayable delivery beyond the current mechanism;
- decoupled producer/consumer lifecycle that materially reduces risk.

Required design includes delivery semantics, idempotency, ordering scope, backpressure, poison-message handling, observability and canonical reconciliation.

### 9.5 Dead-letter handling — only with a bounded retry lifecycle

A dead-letter lane is useful only when repeated processing failure needs explicit quarantine/inspection/reconciliation. It must not become a forgotten second backlog.

### 9.6 Stream platform — high admission bar

A partitioned replayable event-stream platform is admitted only when ordered streams, high fan-out, long replay, stream processing or throughput are current material requirements that simpler outbox/queue mechanisms cannot meet.

Do not add a stream platform as a generic "future scale" foundation.

---

## 10. Search, discovery and analytical projections

### 10.1 Canonical database first

Use owner-local relational indexes, full-text/trigram/geospatial capabilities and bounded read models while they satisfy admitted search/discovery requirements and SLOs.

### 10.2 External search engine — conditional

Add an external search engine only when current Product requirements or measured workload require capabilities/performance that the canonical database cannot provide simply enough, such as materially advanced relevance, autocomplete, faceting, typo tolerance, language analysis, hybrid/semantic retrieval or independently scaled search traffic.

The external index is a derived projection:

```text
CANONICAL OWNER
→ DURABLE CHANGE HANDOFF
→ IDEMPOTENT INDEXER
→ SEARCH INDEX
```

Required before admission:

- full rebuild/reindex from canonical truth;
- document/version identity;
- idempotent indexing;
- projection-lag measurement;
- safe index-version/alias cutover or equivalent;
- defined behavior when the search engine is unavailable/stale;
- no search-index mutation authority over canonical business facts.

### 10.3 Analytics/warehouse — conditional

Move heavy historical/analytical workloads away from the operational database when they materially contend with transactional work or require analytical storage/query characteristics.

Analytics remains derived and cannot become canonical mutation authority.

---

## 11. Service/runtime scaling

**BThwani operating posture — vertical first, horizontal only on demonstrated need.** Local development and initial operation default to one server with a simple single-instance runtime per service; increase available host capacity before introducing replicas when that meets the actual need. This is a preferred scaling strategy, not a frozen deployment inventory. Executable deployment configuration owns actual topology.

**Horizontal readiness is an anti-lock-in constraint, not a feature or a present proof gate.** Do not introduce new durable dependence on one application process's memory or local filesystem for canonical sessions, business data or media. Process-local caches, transient state and in-process workers remain allowed when correct, bounded and recoverable under the current single-instance model.

Do not add replicas, load balancers, shared caches, brokers, distributed locks/leases, separate worker services, orchestrators, new abstraction layers or multi-replica test requirements merely for possible future scale. Preserve currently required correctness, retry, idempotency, concurrency and restart/recovery semantics with the simplest existing owner mechanism. When measured capacity, availability or operational requirements justify horizontal scaling, treat replica coordination and multi-replica proof as a separately scoped change.

### 11.1 Stateless request-serving runtime

Request-serving service replicas should not rely on local ephemeral state as canonical business truth. Material state belongs to the canonical owner/storage boundary.

### 11.2 Horizontal scaling — conditional

Add service replicas when single-instance capacity, availability, maintenance or burst requirements materially require it.

Before scaling horizontally, verify:

- request handlers are safe across replicas;
- idempotency/concurrency semantics survive duplicate/concurrent traffic;
- connection-pool multiplication is safe for dependencies;
- local cache/session assumptions do not become hidden authorities;
- background workers are not accidentally duplicated without coordination/idempotency.

### 11.3 Autoscaling — conditional

Use autoscaling when traffic is sufficiently variable or bursty that static capacity is operationally/cost inefficient.

Choose scaling signals that correlate with real saturation, such as request concurrency, queue depth, latency, connection pressure or workload-specific demand. CPU alone is not automatically sufficient.

Autoscaling must preserve headroom and account for startup/cold-start and database/dependency limits.

### 11.4 Managed elastic/serverless containers — conditional deployment model

Managed/serverless container execution is suitable when it materially reduces server operations or improves burst scaling/cost without violating runtime needs.

Before adoption, prove:

- stateless request handling;
- bounded database connections across elastic replicas;
- acceptable cold/startup latency or minimum warm capacity where required;
- externalized durable state/media;
- worker/scheduler lifecycle independent of ephemeral request instances where required;
- graceful shutdown/cancellation;
- observability and rollback.

Do not decompose one coherent service into a function per endpoint merely to claim "serverless".

### 11.5 Serverless functions — narrow use

Use functions for naturally isolated, short-lived, stateless and independently triggered work when this is simpler than a long-lived service/container. Do not force request-heavy or stateful service architecture into function-per-route form without measured benefit.

### 11.6 Container orchestrator — high admission bar

Adopt a general-purpose orchestrator only when service/worker count, placement, networking, rollout, autoscaling, isolation or multi-environment operations exceed what a simpler managed-container/platform model can handle safely and economically.

Orchestration is not a substitute for correct service boundaries.

### 11.7 Service mesh — exceptional

Adopt a service mesh only when a sufficiently large service topology has repeated cross-service traffic/security/observability policy that cannot be handled more simply by the runtime/platform and application boundaries.

### 11.8 API gateway / edge gateway — conditional

Add a gateway when multiple public services require centralized routing, edge authentication policy, quotas, protocol termination, WAF integration or other cross-service edge behavior that cannot be kept simpler at the existing ingress boundary.

The gateway never becomes business authorization or canonical domain authority.

---

## 12. Availability topology

### 12.1 Multi-zone availability — Production requirement when SLO/RTO demands it

Use failure-domain redundancy across zones/hosts when Production availability cannot tolerate one host/zone failure.

Prove application, database, storage and routing behavior under the relevant failure—not only infrastructure provisioning.

### 12.2 Multi-region — high admission bar

Use multiple regions only for a proven geographic latency, disaster-recovery, legal/residency or availability requirement that a simpler regional multi-zone design cannot satisfy.

Before adoption, define:

- canonical write location/ownership;
- consistency and conflict behavior;
- failover/failback;
- data residency/privacy;
- cross-region latency and cost;
- replication lag/data-loss envelope;
- recovery/readback proof.

### 12.3 Active-active multi-region — exceptional last resort

Do not use active-active multi-region mutation without a domain-specific conflict/consistency model proven for every affected canonical fact. It is not the default endpoint of "scaling up".

---

## 13. Overload and cascading-failure controls

### 13.1 Bounded concurrency — baseline where expensive shared resources exist

Protect databases, downstream services and CPU/memory-heavy handlers from unbounded fan-out.

### 13.2 Circuit breaker — conditional

Add a circuit breaker when repeated dependency failure/timeouts demonstrably create cascading resource exhaustion or unacceptable tail latency and ordinary deadlines/load shedding are insufficient.

A circuit breaker must have observable open/half-open/closed behavior and must not transform a required canonical dependency into a silent fallback.

### 13.3 Bulkhead isolation — conditional

Separate resource pools/concurrency/queues when one workload can starve a materially more critical workload through a shared failure/resource domain.

### 13.4 Priority protection — conditional

When overload policy is necessary, protect material canonical paths before optional derived work where Product semantics permit degradation.

### 13.5 Distributed locks — last choice

Prefer database constraints, transactions, idempotency, optimistic concurrency and explicit state transitions. Use a distributed lock only when those mechanisms cannot correctly express the required mutual exclusion and lease/failure semantics are proven.

### 13.6 Leader election — conditional

Use leader election only when exactly-one-active execution is truly required and idempotent multi-worker processing cannot satisfy the capability more simply.

---

## 14. Observability required for scale decisions

Performance/scalability mechanisms must not become dependencies that cannot be observed.

At minimum, expose the signals material to the adopted mechanism.

### 14.1 Service RED signals

- request/event Rate;
- Error rate/classification;
- Duration distribution.

### 14.2 Resource USE signals

- Utilization;
- Saturation;
- Errors.

### 14.3 Cross-service tracing

Use distributed tracing when cross-service/DB/worker paths are material enough that aggregate logs cannot reliably explain end-to-end latency or failure.

Trace/correlation context must follow security/privacy policy and must not leak credentials or unnecessary PII.

### 14.4 Profiling

Use CPU, heap, goroutine, block/mutex or equivalent profiling when measurement indicates compute, allocation, contention or runtime scheduling as a bottleneck. Profiling is a diagnostic tool, not a substitute for fixing slow database/network work.

### 14.5 Cardinality and telemetry cost

Telemetry dimensions must be bounded. Do not place unbounded actor IDs, request IDs, raw URLs, phone numbers or similar high-cardinality/sensitive values into metric labels.

### 14.6 SLI / SLO / error budget

Material Production journeys should have measurable service-level indicators/objectives appropriate to their user/business impact. Error budgets may govern reliability versus change velocity when materially useful.

SLO values are current operating claims and belong with the current operational/executable authority, not permanently hard-coded in this durable policy.

---

## 15. Performance and resilience proof

When applicable to the changed claim, proof should cover the smallest relevant set of:

- endpoint/journey latency distribution;
- throughput and saturation;
- connection-pool behavior;
- database query/lock behavior;
- cache hit/miss/stampede/failure behavior;
- replica staleness/read-after-write behavior;
- worker/queue backlog and recovery;
- downstream timeout/cancellation/retry behavior;
- process restart and in-flight work;
- partial cross-owner failure and reconciliation;
- load shedding/backpressure;
- dependency outage/circuit behavior;
- failover/readback;
- media upload/download under representative network conditions;
- memory/CPU/leak/soak behavior;
- language/runtime race detection for concurrency-sensitive code when material;
- fuzzing for parsers/trust boundaries/idempotency/cursor/token or similar edge-heavy code when material;
- performance regression against the relevant baseline.

Do not chase universal line coverage or benchmark count. Prove the material claim and its failure modes.

---

## 16. Backup, recovery and disaster readiness

Backup/recovery semantics are owned by `docs/governance/policies/data.md` and `docs/governance/policies/reliability.md`; scalability work must not weaken them.

Before Production material data is trusted, the operating model must define and prove as applicable:

- durable backups;
- point-in-time recovery where the data-loss requirement needs it;
- backup encryption/access control;
- media durability/recovery where media is material;
- restore drills into a disposable environment;
- schema/canonical invariant verification after restore;
- canonical readback after recovery;
- defined RPO/RTO for material owner data.

Replication alone does not satisfy backup/recovery because accidental/corrupting mutations may replicate.

---

## 17. Deployment and release mechanisms

`DELIVERY.md` owns change/cutover authority. The following mechanisms are admitted only when their risk reduction is material.

### 17.1 Feature flags

Use a flag when controlled exposure materially reduces rollout risk or enables a required staged experiment. Each material flag needs an owner and deletion/exit condition so it cannot become shadow architecture.

### 17.2 Canary rollout

Use canary rollout when production behavior needs validation on bounded live traffic before full exposure and rapid rollback is materially valuable.

### 17.3 Blue/green

Use blue/green when near-immediate traffic cutover/rollback and parallel environment validation materially justify duplicate environment cost.

### 17.4 Expand/contract schema evolution

For zero/low-downtime compatibility across versions, evolve durable schemas/contracts in a bounded expand → migrate/cut over → prove → contract sequence. Temporary dual compatibility must not become permanent dual truth.

### 17.5 Immutable artifact and provenance

Production release identity should be traceable from immutable source candidate to built artifact and deployed artifact. SBOM, vulnerability evidence, signing/attestation/provenance are admitted according to release/supply-chain risk and should become part of the Production path where material.

---

## 18. Security and abuse at scale

Scaling increases abuse surface as well as legitimate load.

Performance mechanisms must preserve:

- canonical object/function authorization;
- least-privilege service/database/storage credentials;
- bounded input size/count;
- challenge/login/OTP and sensitive-flow abuse protection;
- SSRF-safe external fetch boundaries;
- safe consumption of downstream APIs;
- secret rotation/revocation;
- PII/location minimization;
- auditability without secret leakage.

A cache, replica, gateway, CDN, queue or search index must never bypass the canonical authorization rule for the action being performed.

---

## 19. Client and surface efficiency

A scalable backend does not compensate for wasteful clients.

Where material, actor-facing surfaces should use:

- bounded pagination/infinite-list windows;
- list virtualization for large rendered collections;
- request deduplication/coalescing where repeated identical reads occur;
- cancellation of obsolete requests;
- appropriate local derived caching with freshness/version semantics;
- prefetch only when likelihood and network/cost justify it;
- media variants appropriate to rendered size;
- offline mutation queues only when idempotency/conflict/replay semantics are explicit;
- bounded polling, preferring event/push-driven refresh where materially more efficient;
- adaptive location/update frequency when continuous high-rate sampling would waste battery/network without Product benefit;
- representative low-bandwidth/high-latency testing where target users materially experience such networks.

Local surface state remains derived/transient and cannot become canonical business truth.

---

## 20. Cost efficiency

Capacity is not closed if the only working design has uncontrolled cost.

Where material, measure:

- infrastructure cost per request/order/delivery/business unit;
- database compute/storage/IO;
- cache cost versus avoided database work;
- object-storage and CDN egress;
- search/index cost;
- queue/event cost;
- autoscaling floor/idle cost;
- cross-region traffic cost.

A performance optimization that creates disproportionate operational cost without a material user/business/reliability benefit should be rejected or redesigned.

---

## 21. Non-default design boundaries

The specialized conditions in sections 5–20 are the sole policy admission rules for scaling mechanisms. Do not maintain a second technology trigger/permission matrix that can drift from those rules. This policy also does **not** adopt system-wide CQRS or event sourcing, GraphQL as a universal API replacement, Factory/Repository abstractions for every model, or per-feature microservice decomposition as default architecture. Each requires its own admitted capability-specific evidence and must preserve one canonical owner.

Profile-guided optimization (PGO) is a narrow CPU optimization only when representative profiling proves the applicable language/toolchain and workload benefit after the higher-level bottlenecks have been corrected. Preserve the profile provenance and before/after measurement; it is never a mandatory build mode.

## 22. Closure law

A performance/scalability change closes only when:

- the original material bottleneck/requirement is explicitly identified;
- canonical ownership remains singular;
- the new mechanism's consistency and failure behavior are explicit;
- representative before/after evidence proves material improvement or required capacity;
- security/privacy/financial/recovery invariants remain satisfied;
- observability can detect saturation, failure and drift;
- rollback/rebuild/recovery is proven where material;
- no obsolete/shadow path remains;
- the resulting system is the simplest complete model that satisfies the current requirement.

```text
FASTER BUT UNKNOWN
= NOT CLOSED

SCALABLE BUT SECOND TRUTH
= DEFECT

MORE AVAILABLE BUT UNRECOVERABLE
= DEFECT

MEASURED + CORRECT + RECOVERABLE + OPERABLE + SIMPLEST COMPLETE
= ADMISSIBLE CLOSURE
```
