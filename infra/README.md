# BThwani refoundation — isolated development infrastructure

Worktree: `D:\samrim-refoundation-clean-20261112`
Compose project: `bthwani-refoundation` (never use `samrim-local` or old volumes).
This environment is synthetic development only, not production deployment.

## Runnable now

| Service | Work | Lenovo loopback port |
| --- | --- | --- |
| `postgres` | Fresh PostgreSQL 18 + PostGIS, own empty database | internal 5432 only, not exposed |
| `media` | Fresh SeaweedFS mini, own media volume/credentials | 3233 |
| `mailpit` | Local inbound test email capture | 3226 |
| `payment-mock` | Empty WireMock, no provider mappings | 3290 |
| `dsh` (with optional Compose file) | Public discovery only; proven read-only Store/Offer API | 3202 |

`compose.yaml` defines exactly these four foundational dependencies. The project-scoped `isolated` bridge
is internal and keeps PostgreSQL inaccessible from the host. A second private
`loopback` bridge is used only by the services publishing 127.0.0.1 ports.
The two named volumes are project-scoped, and there are no host bind mounts.
Existing `samrim-local` containers, historical customers/Root Owner, balances, orders,
secrets, applied migrations and media are never copied or changed.

## Optional owner service roles and DSH public discovery

`compose.apps.yaml` contains eight historical opt-in `implementation` roles.
Only `dsh` and `dsh-migrate` there have a runnable Go entrypoint, and **`dsh`
serves public Store/Offer discovery only**. Its protected mutation and WLT/Order
integrations are NOT_RUN. Do not activate that entire profile.

**NEW Identity source exists** at `services/identity/backend`: it is a
synthetic, read-only PostgreSQL session/Operator-permission verifier. This is
not the old donor Identity and not a full login/session issuer. The old
`compose.apps.yaml` Identity entries still refer to nonexistent Dockerfiles,
bootstrap commands and endpoints. They are not valid for the new verifier.
WLT's genuine backend remains incomplete. Never substitute donor images,
reuse `samrim-local` volumes or claim production authentication.

### Build and run real public DSH inside the same Compose project

Use the exact Go version in root `.go-version`, installed on the Windows build
host. `infra/build-dsh-image.ps1` cross-compiles the DSH owner directly to Linux
and builds the image from the digest-pinned isolated Alpine runtime base; no old binaries
or secrets enter its build context; it packages the reviewed DSH SQL files
without running any migration. Add the **verified existing isolated** schema
and exact permitted browser origins only to the ignored `infra/.env`:

```dotenv
REF_DSH_DISCOVERY_SCHEMA=dsh_test_REPLACE_WITH_VERIFIED_SCHEMA
REF_DSH_PUBLIC_CORS_ORIGINS=http://127.0.0.1:3101,http://localhost:3101
```

Run from the Worktree root (never plain `--profile implementation up`):

```powershell
powershell -NoProfile -File infra/build-dsh-image.ps1
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.apps.yaml config --quiet
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.apps.yaml --profile implementation up -d --no-deps dsh
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.apps.yaml --profile implementation ps dsh
```

The public DSH image uses only the real `/health` and `/v1/public/stores`
routes; the Compose healthcheck confirms database reachability. The database
schema must have the reviewed DSH SQL migrations applied separately in the
isolated namespace before serving. The `dsh-migrate` service can explicitly run
migration 001 only after reviewing the target schema; it does not silently
seed or upgrade 002/003. Do not treat HTTP health as evidence of checkout,
merchant permissions, identity authentication or finance correctness.


### NEW Identity verifier in the SAME Compose project (prepared, NOT_STARTED)

`compose.identity-verifier.yaml` is an opt-in overlay for the **new
refoundation Go Identity source**, not `compose.apps.yaml`'s obsolete service.
Pair it **only** with `compose.yaml`; the existing project name remains
`bthwani-refoundation`, and its published host port is loopback-only 3201.
The service is `identity`, profile `identity-verifier`. It has no
automatic bootstrap, issuer, migrations, donor volumes or other service restarts.

`build-identity-verifier-image.ps1` uses the exact pinned host Go version,
rejects uncommitted Identity Go/SQL source, cross-compiles the real Linux binary
and labels the digest-pinned Alpine image with the source commit. SQL is only
packaged for review; **the build never applies a migration**. The container
uses non-root UID, read-only filesystem, dropped Linux capabilities and
no-new-privileges.

