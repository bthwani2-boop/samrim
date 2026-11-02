# Local runtime ownership

Compose owns PostgreSQL, Mailpit, Identity, DSH, WLT, the migration one-shots and local database-access provisioning. It does not own Control Panel, Metro, ADB or scrcpy.

On `pnpm dev`, missing per-service database passwords are generated once in the ignored `infra/local/.env` and never printed. A post-migration one-shot creates restricted Identity runtime/maintenance, DSH and WLT runtime roles, grants owner-scoped access and verifies real logins and cross-owner denial before starting the APIs. Migration and first-operator bootstrap jobs continue to use the local administrator, never exposed to runtime containers. No existing tables, actor IDs, sessions, or volumes are reset by this change.

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

## Docker Desktop engine and restore evidence (local observation, 2026-10-28)

The local Windows host currently selects **Docker VMM (Beta)** in Docker Desktop 4.97.0. The active Docker CLI context is `desktop-linux`; the PostgreSQL and SeaweedFS containers use named Docker volumes (`samrim-local_samrim-postgres18-data` and `samrim-local_samrim-media-data`), not bind mounts into the repository. The observed Docker Desktop virtual disk is `C:\Users\bassa\AppData\Local\Docker\vm-data\DockerDesktop.vhdx` (~6.32 GiB at this observation); the project and external backups remain on `D:`. These host-specific details are observations, **not** a required path, a permanent configuration contract or evidence of the Docker backend from `docker context` alone. Recheck current backend, disk location, context, container mounts, and backups before a recovery or migration.

For G01, use a separate Docker network, disposable PostgreSQL/SeaweedFS volumes and actual service-owner readback. Restoring the database or copying media alone does not prove combined Identity/DSH/WLT recovery. Never reset Docker Desktop, prune project volumes, swap active VHDX storage, or restore over existing data to make a test pass. A virtual disk file is not itself a verified, off-engine recoverable backup; verify external database and media backups plus their restore and ACL behavior independently.

## Remote Docker on Lenovo (local development)

The Windows Surface keeps the source tree, applications, Docker CLI and Compose plugin; a dedicated
Windows Lenovo host runs Docker Desktop and all containers. The SSH Docker context is
`bthwani-docker`. Local development never requires making Docker Engine or PostgreSQL
available on a LAN-facing address.

The ignored `infra/local/.env` must set `SAMRIM_REMOTE_DOCKER_ROOT` to an absolute Windows
path **on Lenovo** containing `compose/runtime-roles.sql`,
`compose/verify-runtime-access.sh`, and `payment-provider-mock/mappings/`.
The `remote.override.yaml` overlay maps only these host bind sources; other Compose
data stays in named Docker volumes. Keep those static inputs in sync with the source tree
when their contents change. The default `desktop-linux` context uses the original
Compose file and is unaffected by the remote overlay.

After an explicitly verified data cutover, choose `docker context use bthwani-docker`
on Surface, and run `pnpm dev` / `pnpm dev status` as before. The dev script selects the
overlay only when the active Docker context is `bthwani-docker`; if the remote Docker
engine is unavailable it fails rather than starting local Docker Desktop. For a temporary
remote test before cutover, set `DOCKER_CONTEXT=bthwani-docker` only in that shell,
without changing the global default context.

All service host ports are bound to Lenovo `127.0.0.1`. Surface accesses them using
SSH local forwards to the same port numbers **after local Docker releases those ports**.
Port forwarding must be active before starting Expo/Control Panel. If Lenovo sleeps,
reboots or disconnects from Wi-Fi, those service connections stop until the SSH tunnel
reconnects. Docker Desktop is user-session software: verify startup after Windows login
and never equate SSH reachability alone with a running Docker engine.

Preserve separate, verified PostgreSQL and SeaweedFS backups before switching writers.
Never replace volumes with the raw Docker VMM VHDX or `docker compose down -v`.
