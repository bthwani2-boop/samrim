# Samrim agent law

## 1. Authority and exact state

Current user/task authority controls the work within repository, Product, security and data-safety constraints.

Before consequential work, confirm the exact repository, branch, HEAD and relevant working state. Re-read HEAD immediately before a material write when the branch may have moved.

`CAPABILITY != AUTHORITY`. Tool access does not authorize a mutation.

Commit or push authority does not imply merge, promotion, release, destructive-operation or external-system authority.

Preserve unrelated changes, secrets, durable data and active user state.

`MATERIAL` means capable of changing behavior, meaning, authority, safety, durable data, contracts, runtime/configuration, user experience, external/deployable identity, evidence validity or operational outcome.

## 2. Approved outcomes, decisions and canonical owners

Local docs/governance/README.md routes challengeable approved Product/platform/architecture/policy decisions. Actual source, schemas, API contracts, tests, configuration and runtime readback own current implementation truth. Historical external governance and competitor research are read-only evidence, not operational dependencies.

Classify each material durable impact as NONE, REVALIDATE_ONLY, UPDATE_REQUIRED or DEFECT_FOUND. Correct the one applicable local durable owner for approved changed meaning in the same coherent change batch as materially affected implementation/tests; if a PR is separately human-authorized, keep them together in that PR. Never invent commercial features, promote speculative instructions, duplicate executable facts or require routine donor reads. AGENTS.md alone owns agent execution law; REPOSITORY-STRUCTURE.md owns placement.

### Approved conversation decisions and temporal precedence

Where the current user explicitly approves a sequence of Product/refoundation discussions, treat the later approved decision as superseding an incompatible earlier recommendation **for that same meaning**; compatible earlier decisions remain. Reconcile once at the relevant canonical governance owner before implementation. Earlier audit/HEAD/implementation claims remain dated evidence only, not authorization to perpetuate obsolete code or rename public identities. A conversation-level Product approval is not separate permission to destroy data, reset shared runtime, make external payments, push, open PRs or merge. Never duplicate an approved decision in the execution plan or agent law.

## 3. Discovery, ownership and simplification

Do one bounded discovery sufficient to identify the affected cone, current truth, canonical owner, causal root, risk and required proof. Then execute. Widen only when new evidence can materially change the repair.

The implementation and closure unit is a bounded cross-surface vertical slice, including every materially affected app, operator surface, service, contract, state owner and applicable local approved decision. Search material connections across affected local owners and evidenced external interfaces, read deeply only inside the proven cone, and close required behavior plus obsolete/duplicate paths; do not split by screen or manufacture platform-wide audits. End-to-end Journeys remain integration proof scenarios, not a parallel execution queue.

Use native/current evidence before adding diagnostic abstractions. Repair the highest proven causal root, not downstream symptoms.

Prefer the simplest complete correct solution. A small change must remain small.

Default preference:

`DELETE -> DIRECT USE -> STANDARD TOOL -> EXISTING OWNER -> MERGE -> SIMPLIFY/REFACTOR -> NEW MECHANISM ONLY WHEN REQUIRED`

Keep complexity only for a proven current need. Existing wrappers, verifiers, compatibility paths, diagnostics, caches, state machines, registries, workflows or abstractions do not justify themselves by existing.

`SIMPLIFICATION MUST REDUCE MACHINERY, NOT REQUIRED MEANING.` A deletion or refoundation is valid only when each unique current responsibility is unnecessary, retained in compact form, moved to its canonical owner, proven duplicate, proven obsolete, or replaced by a stronger existing truth.

Do not solve complexity by adding another layer around it.

Give each mutable fact one canonical owner/writer. During replacement, migrate callers, configuration, contracts, tests and required documentation; cut over; then delete the losing path and stale references.

**MANDATORY — NO PARALLEL BUSINESS ENGINES:** One canonical engine per essential operation in its existing bounded owner. BTHWANI_PARTNER versus INDEPENDENT_STORE differences belong to canonical policies, eligibility, publication, fulfillment and agreements; they never justify a cloned Store/catalog/price/inventory/checkout/order/finance engine, competing table/schema, service, shadow state or dual writer. Reject any such parallelism in design, code or review, regardless of its name, existing files or perceived convenience. Before adding a truly distinct mechanism, establish the existing owner's actual inability to represent the unique responsibility correctly and obtain explicit governance approval under `docs/governance/architecture.md`; no exception can duplicate an existing fact's writer or essential engine. Derived read models and bounded technical adapters remain non-authoritative. Migrate and prove the cutover before retiring legacy paths; do not delete durable data or active consumers merely to enforce this rule.

