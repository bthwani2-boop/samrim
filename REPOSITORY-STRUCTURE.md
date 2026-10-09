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

## Rules

1. One responsibility has one canonical owner and path.
2. Do not pre-create future architecture or generic `shared`, `common`, `core`, `utils`, `helpers` or `misc` buckets.
3. Create a directory only for current material content.
4. Owner-specific tooling stays with its app, service or package; do not promote it to repository-wide tooling.
5. Generated artifacts remain derived from one authored source of truth.
6. Each service has one canonical migration history.
7. Cross-owner reuse goes through public service boundaries or proven domain-neutral packages, never private internals or another service database.
8. Structural moves are atomic: select the winner → cut over consumers/config/tests → delete the losing path and aliases → perform a fresh residue census.
