# Performance, Capacity and Scalability

ARTIFACT_CLASS: DURABLE_CROSS_CUTTING_POLICY
SEMANTIC_OWNER: docs/governance/policies/scalability.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Purpose and admission

BThwani starts with the simplest correct deployable arrangement: local development and initially one operational server; add replicas, external infrastructure or geographic redundancy **only for measured business, capacity, availability or recovery needs**. Preserve the ability to scale without maintaining unused scaling machinery today. The canonical service/data owner remains authoritative regardless of deployment topology. `docs/governance/architecture.md`, `docs/governance/policies/data.md`, `docs/governance/policies/reliability.md`, `docs/governance/policies/security.md` and `docs/governance/policies/delivery.md` own their respective boundary, data, recovery, safety and release decisions.

Admit any capacity mechanism only after identifying the affected user outcome, measured root bottleneck or explicit recovery objective, simpler alternatives, data consistency, security/privacy, deployment and rollback cost, owner, failure behavior, and the smallest independent proof that it improves the actual workload. A new mechanism must be removable, observable, and justified over an existing simpler solution. Future mechanisms below are **conditional decisions, not tasks, installed dependencies, or requirements to create infrastructure now**.

## Measurement and optimization order

Use representative load, data cardinality, device/network and failure conditions. Examine applicable throughput, concurrency, P50/P95/P99 latency, error rate, resource/connection/lock saturation, downstream time, retries/queue lag, data staleness and cost per useful transaction. Set journey-specific latency and capacity budgets; do not impose one global threshold. Test steady, burst, stress, soak, degraded/recovery and restart cases only when the actual claim calls for them. Plan capacity headroom for material burst, failover and maintenance needs.

Prefer removing unnecessary synchronous work, query/N+1 and payload waste, fixing indexes/transactions, enforcing bounded reads, batching lawful I/O, reducing expensive client work, controlling concurrency/deadlines, and profiling the measured hotspot **before** adding a cache, worker tier, replica, broker or orchestrator. Keep direct reads/owners until there is a proven reason to project or replicate. Every candidate must be measured against its baseline, including operational and developer complexity.

## Data and database boundaries

Use owner-local indexes and representative plans; indexes carry write/storage cost. Use bounded reusable connections sized for workload and replicas. An external pooler is conditional on measured connection churn or exhaustion; it is not the default. Data mutation, transactions, durable migrations and backups remain owned by canonical services. Preserve fresh-bootstrap and existing-state upgrade safety.

Admit a standby/failover arrangement when the approved recovery/availability requirement cannot tolerate a host failure, proving promotion, split-brain prevention, reconnection and recovery; synchronous acknowledgement is exceptional when recovery-point benefit outweighs write latency and availability coupling. Read replicas require proven read pressure and explicit staleness policy; **never** use stale replica reads for security, money, mutation authority or canonical completion claims.

Owner-local materialized projections, logical replication/CDC and analytics stores are conditional on a measured query, migration, integration or analytics purpose and retain a documented canonical writer and rebuild/reconciliation path. Partitioning needs demonstrated table/index/retention behavior and a useful partition key. Archive cold records only when policy and measurable cost allow durable readback and retention. Sharding is a last resort after indexing, bounded queries, archiving, caching, projections and ordinary capacity options prove insufficient; require explicit cross-shard transaction/identity/uniqueness/repair ownership.

## Caches, search and asynchronous work

A cache is disposable derived state, not a second business writer. Prefer no cache, or safe process-local caching, until a shared cache's cross-replica benefit is proven. For admitted caches specify authorization scoping, freshness, invalidation/TTL, rebuild, stampede/negative-cache limits, failure behavior, observability and retirement; never serve stale financial, permission, orderability or canonical transaction truth as authoritative. Cache-aside is the ordinary simple derived-read default; stale-while-revalidate is only for expressly stale-tolerant presentation.

Prefer owner-local relational/full-text/geospatial search and bounded projections. Admit external search or warehouse only when the approved functionality or workload requires it; define acceptable lag, reindex/rebuild, protected scope and canonical readback, without leaking private data or allowing search to become a writer.

For background work, keep durable handoff, attribution, idempotency, ordering where needed, bounded retries, poison-message recovery and reconciliation in the canonical owner. In-process workers are fine while failure isolation and restart proof hold. Separate workers only for material load or lifecycle isolation; add a broker/queue only where durable outbox/worker processing fails a proven need. Dead-letter processing requires an owned bounded recovery path. Replayable stream platforms require demonstrable ordering, replay, fan-out or throughput needs and are not baseline infrastructure.

## Request, media and user-facing efficiency

