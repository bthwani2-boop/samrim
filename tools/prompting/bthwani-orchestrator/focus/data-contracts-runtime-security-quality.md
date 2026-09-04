# Focus — Data, Contracts, Runtime, Security and Assurance

OWNER_ROLE: DATA_CONTRACTS_RUNTIME_SECURITY_ASSURANCE
AUTHORITY_ASSIGNED_BY: 00-ORCHESTRATOR.md
SELF_CERTIFICATION: FORBIDDEN


## 1. Data ownership

For every material persisted fact prove:

```text
CANONICAL DOMAIN OWNER
CANONICAL WRITE PATH
CANONICAL STORAGE
INVARIANTS/CONSTRAINTS
READBACK PATH
LIFECYCLE/RETENTION WHEN MATERIAL
SECURITY/FINANCIAL CLASSIFICATION WHEN MATERIAL
```

Multiple mutable stores for one business truth are forbidden unless one is explicitly derived and non-authoritative.

`ONE TRUTH` does not mean one table; correct normalization may use multiple tables. What is forbidden is multiple mutable authorities for the same meaning.

## 2. Schema and migration refoundation

Migration history is executable architecture, not sacred chronology.

Audit:

```text
SCHEMA OWNERSHIP
MIGRATION ORDER / EPOCHS
DUPLICATE TABLE/COLUMN AUTHORITIES
OBSOLETE COMPATIBILITY COLUMNS
BACKFILLS
SEEDS / BOOTSTRAP
CONSTRAINTS / INDEXES
POLICIES / TRIGGERS
MIGRATION MANIFESTS / ORDERING AUTHORITIES
GENERATED DB CONTRACTS
UPGRADE/RESET ASSUMPTIONS
```

If the migration epoch itself is structurally corrupt, do not patch hundreds of migrations by default.

```text
DETERMINE REQUIRED DURABLE TRUTH
→ DETERMINE RESET VS CONTROLLED CUTOVER CONSTRAINTS
→ DESIGN CANONICAL EPOCH/OWNERSHIP
→ MIGRATE/BACKFILL/RECONCILE
→ CUT OVER
→ DELETE SHADOW/OBSOLETE MIGRATION AUTHORITIES
→ PROVE REAL UPGRADE/READBACK WHERE REQUIRED
```

No destructive data transformation without deterministic evidence.

## 3. Contracts and generated lineage

```text
ONE CANONICAL SOURCE CONTRACT
ONE GENERATOR/TRANSFORM LINEAGE WHEN GENERATED
JUSTIFIED CANONICAL OUTPUT SET
ZERO HAND-MAINTAINED MIRRORS
ZERO STALE GENERATED OUTPUT
ZERO DUPLICATE DTO/ENUM/API-TYPE AUTHORITIES
```

Generated code may contain many files when they are derived from one source. Do not force one-file output; eliminate parallel hand-maintained truth.

Migrate all consumers and delete old contracts/mirrors after cutover unless a proven live external consumer requires bounded compatibility.

## 4. Backend/frontend/data parity

For every exposed material meaning prove the applicable lineage:

```text
PERSISTED TRUTH
→ CANONICAL WRITER
→ DOMAIN SEMANTICS
→ API/EVENT CONTRACT
→ GENERATED CLIENT/BINDING
→ REQUIRED FRONTEND/OTHER CONSUMERS
→ USER ACTION/MUTATION
→ PERSISTED READBACK
```

Manual frontend business mappings, enums, DTOs, allowed-action logic or status interpretations that duplicate canonical semantics are shadow-truth candidates.

A clean backend and clean frontend that disagree semantically are not closed.

### 4.1 Cross-service facts, projections and mirrors

For every material cross-service fact/reference/projection/cache prove as applicable:

```text
CANONICAL_SOURCE_OWNER
CANONICAL_WRITER
SOURCE_EVENT/API
DERIVATION
MUTABILITY
PERSISTENCE
AUTHORITATIVE_OR_DERIVED
REBUILDABILITY_IF_DERIVED
CONSISTENCY_GUARANTEE / RETRY_MODEL
CONSUMERS
READBACK
CAN_IT_DIVERGE
IS_IT_USED_FOR_AUTHORITATIVE_MUTATION_DECISIONS
```

