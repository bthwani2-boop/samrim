# Focus — Data, Contracts, Runtime, Security and Assurance Application

ARTIFACT_CLASS: ORCHESTRATOR_EXECUTION_FOCUS_LENS
LENS_ROLE: DATA_CONTRACTS_RUNTIME_SECURITY_ASSURANCE_APPLICATION
ROUTED_BY: 00-ORCHESTRATOR.md
DURABLE_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
SELF_CERTIFICATION: FORBIDDEN

This lens applies and falsifies materially applicable Governance owners and executable sources for data, contracts, runtime, security, finance and assurance. It never defines those semantics itself.

## 1. Route by affected concern

Load only what is material:

- ownership/data/contracts → ownership map, data/contracts architecture, data/migration policy;
- runtime/config/reliability → runtime architecture, runtime-reliability policy and executable config/scripts;
- providers → provider policy plus applicable capability/financial owner;
- security/privacy → security policy plus Identity/capability owner;
- financial truth → Financial Model plus WLT capability owner;
- testing/tooling/delivery → standards/quality, tooling/assurance and delivery policies.

## 2. Data and migration application

For each affected durable fact identify canonical owner/writer, schema/migration authority, readers/projections, classification and readback.

When ownership or shape changes require deterministic migration/backfill/reconciliation and delete losing storage/writers after cutover. Destructive transformation requires evidence capable of proving required truth preservation.

Multiple normalized tables are not automatically multiple mutable authorities.

## 3. Contract and generated lineage

Trace:

~~~text
CANONICAL CONTRACT SOURCE
→ VALIDATION/GENERATION
→ GENERATED BINDING
→ CONSUMER
→ RUNTIME CALL/EVENT
→ CANONICAL READBACK
~~~

Parallel hand-maintained DTO/status/operation mirrors are findings. Compatibility survives only for a proven coexistence requirement with bounded owner, scope, cutover and removal condition.

## 4. Cross-service facts and projections

Classify every material cross-service fact:

~~~text
CANONICAL OWNER
SOURCE API/EVENT
MUTABILITY
PERSISTENCE
AUTHORITATIVE OR DERIVED
REBUILDABILITY
CONSISTENCY/RETRY
CONSUMERS
READBACK
~~~

Derived projections, caches and indexes cannot become mutation authority.

## 5. Runtime, configuration and provider application

Inspect executable runtime/config/infra for competing authorities, hidden fallback, stale paths, environment divergence and provider-specific domain leakage.

For externally consequential operations preserve operation identity and distinguish rejected, failed, pending and unknown. Unknown remains unresolved until query/reconciliation proves terminal state; never blind-failover where duplicate effect is possible.

## 6. Material mutation contract

For materially affected mutations account for:

~~~text
TRUSTED CONTEXT
PRECONDITIONS
ALLOWED / FORBIDDEN STATE
IDEMPOTENCY / CONCURRENCY
TRANSACTION OR DURABLE EFFECT
TIMEOUT / RETRY / PARTIAL FAILURE
COMPENSATION / REVERSAL
AUDIT / CORRELATION
CANONICAL READBACK
~~~

The concrete semantics come from Governance and source; this lens only checks the chain is complete.

## 7. Security and finance escalation

Authentication, authorization, sessions, secrets, PII, provider credentials, isolation and financial mutation receive heightened evidence. Cleanup never waives truth preservation or reconciliation.

Development/bootstrap credentials never define normal production Identity policy.

## 8. Assurance and test death test

Inherited tests, fixtures, mocks, snapshots, guards and workflows may encode losing architecture. Preserve only assurance that still proves a unique current claim; migrate or delete the rest.

CI/custom tooling is not privileged structure. Exact candidate attribution is mandatory for authoritative evidence.

## 9. Missing-tool/evidence classification

When a check cannot run classify:

~~~text
DIAGNOSIS_BLOCKER
EXECUTION_FINDING
DEGRADED_EVIDENCE
EVIDENCE_AVAILABLE
~~~

Only a proven diagnosis blocker prevents dependent treatment solely because evidence is unavailable. Missing optional evidence does not create campaign-wide waiting when another root remains safely executable.

## 10. Remote evidence and runtime proof

Persistent workflows survive only with unique durable baseline value and correct candidate/event semantics. Campaign-only workflows are temporary.

Rendered/device/runtime proof is distinct from source/config proof. If required evidence is unavailable, keep the corresponding claim open rather than substituting a weaker class.

## 11. Dependencies and control-path efficiency

Every dependency, workspace edge, toolchain pin and custom script needs a current consumer or evidence claim. Remove unused or duplicate tooling after migration.

When build/test/CI/runtime tooling is slow, flaky or duplicated, diagnose that control path as a root. Optimize by removing redundant work or using stronger native mechanisms, never by suppressing failures.

## 12. Final assurance handoff

Before handing the affected unit to verification account for:

~~~text
NO DUPLICATE DATA/CONTRACT/MIGRATION/RUNTIME AUTHORITIES
NO UNCONSUMED MATERIAL SECURITY/STATIC FINDINGS
NO KNOWN UNVERIFIED MATERIAL DATA/SECURITY/FINANCIAL/OPERATIONAL CLAIMS
REQUIRED RUNTIME/DEVICE/RECONCILIATION EVIDENCE ATTRIBUTABLE TO EXACT CANDIDATE
NO NEW SHADOW SOURCE OF TRUTH
~~~

Closure belongs to 04; diagnosis and movement belong to 02 and 05.
