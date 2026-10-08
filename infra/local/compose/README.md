# Local runtime ownership

Compose owns PostgreSQL, Mailpit, Identity, DSH and migration one-shots. It does not own Control Panel, Metro, ADB or scrcpy.

Daily backend lifecycle:

- `pnpm dev` — reconcile current backend images through Docker build cache, preserve/reuse state, wait for health, then return.
- `pnpm dev status` — display backend/state.
- `pnpm dev down` — stop repository host development processes and backend/state.

Interactive surfaces are package-owned foreground processes:

- `pnpm client|partner|captain|field` — run that app's Expo development server.
- `pnpm control` — run Control Panel Next development.
- `pnpm scr` — own ADB transport/reverse mappings and scrcpy.

Mobile apps are opened manually. Application-source edits reuse the running Metro process and Fast Refresh; Control uses Next HMR. Native rebuilds are not part of the source-edit loop.

`infra/local/.env.example` is the tracked local configuration template. The ignored local runtime projection is created beside it and preserved after creation.

The daily lifecycle preserves PostgreSQL/media volumes and does not reset accounts, categories or products. After Identity migrations, Compose runs the Identity-owned one-shot first-operator bootstrap. It only creates the initial operator when Identity contains no actors or operator state; when a valid initial operator already exists it returns that canonical actor unchanged, and incomplete or conflicting state fails closed. `IDENTITY_INITIAL_OPERATOR_PHONE` belongs in ignored `infra/local/.env` and is required only for a new empty Identity database. Persisted rows otherwise change only through an explicit owning migration or service operation, not merely because source or test fixtures changed. Local synthetic-data cleanup follows [the repository's local-state rules](../../../AGENTS.md#4-local-development-state).

An explicitly authorized local correction to the existing initial operator phone uses `docker compose ... run --rm --no-deps identity-bootstrap update-phone`; the command goes through Identity's actor owner, preserves actor identity and permissions, revokes that actor's active sessions and old-number challenges/invitations, suppresses queued delivery, and records masked audit metadata. Normal startup remains non-mutating for an existing operator.

There is no Docker JavaScript runtime, persistent synthetic world, global fixture registry, parallel surface runtime owner or automatic mobile-app opener.
