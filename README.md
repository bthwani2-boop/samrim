# BThwani Platform

This repository is the canonical BThwani platform repository.

## Repository authority

- AGENTS.md — sole repository-local agent execution/safety law.
- REPOSITORY-STRUCTURE.md — repository placement contract delegated by AGENTS.md.
- knowledge.sources.json — exact immutable Governance/Docs binding.
- exact source/config/runtime/database/readback — authority for current executable state.

Durable Governance and Docs remain in the separately pinned repository; do not duplicate them here.

## Development

Materialize dependencies only when setup inputs changed:

```text
pnpm bootstrap
```

Prepare or reuse the canonical backend/state:

```text
pnpm dev
```

pnpm dev owns backend readiness only and returns to the prompt. It does not start Metro, Control, ADB or scrcpy.

Start only the surface being developed:

```text
pnpm client
pnpm partner
pnpm captain
pnpm field
pnpm control
```

Each command enters the owning app package and keeps Expo Metro or Next attached to that terminal with Fast Refresh/HMR. Mobile applications are opened manually. Use pnpm scr only when device transport/reverse mappings or scrcpy are needed.

Backend lifecycle remains explicit:

```text
pnpm runtime:up
pnpm runtime:status
pnpm runtime:down
```

From outside the repository, use pnpm --dir D:\samrim <command>. A child process cannot change the parent PowerShell working directory.

## Verification

Normal work is affected-based, not repository-wide by default.

For fast dirty-tree feedback, run the nearest Nx target directly when the project is known:

```text
pnpm exec nx run <project>:<target>
```

When the change crosses projects or its cone is unclear, keep local feedback to the normal code/build targets:

```text
pnpm exec nx affected -t typecheck test build vet --base=HEAD --outputStyle=dynamic-legacy
```

Mobile export is a heavier deployability/bundling proof, not a default edit-loop check. Run it explicitly when mobile bundling/configuration is affected or deployability is the claim:

```text
pnpm exec nx affected -t export-smoke --base=HEAD --outputStyle=stream
```

Use pnpm verify only after the candidate is coherent and clean. Do not run a separate final pnpm verify immediately before pnpm safe:push; safe:push owns the single final exact-candidate verification and remote SHA confirmation. Runtime and user-facing behavior are proved separately only when the claim requires them. CI performs independent integration/promotion assurance.

The verifier prints per-step and total timings so future optimization is based on measured cost rather than guesswork.

## Secrets

Never commit credentials, Firebase service files, signing files, real .env files, tokens or private keys.

## Nx Cloud CI

Create one read-only CI token and one read-write CI token in the Nx Cloud workspace Access Control settings. Keep the read-write token restricted to protected branches:

```text
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/setup-nx-cloud-github.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/setup-nx-cloud-github.ps1 -Apply
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-nx-cloud-github.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/dispatch-nx-cloud-ci.ps1 -Workflow control-panel-e2e.yml -Ref main -Wait
```