When replacing or refounding a canonical path, migrate every materially affected producer, consumer, contract, durable state/persistence path, runtime/configuration dependency and required proof before deleting the losing path. A cutover is incomplete while any material writer, reader, state owner, runtime dependency or contract still relies on the losing path.

Preserve required Product behavior, security, authorization, privacy, data integrity, contract integrity and operational safety throughout simplification.

### Required structural responsibility check

For every refoundation slice materially affecting files, names or ownership, consult `REPOSITORY-STRUCTURE.md` before writing: identify the winning owner/path, affected consumers and generated sources, and which old files/aliases must disappear. Keep a small task-scoped mapping of KEEP/MOVE/MERGE/REPLACE/DELETE and objective proof, not a permanent second inventory. After the replacement is verified, inspect Git and relevant dependency/build/contract references for orphan files, duplicate writers, stale names and dead imports/routes; leave unrelated concurrent work untouched. Do not claim slice PASS while a material stale/parallel path remains. A change without structural impact need not perform a repository-wide file census.

### Mandatory refoundation capability-conservation and anti-drift gate

Before a rewrite, migration, UX redesign, design-system cutover or removal, enumerate the **materially affected existing capabilities and subfeatures** from current source, routes, contracts, tests, runtime configuration, canonical Product owners and preserved research. For each, establish its actor/surface, current status (working/partial/obsolete/unknown), original writer/consumers, durable state, safety/finance/privacy invariants, target disposition (KEEP/REFOUND/MERGE/REPLACE/APPROVED_RETIRE), and falsifiable proof. A named capability and its specialized media, map, search, export, reporting, accessibility or recovery behavior are not disposable merely because an implementation file is old or a redesign omits them. Unknown disposition is `UNRESOLVED` and blocks deleting that behavior.

At each coherent execution boundary, compare the exact current HEAD to the last accepted checkpoint, protect concurrent work and already-valid proof, and state the one unresolved objective and next smallest vertical slice. Reject scope drift, redo of proven work, parallel source/engine creation, placeholder success and broad rewrite without a traced preservation/cutover path. Update the owning governance rule **only when approved meaning changes**; an inventory or audit note is non-authoritative evidence, never a duplicate Product catalog or backlog. An unproven material gate is `BLOCKED` or `NOT_RUN`, not `PASS`; completion cannot promise perpetual 100% correctness.

For every materially affected workflow, enforce the effort-minimal, high-volume actor experience in `docs/governance/experience.md`: require only necessary facts at the current stage, reuse canonical data, make optional inputs non-blocking, minimize repeated user actions and expose clear completion/recovery. Reject unjustified UX or technical machinery; retain essential safety in its existing owner and prove the simpler real task, not just fewer screens.

## 4. Local development state

The current project phase is local development, before Stage/Production adoption. Entry into shared Stage/Production requires an explicit governed transition. Local phase alone does not make existing state disposable.

Reuse valid warm local state. Do not restart services, Metro, Next.js, backends, containers, sessions or devices merely as ritual when the current state can prove the claim.


### Local runtime ownership and remote development

Before starting, stopping, testing or relocating an application or backend, inspect the executable runtime-owner configuration and verify the actual host, listener/process, active connection and source revision. Repository location, a CLI command name or historical conversation must never be treated as proof that the process runs on that machine. For the current local workflow, see `infra/local/README.md`; that runbook is explanatory and the executable configuration/runtime readback remains authoritative.

One active owner per application/service: reuse healthy processes; never create a competing local Metro/Next.js instance, duplicate Docker engine, second database writer or silent fallback to the source machine when an assigned remote host is unreachable. A runtime cutover requires an independently verified replacement before stopping the old process, preserved stable entrypoints, scoped stop/rollback and fresh health/readback on the final host. A failure to reach the owner is BLOCKED/DEGRADED, not permission to change owners.

Remote source mirrors are one-way derived workspaces, never canonical Git repositories or authority to modify source. Before claiming that an edit, Fast Refresh, browser/device test or build reflects current code, verify the affected source bytes/revision reached the running host; a successful local typecheck or HTTP status alone does not prove remote freshness. Do not synchronize `.git`, credentials, databases, generated caches, or dependency trees into source mirrors; configure secrets separately with least-privilege access. Do not edit shared host tasks, ports, services, volumes or credentials without checking other active consumers and preserving durable state.


