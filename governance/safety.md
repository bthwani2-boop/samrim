# BThwani — Security, Data Integrity and Recovery

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/safety.md
STATUS: ACTIVE_FOR_PROGRESSIVE_DEVELOPMENT
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Security and privacy are invariants, not policy switches

Identity authenticates; the actual DSH/WLT operation independently authorizes the current role, Store, city, delegated scope and action. Root Owner restrictions, tenant isolation, CSRF and IDOR defenses, ledger conservation, audit, retained rights, lawful consent and privacy are not adjustable policy choices.

Authentication, recovery and machine-to-machine authority require trusted proof, not caller-authored actor/role claims. Missing or invalid proof fails closed. Public authentication avoids unnecessary enumeration. Bound challenges by purpose, expiry, attempts, throttling, single use and replay protection. Protect credentials, tokens and recovery secrets; revoke/rotate upon compromise and never log them. Operator authority follows Identity, not a weaker parallel login.

Apply need-to-know and least privilege to financial, Store, Order, media, Customer and recipient facts. Draft/unapproved Stores, unrelated actors, candidate Captains and revoked membership cannot inherit access via public URL, cursor, offline storage, pending request or stale cache. Only the lawful assigned Captain receives the private delivery details needed for that task.

Company HR and each Merchant's HR remain isolated. Employment or Store association cannot implicitly grant Identity or Store authority; unrelated personnel, private attachments, stale sessions and revoked staff scopes must be denied. WLT alone records monetary effects.

## Location consent and current-mission least privilege

DSH may retain only the bounded latest availability fix needed for eligible platform dispatch; no historical movement trail or individual-Captain directory. Before acceptance, candidate and aggregate maps conceal precise customer destination, private address and individual Captain location.

The admitted active assignment may separately expose its single latest mission fix, bounded by freshness, accuracy and sequence, only to specifically authorized Operations for that Order. Customer, Merchant, other Captains, general notification and opportunity map have no inherited GPS entitlement. Assignment end, expiry, revocation, logout and lawful retention cleanup end effective access. Stale/offline observations remain explicit; never fabricate movement.

Android background tracking needs affirmative platform permission and a visible operating notification where required. JavaScript export is not evidence of native consent or behavior. [Fulfillment](fulfillment.md) owns operational thresholds and mission semantics within these privacy constraints.

## Policy mutation protections

