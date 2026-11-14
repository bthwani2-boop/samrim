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

`compose.yaml` defines exactly these four. The project-scoped `isolated` bridge
is internal and keeps PostgreSQL inaccessible from the host. A second private
`loopback` bridge is used only by the services publishing 127.0.0.1 ports.
The two named volumes are project-scoped, and there are no host bind mounts.
Existing `samrim-local` containers, historical customers/Root Owner, balances, orders,
secrets, applied migrations and media are never copied or changed.

## The eight additional historical container roles

`compose.apps.yaml` defines `postgres-access`, `identity-migrate`,
`identity-bootstrap`, `identity`, `dsh-migrate`, `dsh`, `wlt-migrate`, and `wlt`
under the opt-in `implementation` profile. They are intentionally NOT_RUN
because this Worktree does not yet contain their Go Dockerfiles, real owner
contracts, migrations, safe owner-scoped DB roles or verified acceptance.
Never use the previous `samrim-local-identity:dev`, `samrim-local-dsh:dev`,
or `samrim-local-wlt:dev` images as fake refoundation implementations.

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

Do not invoke `compose.apps.yaml` with the `implementation` profile until
its real owner code, safe per-owner DB credentials and runtime proof exist.
Do not run `down -v`, `prune`, copy donor volume data or touch donor tasks.

## Approved port map (reservations, not live app listeners)

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
