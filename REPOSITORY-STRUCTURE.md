# Repository placement

This file defines placement only. `AGENTS.md` governs execution. Local docs/governance/README.md routes approved durable Product/System/Policy meaning. Exact source, project graph, configuration and runtime own current implementation truth.

## Owners

- `apps/` — deployable UI/composition hosts.
- `services/` — bounded service owners, including their contracts, clients, migrations, tests and service-specific tools.
- `packages/` — proven domain-neutral technical reuse with multiple real consumers.
- `infra/` — deployment and local environment composition only.
- `tools/` — genuinely repository-wide development, build, security and platform utilities.
- `tests/` — genuinely cross-owner integration/runtime proofs.
- `.github/` — GitHub automation only.
- `docs/governance/` — binding semantic decisions routed by its README; `docs/reference/` — preserved non-authoritative research and links.

## Rules

1. One responsibility has one canonical owner and path.
2. Do not pre-create future architecture or generic `shared`, `common`, `core`, `utils`, `helpers` or `misc` buckets.
3. Create a directory only for current material content.
4. Owner-specific tooling stays with its app, service or package; do not promote it to repository-wide tooling.
5. Generated artifacts remain derived from one authored source of truth.
6. Each service has one canonical migration history.
7. Cross-owner reuse goes through public service boundaries or proven domain-neutral packages, never private internals or another service database.
8. Structural moves are atomic: select the winner → cut over consumers/config/tests → delete the losing path and aliases → perform a fresh residue census.


## Required naming and placement rules for refoundation

- Place every **authored** file at the owner of its current responsibility, not under its historic screen, team, temporary project, technology fashion or previous developer. UI hosts own composition; service owners own business code, schemas, migrations, API contracts and their tests. Domain-neutral `packages/` reuse needs at least two evidenced consumers and no business writer. Keep service-owned and app-owned tests beside their owners; use root `tests/` only for genuine cross-owner proofs.
- Names express **one stable responsibility** in the approved Customer/Merchant/Captain/Operator vocabulary. Prefer clear, domain-specific directories and file names to `shared`, `common`, `misc`, `legacy`, `new`, `v2`, date suffixes or parallel aliases. Do not bulk-rename stable external URLs, package IDs, device bundle IDs, API contracts, migration versions, legally binding records or old Git history just to improve spelling; manage each actual compatibility boundary before retirement.
- For each affected duplicate, keep the **canonical owner/implementation**, move genuinely unique responsibilities to their lawful owners, rewire every caller and generated contract, then remove the losing source, imports, exports, routes, dependency and obsolete tests. A useful capability (including maps, video, media, offline recovery, reports or accessibility) cannot be discarded because its old file is badly named. A large file is split only when independent responsibilities or testability make that worthwhile; small files are merged when they only fragment one responsibility.
- Avoid decorative reorganization and arbitrary file-count targets. Never create a second route, engine, schema, editor, policy store, cache writer or `compat` layer as a shortcut for a move. A necessary temporary compatibility path has a unique owner, consumers, clear expiry and proven cutover; otherwise delete it.
- Preserve `docs/reference/` links and original OSS/competitor evidence; maintain exactly one semantic governance owner per decision and one executable source per generated output. Keep approved Spec Kit tooling, useful Expo platform packages and external identities unless their individual migration is separately authorized.
- On case-insensitive Windows filesystems, case-only renames and moves must be checked against Git's actual path index and cross-platform imports; no case-colliding files or references are allowed.

## Structural acceptance for each affected slice

A structural slice is complete only after the target owner and names are mapped to **actual** affected files, affected importers/exports/routes/contract generation/tests/configuration/migrations are cut over, the old path and aliases are gone, and the current Git diff and targeted source/test/runtime proof show no lost required behavior, stale reference, unauthorized access or parallel authority. Check for remaining references using the repository's actual tracked paths and the build/dependency graph where applicable; classify any unresolved consumer `BLOCKED`, not success. Report which affected files were kept, renamed/moved, merged, replaced or deleted and the proof; do not produce an enduring second file inventory or duplicate Product decision log. Protect unrelated unstaged work.
