# Feature Specification: Governed Admission to Commercial Implementation

**Existing Git branch:** `refoundation/clean-house-20261112` — no feature Branch or Worktree was created.
**Spec Kit CLI:** pinned local `specify 1.3.0`, agent-neutral `none` integration.
**Status:** DRAFT — DEVELOPMENT OPEN FOR EXISTING AND PROPOSED CAPABILITIES; journey/runtime acceptance remains NOT_RUN.
**Semantic owners:** `governance/README.md` and its 14 listed owner documents; this specification is a derived acceptance workflow, not another policy writer.
**User goal:** Enable Close as We Go now: progressively analyze and build existing and new proposed capabilities as deep, multi-surface, owner-backed journeys; close their acceptance with evidence while reconciling whole-platform policy separately. Preserve donor branch `41` as read-only.

## User scenarios and independently testable acceptance

### US1 — Product owner decides if governance can direct implementation (P1)

The owner can identify the exact revision, meaning, provenance, unresolved conflicts and risk acceptance for every admitted material requirement **before** anyone changes the cutover marker.

**Independent test:** Read the 14 owner documents, the 26-capability census and 16 admitted journeys on an exact Git SHA; check provenance at the donor's pinned blob/line; challenge material choices with negative cases; inspect signed-off human choices and the internal risk evidence. A document's presence or matching heading must not count as approval.

1. **Given** a substantive donor obligation is unresolved, **when** admission is assessed, **then** the specific obligation, owner and missing semantic decision are reported as `REVIEW_BLOCKED`, and `GOVERNANCE_CUTOVER` remains `NOT_READY`.
2. **Given** every material Product/Owner/Legal/Financial/Security requirement has a reviewed disposition and applicable risk analysis, **when** the human Product owner approves the precise revision and guard checks pass, **then** a separate, explicitly reviewed cutover change may set `READY`.
3. **Given** policy is approved, **when** no actual service has been deployed or database restored, **then** policy readiness may be recorded without falsely labelling service/runtime readiness `PASS`.

### US2 — Engineer prepares one feature on the existing authorized Git branch (P1)

An engineer can use the installed **official Spec Kit CLI and bundled PowerShell scripts** to create `spec.md`, `plan.md` and `tasks.md` on the existing Worktree without creating a new Git branch or writing shared `.specify/feature.json`.

**Independent test:** Run `specify --version`, `specify check`, `specify workflow list`, and the installed Spec Kit scripts with `SPECIFY_FEATURE_NO_PERSIST=1` and an explicit `SPECIFY_FEATURE_DIRECTORY`. Confirm `git branch --show-current`, `git status --short .specify` and the feature files; test that missing feature, plan or tasks blocks prerequisite validation.

1. **Given** no feature context, **when** required Spec Kit prerequisites are checked, **then** validation fails rather than silently inventing a feature or moving branches.
2. **Given** the feature directory and complete spec/plan/tasks, **when** prerequisites run with no persistence, **then** path and document checks pass and `.specify/feature.json` remains unchanged.
3. **Given** a concurrent Git writer, **when** a feature is complete, **then** its exact files are staged, committed and pushed only under the exclusive Git-turn protocol and after unrelated staged changes have been cleared by their owner.

### US3 — First business slice can be engineered without guessing money or permissions (P1)

Without waiting for whole-platform governance cutover, a thin real owner-backed Store/discovery or authentication slice has an executable contract, error and permission matrix, independent SQL/migration assurance as appropriate, and actual screen/owner-readback acceptance. The slice does not inherit functional acceptance from a historical file census.

**Independent test:** For an approved feature, follow its Product owner and role through an actual contract operation, denied cross-actor/Store attempt, authenticated owner-side persistent readback, relevant Android/Web UI path, and failure/retry case on the same exact source and environment revision.

1. **Given** a missing executable contract or resource authorization, **when** journey closure or activation is requested, **then** the unproven behavior remains NOT_RUN/BLOCKED; a placeholder OpenAPI `paths: {}`, mock response or static screen does not qualify, but specification and owner-side development may proceed within the permitted scope.
2. **Given** Store and Catalog are admitted for implementation, **when** a Merchant modifies one Store and a Customer reads its published Offer, **then** data comes from the DSH owner, Identity authorizes the actor and Store scope, and a second Store/account cannot read or write restricted data.
3. **Given** an Order, cash, balance or settlement path is later admitted, **when** replay, concurrency, timeout or partial failure occurs, **then** the owner-backed test must prove idempotency, consistent DSH/WLT readback, no double debit/accept, conserved ledger and a recoverable unknown outcome before activation.

## Requirements

