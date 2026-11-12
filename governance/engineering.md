# BThwani — Engineering, Policy Admission and Refoundation Quality

ARTIFACT_CLASS: DOMAIN_GOVERNANCE_DRAFT
SEMANTIC_OWNER: governance/engineering.md
STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER
IMPLEMENTATION_STATE_AUTHORITY: NONE

## Staged work and authority
**Current program sequence is mandatory:** (1) finish and reconcile root `governance/`, `AGENTS.md`, `REPOSITORY-STRUCTURE.md`, temporary `docs/REFOUNDATION-PLAN.md`, and stage-appropriate `.github/` guards; (2) review and approve a coherent **governance cutover**; (3) only then create the agreed new technical baseline, SQL, apps and services, then (4) accept end-to-end evidence.

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