```text
DERIVED != AUTHORITATIVE
CACHED != CANONICAL
MATERIALIZED != SECOND_WRITER
```

Classify material mirrors:

```text
REDUNDANT_MUTABLE_MIRROR
→ MIGRATE CONSUMERS
→ DELETE

NECESSARY_DERIVED_PROJECTION
→ ONE-WAY
→ NON-AUTHORITATIVE
→ REBUILDABLE

CANONICAL_TRUTH_MISOWNED_OR_MISNAMED
→ REHOME/RENAME
```

## 5. Runtime/config/infra

Audit every material runtime authority:

```text
ENV VARIABLES
CONFIG FILES
FEATURE FLAGS
PORTS/ENDPOINTS
CONTAINER/COMPOSE/DEPLOYMENT
STARTUP/BOOTSTRAP
HEALTH/READINESS
QUEUES/JOBS
SECRET REFERENCES
OBSERVABILITY
ROUTING/PROXY
```

Eliminate competing authorities and stale runtime paths after cutover. Do not preserve scripts/config merely because historical tooling depends on them; migrate the consumer or refound the tooling.

## 6. Operational truth where material

Do not stop at compile/runtime startup when the affected root includes operational behavior. Audit only where material, but cover the real concern completely:

```text
OBSERVABILITY / ALERTING SIGNAL OWNERSHIP
FAILURE / RECOVERY / RETRY / RESTART
BACKUP / RESTORE / DATA RECOVERY
PRIVACY / RETENTION / DELETION LIFECYCLE
PERFORMANCE / CAPACITY / RESILIENCE
SUPPLY-CHAIN / DEPENDENCY / ARTIFACT PROVENANCE
EXTERNAL PROVIDER FAILURE / UNKNOWN RESULT
JOB/QUEUE REPLAY / IDEMPOTENCY
```

Do not invent arbitrary SLO/RPO/RTO numbers without a real requirement. But known material operational gaps block a trustworthy baseline.

### 6.1 Material mutation / operational failure contract

For every material mutation or externally consequential operation, prove as applicable:

```text
ACTOR / TRUSTED CONTEXT
PRECONDITIONS
ALLOWED STATE
FORBIDDEN STATE
COMMAND/ACTION
STATE TRANSITION
DURABLE DATA EFFECT
FINANCIAL EFFECT
EXTERNAL PROVIDER EFFECT
IDEMPOTENCY / REPLAY IDENTITY
TRANSACTION BOUNDARY
CONCURRENCY / LOCKING
TIMEOUT
RETRY / BACKOFF
PARTIAL FAILURE
UNKNOWN OUTCOME
COMPENSATION / REVERSAL
AUDIT
CANONICAL READBACK
CROSS-SURFACE FINAL RESULT
```

```text
A timeout is not proof of failure.
A returned success is not proof of durable commitment unless the required readback proves it.
UNKNOWN MUST REMAIN UNKNOWN UNTIL RECONCILED.
```

### 6.2 Version-skew and compatibility gate

When a contract/schema/event/client/runtime change can coexist with independently deployed consumers, enumerate every deployment combination that can materially occur.

Examples only when the deployment model permits them:

```text
CURRENT_MOBILE → NEW_BACKEND
NEW_MOBILE → COMPATIBLE_EXISTING_BACKEND
CURRENT_CONTROL_PANEL → NEW_BACKEND
GENERATED_CLIENT_VERSION → CONTRACT_VERSION
OLD_EVENT_PRODUCER → NEW_CONSUMER
NEW_EVENT_PRODUCER → COMPATIBLE_OLD_CONSUMER
LOCAL_CACHE/PERSISTED_CLIENT_SCHEMA → NEW_SERVER_SEMANTICS
FEATURE_FLAG_OFF/ON SAFE DEFAULT
ROLL_FORWARD PATH
ROLLBACK PATH
```