Reuse established authentication sessions, actors and representative business state when valid. Do not require generic logout/login, re-enrollment or credential reset for unrelated proof.

For authenticated website inspection and reverse engineering, use the **single existing authorized Chrome automation profile** through `tools/dev/Start-BrowserAutomation.ps1` and its CDP connection. Before inspecting a protected page, invoke the launcher with `-Url`, `-VerifyAuthenticated` and a `-RequireSelector` that proves the intended signed-in page; the gate must confirm the real page, not just HTTP 200, an account-index match or an open CDP port. Playwright attaches via `connectOverCDP` to the same profile; REA observes its CDP targets. Multiple tabs in that existing context are allowed when independently owned, but never start an independent browser/profile/context to compensate for missing site authentication, request a second login merely for an analysis tool, or copy cookies/credentials between profiles. BrowserAct is optional: use it for unauthenticated flows or only when the same authorized session can actually be verified; otherwise use Playwright/REA directly. If the original site session expires, report `BLOCKED_AUTH` and require legitimate reauthentication in the **original profile**; never bypass the site's own authentication or authorization.

Never reset credentials, revoke unrelated sessions, grant permissions, mutate actor identity, fabricate business state, or destroy reusable persistent state merely to make a check pass.

Do not use direct SQL, ad-hoc seed data or hidden state mutation to manufacture success. Test-fixture setup is acceptable only when the task explicitly owns it and the resulting proof remains representative of the real path.

Progressive Lean Synthetic Data: during local development, create realistic, coherent synthetic records incrementally only when needed; reuse minimal, idempotent, owner-backed fixtures instead of bulk or startup reseeding. Preserve useful persistent fixtures and manually created data; isolate and clean disposable test fixtures. Keep the protected Root Owner outside synthetic seeding/cleanup, and never expose synthetic data to production or trigger real external transactions. Do not create a persistent synthetic world or global fixture registry. System/reference records and role/permission definitions remain governed by their owning contracts.

An authorized local cleanup may delete or recreate proven synthetic, unshared data that is no longer needed or is reproducible. Before mutation, identify the exact local target, creating owner, dependent records and effect on active sessions/business state; preserve useful state and read back through the canonical owner. This applies equally to accounts, memberships, categories, products, media and transactions. A test/demo name is not proof of disposability. Real, shared, durable or unknown-origin state remains protected until its ownership and disposition are established.

Do not assume source or fixture edits update existing database rows. When a task requires a persisted-data change, use the owning migration, authorized service operation or isolated fixture setup as appropriate. Preserve record identities and relationships when only display labels change; do not overwrite user-created local state as part of ordinary startup.

Secrets stay outside the repository. Never print, commit or route them through evidence artifacts.

Executable configuration is the authority for mutable runtime details. Do not duplicate ports, versions, container inventories or other discoverable runtime state in this constitution.

Sonar is Cloud-only for this repository. Do not introduce a local Sonar server or parallel local Sonar truth unless the task explicitly changes that policy.

Database migrations: while a local feature is still unadopted, migrations not merged to `main` and not applied to any durable database state that must be preserved may be rewritten, merged or deleted to keep a clean canonical baseline. Once a migration is merged to `main` or applied to a database whose state must be preserved or shared, treat it as immutable; every later schema change requires a new migration. Rebaseline/squash only at an explicit safe boundary where affected databases can be recreated or reconciled, preferably after a domain stabilizes and before Stage/Production. Before accepting migration changes, prove both fresh bootstrap and upgrade from the prior baseline with required data preserved.

## 5. Development and proof

### Outcome-first autonomous engineering — default for authorized work

Own the complete usable outcome of each authorized feature, defect, catalog operation or vertical slice, not just code, a passing isolated test or a test report. Infer the required implementation, UX, data, roles and proof from the user objective and canonical Product contracts. Within the proven affected cone, discover and repair material gaps without requiring the user to repeatedly request browsing, interaction, testing or fixes.

Choose the simplest capable existing path for each claim: native Go/API and owner readback for services and data; Maestro/ADB for affected Android interaction; Playwright/current browser tools for web; actual rendered states and the Design System for affected UX. Use native batch/import APIs for large data operations and real browser/device interaction for representative end-user proof. Do not run every tool ritualistically or add a dependency, agent framework, MCP server or abstraction without demonstrated need.

Where a workflow crosses actors or surfaces, exercise distinct authorized roles and materially affected handoffs using isolated, task-owned fixtures and canonical persisted readback. Mocks and successful screens do not prove the real journey. For visual work, inspect the materially relevant rendered states, responsiveness, Arabic/RTL, usability and recovery. If a check fails, repair the causal owner and repeat only the invalidated affected proof.

