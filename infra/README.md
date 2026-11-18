# BThwani refoundation — isolated development infrastructure

Canonical checkout: `D:\samrim` (current development branch changes).
Compose project: `bthwani-refoundation` is a stable runtime identity. Do not change it when switching Git branches or repurpose donor volumes.
This environment is synthetic development only, not production deployment. Legacy `com.bthwani.worktree` labels are retained as compatibility identifiers for running containers; they do **not** describe the current checkout. Do not recreate existing services or rename their volumes as part of a Git branch change.

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

`compose.apps.yaml` now contains **only** the two real DSH owner roles:
`dsh` and opt-in `dsh-migrate`. Placeholder Identity/WLT services,
nonexistent bootstrap commands and invalid old Dockerfiles are no longer
advertised as runnable. Do not start the whole `implementation` profile.
DSH public Store/Offer discovery is real; protected mutation and WLT/Order
integration remain NOT_RUN.

Identity is a separate, synthetic Go session/Operator-permission verifier
in `compose.identity-verifier.yaml`, not a first-factor login issuer.
The two overlays may be combined with the same `compose.yaml` without
competing service definitions. WLT has no runnable Go backend yet.

The DSH migration command now uses its own `migration` Compose profile,
separate from `implementation`. Normal `implementation` startup cannot start
`dsh-migrate`; migration remains an explicit, separately reviewed operation.
Validate this invariant with `node --test infra/compose-policy.test.mjs` and
`docker compose ... --profile implementation config --services`. Never use
`--profile '*'`, `--profile migration up` or automatic migrations in the normal
service-start path. Existing running containers and persisted volumes are not
recreated by this file change.
Never reuse donor images, production data or `samrim-local` volumes.

### Build and run real public DSH inside the same Compose project

`services/dsh/backend/Dockerfile` is the canonical multi-stage Go build. Its
builder is pinned to the approved root `.go-version` and an immutable digest,
and the runtime Alpine image is also digest-pinned. The context is only
`services/dsh/` with an allowlisted `.dockerignore`; no local Go compiler or
Windows cross-compilation is required. `infra/build-dsh-image.ps1` keeps
committed-source SHA checks and creates a tagged image without starting it,
modifying secrets, or executing SQL migrations. Add the **verified existing isolated** schema
and exact permitted browser origins only to the ignored `infra/.env`:

```dotenv
REF_DSH_DISCOVERY_SCHEMA=dsh_test_REPLACE_WITH_VERIFIED_SCHEMA
REF_DSH_PUBLIC_CORS_ORIGINS=http://127.0.0.1:3101,http://localhost:3101
```

Run from the checkout root (never start an entire profile). The default
`:dev` image tag preserves the existing running service; set
`REF_DSH_IMAGE_TAG` to an independently tested revision tag for controlled
rollout. An image build by itself does not recreate an existing container:

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
seed or upgrade 002/003/004/005. It is isolated under the `migration` profile,
not included in routine `implementation` startup. Inspect the exact applied
migration versions and target role before any separately authorized migration. Do not treat HTTP health as evidence of checkout,
merchant permissions, identity authentication or finance correctness.


### Isolated Identity verifier in the SAME Compose project

`compose.identity-verifier.yaml` is an opt-in overlay for the **new
refoundation Go Identity source**. Pair it with `compose.yaml` and optionally
`compose.apps.yaml` for the real DSH service; the existing project name remains
`bthwani-refoundation`, and its published host port is loopback-only 3201.
The service is `identity`, profile `identity-verifier`. It has no
automatic bootstrap, issuer, migrations, donor volumes or other service restarts.

`services/identity/backend/Dockerfile` now builds the real Go binary in a
pinned multi-stage Linux builder. `build-identity-verifier-image.ps1` checks
that the Docker builder matches `.go-version`, rejects uncommitted owner
source, and records the exact source SHA on the resulting image. The Docker
context is limited to `services/identity/`; SQL is packaged for review and
**never executed by the image build**. The container
uses non-root UID, read-only filesystem, dropped Linux capabilities and
no-new-privileges.

**Do not start it based on a passing Compose config alone.** The committed
Identity owner now permits `0.0.0.0:3302` only with both
`BTHWANI_ISOLATED_TEST_MODE=true` and `BTHWANI_ISOLATED_CONTAINER_MODE=true`,
a valid `identity_test_*` schema, and the exact container listener port.
This overlay sets both explicit flags. The normal host default remains
`127.0.0.1:3302`. Owner Go negative tests cover the listener restriction,
but an actual networked verifier and its database permissions are separate
runtime gates. Before starting, verify an independently isolated synthetic
schema, least-privilege database role, reviewed applied SQL and protected
Identity session/permission denial and revocation readback. The build script
continues to reject uncommitted Identity Go/SQL source; no issuer, real user
or production authentication is enabled by these settings.

