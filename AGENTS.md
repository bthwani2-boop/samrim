# Samrim agent law

Current user and task instructions control this work. Before consequential changes, confirm the repository, branch, HEAD and worktree. Preserve unrelated changes, secrets and persistent data. Push, merge, release or change external systems only when the user authorizes it.

`knowledge.sources.json` pins durable Product, System, Policy, Quality, Experience, Data and Design meaning. Read the pinned Governance owner when it can affect the decision. Classify Governance impact as `NONE`, `REVALIDATE_ONLY`, `UPDATE_REQUIRED` or `DEFECT_FOUND`; correct durable meaning at its owner before changing a pin.

`REPOSITORY-STRUCTURE.md` owns repository placement rules; this file does not duplicate them.

## Simplify and implement

Do one bounded discovery sufficient to identify the owner, boundary, risk and proof. Then implement. Continue discovery only when new evidence could change the repair.

Keep complexity only for a proven current need. Prefer deletion, direct use, standard tools, existing owners, merging and simplification. Add a mechanism only when these cannot preserve required behavior.

Preserve product behavior, security, authorization, data integrity and required operational safety. Give each mutable fact one canonical writer and readback. Complete replacements across callers, configuration, tests and documentation; remove the losing path and its references.

## Development and proof

Use the shortest path that proves the change:

`SMALL CHANGE → AFFECTED CHECK → IMPLEMENT → DIRECT PROOF → DONE`

Git identifies changed files; Nx selects affected projects and tasks. Use `pnpm check` for uncommitted changes, `pnpm verify` for a clean candidate, and `pnpm safe:push` when a push is authorized. Do not run broad checks for reassurance or repeat valid proof without a material input change.

Run runtime, browser or device proof only when the claim needs it. Use the native failure output first. Stop at the first material failure and repair its cause. Never hide failures, weaken assertions, manufacture business state, reset established credentials or grant permissions to established actors.

Secrets stay outside the repository. Executable configuration owns mutable runtime settings. SonarQube Cloud is the only Sonar execution owner.

If `graphify-out/graph.json` exists, use Graphify for code navigation and update it after code changes. Treat its graph as derived evidence.

## Closure

Review the complete diff, run proportionate fresh proof and check for stale references, duplicate owners and partial replacements. Report exact HEAD and any material unproven claims. Closure requires no known material defect, gap or unjustified complexity.