Proceed autonomously through routine authorized edits, application interaction, diagnosis and verification until the objective is demonstrably usable or a real blocker is established. Preserve valid sessions and user data, maintain useful regression proof, and finish with an exact-HEAD closure claim and concise results rather than a test-only handoff. Existing authorization, financial, destructive-change, external-publication, deployment and merge boundaries remain in force; this default grants no new authority. Never claim unproven or perpetual 100% correctness.

Default fast local closure loop:

`BOUNDED ROOT CAUSE -> COHERENT IMPLEMENTATION BATCH -> SMALLEST SUFFICIENT AFFECTED CHECK -> DIRECT PROOF WHEN NEEDED -> DONE`

Complete related edits before running TypeScript, tests, device checks or other verification; do not repeat a check after every minor edit. Batch related terminal/remote/device inspection and reuse still-valid proof. If a check fails, repair the relevant owner and rerun only the invalidated proof. Preserve earlier proof for unaffected code. This optimization never removes material security, financial, data-integrity or end-user evidence.

Use Git to identify changes and Nx to select affected project work when applicable. `pnpm check` is the normal local feedback command for uncommitted work; use narrower direct commands when they are sufficient. `pnpm verify` is explicit candidate-wide local proof, not a default step and not an implicit prerequisite to push.

**MANDATORY — ZERO MOJIBAKE:** All new/modified text MUST be valid UTF-8 without BOM or confirmed encoding corruption. Run `node tools/dev/check-encoding.mjs`; any confirmed violation BLOCKS closure until its root cause is fixed—never blindly replace characters. Details: `docs/governance/engineering.md`.

Execution routing: MA Commander, SentinelX, Remote Desktop Commander, Cmdexa, Remote Arc, MCPENROUZ and Local Commander are equal-status authorized device-control candidates, with no fixed priority. GitHub is the specialized eighth channel for repository/PR/CI state; Light Remote, Shellway and other connected tools are optional. Select by real capability, permission, efficiency, reliability and recovery. Do not use a different channel to bypass DENIED; do not run Codex CLI without a task-specific human instruction and proven direct-tool insufficiency.

Default local-first development flow (each external Git action requires its own human authorization):

`DISCOVER -> REUSE EXISTING AUTHORIZED BRANCH/WORKTREE -> COHERENT CHANGE -> AFFECTED PROOF -> LOCAL COMMIT -> [HUMAN-AUTHORIZED PUSH] -> [HUMAN-AUTHORIZED PR] -> EXACT-CANDIDATE CI / REVIEW -> [HUMAN-AUTHORIZED MERGE]`

Reuse the existing, explicitly authorized branch and checkout for related changes. **Never create a branch, create a worktree, or open a new Pull Request without an explicit human command for that action.** Do not silently switch to another branch or add unrelated work to an occupied branch. If no suitable authorized branch is available, preserve the state and request the necessary branch authorization rather than contaminating another task. A worktree is optional even for concurrent sessions and requires separate human authorization; serialize shared writes when isolation is unavailable.

Complete related changes as coherent batches; review their diff and run the smallest sufficient affected checks, then create authorized local commits at meaningful checkpoints, not per file or keystroke. Push only under an explicit human authorization with its agreed scope/cadence, and verify remote SHA. A Push does not authorize a PR; a PR does not authorize Ready, merge, or deployment. When a PR already exists, reuse it for the same bounded deliverable; never manufacture a PR cascade for incidental fixes.

CI, CodeRabbit and SonarQube are feedback, **not a per-edit blocking loop**. Do not repeatedly poll them or run candidate-wide suites after minor edits. Continue independently safe development while checks run; address confirmed critical findings at their causal owner. At human-authorized delivery and before declaring a PR ready, verify applicable required checks, reviewer findings, and independent high-risk proofs on the exact candidate SHA and applicable target base. Missing or failed required gates are BLOCKED/REVIEW_BLOCKED, never PASS. Local task completion is distinct from remote delivery/merge completion.

`pnpm safe:push` is a Git transport/safety interlock only. It must not duplicate candidate-wide proof already owned by explicit `pnpm verify` or final CI.

Proof is claim-driven and static-first. Use runtime, browser or real-device proof only when the claim cannot be falsified adequately by static evidence.

For a material cross-surface slice, a passing screen, API, typecheck, unit test or isolated service proof is not closure. Prove every materially participating handoff through its canonical owners until the required canonical readback is reached. Claim completion of a connected end-to-end scenario only after its constituent slices and material cross-slice handoffs are verified.

