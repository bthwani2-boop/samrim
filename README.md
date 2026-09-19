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

Start the Docker-owned backend once for the development session:

```text
pnpm runtime:up
```

Start only the surface you are actively developing:

```text
pnpm control
pnpm client
pnpm partner
pnpm captain
pnpm field
pnpm scr
```

All local development commands route through one owner: `tools/dev/local.ps1`. It starts Docker backend services and reuses or starts the selected Metro/Next surface. Android tooling delegates directly to ADB/Expo/scrcpy and assumes one attached device; the repository does not discover or manage device serials.

Use `pnpm runtime:status` or `pnpm runtime:doctor` only when diagnosing the backend. Stop it with `pnpm runtime:down`. Exceptional rebuild/reset work uses Docker Compose directly instead of permanent repository wrappers.

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
