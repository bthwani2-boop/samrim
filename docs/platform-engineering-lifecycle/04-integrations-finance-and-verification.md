DOCUMENT_CLASS: HUMAN_DEVELOPMENT_AND_OPERATIONS_GUIDANCE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
PARENT_GUIDE: docs/platform-engineering-lifecycle/README.md

INTERPRETATION_RULE: HUMAN_REFERENCE_ONLY; MODULE_NUMBER_IS_NOT_EXECUTION_ORDER; CHECKLIST_IS_NOT_CLOSURE_AUTHORITY

# Providers, Async Work, Notifications, and Financial Systems

## Providers

Terminate provider details at explicit semantic adapters/ports.

For every external integration define:

```text
owner
credentials
request/response contract
timeouts
retry/idempotency
rate/quota behavior
signature/verification
error normalization
unknown-result behavior
observability
reconciliation
sandbox/test strategy
```

Provider names must not become business-domain owners.

## Async work

Introduce queues/events only when asynchronous decoupling, durability, throughput, or failure isolation proves the need.

When database state and event publication must be atomic, a transactional outbox is a common valid pattern.

Workers/consumers must address:

```text
duplicates
idempotency
ordering where required
lease/visibility timeout
restart/replay
poison/dead-letter handling
backpressure
stuck-work detection
correlation
```

## Notifications

Notification delivery is not proof that source-domain mutation succeeded, and notification retry must not replay the source-domain mutation.

## Financial core

For authoritative wallet/ledger/payment/refund/settlement systems, use accounting-grade invariants.

As applicable:

```text
exact monetary representation
currency discipline
immutable/append-only journal semantics
double-entry accounting for ledger/wallet movement where appropriate
holds/releases
idempotent commands
provider evidence
reversals rather than arbitrary history rewrite
reconciliation
auditability
unknown external outcomes
separation of available/held/pending state
```

Never use floating-point arithmetic for authoritative money.

```text
PROVIDER_TIMEOUT != SUCCESS
PROVIDER_TIMEOUT != FAILURE
PROVIDER_TIMEOUT = UNKNOWN UNTIL RECONCILED
```

---

# Verification Architecture

Testing starts with the first capability and expands by risk.

Use the smallest evidence that can falsify a claim, then expand.

Applicable evidence includes:

```text
unit tests
domain/invariant tests
property/fuzz tests where valuable
database integration tests
migration/upgrade tests
contract/schema tests
service integration tests
concurrency/race tests
negative authorization tests
frontend/component tests
mobile interaction tests
accessibility tests
RTL/localization checks
multi-surface E2E
provider sandbox/fault tests
network degradation/offline
performance/load/capacity
restart/recovery
backup/restore
real-device testing
security review/penetration testing
```

Do not optimize for test count. Optimize for coverage of material failure modes.

## Real-device matrix

Choose by risk and supported users, not by a ceremonial fixed list.

Include representative combinations of:

```text
low-resource Android
current mainstream Android
different screen classes
current iPhone
oldest materially supported iPhone/OS
slow/high-latency network
offline/reconnect
permission denied/revoked
location disabled
background/foreground
OS process kill/relaunch
large text/accessibility settings
expired/revoked session
battery/background restrictions where operationally relevant
```

Operational driver/captain applications may require especially strong background-location, battery-management, process-death, and intermittent-network verification.

---
