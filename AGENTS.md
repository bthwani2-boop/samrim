# Samrim agent law

## 1. Authority and exact state

Current user/task authority controls the work within repository, Product, security and data-safety constraints.

Before consequential work, confirm the exact repository, branch, HEAD and relevant working state. Re-read HEAD immediately before a material write when the branch may have moved.

`CAPABILITY != AUTHORITY`. Tool access does not authorize a mutation.

Commit or push authority does not imply merge, promotion, release, destructive-operation or external-system authority.

Preserve unrelated changes, secrets, durable data and active user state.

`MATERIAL` means capable of changing behavior, meaning, authority, safety, durable data, contracts, runtime/configuration, user experience, external/deployable identity, evidence validity or operational outcome.

## 2. Durable knowledge

`knowledge.sources.json` pins the exact durable BThwani Product/System/Policy/Quality/Experience/Data/Design baseline. It is challengeable durable knowledge, not a replacement for current task authority or live repository truth.

Read pinned governance only when it can change the decision. `REPOSITORY-STRUCTURE.md` owns repository placement rules.

Repository-local `AGENTS.md` owns execution and safety law. Do not duplicate Product, System, Policy, Experience, Data or Design semantics here.

Classify governance impact as exactly one of:

- `NONE`: no durable meaning is affected.
- `REVALIDATE_ONLY`: durable meaning remains correct but must be checked against the change.
- `UPDATE_REQUIRED`: intentional durable meaning must change.
- `DEFECT_FOUND`: the durable source is wrong, incomplete or contradictory.

For `UPDATE_REQUIRED` or `DEFECT_FOUND`, repair the canonical governance owner first, merge that durable change through its governed path, then repin this repository to the exact canonical commit. Do not create shadow policy locally.

## 3. Discovery, ownership and simplification

Do one bounded discovery sufficient to identify the affected cone, current truth, canonical owner, causal root, risk and required proof. Then execute. Widen only when new evidence can materially change the repair.

The implementation and closure unit is a bounded cross-surface vertical slice, including every materially affected app, operator surface, service, contract, state owner and pinned Governance source. Search all its material connections across repositories, read deeply only inside the proven cone, and close required behavior plus obsolete/duplicate paths; do not split by screen or manufacture platform-wide audits. End-to-end Journeys remain integration proof scenarios, not a parallel execution queue.

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

## 4. Local development state

The current project phase is local development, before Stage/Production adoption. Entry into shared Stage/Production requires an explicit governed transition. Local phase alone does not make existing state disposable.

Reuse valid warm local state. Do not restart services, Metro, Next.js, backends, containers, sessions or devices merely as ritual when the current state can prove the claim.

Reuse established authentication sessions, actors and representative business state when valid. Do not require generic logout/login, re-enrollment or credential reset for unrelated proof.

Never reset credentials, revoke unrelated sessions, grant permissions, mutate actor identity, fabricate business state, or destroy reusable persistent state merely to make a check pass.

Do not use direct SQL, ad-hoc seed data or hidden state mutation to manufacture success. Test-fixture setup is acceptable only when the task explicitly owns it and the resulting proof remains representative of the real path.

Keep synthetic setup limited to the current development/proof need, using existing service owners and isolated, task-owned fixtures. Do not create a persistent synthetic world, global fixture registry or automatic startup reseeding. Required system/reference records, role and permission definitions, and useful actors/business state are preserved according to their owning contracts; they are not disposable merely because they are used locally.

An authorized local cleanup may delete or recreate proven synthetic, unshared data that is no longer needed or is reproducible. Before mutation, identify the exact local target, creating owner, dependent records and effect on active sessions/business state; preserve useful state and read back through the canonical owner. This applies equally to accounts, memberships, categories, products, media and transactions. A test/demo name is not proof of disposability. Real, shared, durable or unknown-origin state remains protected until its ownership and disposition are established.

Do not assume source or fixture edits update existing database rows. When a task requires a persisted-data change, use the owning migration, authorized service operation or isolated fixture setup as appropriate. Preserve record identities and relationships when only display labels change; do not overwrite user-created local state as part of ordinary startup.

Secrets stay outside the repository. Never print, commit or route them through evidence artifacts.

Executable configuration is the authority for mutable runtime details. Do not duplicate ports, versions, container inventories or other discoverable runtime state in this constitution.

Sonar is Cloud-only for this repository. Do not introduce a local Sonar server or parallel local Sonar truth unless the task explicitly changes that policy.

Database migrations: while a local feature is still unadopted, migrations not merged to `main` and not applied to any durable database state that must be preserved may be rewritten, merged or deleted to keep a clean canonical baseline. Once a migration is merged to `main` or applied to a database whose state must be preserved or shared, treat it as immutable; every later schema change requires a new migration. Rebaseline/squash only at an explicit safe boundary where affected databases can be recreated or reconciled, preferably after a domain stabilizes and before Stage/Production. Before accepting migration changes, prove both fresh bootstrap and upgrade from the prior baseline with required data preserved.

## 5. Development and proof

Default small-change loop:

`SMALL CHANGE -> AFFECTED CHECK -> IMPLEMENT -> DIRECT PROOF -> DONE`

Use Git to identify changes and Nx to select affected project work when applicable. `pnpm check` is the normal local feedback command for uncommitted work; use narrower direct commands when they are sufficient. `pnpm verify` is explicit candidate-wide local proof, not a default step and not an implicit prerequisite to push.

Default integration flow:

`DISCOVER -> CHANGE -> AFFECTED PROOF -> LOCAL COMMIT(S) -> FEATURE FREEZE -> SAFE PUSH -> PR/CI ONCE`

`pnpm safe:push` is a Git transport/safety interlock only. It must not duplicate candidate-wide proof already owned by explicit `pnpm verify` or final CI.

Proof is claim-driven and static-first. Use runtime, browser or real-device proof only when the claim cannot be falsified adequately by static evidence.

For a material cross-surface slice, a passing screen, API, typecheck, unit test or isolated service proof is not closure. Prove every materially participating handoff through its canonical owners until the required canonical readback is reached. Claim completion of a connected end-to-end scenario only after its constituent slices and material cross-slice handoffs are verified.

Proof must exercise the material failure modes of the affected claim, not only its happy path. Add negative, authorization, isolation, validation, recovery, idempotency or concurrency proof only when that risk is materially present in the affected cone.

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

When the task is to plan or prepare implementation work rather than execute it, use the pinned Governance `docs/EXECUTION-CONTRACT.md`. Do not maintain or request a separate reusable trigger that duplicates the generated execution command. The planner emits only the current material slice command, then consumes the executor's compact checkpoint through delta review for the next slice.


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

If governance changed, verify the repository pins the exact merged canonical governance commit and that the durable owner contains the intended meaning.

Closure requires all of the following:

- the authorized objective is proven;
- the material affected cone is accounted for;
- canonical owner/writer/readback is clear where relevant;
- material Product, contract, data, runtime and user-facing claims are proven to the degree they are affected;
- no known material defect, gap, partial cutover, stale owner, unjustified complexity or unproven material claim remains.

Report the exact final HEAD and any material unproven claim. Do not claim closure when evidence is stale or incomplete.

Fixed-point closure is bounded to the authorized objective and its proven affected cone. It does not authorize a platform-wide census of unrelated capabilities, surfaces, history or debt.

When the assigned objective is complete, stop. Do not invent additional scope or ask for another task as a condition of closure.
