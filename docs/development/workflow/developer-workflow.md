# Developer Workflow

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE
CURRENT_COMMAND_TRUTH_SOURCE: package.json / pnpm-workspace.yaml / repository scripts
CURRENT_IMPLEMENTATION_TRUTH_SOURCE: LIVE_REPOSITORY_SOURCE_AND_RUNTIME

## Start here

Before a material change:

1. read `AGENTS.md`;
2. resolve only the applicable Product capability/journey/owner with `pnpm knowledge:query -- ...`;
3. confirm canonical owner/writer in `governance/architecture/OWNERSHIP-AND-SOURCE-OF-TRUTH.md`;
4. load the applicable Governance policy plus one focused development guide;
5. inspect the exact repository head, executable source/history/runtime and define the affected cone.

Repository orientation:

```text
apps/       → deployable hosts/composition
services/   → bounded-context/service implementations
packages/   → proven reusable technical packages
contracts/  → genuinely cross-service protocol material only
infra/      → environment/deployment composition
governance/ → durable meaning/policy
docs/       → human guidance
tools/      → automation/evidence
```

Placement follows durable responsibility, not import convenience.

## Toolchain and install

Repository-declared constraints currently include Node.js `24.17.0`, pnpm `10.34.0`, Go `1.27.1`, PowerShell `7.4+`, Git, and platform-specific tooling only when required.

Install exact workspace state:

```powershell
pnpm install --frozen-lockfile
```

Canonical bootstrap:

```powershell
pnpm bootstrap
```

Do not use package-local ad-hoc installs to repair a root workspace problem.

## Primary app and verification commands

```powershell
pnpm client
pnpm partner
pnpm captain
pnpm field
pnpm control

pnpm nx:projects
pnpm workspace:verify
pnpm mobile:verify-config
pnpm docs:verify:all
pnpm knowledge:verify:all
```

For the canonical integration runtime proof:

```powershell
pnpm runtime:integration:close
```

Use current `package.json` and repository scripts as command truth; this guide must not become a hand-maintained command registry.

## First representative change

For the first real change:

```text
PIN EXACT HEAD
→ RESOLVE PRODUCT/JOURNEY/OWNER
→ DEFINE AFFECTED CONE
→ CHANGE CANONICAL SOURCE/OWNER
→ UPDATE CONTRACT/GENERATED/DATA/CONSUMERS AS REQUIRED
→ VERIFY MATERIAL VERTICAL PATH
→ DELETE LOSING/OBSOLETE PATHS
→ RE-READ CANONICAL EFFECT/READBACK
```

A file/route/screen does not create ownership. Surface-specific feature UI stays with the app host; service truth/data/contracts stay with the owning service.

## Authorized-slice discipline

Incremental delivery means **small Product breadth on final architecture**, not temporary architecture.

```text
TARGET_PRODUCT_VISION != AUTHORIZED_PRODUCT_SCOPE
AUTHORIZED_PRODUCT_SCOPE != CURRENT_IMPLEMENTATION_STATE
SMALL_BREADTH != TEMPORARY_ARCHITECTURE
```

For an already-authorized slice:

- use the final canonical owner/model;
- close the material vertical path and required readback;
- preserve applicable security/financial/data/provider invariants;
- leave future Product breadth absent rather than fake;
- reverify previously proven evidence invalidated by shared owners/contracts/data/runtime/hosts.

Do not introduce `simple_*`, `*_v1`, bootstrap business models, fake routes/tables, shadow DTOs, temporary state machines, placeholder Product screens or speculative abstractions.

## Evidence discipline

Every material evidence claim is attributable to the exact candidate tested. Record enough to reconstruct commit SHA, claim, evidence source, result, proof boundary and invalidation trigger.

Static, runtime, visual/accessibility, security/privacy, financial/reconciliation, data-migration and release evidence are not interchangeable.

If the branch moves, invalidate only evidence whose affected cone changed. Git history is forensic archive; do not retain dead implementations in the current tree merely for reference.

## Donor/OSS and optional LeanCTX

Inspect only donor/reference material capable of changing the authorized slice's semantics, ownership, failure/recovery, UX or tests.

LeanCTX is an optional local context-reduction/navigation aid. It is never repository/product/architecture authority. Reconcile consequential conclusions against authoritative repository source before writing or closing anything. Do not commit host-specific LeanCTX caches, IDs, credentials or context dumps.
