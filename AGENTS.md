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

Classify each material durable impact as NONE, REVALIDATE_ONLY, UPDATE_REQUIRED or DEFECT_FOUND. Correct the one applicable local durable owner for approved changed meaning in the same coherent samrim PR as materially affected implementation/tests. Never invent commercial features, promote speculative instructions, duplicate executable facts or require routine donor reads. AGENTS.md alone owns agent execution law; REPOSITORY-STRUCTURE.md owns placement.

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

When replacing or refounding a canonical path, migrate every materially affected producer, consumer, contract, durable state/persistence path, runtime/configuration dependency and required proof before deleting the losing path. A cutover is incomplete while any material writer, reader, state owner, runtime dependency or contract still relies on the losing path.

Preserve required Product behavior, security, authorization, privacy, data integrity, contract integrity and operational safety throughout simplification.

For every materially affected workflow, enforce the effort-minimal, high-volume actor experience in `docs/governance/policies/experience.md`: require only necessary facts at the current stage, reuse canonical data, make optional inputs non-blocking, minimize repeated user actions and expose clear completion/recovery. Reject unjustified UX or technical machinery; retain essential safety in its existing owner and prove the simpler real task, not just fewer screens.

## 4. Local development state

The current project phase is local development, before Stage/Production adoption. Entry into shared Stage/Production requires an explicit governed transition. Local phase alone does not make existing state disposable.

Reuse valid warm local state. Do not restart services, Metro, Next.js, backends, containers, sessions or devices merely as ritual when the current state can prove the claim.

Reuse established authentication sessions, actors and representative business state when valid. Do not require generic logout/login, re-enrollment or credential reset for unrelated proof.

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

Default integration flow:

`DISCOVER -> CHANGE -> AFFECTED PROOF -> LOCAL COMMIT(S) -> FEATURE FREEZE -> SAFE PUSH -> PR/CI ONCE`

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
- Local commits may be development checkpoints. Push, pull-request creation, remote CI and remote AI review are integration events, not routine iterative-development checkpoints; unless earlier remote integration is materially required, defer them until feature freeze.
- Candidate-wide proof should normally run once after feature freeze. Rerun only proof invalidated by a later affected change.

When asked to plan, emit one bounded objective command anchored to current HEAD, approved outcome, affected owners, necessary proof and safe stop point; do not add another permanent planning contract.

### Professional product closure — applicable affected scope

Before implementation, verify the approved outcome, what already works, acceptance criteria and real actors. Distinguish implemented, partial, authorized future and obsolete behavior. Find the highest evidenced causal root and the full materially affected writers, readers, state owners, services, consumers and handoffs. Choose the simplest complete maintainable repair. Remove losing paths only after verified consumer cutover and regression; retain adopted migrations, real history and supported published APIs.

For materially affected UI, deliver real professional fit-and-finish using the Design System: useful hierarchy/navigation, coherent layout, complete forms, validation, messages and recovery; correct Arabic/RTL where required; responsive layouts, touch/keyboard/focus/screen-reader support, WCAG 2.2 AA where applicable, and supported themes/reduced motion. Render representative browser/device states and verify materially relevant loading, populated, empty, no-results, forbidden, invalid, network error/retry, busy/success/failure, concurrency and destructive confirmation/undo behavior. State applicability is justified, not a ceremonial full matrix. Backend-only or trivial text work has no fictitious visual gate.

Before extending an app UI, read its maintained design/UX contract and reuse or extend the canonical tokens, controls and composition owners; reject a competing page-local foundation. Follow `docs/governance/policies/quality.md` for structural and visual regression proof. Review intentional visual baseline changes on the exact candidate; never auto-accept a changed image merely to pass CI.

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

A subagent must not push, merge, repin governance, reset persistent state, expose secrets, perform unauthorized external mutations, or declare final closure.

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
