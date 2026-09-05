# Developer Getting Started

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
CURRENT_COMMAND_AUTHORITY: package.json / pnpm-workspace.yaml / repository scripts

## Developer reading path

Before making a material change:

1. read `AGENTS.md` for authority routing;
2. read `governance/project/PLATFORM.md` and `governance/product/PRD.md`;
3. retrieve only the relevant capability/journey/owner with `pnpm knowledge:query -- ...`;
4. confirm ownership in `governance/architecture/OWNERSHIP-AND-SOURCE-OF-TRUTH.md`;
5. read the applicable policy plus `repository-map.md` and the focused development guide;
6. inspect live source/history/runtime for current implementation state.

## Prerequisites

Current root toolchain constraints are:

- Node.js `24.17.0` (`.nvmrc`, `.node-version`);
- pnpm `10.34.0`;
- Go `1.27.1` for the Go workspace/services;
- PowerShell `7.4+` for repository Windows scripts;
- Git;
- Docker CLI/daemon only when the selected runtime/integration path requires Docker;
- Android SDK/ADB for physical Android mobile development.

Do not infer a different toolchain from global machine installations when the repository declares a pinned version.

## Install

From repository root:

```powershell
pnpm install --frozen-lockfile
```

The root lockfile/workspace is the dependency authority. Do not run package-local ad-hoc installs to repair a workspace problem.

## Primary surface commands

```powershell
pnpm client
pnpm partner
pnpm captain
pnpm field
pnpm control
```

These commands delegate to repository-owned runtime scripts. Do not duplicate their internal environment/bootstrap logic in shell aliases or docs.

## Canonical workspace bootstrap

The canonical lockfile is committed. Install the exact workspace state with:

```powershell
pnpm bootstrap
```

For verification without changing declared dependencies or lockfile authority, use the repository verification commands below. Lockfile regeneration is a deliberate manifest-change operation, not a normal bootstrap step.

## Primary verification

Discover the current Nx projects:

```powershell
pnpm nx:projects
```

Verify the current workspace after the canonical lockfile has been installed:

```powershell
pnpm workspace:verify
```

Verify app-owned mobile identities/configuration:

```powershell
pnpm mobile:verify-config
```

Validate the Foundation runtime composition manually when diagnosing:

```powershell
pnpm runtime:foundation:config
pnpm runtime:foundation:up
pnpm runtime:foundation:status
pnpm runtime:foundation:verify
```

For the canonical local Foundation runtime proof, use:

```powershell
pnpm foundation:runtime:close
```

This command requires a clean working tree but does not hard-code a branch. When an invocation requires an exact branch, call the underlying PowerShell script with `-ExpectedBranch <branch>`. It creates an ignored local compose `.env` when missing, builds and starts the Foundation profile, retries the service and infrastructure readiness checks until ready, verifies the expected compose services are running, fails on repository mutation, prints diagnostics on failure, and stops the runtime after a successful proof unless `-KeepRunning` is supplied.

Contract/database/runtime-specific commands are discoverable from the current root/service manifests; choose only evidence applicable to the change.

## Before changing a capability

Read the applicable Product and policy owners first:

```text
governance/product/PRD.md
→ pnpm knowledge:query -- capability <CAPABILITY_ID>
→ pnpm knowledge:query -- journey <J_ID>
→ pnpm knowledge:query -- owner <keyword-or-path>
→ FINANCIAL-MODEL.md when applicable
→ EXPERIENCE-AND-DESIGN.md when user/operator facing
→ applicable governance/policies/*
```

Then inspect live implementation/contracts/data. Do not implement against a documentation route/table/operation inventory.

## Definition of a credible local result

A command returning zero is evidence only for what it exercised. A material cross-layer capability normally requires the applicable chain from user/system action through owner, contract, durable effect and canonical readback—not merely a green frontend or backend command.