```text
TEST_ONLY_VERSION_COMBINATIONS_THAT_CAN_EXIST_IN_REAL_DEPLOYMENT
INDEFINITE_DUAL_SEMANTICS=FORBIDDEN
COMPATIBILITY_JUST_IN_CASE=FORBIDDEN
COMPATIBILITY_WINDOW_REQUIRES_OWNER_SCOPE_CUTOVER_CONDITION_REMOVAL_TRIGGER
```

Internal consumers under atomic repository control should normally cut over and delete the old path rather than manufacture compatibility.

### 6.3 Observability semantics

Material operations must expose enough attributable evidence to reconstruct the operation without leaking sensitive truth.

As applicable:

```text
CORRELATION_ID
REQUEST_ID
ACTOR_ID
TRUSTED_OPERATOR_CONTEXT
OPERATION/COMMAND_IDENTITY
IDEMPOTENCY/REPLAY_IDENTITY
CANONICAL_ERROR_CODE
STATE_TRANSITION / AUDIT_EVENT
PROVIDER_PROVENANCE
LATENCY / FAILURE / RETRY_SIGNAL
RECONCILIATION_SIGNAL
PII/SECRET_REDACTION
```

```text
LOGGED != AUDITED
METRIC != BUSINESS_TRUTH
TRACE != AUTHORIZATION
OBSERVABILITY MUST NOT BECOME A SECOND STATE AUTHORITY
```

## 6.4 Semantic external-capability boundaries

External integrations are modeled by stable semantic responsibility, not vendor/general-provider shape.

Examples:

```text
AUTH_CHALLENGE_ENGINE != DELIVERY_CHANNEL
FINANCIAL_RAIL != BILLER_FULFILLMENT
CACHE/COORDINATION != BUSINESS_TRUTH
VENDOR_ADAPTER != DOMAIN_OWNER
```

A timeout/unknown external mutation preserves operation identity and reconciliation semantics. Blind cross-provider fallback is forbidden when duplicate effect is possible.

## 7. Security and financial truth

Authentication, authorization, sessions, secrets, PII, provider credentials, isolation and financial mutation receive heightened proof.

```text
SERVER-SIDE AUTHORITY FOR SECURITY DECISIONS
NO CLIENT-ONLY AUTHORIZATION
LEAST PRIVILEGE
NO SECRET MATERIAL IN REPOSITORY OUTPUTS
IDEMPOTENT/TRACEABLE FINANCIAL MUTATION WHERE REQUIRED
NO PARALLEL BALANCE/LEDGER WRITERS
NO FLOATING FINANCIAL SOURCE OF TRUTH
AUDITABLE CANONICAL READBACK
```

Aggressive structural deletion never waives truth-preservation/migration proof for security or money.

Development/bootstrap credentials must not define normal Identity credential policy. Credential/verification strength, abuse controls and rate limits derive from current Identity/Security requirements, not historical development examples.

## 8. Tests are consumers, not truth by themselves

Inherited tests can encode obsolete architecture.

Classify each material test expectation:

```text
VALID_CANONICAL_SPEC
OBSOLETE_BEHAVIOR
DUPLICATE_COVERAGE
WRONG_LAYER_SPEC
MISSING_PREVENTION
BROKEN_TEST_INFRA
```

Update/delete tests with the refoundation unit. Never weaken a valid assertion merely to obtain green output.

Tests, fixtures, mocks, snapshots and helpers tied only to losing containers must migrate or be deleted in the same unit.

## 9. Tool execution condition classification

A tool can fail independently of Product code. Classify material tool/execution conditions as:

```text
DIAGNOSIS_BLOCKER
EXECUTION_FINDING
DEGRADED_EVIDENCE
NOT_APPLICABLE
EVIDENCE_AVAILABLE
```

Only a proven `DIAGNOSIS_BLOCKER` can stop a dependent treatment solely because evidence is missing. `EXECUTION_FINDING` and `DEGRADED_EVIDENCE` do not force the whole campaign to stop when another root is already sufficiently proven.

This preserves speed while keeping missing closure proof visible.

## 10. CI/assurance control-plane refoundation

