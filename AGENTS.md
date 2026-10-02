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

Use native/current evidence before adding diagnostic abstractions. Repair the highest proven causal root, not downstream symptoms.

Prefer the simplest complete correct solution. A small change must remain small.

Default preference:

`DELETE -> DIRECT USE -> STANDARD TOOL -> EXISTING OWNER -> MERGE -> SIMPLIFY/REFACTOR -> NEW MECHANISM ONLY WHEN REQUIRED`

Keep complexity only for a proven current need. Existing wrappers, verifiers, compatibility paths, diagnostics, caches, state machines, registries, workflows or abstractions do not justify themselves by existing.

`SIMPLIFICATION MUST REDUCE MACHINERY, NOT REQUIRED MEANING.` A deletion or refoundation is valid only when each unique current responsibility is unnecessary, retained in compact form, moved to its canonical owner, proven duplicate, proven obsolete, or replaced by a stronger existing truth.

Do not solve complexity by adding another layer around it.

Give each mutable fact one canonical owner/writer. During replacement, migrate callers, configuration, contracts, tests and required documentation; cut over; then delete the losing path and stale references.

Preserve required Product behavior, security, authorization, privacy, data integrity, contract integrity and operational safety throughout simplification.

## 4. Local development state

Reuse valid warm local state. Do not restart services, Metro, Next.js, backends, containers, sessions or devices merely as ritual when the current state can prove the claim.

Reuse established authentication sessions, actors and representative business state when valid. Do not require generic logout/login, re-enrollment or credential reset for unrelated proof.

Never reset credentials, revoke unrelated sessions, grant permissions, mutate actor identity, fabricate business state, or destroy reusable persistent state merely to make a check pass.

Do not use direct SQL, ad-hoc seed data or hidden state mutation to manufacture success. Test-fixture setup is acceptable only when the task explicitly owns it and the resulting proof remains representative of the real path.

Secrets stay outside the repository. Never print, commit or route them through evidence artifacts.

Executable configuration is the authority for mutable runtime details. Do not duplicate ports, versions, container inventories or other discoverable runtime state in this constitution.

Sonar is Cloud-only for this repository. Do not introduce a local Sonar server or parallel local Sonar truth unless the task explicitly changes that policy.

## 5. Development and proof

Default small-change loop:

`SMALL CHANGE -> AFFECTED CHECK -> IMPLEMENT -> DIRECT PROOF -> DONE`

Use Git to identify changes and Nx to select affected project work when applicable. `pnpm check` is the normal local feedback command for uncommitted work; use narrower direct commands when they are sufficient.

Proof is claim-driven and static-first. Use runtime, browser or real-device proof only when the claim cannot be falsified adequately by static evidence.

Use the native failing command and native failure output first. Broaden diagnostics only when broader evidence can change the repair decision.

A valid PASS remains reusable until an affected change, relevant state change or environment change invalidates it. Rerun invalidated proof, not everything for reassurance.

Duplicate proof without distinct falsification value is unjustified complexity.

Do not hide failures, weaken assertions, skip material checks, relabel red evidence as green, or blindly retry until a transient pass appears.

Repair a proven failure at its causal owner. Do not add exception paths solely to satisfy the verifier.

CI and GitHub rulesets provide final integration/merge assurance. They do not replace direct local proof for a claim that can and should be checked before push.

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

When the assigned objective is complete, stop. Do not invent additional scope or ask for another task as a condition of closure.