The canonical mutation and rollback protocol is [architecture](architecture.md#safe-change-protocol); do not create another policy authority. Security acceptance must demonstrate rejection of unauthorized actor/scope, invalid or stale versions, incompatible concurrent writes and unsafe replay after unknown outcome. Test that a configured value cannot activate unsupported billing, payment, publication, dispatch, cash or legally unaccepted behavior. No permissive stale-client fallback. Rollback cannot erase previously accepted rights, agreements or history.

## SQL, finance and migration protection

WLT alone owns authoritative wallets and ledgers. Preserve exact integer YER arithmetic, double-entry conservation, immutable history and once-only release/debit/settlement under retry and concurrency. Disputed and uncertain effects remain explicit, never manufactured by direct SQL or test fixtures.

[SQL-01](engineering.md#sql-01--safe-one-baseline-per-owner-fresh-bootstrap-protected-upgrades) owns baseline-first, fresh schema and retained-upgrade lifecycle; [repository structure](../REPOSITORY-STRUCTURE.md) owns placement. A fresh baseline is not a retained-data migration. A development label or clean source tree cannot authorize destructive reset. Preserve actual applied history, checksums, records, sessions, grants, Root Owner, Orders, balances, audit, media, credentials and shared data. No new retained-data epoch without the separate approval and rehearsed compatible upgrade.

Before a protected migration or deletion, verify exact source, applied schema/version/checksums, affected records, preconditions, authority and a restricted restorable backup. Rehearse the same deterministic ordered migration and restore on an isolated copy. Coordinate or stop incompatible writers under actual authority; reject mismatching version, ownership, preconditions or backup integrity. Before resuming writers, prove applied version, preserved identities, constraints, grants, financial/session invariants and compatible owner-service durable readback. A passing fresh bootstrap never certifies retained migration or restore.

Synthetic writes require verified database/namespace, role, isolation and operation-specific admission. Never use production credentials, real customer contacts or live payment/message rails. Separate automated tests from persistent development and each other. Keep test credentials isolated and dispose only after verified ownership, absence of retained/shared dependency and authorization. Preserve useful and unknown-origin development data; no test-only business columns or alternate writers. New Docker/Compose test environments use distinct project/services, networks, ports and volumes, never implicit replacement of an existing environment. No shared reset through normal development lifecycle. See [local data lifecycle](engineering.md#local-development-data-lifecycle).

## Software and supply-chain safeguards

Preserve proven dependencies, signing identities, domain routes and credential boundaries. New plugin, wrapper, CI agent, secret store, provider or dependency needs distinct demonstrated responsibility and necessity. Use official compatible versions, locked dependencies, verified source/artifacts and applicable vulnerability/security checks; no hidden substitution or weakened acceptance.

GitHub Actions use minimum token permissions and must not expose secrets to untrusted PR/fork code. Required checks and provider reviews are verification instruments, not authority to approve business decisions. Retired features cannot regain production access; retained legal or financial liabilities stay protected at their owners, without restoring an obsolete writer or screen for new transactions.

## Proof, internal technical risk assurance and incident readiness

For affected critical risks, prove actual owner-backed denial and durable outcomes: forged actor/Store IDOR, cross-account switch with pending reads, stale/revoked grants, policy races, price/cart change, COD/Mixed partial funding, double debit, settlement timeout, refund, lost/late dispatch acceptance, publication rollback and media privacy. Include interruption, recovery, concurrency and applicable restoration proof. Missing tests remain NOT_RUN or REVIEW_BLOCKED, never PASS.

**Human-approved 2026-11-26 risk assurance:** The responsible executor performs attributable internal adversarial assessment and verifies evidence. No separate independent reviewer or reviewer signature is mandatory merely for development or acceptance, including financial implementation. Before activating actual finance, authentication/security, protected migration/deletion or sensitive-data effects, require applicable specific human approval, owner contracts and authorization, negative verification, financial/concurrency or restore proof and documented risk assessment. Unverified implementation remains unaccepted. Self-assertions, documentation, a green pipeline or HTTP 200 are not substitutes. Do not represent external audit or signature as performed; legal consent, obligations and actual protected authority remain binding.

## Database roles, enforceable constraints and bounded reads

A service runtime identity may access only its own schema/facts with minimum privileges. Schema administration and migrations use distinct controlled authority. Cross-owner reads require an explicit reviewed contract or approved bounded projection, not indiscriminate SQL access. Prove permitted same-owner effects and denied unrelated-owner reads/writes.

Enforce expressible uniqueness, foreign keys, NOT NULL, range/check constraints, atomicity, concurrency/idempotency and required scope/authorization at the strongest practical persistence boundary. Client/service validation complements that boundary, never replaces it. Source and domain records use verified UTF-8 without BOM; decode legacy external encodings only at ingestion. Preserve Arabic Unicode, mixed-direction identifiers and original facts through API/storage/display; a justified consumer-required BOM (such as Excel-compatible CSV) is an export exception, not a source convention.

Growing collection reads use owner-side bounded pagination/filter/sort and stable deterministic tie-breaks with permission-scoped cursors where needed. Reject stale or mismatching scope without leaking another Store or silently changing the query. Choose the simplest correct pagination mechanism at the owner; no universal paging engine.

## Failure contract, cross-owner degraded state and evidence

Material owner APIs expose stable machine-classifiable error categories and canonical operation/reconciliation identities. Human-readable Arabic text is not a business-decision parser. A multi-record command may report partial completion only for a finite scope with reconstructable durable per-item outcomes; never label partial progress an atomic success.

A missing second-owner acknowledgment in a money or authorization handoff is explicitly incomplete/degraded. Local success or historical snapshot cannot alone authorize an irreversible transfer. Reconcile unknown provider results before a potentially duplicate effect; reconstruct restart/resume from current owner facts, not stale memory or cached client success. A timeout changes durable state only when the domain contract explicitly defines that consequence. No silent fallback to a different canonical writer, authority or meaning of success. Health/readiness distinguish configured, available, degraded and unknown when material; correlate causes without leaking secrets or unnecessary personal data.

Media has one lawful upload/reference/retention path. A derived preview cannot make private Store/Order attachments public. Orphan cleanup requires ownership and retention proof, never blanket filesystem deletion. The actual fact owner executes lawful retention, deletion and anonymization without erasing another owner's protected history; licensing/provenance and permitted visual use stay with the relevant design/domain owner.