CI is not privileged structure. `.github/**`, assurance scripts, custom guards, scanner adapters and evidence collectors must re-earn existence.

Audit for:

```text
DUPLICATE VERIFICATION AUTHORITY
PR-ONLY ASSUMPTIONS IN h
DEFAULT/OLD-BRANCH TRUST
STALE g/master AUTHORITY
UNCONSUMED SCANNER OUTPUT
SUPPRESSION / ALLOW-FAIL MASKING
DUPLICATE CUSTOM GUARDS
FAKE HUMAN/COMMENT ATTESTATION USED AS EXECUTION PROOF
CAMPAIGN-ONLY RESIDUE
EXCESSIVE INDIRECTION/COST WITHOUT UNIQUE CLAIM
```

When the control plane is the root, refound it as one surface rather than patching workflows one-by-one.

Preferred durable shape:

```text
ONE CANONICAL EXACT-CANDIDATE CONTROLLER PER DISTINCT ASSURANCE ROLE
→ REUSABLE WORKERS WITH UNIQUE CLAIMS
→ NO PR REQUIREMENT
→ NO OLD-BRANCH AUTHORITY
→ FAIL-CLOSED MATERIAL NOT_COVERED
→ CAMPAIGN-ONLY WORKFLOWS DELETED AFTER USE
```

Do not preserve repository-baseline, PR dispatcher, PR comment evidence or other historical structures unless they independently prove unique required value for the intended canonical repository baseline.

## 11. Verifier/admission-hole law

When a defect was accepted because verification was weak, closure requires fixing both product/structure and detector/admission authority.

If the verifier itself is wrong:

```text
DEFINE CANONICAL CLAIM
→ REBUILD VERIFIER
→ PROVE GOOD CASE PASSES
→ PROVE KNOWN BAD CASE FAILS
→ THEN USE IT AS EVIDENCE
```

Never weaken a gate to obtain green.

## 12. GitHub Actions on the invocation branch

The invocation branch may create, rewrite, run and delete actions as needed within current authority.

Persistent workflows survive only with unique durable baseline value. Diagnostic/campaign workflows are temporary by default.

Every authoritative workflow must prove exact candidate identity and must not depend on PR/default-branch semantics unless an actual external requirement makes that necessary.

If real rendered/device/runtime evidence is required but unavailable:

```text
CLAIM=NOT_COVERED
```

Do not replace it with a PR comment or self-attestation.

## 13. Evidence ingestion

Every material tool result must be consumed:

```text
FINDING
MATERIALITY
AFFECTED_CLAIM
CAUSAL_ROOT/UNIT_MAPPING
DISPOSITION
REVERIFY_REQUIREMENT
LIMITATION
```

Scanner execution is not finding closure.

## 14. Dependencies and toolchain

Every dependency, workspace edge, toolchain pin and custom script must re-earn existence.

Delete unused dependencies after migration. Consolidate duplicated tooling/libraries when they encode the same responsibility. Remove custom automation when native compiler/test/build/runtime/security tooling gives the same or stronger unique claim more simply.

## 15. Runtime and experience proof

When behavior is runtime-material, static evidence is insufficient.

Prove startup/request/persistence/readback/experience at the highest material boundary affected by the refoundation unit.

For mobile/web, distinguish source/config correctness from actual rendered/device execution; do not claim one as the other.

## 16. Final assurance cleanliness

At fixed point:

```text
NO_DUPLICATE_MATERIAL_CI_AUTHORITIES
NO_PR/DEFAULT/OLD_BRANCH_h_TRUST_ASSUMPTIONS
NO_CAMPAIGN_ONLY_WORKFLOW/TOOL_RESIDUE
NO_FAKE_EXPERIENCE_ATTESTATION
NO_UNCONSUMED_MATERIAL_STATIC/SECURITY_FINDINGS
NO_UNUSED_MATERIAL_DEPENDENCIES
NO_DUPLICATE_CONTRACT/MIGRATION/RUNTIME_AUTHORITIES
NO_KNOWN_UNVERIFIED_MATERIAL_DATA/SECURITY/FINANCIAL/OPERATIONAL_CLAIMS
```