After those independent prerequisites are **proved**, set the Identity-only
values `REF_IDENTITY_TEST_SCHEMA`, `REF_IDENTITY_TEST_DATABASE_URL` (pointing
to isolated `postgres:5432` with a separately authorized limited database
role, never admin/donor/production), and optionally `REF_IDENTITY_VERIFIER_PORT`
in the ignored `infra/.env.identity-verifier.local`. Keep the shared
`infra/.env` untouched. `REF_IDENTITY_IMAGE_TAG` may select a tested revision
image; default `:dev` remains compatible with existing development commands.
Set `REF_IDENTITY_SYNTHETIC_PHONE_AUTH=true` only after applying the Identity
phone migration in the synthetic schema and verifying the runtime role's scoped
write privileges. Supply a fresh 32-byte hex `REF_IDENTITY_SYNTHETIC_PHONE_HMAC_KEY`
through the Identity-only local settings. Delivery stays on the project's
`mailpit:1025` network endpoint and accepts only the reserved test phone range.
The Lenovo Merchant launcher enables local Web admission on startup when the
synthetic phone endpoint is present at `127.0.0.1:3201`. A different loopback
port requires an explicit `MERCHANT_SYNTHETIC_IDENTITY_ORIGIN` setting.
The opt-in deployment sequence is:

```powershell
powershell -NoProfile -File infra/build-identity-verifier-image.ps1
docker --context bthwani-docker compose --env-file infra/.env --env-file infra/.env.identity-verifier.local -f infra/compose.yaml -f infra/compose.identity-verifier.yaml --profile identity-verifier config --quiet
docker --context bthwani-docker compose --env-file infra/.env --env-file infra/.env.identity-verifier.local -f infra/compose.yaml -f infra/compose.identity-verifier.yaml --profile identity-verifier up -d --no-deps identity
docker --context bthwani-docker compose --env-file infra/.env --env-file infra/.env.identity-verifier.local -f infra/compose.yaml -f infra/compose.identity-verifier.yaml --profile identity-verifier ps identity
```

The committed Identity verifier now exposes `GET /health` for isolated
development only. It checks a bounded PostgreSQL Ping without exposing actor,
session or credential details; its Docker healthcheck is **readiness only**.
A successful health response does not prove login, permissions or session
revocation. Require actual **Identity-owned** PostgreSQL session read,
permission denial/revocation proof and running image ID/source SHA matching
before changing DSH consumers. Existing containers must be rebuilt and
separately tested before the new healthcheck can be claimed live. No
real login, WebAuthn, Operator permission administration or production release
is authorized by this isolated verifier.

## Non-invasive runtime attestation and disposable PostgreSQL proof

Before trusting a previously running Docker service after a source change, use:

```powershell
node infra/verify-runtime-provenance.mjs --context bthwani-docker
pwsh -NoProfile -File infra/verify-isolated-postgres.ps1 -DockerContext bthwani-docker
```

The runtime check reads the actual Compose container image ID, non-secret source
SHA labels, owner Git history/diff, health and owner worktree state. It fails on
missing labels, changed owner source or an unproven container. It **does not**
rebuild/restart a service, examine secrets, run SQL or prove login, session
revocation, WLT, published client UX or production suitability. Building a
new `sha-<commit>` image is a separate operation and does **not** update the
container already running. Readiness always attaches to the *running* image ID.

The SQL proof intentionally creates a **new disposable container** with a
unique `bthwani-agent01-pgproof-*` name and the same pinned PostGIS image as
the existing Compose stack. It has `--network none`, no published ports, no
external volumes and tmpfs-only PostgreSQL storage. The script runs all five
current DSH migrations in order, establishes a synthetic read-only role and
asserts that its writes fail (SQLSTATE 42501), then makes a PostgreSQL backup,
restores it into a second disposable database and compares schema/data counts.
It stops only its own identity-verified scratch container at the end.

**Scope boundary:** This proves an *empty isolated fresh installation*,
synthetic least-privilege example and local restore, not migration of existing
protected DSH data, privileges of the shared refoundation database, an
already-running service version, service-to-service authentication, or any
financial ledger. Do not take the successful scratch proof as authority to
change shared database roles, alter protected volumes, restart active services
or run real schema upgrades.

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

Do not start an entire Compose profile. Launch only services with proven
source, isolated database permissions and authorization acceptance. WLT
remains unbuilt and must not be represented by a placeholder container.
Do not run `down -v`, `prune`, copy donor volume data or touch donor tasks.

## Approved development port map (configured ports are not proof of current source or readiness)

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
