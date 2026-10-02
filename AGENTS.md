# BThwani / Samrim Agent Law

`AGENTS.md` is the repository-local execution and safety law. It does not own Product meaning or current implementation truth.

## Authority

Resolve conflicts in this order:

CURRENT USER / TASK AUTHORITY
→ this `AGENTS.md`
→ pinned Governance in `knowledge.sources.json`
→ exact live source / contracts / schema / migrations / Nx / config / runtime / database / canonical readback
→ Git history

Use one bounded discovery sufficient to identify the affected scope, canonical owner, real risk and required proof. After that, execute. Widen discovery only when new evidence can materially change the repair decision.

## Simplification law

The target is always the **simplest complete correct system**.

For every repository-owned mechanism ask what current material problem it solves, whether that problem still exists, whether Git/Nx/the native tool/current owner already solves it, and what actually breaks if the mechanism is removed. If no current material value is proven, delete it.

Treatment order:

DELETE
→ DIRECT USE
→ STANDARD TOOL
→ REUSE EXISTING OWNER
→ MERGE DUPLICATES
→ SIMPLIFY / REFACTOR
→ REFOUND
→ NEW MECHANISM ONLY WHEN REQUIRED

Do not solve complexity by adding another abstraction. Do not retain wrappers, verifiers, diagnostics, compatibility paths, state machines, generated evidence, caches or duplicated ownership merely because they already exist or because another custom verifier depends on them.

A small change must remain small. Local feedback, CI, runtime work and agent reasoning must stay proportional to the proven affected scope.

## Correctness boundaries

Simplification must preserve required Product behavior, security, authorization, data integrity, canonical persistence, externally required compatibility and real operational safety.

One material meaning has one semantic owner. One mutable fact has one canonical writer. One contract has one executable owner. Fix the highest proven causal root; do not preserve a defective path behind aliases, wrappers, suppressions or documentation.

When replacing a path, cut over all real producers, consumers, config, runtime, tests and references, then delete the loser. No shadow truth or partial cutover.

Persistent invariants belong at the strongest reliable boundary: database constraints/transactions for durable data truth, service authorization at the owning service, executable contracts for API/event shape. UI validation is complementary.

Secrets stay outside the repository. Never commit secret values or create hidden seed/business-data authority.

## Development path

The normal path is:

SMALL CHANGE
→ SMALL AFFECTED CHECK
→ IMPLEMENT
→ DIRECT PROOF
→ DONE

Stable local commands:

- `pnpm bootstrap` — install/sync setup when setup inputs changed.
- `pnpm dev` or `pnpm runtime:up` — prepare/reuse backend and state.
- `pnpm runtime:status` — direct backend/state readback.
- `pnpm client|partner|captain|field|control` — run only the requested host.
- `pnpm scr` — device transport/reverse/scrcpy.
- `pnpm runtime:down` — stop local runtime.
- `pnpm check` — dirty-tree affected static feedback only.
- `pnpm verify` — exact clean-candidate affected static proof only.
- `pnpm safe:push` — verify the exact clean candidate, push it, confirm the remote SHA.

Do not run repository-wide checks merely for reassurance. Do not repeat install/build/discovery/proof when unchanged evidence already exists.

Sonar is cloud-only. Do not run a local Sonar server/container/image or local Sonar analysis path.

## Proof selection

Use Git for changed state and Nx for the project/task graph.

Choose the smallest proof that can falsify the materially affected claim:

- static source/type/contract/schema/unit evidence when sufficient;
- runtime only for claims that actually require process, DB, HTTP, browser/device, concurrency or runtime readback;
- broad/full regression only when explicitly justified, scheduled or required for final integration.

Native tool output is the first diagnostic. Do not automatically create forensic packages, graphs, profiles or secondary diagnostic artifacts. Gather extra diagnostics only when the direct failure is insufficient to choose the repair.

A failed proof blocks dependent work until classified and repaired. Do not hide failures with skips, allowlists, weakened assertions, catch-and-ignore, exit-code masking or retry inflation. Retry only for an independently supported transient cause.

After a repair, rerun only the smallest proof invalidated by that repair. Unaffected successful evidence remains reusable.

## Governance and repository placement

Pinned Governance owns durable Product/System/Policy/Quality/Experience/Data/Design meaning. Update and repin Governance only when the task materially changes or finds a defect in that durable meaning; implementation-only work must not manufacture Governance churn.

`REPOSITORY-STRUCTURE.md` owns placement rules only. Exact Nx/source/config/runtime owns current inventory. Do not duplicate mutable inventory into Markdown.

## Local-development refoundation authority

Within authorized local development, no repository-owned technical artifact is protected merely because it exists. Delete, rewrite, restructure, refound, regenerate or replace repository-owned tooling/config/code when that is the simplest complete repair. Preserve unrelated user-owned state, external systems, secrets and irreversible external consequences.

## Completion

Before declaring closure:

1. Review the complete diff.
2. Run the smallest complete static proof.
3. Run runtime only for remaining runtime-dependent claims.
4. Confirm the winning path has all required consumers and the losing path has no live references.
5. Fix any material finding that appears; rerun only stale proof.

Closure means no known material defect, no known material gap, no unjustified duplicate owner/path, and no temporary workaround remains in the affected scope.
