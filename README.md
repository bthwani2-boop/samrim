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

pnpm dev owns backend readiness only and returns to the prompt. It reconciles the current Identity/DSH source through Docker build cache before declaring the backend ready, preserving reusable database state. It does not start Metro, Control, ADB or scrcpy.

Start only the surface being developed:

```text
pnpm client
pnpm partner
pnpm captain
pnpm field
pnpm control
```

Each command enters the owning app package and keeps Expo Metro or Next attached to that terminal with Fast Refresh/HMR. Mobile applications are opened manually. Use pnpm scr only when device transport/reverse mappings or scrcpy are needed.

In local development, Identity first restores the persisted real session. If that reusable session is absent or terminally invalid, the development-only Identity route uses the server-configured `actor_id` for that role and verifies the existing actor/role is enabled, security-enabled and authentication-ready before issuing a fresh real role-scoped session. The client never selects the actor. Missing pins fail with `404`; configured but not-ready actors fail with `409`. The route never creates actors, roles or credentials and is not registered outside `BTHWANI_ENV=development`. Explicit logout or recovery remains signed out within that runtime instance, while a fresh runtime can resume development continuity. OTP, activation, Passkey and recovery remain product/security journeys and the development shortcut never substitutes for proving them.

For an explicit real activation/authentication journey proof, start the affected surface with `EXPO_PUBLIC_BTHWANI_AUTH_JOURNEY_PROOF=1` for Mobile or `BTHWANI_AUTH_JOURNEY_PROOF=1` for Control. That flag disables only the development-session fallback; normal local development remains unchanged, and the canonical activation/login/recovery implementation remains the path under proof.

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

Mobile export is a heavier bundling/deployability proof, so it is not part of the fast dirty-tree edit loop. The final exact-candidate verifier still runs export-smoke for affected Mobile projects after cheaper checks pass, preserving bundling/module-resolution proof without paying that cost on every intermediate edit.

Use pnpm verify only after the candidate is coherent and clean. Coherent units may be committed locally while one authorized objective is in progress; do not safe-push every local commit by default. Do not run a separate final pnpm verify immediately before pnpm safe:push; one safe:push at objective closure owns the final verification of the complete unpushed delta and remote SHA confirmation. Runtime and user-facing behavior are proved separately only when the claim requires them. CI performs independent integration/promotion assurance.

The verifier prints per-step and total timings so future optimization is based on measured cost rather than guesswork.

## Secrets

Never commit credentials, Firebase service files, signing files, real .env files, tokens or private keys.

## Nx Cloud CI

Create one read-only CI token and one read-write CI token in the Nx Cloud workspace Access Control settings. Keep the read-write token restricted to protected branches. `CI Static` is the canonical cache-using verification gate; `CI Runtime` is deliberately uncached and runs with Nx Cloud disabled.

```text
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/setup-nx-cloud-github.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/setup-nx-cloud-github.ps1 -Apply
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/verify-nx-cloud-github.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/dispatch-nx-cloud-ci.ps1 -Workflow ci-static.yml -Ref main -Wait
pwsh -NoProfile -ExecutionPolicy Bypass -File tools/dev/dispatch-nx-cloud-ci.ps1 -Workflow ci-runtime.yml -Ref <branch> -Wait
```
