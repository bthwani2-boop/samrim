# BThwani Platform

This repository is the canonical BThwani platform repository.

## Repository authority

- `AGENTS.md` — sole repository-local agent operating law.
- `REPOSITORY-STRUCTURE.md` — repository placement contract delegated by `AGENTS.md`.
- `knowledge.sources.json` — exact immutable Governance/Docs binding.
- exact source/config/runtime/database/readback — authority for current executable state.

Durable Governance and Docs remain in the separately pinned repository; do not duplicate them here.

## Development

Bootstrap host dependencies only when setup inputs changed or the workspace is not ready:

```text
pnpm bootstrap
```

Start the canonical Docker-owned backend/state runtime:

```text
pnpm runtime:up
pnpm runtime:doctor
pnpm runtime:status
```

Start only the application surfaces you are actively developing. These run directly on the Windows host and reuse the already-ready Docker backend:

```text
pnpm control
pnpm client
pnpm partner
pnpm captain
pnpm field
```

`pnpm client|partner|captain|field` prepares the canonical device/backend reverse path, then delegates the selected app's Metro lifecycle and Android development-client launch directly to Expo CLI on the Windows host. `pnpm control` owns the host Next.js development server. PostgreSQL, Mailpit, Identity, DSH and their migrations remain Docker-owned. Device execution remains device-owned.

When baked backend source changes, rebuild only the invalidated service when a runtime proof requires current binaries:

```text
pnpm runtime:rebuild -- -Service identity
pnpm runtime:rebuild -- -Service dsh
```

`pnpm runtime:up` does not intentionally rebuild existing backend images. On a fresh machine Compose may build missing images; after baked backend source changes use the targeted rebuild command above before behavior proof.

## Verification

Normal work is affected-based, not repository-wide by default.

For fast dirty-tree feedback, run the nearest Nx target directly when the project is known:

```text
pnpm exec nx run <project>:<target>
```

When the change crosses projects or its cone is unclear:

```text
pnpm exec nx affected -t typecheck test build export-smoke vet --base=HEAD --outputStyle=dynamic-legacy
```

Use `pnpm verify` only after the candidate is coherent and clean. Runtime and user-facing behavior are proved separately only when the claim requires them. CI performs independent Linux integration/promotion assurance.

## Secrets

Never commit credentials, Firebase service files, signing files, real `.env` files, tokens or private keys.

## Nx Cloud CI

Create one read-only CI token and one read-write CI token in the Nx Cloud workspace Access Control settings. Keep the read-write token restricted to protected branches:

```text
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/setup-nx-cloud-github.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/setup-nx-cloud-github.ps1 -Apply
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-nx-cloud-github.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/dispatch-nx-cloud-ci.ps1 -Workflow control-panel-e2e.yml -Ref main -Wait
```