**Do not start it yet.** The current Identity owner `cmd/identity/main.go`
requires `127.0.0.1` bind, which is inaccessible to other Compose containers
and refuses the `0.0.0.0:3302` binding required for this opt-in internal
network service. The Identity owner must review and test a strict
*container-only, synthetic-mode* bind exception without weakening the
non-container loopback default. Also required: a verified dedicated
`identity_test_*` schema with a least-privilege runtime role, independently
reviewed SQL, durable current-session/permission positive and negative tests,
and committed owner source. Uncommitted Identity source deliberately causes
the image build to fail.

After those independent prerequisites are **proved**, load only the ignored
`infra/.env` values `REF_IDENTITY_TEST_SCHEMA`,
`REF_IDENTITY_TEST_DATABASE_URL` (pointing to isolated `postgres:5432`,
never donor/production), and optionally `REF_IDENTITY_VERIFIER_PORT`.
The explicit deployment sequence is:

```powershell
powershell -NoProfile -File infra/build-identity-verifier-image.ps1
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.identity-verifier.yaml --profile identity-verifier config --quiet
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.identity-verifier.yaml --profile identity-verifier up -d --no-deps identity
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.identity-verifier.yaml --profile identity-verifier ps identity
```

The service will not be declared healthy on a TCP listener, unauthenticated
HTTP response or container exit code. Require an actual **Identity-owned**
PostgreSQL session read and permission denial/revocation proof, and compare
the running image ID and source SHA before changing DSH consumers. No
real login, WebAuthn, Operator permission administration or production release
is authorized by this isolated verifier.

## Deployment boundary and security review

The DSH container is a **local public-read-only** service: non-root runtime,
read-only container root filesystem, all Linux capabilities dropped, no new
privileges and loopback-only published port. It has no application volume mounts,
and its PostgreSQL dependency is on the project's internal bridge network.

**Known limitation:** The current DSH discovery owner uses the private
development database administrator credentials via `REF_POSTGRES_*`. This is
only acceptable for tightly isolated synthetic development, **not** release.
Before any protected endpoint or non-synthetic deployment, create and verify
owner-scoped DSH runtime database grants (separate migration credentials),
real Identity authorization, WLT integration and negative/recovery tests.
Do not change DB grants or handle real money through this setup.

The build script rejects uncommitted Go/SQL source so that its source-SHA image
label cannot silently certify a different working-tree revision. The image
build itself does not certify merchant scope, login, checkout or finance.
Identity and WLT require their genuine owner implementations and signed-off
security/ledger evidence; no placeholder service counts as readiness.

## Credentials and startup

`setup-env.mjs` is an idempotent local secret generator that never prints values.
An actual ignored `infra/.env` is required before starting; a missing or blocked
secret store is a BLOCKED state, **not** permission to use old credentials.
Necessary non-secret names are `REF_POSTGRES_USER`, `REF_POSTGRES_DB`,
`REF_MEDIA_BUCKET` and port variables; secrets are `REF_POSTGRES_PASSWORD`,
`REF_MEDIA_ACCESS_KEY` and `REF_MEDIA_SECRET_KEY`.

Once authorized private credentials exist, run from the Worktree root:

```powershell
node infra/setup-env.mjs
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml config --quiet
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml up -d
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml ps
```

Do not start the whole `implementation` profile. Launch only the proven DSH
public service explicitly; the remaining future owner roles must first pass
owner-backed persistence, security and financial acceptance.
Do not run `down -v`, `prune`, copy donor volume data or touch donor tasks.

## Approved port map (only DSH and the listed dependencies are currently live)

| Future native app | Port | Future service | Port |
| --- | ---: | --- | ---: |
| Customer | 3101 | Identity | 3201 |
| Merchant | 3102 | DSH | 3202 |
| Captain | 3103 | WLT | 3203 |
| Operator | 3104 | | |

Mailpit 3226, SeaweedFS 3233, Payment Mock 3290. PostgreSQL is network-internal.
All published service ports bind to 127.0.0.1 **on Lenovo**. They are not
automatically reachable on Surface as localhost. Use separately verified SSH
loopback forwards when genuinely needed, without changing donor tunnels.
Expo and Next development processes are native, not Docker containers.

## What counts as proof

Check Docker project labels, two new volume names and two project-scoped networks, the
four dependency health/readiness states, and the old container IDs and volume
names before/after. Check a fresh database contains no business tables.
HTTP 200 and healthy Docker containers do NOT prove Go implementation,
authorization, ledger invariants, Android/iOS journeys or production readiness.
Production and GitHub merge remain separately blocked until their gates pass.
