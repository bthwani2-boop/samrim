# BThwani — Original branch-41 toolchain baseline (non-governing reference)

ARTIFACT_CLASS: NON_AUTHORITATIVE_TOOLCHAIN_PROVENANCE
BUSINESS_POLICY_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE
SOURCE_REPOSITORY: D:\samrim
SOURCE_BRANCH: 41
SOURCE_HEAD: 426d67b47beb8c66b09acd8c7394086b53ac5aae
STATUS: STAGE_1_TO_3_TOOLCHAIN_INVENTORY

This inventory is extracted from the **actual root manifests and package manifests at the source HEAD**, not from old chats or an instruction to update package releases. **Do not upgrade any of these versions in the new Worktree.** Keep this file as historical evidence; the eventual executable version pins are the new root manifests and individual approved consumer package.json/go.mod files when they are created.

| Tool, library or runtime | Exact source version | Stage 1–3 disposition |
| --- | --- | --- |
| Node (project .node-version / .nvmrc) | `24.22.1` | Pinned in new root; installed Node matches |
| Node package engine range | `>=24.17.0 <25` | Same original range; pnpm's bundled runtime may differ from command-line Node |
| pnpm | `12.15.0` | Exact executable matched and used for a new minimal frozen lockfile |
| Go (.go-version / go.work / service modules) | `1.27.3` | Pinned; installed machine has **1.27.1**, so exact Go build/reproduce remains BLOCKED; do not silently use a different Go version |
| Git command observed | `2.55.0.windows.3` | Available; no source-required pin for Git |
| TypeScript | `7.0.2` | Exact isolated dev dependency in stage-3 root |
| Biome | `2.5.12` | Exact dev dependency; pre-existing lint/formatter choice, no redundant ESLint installed |
| Nx | `24.0.1` | **DEFERRED** until actual runnable projects need graph/affected/caching; no Nx Cloud or copied old Nx configuration |
| Expo | `58.0.19` | **DEFERRED** to Stage 4 |
| Expo Metro config | `58.0.17` | **DEFERRED** to Stage 4 |
| Expo Router | `58.0.26` | **DEFERRED** to Stage 4 |
| React / react-dom | `19.3.0` | **DEFERRED** to Stage 4 |
| React Native | `0.88.0` | **DEFERRED** to Stage 4 |
| Tamagui and @tamagui/config | `3.3.1` | **DEFERRED** to Stage 4 |
| Next.js | `16.4.3` | **DEFERRED** to Stage 4 |
| Ant Design | `6.6.7` | **DEFERRED** to Stage 4 |
| Docker CLI observed | `29.9.2` | Present only; **no containers created or started** |
| Docker Compose observed | `5.6.1` | Present only; no Stage-6 environment |
| Java observed | `21.0.12.1` | Installed; Android Stage 4 verification not performed |
| Android adb observed | `37.0.1` | Present; actual Android build/emulator and SDK completeness NOT_RUN |

The old `pnpm-lock.yaml` includes unrelated apps, packages, development patches and provider dependencies. It **must not be copied** into a source-sparse Workspace: Stage 3 generates its own lock for only the exact selected tools using `pnpm 12.15.0` offline. Later projects must reintroduce only real source-approved dependencies with the **same exact published versions** and no automatic latest or version-range upgrade.

**Safety gate:** The Go mismatch does not justify changing `.go-version` from `1.27.3` to `1.27.1`, or installing/upgrading a machine-wide Go runtime without separate review of its effect. Mark full exact Go toolchain readiness `BLOCKED` until the correct source-matching toolchain is available without violating user constraints. Stage 3 can still validate pnpm, TypeScript and Biome now.
