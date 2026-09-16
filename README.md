# BThwani Platform

This repository is the canonical BThwani platform repository.

## Repository authority

- `AGENTS.md` — sole repository-local agent operating law.
- `REPOSITORY-STRUCTURE.md` — repository placement contract delegated by `AGENTS.md`.
- `knowledge.sources.json` — exact immutable Governance/Docs binding.
- exact source/config/runtime/database/readback — authority for current executable state.

Durable Governance and Docs remain in the separately pinned repository; do not duplicate them here.

## Development

Bootstrap dependencies only when setup inputs changed or the workspace is not ready:

```text
pnpm bootstrap
```

Start the complete Docker-owned local integration stack:

```text
pnpm runtime:up
```

Read the complete stack:

```text
pnpm runtime:doctor
pnpm runtime:status
```

Open one development surface without stopping other already-running surfaces:

```text
pnpm client
pnpm partner
pnpm captain
pnpm field
pnpm control
```

Docker remains the sole LOCAL_INTEGRATION runtime owner for PostgreSQL, Mailpit, Identity, DSH, Control Panel and all four Metro servers. Device execution remains device-owned.

When baked backend source changes, rebuild only the invalidated service when a runtime proof requires current binaries:

```text
pnpm runtime:rebuild -- -Service identity
pnpm runtime:rebuild -- -Service dsh
```

`pnpm runtime:up` starts every canonical Docker service but does not intentionally rebuild all existing images. On a fresh machine Compose may build missing images; after baked backend source changes use the targeted rebuild command above before behavior proof.

## Verification

Normal work is affected-based, not repository-wide by default.

For fast dirty-tree feedback, run the nearest Nx target directly when the project is known:

```text
pnpm exec nx run <project>:<target>
```

When the change crosses projects or its cone is unclear, let Nx include committed, uncommitted, and untracked changes from the current commit:

```text
pnpm exec nx affected -t typecheck test build export-smoke vet --base=HEAD --outputStyle=dynamic-legacy
```

This loop is for feedback during editing. Use `pnpm verify` only after the candidate is coherent and clean; use `pnpm exec nx run control-panel:e2e` only when the Docker-owned runtime is already ready, because that target is intrinsically uncached.

`pnpm verify` verifies the exact clean candidate against a supplied/derived Git base using repository invariants plus Nx affected targets. It is non-mutating and does not bootstrap dependencies or own Docker lifecycle.

Runtime and user-facing behavior are proved separately only when the claim requires them.

`pnpm safe:push`:

1. reconciles the current branch with its remote;
2. returns immediately when the exact SHA is already remote;
3. performs one final affected exact-candidate verification;
4. pushes only fast-forward/first-branch state;
5. confirms the exact remote SHA.

CI performs independent integration/promotion assurance. Heavy backend runtime CI is skipped when the change cannot affect backend runtime.

## Secrets

Never commit credentials, Firebase service files, signing files, real `.env` files, tokens or private keys. Ordinary pushes scan the current candidate and newly introduced commits; a scheduled/manual job performs the expensive full-history scan.

## Nx Cloud CI

Create one read-only CI token and one read-write CI token in the Nx Cloud workspace Access Control settings. Keep the read-write token restricted to protected branches. The repository scripts never print or store token values:

```text
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/setup-nx-cloud-github.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/setup-nx-cloud-github.ps1 -Apply
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-nx-cloud-github.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/dispatch-nx-cloud-ci.ps1 -Workflow control-panel-e2e.yml -Ref main -Wait
```

The setup script stores `NX_CLOUD_RO_TOKEN` as a repository secret and `NX_CLOUD_RW_TOKEN` in the `nx-cloud-protected` GitHub environment, restricted to the `main` deployment branch. The first command is a dry run; use `-Force` only when intentionally replacing an existing token. The dispatch script performs a read-only preflight and exits non-zero if the GitHub run fails. See the [Nx Cloud access-token guidance](https://nx.dev/docs/kb/access-tokens).