Proof must exercise the material failure modes of the affected claim, not only its happy path. Add negative, authorization, isolation, validation, recovery, idempotency or concurrency proof only when that risk is materially present in the affected cone.

Where available, derive expected results from a contract, invariant or canonical readback independent of the implementation decision being tested. Reusing the same decision logic as both implementation and oracle can reproduce the same defect and a false pass.

Use the native failing command and native failure output first. Broaden diagnostics only when broader evidence can change the repair decision.

A valid PASS remains reusable until an affected change, relevant state change or environment change invalidates it. Rerun invalidated proof, not everything for reassurance.

Duplicate proof without distinct falsification value is unjustified complexity.

Do not hide failures, weaken assertions, skip material checks, relabel red evidence as green, or blindly retry until a transient pass appears.

Repair a proven failure at its causal owner. Do not add exception paths solely to satisfy the verifier.

CI and GitHub rulesets provide final integration/merge assurance. They do not replace direct local proof for a claim that can and should be checked before push.

Model context is a scarce working set, not an archive. Reduce context without reducing correctness, material scope, safety or required proof.

- Search or navigate to the owning symbol/path before broad reading. Prefer the smallest relevant range; read an entire large file only when the claim materially requires it.
- Do not carry raw logs, unchanged source, giant diffs or already-proven evidence across material closure cells. Retain only evidence that can still change the repair decision.
- At a material cell boundary retain a compact checkpoint: exact HEAD, material decisions, affected owners/paths, still-valid proof, remaining dependencies and blockers. Discard superseded execution noise.
- Keep the objective dependency map, but use a fresh bounded execution context for the next material cell instead of accumulating prior cell transcripts.
- Each coherent development batch is a local checkpoint: inspect the diff and affected proof, then commit locally when authorized. Neither a Push nor a PR is needed to continue or finish an authorized local development task. Only on a separate human delivery command, safely push within the approved scope and verify remote SHA; create or update a PR only when that operation is explicitly authorized. A failed required gate leaves the candidate unready; do not perform repetitive full-suite reviews while development continues.
- Candidate-wide proof should normally run once after feature freeze. Rerun only proof invalidated by a later affected change.

When asked to plan, emit one bounded objective command anchored to current HEAD, approved outcome, affected owners, necessary proof and safe stop point; do not add another permanent planning contract.

### Professional product closure — applicable affected scope

Before implementation, verify the approved outcome, what already works, acceptance criteria and real actors. Distinguish implemented, partial, authorized future and obsolete behavior. Find the highest evidenced causal root and the full materially affected writers, readers, state owners, services, consumers and handoffs. Choose the simplest complete maintainable repair. Remove losing paths only after verified consumer cutover and regression; retain adopted migrations, real history and supported published APIs.

For materially affected UI, deliver real professional fit-and-finish using the Design System: useful hierarchy/navigation, coherent layout, complete forms, validation, messages and recovery; correct Arabic/RTL where required; responsive layouts, touch/keyboard/focus/screen-reader support, WCAG 2.2 AA where applicable, and supported themes/reduced motion. Render representative browser/device states and verify materially relevant loading, populated, empty, no-results, forbidden, invalid, network error/retry, busy/success/failure, concurrency and destructive confirmation/undo behavior. State applicability is justified, not a ceremonial full matrix. Backend-only or trivial text work has no fictitious visual gate.

Before extending an app UI, read its maintained design/UX contract and reuse or extend the canonical tokens, controls and composition owners; reject a competing page-local foundation. Follow `docs/governance/engineering.md` for structural and visual regression proof. Review intentional visual baseline changes on the exact candidate; never auto-accept a changed image merely to pass CI.

For affected functionality, verify the authorized actor finishes the task and the next authorized actor reads canonical persistent state. Include real negative/security/tenant/role boundaries, retry/idempotency, concurrency, settlement/financial conservation and failure recovery where materially applicable. No mocked screen, isolated HTTP 200 or green CI alone proves full journey closure. Use bounded disposable owned fixtures and actual state owners; do not change user data, invent features or rebuild healthy code.

Use narrow symbol/owner searches, existing Nx affected/static-first proof and still-valid evidence; rerun only invalidated checks. Final exact-HEAD review must account for approved outcome, materially affected UX/data/security/actors, canonical readback, safe legacy removal and honest residual limits. Mark the objective blocked for any unproven material gate; never claim perpetual or unverified 100% correctness.

