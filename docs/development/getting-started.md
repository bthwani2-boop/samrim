# Developer Getting Started

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
CURRENT_COMMAND_AUTHORITY: package.json / pnpm-workspace.yaml / repository scripts

## Developer reading path

Before making a material change:

1. read `governance/project/PLATFORM.md`;
2. read `governance/product/PRD.md`;
3. locate the capability in `governance/product/CAPABILITIES.md`;
4. locate the journey in `governance/product/JOURNEYS.md`;
5. confirm ownership in `governance/architecture/OWNERSHIP-AND-SOURCE-OF-TRUTH.md`;
6. read `repository-map.md` and the applicable development guide.

## Prerequisites

Current root toolchain constraints are:

- Node.js `24.17.0` (`.nvmrc`, `.node-version`);
- pnpm `10.34.0`;
- PowerShell 7+ for repository Windows scripts;
- Git;
- Docker only when the selected runtime/integration path requires it;
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

## Primary verification

Fast affected verification:

```powershell
pnpm verify
```

Full workspace verification when the affected cone requires it:

```powershell
pnpm verify:full
```

Runtime smoke for the declared full integration profile:

```powershell
pnpm runtime:full:smoke
```

Contract/database/runtime-specific commands are discoverable from `package.json`; choose only the evidence applicable to the change.

## Before changing a capability

Read the applicable Product and policy owners first:

```text
governance/product/PRD.md
→ governance/product/CAPABILITIES.md
→ FINANCIAL-MODEL.md when applicable
→ EXPERIENCE-AND-DESIGN.md when user/operator facing
→ applicable governance/policies/*
```

Then inspect live implementation/contracts/data. Do not implement against a documentation route/table/operation inventory.

## Definition of a credible local result

A command returning zero is evidence only for what it exercised. A material cross-layer capability normally requires the applicable chain from user/system action through owner, contract, durable effect and canonical readback—not merely a green frontend or backend command.
