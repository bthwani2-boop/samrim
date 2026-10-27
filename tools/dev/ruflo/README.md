# Ruflo and Codex supervisor

This directory is the permanent repository-owned source for the local supervisor, fixture worker, Git worktree owner, Ruflo sync client, and built-in Node tests. Runtime state belongs in an explicit absolute `--root` outside the repository. Launching `doctor` or `status` reads that runtime root; it does not initialize or write data beside this source.

## Runtime layout and setup

The runtime root owns `config.json`, `queue/`, `runs/`, `control/claims/`, `control/outcomes/`, `control/archives/`, temporary files, and Ruflo's `ruflo-state/`. Configure that directory out of band. A safe starting config is:

```json
{
  "enabled": false,
  "dispatchEnabled": false,
  "maxParallel": 1,
  "minFreeRamGb": 2.5,
  "pollMs": 15000,
  "baseRepo": "D:\\samrim",
  "worktreeRoot": "D:\\samrim-implementation\\worktrees\\ruflo-agents"
}
```

Both enable flags default to false. `maxParallel` is limited to 1 through 6; dispatch requires at least 2.5 GB free RAM, even if the configured threshold is higher. The source repository, base repository, runtime root, and worktree root have separate roles. The base repo must be clean, checked out on local branch `28`, and have `HEAD` equal to `refs/heads/28` before a Codex worktree is created. The worktree root must be outside the base repo.

Commands require an absolute runtime root:

```powershell
node tools/dev/ruflo/supervisor.mjs doctor --root D:\samrim-implementation\ruflo-runtime
node tools/dev/ruflo/supervisor.mjs status --root D:\samrim-implementation\ruflo-runtime
node tools/dev/ruflo/supervisor.mjs once --root D:\samrim-implementation\ruflo-runtime
node tools/dev/ruflo/supervisor.mjs serve --root D:\samrim-implementation\ruflo-runtime
node --test tools/dev/ruflo/supervisor.test.mjs
```

`doctor` and `status` are read-only. `once` and `serve` dispatch only when both enable flags are true. The supervisor does not start or configure services or schedulers.

## Approved queue manifests

Each `queue/<id>.json` must use the filename's lowercase ASCII id and include `approved: true`, a supported `kind`, and a nonempty `prompt`. Manifests cannot choose commands, arguments, workdirs, branches, repositories, or worktree locations.

- `isolated-fixture` accepts only the local fixture grammar documented below.
- `codex` runs the installed Codex executable in `runs/<id>` with `workspace-write`.
- `codex-worktree` also requires `baseSha`, exactly 40 hexadecimal characters. It must match the current local `refs/heads/28` in the configured base repo. The supervisor derives branch `agent/28-<id>` and directory `<worktreeRoot>/<id>`; either existing one denies creation. Git runs with fixed argument arrays and no shell. The worktree is created from the pinned SHA, and Codex executes there.

For example, after independent approval and pinning the intended local base SHA:

```json
{
  "approved": true,
  "kind": "codex-worktree",
  "baseSha": "0123456789abcdef0123456789abcdef01234567",
  "prompt": "Implement the approved isolated change"
}
```

An exclusive claim is written before worktree creation or worker launch. Claims are never retried or removed automatically. A Codex exit code of zero is recorded as `needs_review`; it never means integration passed. The supervisor does not commit, push, merge, or integrate a worktree. A human must inspect and accept the result and decide any later integration separately.

A dead supervisor lock can be archived and recovered only after its PID is absent and every recorded worker PID in current claims is also absent. An unreadable claim, live worker, recovery race, or lock race fails closed. Archived lock records remain in `control/archives/`. Claims without outcomes remain blocked or ambiguous for manual review.

The fixture worker accepts only `fixture:success`, `fixture:fail`, `fixture:crash-before`, `fixture:crash-after`, and `fixture:hold[:milliseconds]`. Fixture effects use exclusive file creation under the external runtime root. Verified fixture success can be recorded as completed; crashes and unverified results remain ambiguous or failed.

## Ruflo synchronization

Invoke sync with the same runtime root and an explicit installed Ruflo `node_modules` directory:

```powershell
node tools/dev/ruflo/ruflo-sync.mjs --root D:\samrim-implementation\ruflo-runtime --ruflo-install D:\samrim-implementation\ruflo-pilot\node_modules
```

The MCP SDK and Ruflo executable are resolved dynamically from that installation; this source adds no dependency and performs no install. Ruflo state is stored only at `<root>/ruflo-state`. Sync reads only approved, valid queue manifests. Repeated sync updates the same task without repeatedly changing stable progress. Only a supervisor outcome explicitly marked `completed` can complete a Ruflo task; `needs_review` remains in progress and carries the review requirement.

## Tests

`node --test tools/dev/ruflo/supervisor.test.mjs` uses Node built-ins and temporary runtime roots. Its Git test initializes and commits an isolated repository under `tools/dev/ruflo/tests/`, then checks two independently modified worktrees from the same SHA, derived branches, collision denial, and wrong-SHA denial. It skips only when Git itself is unavailable. Tests never invoke Codex or connect to Ruflo.

When preserving an existing Ruflo policy ledger across a runtime relocation, use the optional `--ruflo-state` flag with the original, verified state directory. Ruflo anchors are cryptographically bound to their real project-root path and may not be copied to a new root without an officially verified migration. Keep the copied untrusted state snapshot unused, and do not delete, rewrite, or bypass the trusted anchor mirror.