Collections must be bounded, deterministically ordered and paginated; cursor/keyset paging is appropriate for deep or concurrent datasets. Return bounded summary representations; compress/conditionally fetch only where bandwidth gains justify processing cost. Propagate end-to-end deadlines, bounded safe retries with backoff, and cancellation. Batch compatible independent operations and cap parallel fan-out. Protect expensive routes with appropriate input limits, concurrency, quotas and backpressure. Load shedding must preserve canonical integrity and prioritize accepted critical operations. Hedged duplicate requests are exceptional, read-only/idempotent, measured and strictly bounded.

Durable media ownership must not depend on a disposable app filesystem. Validate authorization, content type, size, metadata privacy and storage relationship. Signed/direct and resumable uploads are conditional on real bandwidth, file-size or unstable-network pressure; maintain post-upload validation and durable ownership. Generate rebuildable right-sized derivatives where beneficial. Video processing exists only for an admitted video capability. CDN/edge caching is conditional on measured traffic/geographic benefit, with versioned identity and safe invalidation.

Mobile and web surfaces should use paged queries, bounded memory, purposeful caching, efficient images and list virtualization where workload requires them. Measure perceived loading, offline/error recovery, network usage and accessibility before optimizing. Do not introduce alternate client business authority or speculative prefetch networks.

## Runtime, deployment and failure domains

Request-serving replicas must be **stateless with respect to canonical business state**: no correctness-critical local session, mutable file, in-process lock or scheduler ownership that fails when a second instance is added. Store material state through its canonical database/object/owner boundary and prove duplicate requests, concurrency, restart and different-instance readback before actual horizontal expansion.

Scale services horizontally only for demonstrated capacity, availability, maintenance or burst requirements, proving health, routing, state isolation, startup/readiness, shared external state and idempotency. Autoscaling is conditional on workload variability and meaningful saturation signals with bounded cost. Managed/serverless containers are evaluated for compatible runtime lifetimes, connections, cold starts and operational savings; functions are for independently bounded short-lived work. A general container orchestrator requires proven coordination needs beyond simpler deployment tooling. Service mesh is exceptional when repeated cross-service network/security policy cannot be handled simply. An API/edge gateway is conditional on multiple actual services requiring consolidated edge routing, auth, WAF or quota controls.

Multi-zone redundancy is conditional on a real production availability/RTO requirement; prove data/storage/routing behavior through a zone/host failure. Multi-region is a high bar for geography, disaster recovery or legal residency; explicitly price replication lag, cost and recovery. Active-active cross-region writes require a proven domain-specific conflict and consistency model and are not a default evolution target.

Use bounded concurrency and pressure control to prevent cascades. Circuit breakers, bulkheads and priority lanes require evidence that ordinary timeouts/backpressure are insufficient. Prefer constraints, transactions, idempotency and versioned state transitions to distributed locks; locks or elected leaders need proof that simpler multi-worker processing cannot meet correctness. Optional work must not starve critical canonical activity.

## Observability, security, release and recovery

Monitor relevant request rate/errors/duration (RED), resource utilization/saturation/errors (USE), and owner-specific state such as queue age, lag, cache hit ratio and reconciliation backlog. Trace cross-owner paths only when necessary for diagnosis, with bounded correlation context; profile measured compute/memory/lock bottlenecks. Avoid secret/PII and high-cardinality actor/request identifiers in metric labels. Define business-appropriate SLI/SLO and error budget where operating production claims warrant them.

Scaling never weakens least-privilege authorization, tenant/store isolation, fraud/rate protection, encryption, retention, financial conservation, audit attribution or secrets handling. Backups need tested restore and appropriate recovery-point/recovery-time guarantees before production adoption. An unreadable backup or unreconciled fallback cannot substantiate a recovery claim.

Feature flags, canary rollouts and blue/green deployment are conditional on specific rollout risk reductions; every temporary flag or compatibility lane has a retirement condition. Use bounded expand → migrate/dual-read if necessary → cut over → prove → contract for compatibility-dependent schema evolution. Track an immutable release from source to built and deployed artifact; SBOM/signing/provenance are admitted as risk justifies them, not as local development ceremonies.

## Closure

A performance or scalability change is closed only when the **authorized user/business outcome** and claimed capacity/recovery improvement are demonstrated on representative bounded data and traffic; canonical writers/readback, security/financial invariants, stale/duplicate/failure handling, operator observability, realistic cost and safe rollback are accounted for as applicable. Compare against the actual baseline, prove the materially affected scenario, delete superseded mechanisms after consumer cutover, and do not add an unrelated infrastructure project. No metric, technology name, or green isolated benchmark proves product-wide scalability.
