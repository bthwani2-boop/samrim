# BThwani — Security, Data Integrity and Recovery

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/safety.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Security and privacy are invariants, not policy switches
Identity authenticates the actor; the real DSH/WLT owner authorizes each protected mutation and read by role, current Store, city, delegated scope and action. Operator Policies can configure **eligible business choices**, never bypass actor validation, Root Owner restrictions, CSRF, IDOR protection, ledger conservation, tenant isolation, audit trail, protected-data retention or legal consent.

All financial, Store, Order, media and Customer/recipient data must respect least privilege and need-to-know. Draft or unapproved Stores, unrelated actors, candidate Captains and revoked members do not gain access through a public URL, cursor, mobile offline storage or stale session-scoped request. A Captain receives private customer delivery details only when validly assigned for that operation. Store-facing media links and customer contact data need bounded exposure and lawful retention.

## Policy mutation protections
- Every editable policy has one owner, permitted scope and options, authenticated actor/permission, canonical version, effective date, reason, audit log, idempotent mutation and owner-backed readback.
- Two concurrent changes to the same scope must not both silently succeed with contradictory effective versions. A timed-out POST cannot be retried with a fresh mutation identity until canonical read resolves the outcome.
- A stored policy is not proof an unimplemented capability can activate. Owner checks billing, payment, publication, dispatch/cash and legal readiness before applying it to a real request.
- Rollback is a new version and preserves prior agreements, Order/customer rights and financial history. Every policy read and write has explicit failure behavior; never fall back to a permissive stale client constant.

## SQL, finance and migration protection
- WLT is sole authoritative wallet/ledger owner. Preserve exact integer YER money arithmetic, double-entry conservation, immutable transaction history, once-only release/debit/settlement under retry and concurrency; disputed or unknown outcomes stay explicit.
- Each service owner has one canonical migration/source of schema truth. A new clean baseline is designed by reasoning from supported capabilities, not copying historic SQL. Applied migration history and actual databases must not be silently squashed or rewritten; isolate fresh bootstrap and protected upgrade/rollback/restore proof.
- Protect Root Owner, users, sessions, wallet balances, Orders, media, provider secrets, schemas and shared environment data. No direct SQL/test fixture may manufacture financial or security PASS. Test credentials and synthetic data need authorization/isolation and secure disposal.
- A new Docker/Compose environment uses separately named project/services, networks, ports and volumes. Do not start or replace containers in the old environment merely to assemble governance.

## Software and supply-chain safeguards
- Retain proven dependencies, signing identities, domain routes and credential boundaries. Do not add a plugin, wrapper, CI agent, secret store or external provider without a concrete owner and necessity.
- GitHub Actions use minimum token permissions and do not expose secrets to untrusted PR/fork code. Fast Guard and provider review checks are proof instruments, not authority to approve business decisions.
- Retired historical features do not regain production permissions. If historic financial/legal liabilities survive, preserve them in protected owner history without restoring a screen or writer for new transactions.

## Proof, independent review and incident readiness
For affected risk surfaces: forged actor/Store IDOR, account switch with pending reads, stale permissions, policy race, price/cart change, COD/Mixed partial funding, double debit, settlement timeout, refunds, lost/late dispatch acceptance, publication rollback and media privacy. Verify persisted owner facts and explicitly report NOT_RUN where needed.

Changes to real finance, authentication/security, migration/deletion or sensitive data require an independent competent review per approved process; otherwise REVIEW_BLOCKED even with passing local checks. Security/financial acceptance is never inferred from a document, green pipeline or HTTP 200 alone.