- **FR-001:** Treat the **latest explicit human-approved** Product rules and 14 canonical `governance/` owners as the sole normative sources; use `docs/reference/` solely for source provenance, never as a parallel policy or runtime-acceptance source.
- **FR-002:** Reconcile all **26 capability IDs** and their material subfeatures with one owner, plus the **16 admitted journeys** and their errors, authorization and observable handoffs. Resolve or explicitly block every material historical clause; do not promote all 340 donor headings merely because they were indexed.
- **FR-003:** Preserve the 2026-11-13 human-approved FIN-01/02/03, SEC-01/02, MIG-01 and LEGAL-01 target directions in their actual owner documents without inventing independent/external reviewer signatures, financial balances, consent or evidence.
- **FR-004:** Document internal technical threat/adverse analysis for material finance, authentication, privacy, migration and legal consequences; actual live activation separately requires owner-backed negative/concurrency/restore proof, as applicable.
- **FR-005:** Preserve exactly one business writer per mutable fact: Identity for actors/sessions/platform grants; DSH for Store/catalog/Order/fulfillment; WLT for ledger/cash/agreements/settlement. Do not create a fourth HR business service or independent policy engine.
- **FR-006:** Development is open for all existing and newly proposed capabilities. Adapt the old Stage-4-only verifier and isolate new owner runtime/SQL; no full governance cutover or per-capability vote is required to write relevant business code. A `READY` marker or document is **not** proof of a native binary, service or deployed system, and production remains blocked pending evidence and authority.
- **FR-007:** During each journey, including newly proposed capability work, record caller role, legal owner, inputs, success, explicit errors, resource ID authorization, idempotency/unknown outcome and executable negative tests; use them to verify acceptance before closing its API/screen.
- **FR-008:** Use pinned original toolchain, preserved Expo/EAS identities, native RTL/security constraints and one design-semantic source. Select mobile renderer/PG isolation by verified representative tests; untested iOS/Android/SQL paths remain labelled `NOT_RUN`.
- **FR-009:** Use official Spec Kit 1.3.0 templates/scripts on the current authorized branch with `SPECIFY_FEATURE_NO_PERSIST=1`; do not use Codex CLI, create Branch/Worktree/PR, modify donor branch 41, or bypass another writer's Git-turn.
- **FR-010:** Do not overwrite protected databases, signer/provider keys, historical legal rights or production financial state to make the test pass.

## Failure and boundary cases

- A historic requirement has a matching new title but changed meaning: keep semantic review OPEN until evidence establishes the actual rule.
- Financial coverage policy admits a Captain who cannot safely cover the exposure: continue isolated analysis and engineering, but do not claim the financial behavior accepted or enable real exposure until FIN-01 adverse cases validate the chosen risk law.
- The same Order key is replayed with different payloads; two Captains accept simultaneously; delivery is interrupted: require explicit deterministic owner behavior and negative proof.
- A Merchant switches Stores or an Operator loses scope mid-request: reject stale/cross-Store actions without exposing customer addresses.
- SQL topology grants WLT direct DSH write or unsafe public-schema CREATE: fail the isolation test before production admission.
- A mobile preview compiles but no signed native app is installed: report `NOT_RUN`, not success.
- A Spec Kit command tries to write `.specify/feature.json` or create a Git branch: reject or run only in no-persist/dry-run mode.
- CI/Sonar/CodeQL PASS on one SHA but another SHA is the handoff candidate: rerun only invalidated gates on the final revision.

## Acceptance criteria (all must be satisfied for the specifically claimed stage)

- **AC-01 Governance:** Each existing or new journey closes only after 100% of its applicable and traceable cross-surface criteria pass with owner/source evidence; full 14-owner semantic review remains necessary only to declare final `GOVERNANCE_CUTOVER: READY`, not to start development.
- **AC-02 Developer workflow:** `specify check` and official no-persist feature prerequisite checks PASS; content-specific `spec.md/plan.md/tasks.md` exist and are not empty templates; branch 41 unchanged, no new branch/worktree and no foreign staged paths in own commit.
- **AC-03 First service slice:** before claiming journey closure, owner contract, real service data, permission denial, failure recovery and owner-backed readback are demonstrated with tests; any native/DB/migration evidence is tied to exact SHA, versions and isolated test environment.
- **AC-04 No false aggregation:** governance-ready, service-ready, finance-ready, mobile native-ready and release-ready remain separate PASS/BLOCKED/NOT_RUN states. No global 100% correctness claim.

## Current known blockers (evidence, not permanent normative rules)

At initial creation on 2026-11-14, `governance/README.md` still reports `NOT_READY`; the source census identifies 340 donor headings, 113 documentary dispositions and 227 `REVIEW_PENDING` without full semantic parity; service OpenAPI remains reserved empty, with no new owner-backed Go/SQL implementation or current native finance E2E. These facts are rechecked from HEAD before each gate, never used as a stale hard-coded decision.