## 6. Consequential action safety

Do not force-push or rewrite shared history unless the user explicitly authorizes that exact destructive action.

Do not blindly merge, cherry-pick, reset, revert or retry a mutating operation after an ambiguous result. Inspect the exact live state first.

Before a destructive or externally visible mutation, make the target and scope explicit and use canonical readback afterward.

Push only authorized branch work. Merge, release, deployment, promotion, external-system mutation and governance repinning require their own authority and prerequisites.

If concurrent work moves a branch, preserve it by default. Re-read the new HEAD, reconcile affected files and continue from the new truth instead of overwriting it.

## 7. Delegation

Delegate only bounded work with explicit scope and evidence expectations.

Avoid overlapping writers. Parallel work should have disjoint write ownership or remain read-only.

A subagent must not merge, repin governance, reset persistent state, expose secrets, perform unauthorized external mutations, or declare final closure. A user may explicitly delegate narrow local Commit and Push authority for a named task and existing authorized branch to separately assigned assistant sessions. Delegation does not grant source ownership outside their assigned paths, and does not authorize PR, Ready, main merge, deployment, force-push, paid actions, permission changes, or destructive work.

When multiple assistants share one worktree, only one named Git writer may stage, commit, or push at a time using a verifiable exclusive handoff/turn. Before staging, verify branch, HEAD, existing index/staged changes, exact own source paths, source ownership, reviewed diff and affected checks. Stage only own accepted files, then check the exact staged path allowlist and commit readback. For Push use the repository's existing safe-push guard: it requires a clean entire worktree and exact remote SHA confirmation. If unrelated agent work remains dirty, local Commit may stand but Push must be recorded BLOCKED_DIRTY_WORKTREE; never bypass the guard, stash/reset peer work, or create a parallel worktree. A vague or stale agent note is not proof of an active Git turn. Human authorization must be explicit for each task/branch; do not carry this privilege to other projects by default.

The lead agent owns integration, conflict resolution, final diff review, final proof and closure claims.

## 8. Closure

Review the complete final diff on the exact final HEAD.

Run the smallest fresh proof that can falsify the affected claims. Reuse still-valid PASS evidence instead of repeating unrelated checks.

Check for stale references, dead paths, duplicate owners, shadow truth, partial cutovers and obsolete compatibility residue.

If approved durable meaning changed, verify its one local owner and materially affected consumers on the exact final candidate.

Closure requires all of the following:

- the authorized objective is proven;
- the material affected cone is accounted for;
- canonical owner/writer/readback is clear where relevant;
- material Product, contract, data, runtime and user-facing claims are proven to the degree they are affected;
- no known material defect, gap, partial cutover, stale owner, unjustified complexity or unproven material claim remains.

Report the exact final HEAD and any material unproven claim. Do not claim closure when evidence is stale or incomplete.

Fixed-point closure is bounded to the authorized objective and its proven affected cone. It does not authorize a platform-wide census of unrelated capabilities, surfaces, history or debt.

When the assigned objective is complete, stop. Do not invent additional scope or ask for another task as a condition of closure.

### Compact refoundation acceptance gate — one agent law

The following labels index the obligations **already defined above**, not a second owner, workflow or replacement for proportional checks. Every affected gate needs attributable evidence or an explicit non-PASS status before reporting completion:

- **G1 STATE:** exact checkout, HEAD, status, runtime owner and concurrent work;
- **G2 OUTCOME:** authorized scope, actor goal and observable acceptance;
- **G3 PRESERVE:** affected capabilities/subfeatures and evidence-led disposition;
- **G4 OWNER:** one authoritative fact writer, engine, contract and source;
- **G5 SIMPLIFY:** necessity of each new abstraction or dependency;
- **G6 CUTOVER:** all affected readers/writers/contracts/data safely migrated before deletion;
- **G7 INTEGRATE:** owner-backed true result across changed surfaces and services;
- **G8 SAFETY:** finance, privacy, permissions, replay, races and loss scenarios where affected;
- **G9 UX:** required real platform, RTL, accessibility and failure/recovery proof;
- **G10 REVIEW:** final diff, true persistent state and still-valid checks;
- **G11 GIT:** scoped staging and distinct local Commit/Push/PR/Merge authority;
- **G12 CLOSE:** no known material gap for the authorized slice; remaining full-platform work remains NOT_DONE.

An unresolved protected behavior is `UNRESOLVED`; a missing material test is `NOT_RUN` or `BLOCKED`, never an implied PASS.
