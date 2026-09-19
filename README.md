# BThwani Platform

This repository is the canonical BThwani platform repository.

## Repository authority

- `AGENTS.md` — sole repository-local agent operating law.
- `REPOSITORY-STRUCTURE.md` — repository placement contract delegated by `AGENTS.md`.
- `knowledge.sources.json` — exact immutable Governance/Docs binding.
- exact source/config/runtime/database/readback — authority for current executable state.

Durable Governance and Docs remain in the separately pinned repository; do not duplicate them here.

## Development

Bootstrap dependencies only when setup inputs changed:

```text
pnpm bootstrap
```

Daily local development:

```text
pnpm dev
```

That single command reuses or prepares the complete local development environment: Docker backend/state, USB ADB reverse mappings, all four Metro servers, Control Panel and scrcpy. It does not open the mobile applications. Open Client, Partner, Captain or Field manually on the device; the development client reconnects to its most recent project and Fast Refresh remains live. Control uses Next HMR. The canonical runtime file is `tools/dev/dev.ps1`.

Maintenance commands:

```text
pnpm runtime:up
pnpm runtime:status
pnpm runtime:down
```

From outside the repository, use `pnpm --dir D:\samrim dev`. A child process cannot change the parent PowerShell working directory; changing the caller prompt itself requires a shell function/profile entry rather than repository runtime code.

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
