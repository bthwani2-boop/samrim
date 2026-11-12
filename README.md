# BThwani — Refoundation workspace, foundation stages 1–3

This is the **clean refoundation candidate**, not a replacement for the original source/runtime. Current canonical **draft** Product/architecture governance is in [`governance/README.md`](governance/README.md) and is deliberately `NOT_READY` until independent finance/security/migration review and remaining semantic reconciliation.

Stage 1 records the governance blockers and source provenance. Stage 2 inventories and pins the **original branch-41 versions** without upgrading any system-wide software. Stage 3 contains only a minimal source-sparse `pnpm workspace` with TypeScript and Biome pinned at the donor versions. No Expo apps, Go services, contracts, SQL, database, Docker environment or Nx configuration has been created.

## Local checks

Use the already installed **pnpm 12.15.0**:

```powershell
pnpm install --offline --frozen-lockfile --ignore-scripts
pnpm run check
pnpm exec tsc --version
pnpm exec biome --version
```

On a clean machine without a populated package cache, use `pnpm install --frozen-lockfile --ignore-scripts` after installing the **same pinned pnpm 12.15.0**: it may fetch the **exact integrity-locked artifacts**, but must not recalculate or upgrade their versions. The offline command above is the locally verified path.

`pnpm run check:toolchain` additionally enforces exact local Node/Go toolchain versions. It is expected to **fail** while this machine has Go `1.27.1` and the original source requires Go `1.27.3`. Do not hide the mismatch or upgrade Go without authorization.

No `tsc` project compile, Nx graph, Go service build, Expo start, UI theme/RTL, database migration, OpenAPI contract, GitHub remote CI or app-runtime validation is possible yet. Source version evidence: [`docs/reference/TOOLCHAIN-SOURCE-VERSIONS.md`](docs/reference/TOOLCHAIN-SOURCE-VERSIONS.md). The single temporary stage evidence tracker is `docs/REFOUNDATION-PLAN.md`, not this README.
