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
| `payment-mock` | WireMock with fixed synthetic cash-in evidence (no production rails) | 3290 |
| `wlt` (opt-in overlay) | Real WLT read-only Customer balance/history with new isolated PostgreSQL database | 3203 |
| `dsh` (with optional Compose file) | Public discovery only; proven read-only Store/Offer API | 3202 |

The `payment-mock` image is built from `tests/infra/payment-mock/Dockerfile` using the existing
pinned WireMock base and fixed, synthetic funding-status mappings. Only the
listed `GET /sandbox/v1/funding/{reference}` test identities return evidence.
Unknown operations return 404. The simulator never owns wallets, posts money,
or exercises a production payment rail. It has no mounted host data or provider
secrets. The image build and any controlled replacement of the already-running
container are separate operations; merely editing Compose does not refresh it.

`compose.yaml` defines exactly these four foundational dependencies. The project-scoped `isolated` bridge
is internal and keeps PostgreSQL inaccessible from the host. A second private
`loopback` bridge is used only by the services publishing 127.0.0.1 ports.
The two named volumes are project-scoped, and there are no host bind mounts.
Existing `samrim-local` containers, historical customers/Root Owner, balances, orders,
secrets, applied migrations and media are never copied or changed.

## Optional owner service roles and DSH public discovery

`compose.apps.yaml` now contains **only** the two real DSH owner roles:
`dsh` and opt-in `dsh-bootstrap`. Placeholder Identity services and nonexistent bootstrap commands are not
advertised as runnable. The separate `compose.wlt.yaml` now defines the real
read-only WLT development owner; it is not activated by the DSH profile. Do not start the whole `implementation` profile.
DSH public Store/Offer discovery is real; protected mutation and WLT/Order
integration remain NOT_RUN.

Identity is a separate, synthetic Go session/Operator-permission verifier
in `compose.identity-verifier.yaml`, not a first-factor login issuer.
The two overlays may be combined with the same `compose.yaml` without
competing service definitions. The [WLT Customer balance reader](../services/wlt/backend/README.md)
runs only as an isolated loopback process with its read-only database role.

The fresh DSH bootstrap command uses its own `bootstrap` Compose profile,
separate from `implementation`. Normal `implementation` startup cannot start
`dsh-bootstrap`; bootstrap remains an explicit, separately verified operation on a new empty schema.
Validate this invariant with `node --test tests/infra/compose-policy.test.mjs` and
`docker compose ... --profile implementation config --services`. Never use
`--profile '*'`, `--profile bootstrap up` or automatic schema changes in the normal
service-start path. Existing running containers and persisted volumes are not
recreated by this file change.
Never reuse donor images, production data or `samrim-local` volumes.

### Opt-in real WLT read-only container

WLT has a separate `compose.wlt.yaml` overlay and a pinned service-owned
Dockerfile. The refoundation database currently used by Identity/DSH is
**not** renamed, erased or migrated. Provision `bthwani_wlt_test` explicitly
using `pwsh -NoProfile -File tools/dev/provision-wlt-test-db.ps1` only after
confirming it and its three WLT roles do not already exist. That operation
creates a new isolated database plus its own read-only runtime credentials
inside ignored `infra/.env`. It must never be run automatically with Compose.

After a source commit, build via
`pwsh -NoProfile -File tools/dev/docker/build-owner-image.ps1 -Owner wlt`, and configure with
`docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.wlt.yaml --profile wlt-reader config --quiet`.
Start only the admitted reader using the matching Compose invocation plus
`up -d --no-deps wlt`. Port `3203` is bound to Lenovo loopback only;
WLT uses the existing synthetic Identity verifier `identity:3302` and a
separate read-only WLT database identity. A successful Docker healthcheck
indicates only local process/SQL readiness; financial delivery, checkout and
production remain disabled. The local executable loopback reader remains
supported independently.

### Build and run real public DSH inside the same Compose project

`services/dsh/backend/Dockerfile` is the canonical multi-stage Go build. Its
builder is pinned to the approved root `.go-version` and an immutable digest,
and the runtime Alpine image is also digest-pinned. The context is only
`services/dsh/` with an allowlisted `.dockerignore`; no local Go compiler or
Windows cross-compilation is required. `tools/dev/docker/build-owner-image.ps1` keeps
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
powershell -NoProfile -File tools/dev/docker/build-owner-image.ps1 -Owner dsh
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.apps.yaml config --quiet
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.apps.yaml --profile implementation up -d --no-deps dsh
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.apps.yaml --profile implementation ps dsh
```

The public DSH image serves `/health` and the public Store discovery routes.
The Compose healthcheck requires the configured DSH discovery revision row to
be readable. A freshly initialized schema with an empty catalog is ready. For a
new verified absent `dsh_test_*` namespace, explicitly run the `dsh-bootstrap`
one-shot service in the `bootstrap` profile after building the matching owner
image. It uses the reviewed ordered `database/schema/` files in one transaction,
refuses existing schemas, and by default does not seed or upgrade. For a new
empty synthetic Merchant development environment explicitly approved for Sanaa
registration, add the one-shot opt-in to the existing bootstrap command:

```powershell
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.apps.yaml --profile bootstrap run --rm --no-deps -e DSH_BOOTSTRAP_SYNTHETIC_REGISTRATION=true dsh-bootstrap
```

The opt-in installs only Sanaa, the synthetic grocery vertical, one
nonbinding terms version and two audited version-1 registration policies in
the same fresh transaction. System provenance is not a human operator.
No Stores, publication, orders, financial agreements or money are seeded.
Do not set this flag on serving or retained-data reconciliation commands.
A repeated bootstrap refuses the existing schema; changes made by Operators
remain untouched. Never run it against
retained state or as part of normal `implementation` startup. A retained
schema must keep its existing applied history and any separately authorized
upgrade path until its compatibility obligations are resolved. Do not treat HTTP health as evidence of checkout,
merchant permissions, identity authentication or finance correctness.


### Isolated Identity verifier in the SAME Compose project

`compose.identity-verifier.yaml` is an opt-in overlay for the **new
refoundation Go Identity source**. Pair it with `compose.yaml` and optionally
`compose.apps.yaml` for the real DSH service; the existing project name remains
`bthwani-refoundation`, and its published host port is loopback-only 3201.
The service is `identity`, profile `identity-verifier`. It has no
automatic bootstrap, issuer, migrations, donor volumes or other service restarts.

`services/identity/backend/Dockerfile` now builds the real Go binary in a
pinned multi-stage Linux builder. `build-owner-image.ps1` checks
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
values `REF_IDENTITY_TEST_SCHEMA`, `REF_IDENTITY_RUNTIME_DATABASE_URL` (pointing
to isolated `postgres:5432` with a separately authorized limited database
role, never admin/donor/production), and optionally `REF_IDENTITY_VERIFIER_PORT`
in the single ignored `infra/.env`. Preserve all other owner settings and credentials. `REF_IDENTITY_IMAGE_TAG` may select a tested revision
image; default `:dev` remains compatible with existing development commands.
Set `REF_IDENTITY_SYNTHETIC_PHONE_AUTH=true` only after applying the Identity
phone verification baseline in a new synthetic schema (or confirming the compatible retained schema) and verifying the runtime role's scoped
write privileges. Supply a fresh 32-byte hex `REF_IDENTITY_SYNTHETIC_PHONE_HMAC_KEY`
through the Identity-only local settings. Delivery stays on the project's
`mailpit:1025` network endpoint. Verify the Yemeni phone format constraint from `database/schema/10_verification.sql`
and set `REF_IDENTITY_SYNTHETIC_YEMEN_PHONES` to the allowed test numbers in
international format. The Compose default is `+967770000001`.
The local Merchant development Web endpoint checks synthetic phone availability
at `127.0.0.1:3201` on each admission retry. For alternate isolated hosts, set
`MERCHANT_SYNTHETIC_IDENTITY_ORIGIN` and `MERCHANT_SYNTHETIC_DSH_ORIGIN` explicitly.
The default local DSH origin is `127.0.0.1:3202`. Its standing endpoint must
independently verify the Merchant session with Identity. For a containerized
DSH verifier connection, set `REF_DSH_IDENTITY_VERIFIER_URL` to the authorized
HTTPS Identity origin. Leaving it unset keeps protected DSH operations unavailable.

For the isolated Docker Merchant read path, add `compose.merchant-development.yaml`
to the base, Identity and DSH Compose files. It requires two dedicated volumes.
The Identity TLS volume contains `server.pem` and `server-key.pem`, with the key
readable only by Identity's UID 65532. The separate DSH trust volume contains
`ca.pem`. Issue the leaf for DNS name `identity`, keep the CA signing key off the
containers, and never publish port 3343. The overlay enables authenticated Store
standing and policy-bound registration. Store availability mutations have a
separate opt-in.
The opt-in deployment sequence is:

```powershell
powershell -NoProfile -File tools/dev/docker/build-owner-image.ps1 -Owner identity
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.identity-verifier.yaml --profile identity-verifier config --quiet
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.identity-verifier.yaml --profile identity-verifier up -d --no-deps identity
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml -f infra/compose.identity-verifier.yaml --profile identity-verifier ps identity
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

## Isolated Surface app preview

`tools/dev/Start-RefoundationApp.ps1 -Surface -App <app>` runs the named app from
the current checkout. It uses separate loopback ports for Control Panel
(`localhost:23100`), Customer (`127.0.0.1:23101`), Merchant
(`127.0.0.1:23102`) and Captain Metro (`127.0.0.1:23103`).
The default Identity and DSH preview ports are `23201` and `23202`.

Use locally running owners with fresh synthetic schemas and the relevant
phone, Passkey and DSH standing capabilities enabled. Configure DSH to allow
the Customer preview origin and Identity to accept the Operator's exact
`http://localhost:23100` WebAuthn origin. Only synthetic test phones and
enrolled synthetic Operator credentials belong in this preview.

To enroll the first synthetic Operator on Surface, start the Identity
owner with the two isolated Passkey and bootstrap opt-ins, the exact
`http://localhost:23100` origin, and the dedicated disposable WebAuthn
database described in [Identity](../services/identity/README.md). Then start
Control Panel using
`pwsh -NoProfile -File tools/dev/Start-RefoundationApp.ps1 -Surface -App control-panel -EnableIsolatedOperatorPasskeyPreview -EnableIsolatedRootBootstrap`.
The launcher requires both bootstrap routes on the local Identity owner.

For a **synthetic Android emulator only**, the Customer can opt into WLT's
read-only wallet and posted-funding history once **Identity, DSH and WLT** are
running locally with isolated synthetic data. Start the Surface Customer
presentation using
`pwsh -NoProfile -File tools/dev/Start-RefoundationApp.ps1 -Surface -App customer -EnableAndroidWalletPreview -WltPort 23203`.
The launcher checks the WLT loopback listener and its unauthenticated read
must return HTTP 401. Android receives the emulator-to-host `10.0.2.2` origins
for both Identity and WLT; the Web BFF continues using `127.0.0.1`.
Absent owner, revoked session, wrong role and physical-device/private-LAN
origins keep the Native finance display closed. No Cash-In, payment, protected
database migration or real-user finance access is activated by this flag.

### Opt-in Lenovo Customer Web wallet

The active Lenovo Customer Web server is **not** silently reconfigured when
Docker WLT appears. With its existing default launcher environment, its
`/api/customer-auth/wallet` and `/wallet-transactions` routes remain disabled
(`503`). Once the isolated `identity` and `wlt` containers are healthy,
a **separately controlled Customer Web start** on Lenovo can use
`pwsh -NoProfile -File tools/dev/Start-RefoundationApp.ps1 -App customer -EnableDockerWalletWebPreview`
from the verified runtime source. Only this opt-in sets the Web BFF's private
`BTHWANI_DOCKER_WALLET_WEB_PREVIEW` flag, explicit isolated-test mode,
and fixed local Identity `3201`
and WLT `3203` owner origins. The launcher validates the actual Docker
container capability labels, health and unauthenticated route denial before
starting Expo. It refuses Surface/native previews and all other applications;
the browser session is still an HttpOnly same-origin Customer cookie.
The public/native Expo preview flags stay disabled and the BFF refuses any
other wallet port even if other preview flags are set. **Do not restart the
shared running Customer task to opt in without checking its ownership and
other active sessions.** Only the synthetic development customer can sign in
through Mailpit. No payment mutation is enabled.
Neither an Expo Android JS export nor source tests prove actual emulator/device
execution; test its complete network and session behavior separately.

### Opt-in Lenovo Customer Android sign-in

Use `-EnableDockerCustomerAndroidIdentityPreview` on the Customer launcher
with the standard Customer Metro tunnel and ADB reverse on port `18101`.
The isolated Identity owner must be published on Lenovo loopback port `3201`.
Forward that owner over the approved private SSH connection to a Surface
loopback port and map device port `3201` to that Surface port with ADB reverse.
This preview uses a separate Android session namespace and synthetic phones.
The Web wallet option can coexist with it and continues to use its own cookie.

The existing Surface development launcher adds ADB reverse mappings for the
three Metro ports and the two owner ports (Identity 3201, DSH 3202) only after
verifying that the latter are listening through the canonical loopback SSH
tunnel. The existing Customer SSH tunnel carries both owner forwards; do not
start another SSH process for them or replace an unrelated ADB mapping.
A change to tunnel arguments requires a separately controlled reload of that
existing task before the new mappings can be used. The Lenovo Merchant and
Captain launchers require healthy, isolated Identity and DSH owners before
considering native admission. Merchant admission stays blocked when its owner
endpoint is unavailable. If the isolated DSH has not enabled Captain standing
and returns exactly HTTP 404, the Captain launcher keeps the verified isolated
Identity origin so the public phone login form remains visible, but removes
the DSH origin. The Captain form explains that code submission is disabled
until owner standing is available; it never consumes OTP or grants workspace
access while DSH is missing. Any other unexpected Captain owner response aborts
startup. Once the DSH owner is migrated and independently enabled, an
unauthenticated standing read must return HTTP 401 before Captain native
admission can be configured. Browser
cookies and native SecureStore remain separate.

## Non-invasive runtime attestation and disposable PostgreSQL proof

Before trusting a previously running Docker service after a source change, use:

```powershell
node tools/dev/docker/verify-runtime-provenance.mjs --context bthwani-docker
# When the optional WLT reader is running, attest all three canonical owners.
node tools/dev/docker/verify-runtime-provenance.mjs --context bthwani-docker --include-wlt
pwsh -NoProfile -File tests/infra/verify-isolated-postgres.ps1 -DockerContext bthwani-docker
```

The runtime check reads the actual Compose container image ID, non-secret source
SHA labels, owner Git history/diff, health and owner worktree state. It fails on
missing labels, changed owner source or an unproven container. The
`--include-wlt` switch additionally requires the optional WLT container
and fails closed if its running image is stale, unhealthy or absent. Without
that switch, the baseline DSH/Identity check remains usable before WLT opt-in.
It **does not** rebuild/restart a service, examine secrets, run SQL or prove
login, session revocation, ledger correctness, published client UX or
production suitability. Building a
new `sha-<commit>` image is a separate operation and does **not** update the
container already running. Readiness always attaches to the *running* image ID.

The approved DSH target is `bthwani_dsh_dev` on the existing PostgreSQL
server, with `bthwani_dsh_runtime` (no DDL/cluster administration) and separate
offline bootstrap authority. Normal serving Compose reads only
`REF_DSH_RUNTIME_DATABASE`, `REF_DSH_RUNTIME_USER`, and
`REF_DSH_RUNTIME_PASSWORD` from ignored local configuration; bootstrap uses
separate credentials. The existing unified launcher supports the one-time,
explicit `pnpm dev docker reconcile -Apply -PrepareDshDatabase` preparation
of an absent target using the reviewed owner bootstrap and constraint-preserving
native data-only restore. It compares old/new owner data and sequence hashes,
verifies the real limited login, and retains the old runtime as sole writer.
An existing target or incomplete outcome requires readback before any retry.
This command does not switch the serving container. The explicit unified
`pnpm dev docker reconcile -Apply -CutoverDshDatabase -PreparedSourceSha <sha>`
operation verifies the exact prepared image, data and role, pauses the old
writer, rechecks parity and promotes only DSH. It refuses rollback to stale
data after a new writer may have accepted a change.

Identity's one-time `pnpm dev docker reconcile -Apply -RelocateIdentityDatabase`
moves its unchanged owner schema into `bthwani_identity_dev`, using
`bthwani_identity_runtime`, a separate non-login schema owner, the exact
existing table/column privilege set and the native PostgreSQL backup/restore.
It retains the old schema, original session/permission facts and historical
audit, proves full data and ACL parity, and switches only Identity. This is
a relocation of an unchanged schema, not an experimental schema upgrade.
A future schema change must use a separately verified fresh-baseline
transition; neither command overlays a baseline on retained data.

For a committed owner schema change, the existing source watcher requests one
isolated baseline rehearsal per new runtime input key through the unified
lifecycle mutex. The explicit equivalent is
`pnpm dev docker reconcile -Apply -PrepareBaseline`.
The rehearsal never writes to a retained database. It proves a fresh
baseline, compatible data transfer, preserved privileges and rollback on
incompatible input. Only a successful proof for the current clean source
admits a canonical owner schema change for transition.

The reconciler then builds and verifies the affected immutable owner image,
stops the exclusive writer, and executes the owner-local transition in one
PostgreSQL transaction. The previous namespace is retained under a unique
`bthwani_recovery_<owner>_<id>` name with runtime access denied. A fresh
canonical namespace is created, retained rows and sequence state are copied
with constraints and triggers enabled, and exact data/privilege parity is
checked before commit. No credentials, shared database, Docker volumes or
financial history are reset. An incompatible transition rolls back and the
original writer is restored only after the original namespace identity is
verified. If commit or replacement is uncertain, automatic writes stop:
an old image must never serve a newly committed schema. Recovery namespaces
are not automatically pruned.

`BASELINE_PROOF_PASS` is rehearsal evidence, not live acceptance.
`OWNER_SCHEMA_PASS`, `OWNER_RUNTIME_PASS` and the terminal reconciliation
result identify a completed live transition. The normal read-only check
never runs the rehearsal or changes SQL. Independently eligible owners
continue when rehearsal fails.

The SQL proof intentionally creates a **new disposable container** with a
unique `bthwani-agent01-pgproof-*` name and the same pinned PostGIS image as
the existing Compose stack. It has `--network none`, no published ports, no
external volumes and tmpfs-only PostgreSQL storage. The script runs the
current DSH owner baseline SQL in order, then restores a custom-format backup into a
second database in the same disposable container. It compares columns,
constraints, indexes, triggers and the discovery revision. The same synthetic
reader must be able to read the revision and must receive SQLSTATE 42501 on
update in both databases. The Go quality workflow runs this rehearsal with
its local Docker context. The script stops only its own verified container.

**Scope boundary:** This proves isolated fresh installation, compatible synthetic data transfer for all three owners, least-privilege access, rollback and WLT ledger conservation. It does not prove migration of protected real data, a live schema transition, service-to-service authentication, or production acceptance. Do not take the successful scratch proof as authority to
change shared database roles, alter protected volumes, restart active services
or run real schema upgrades.

The [owner integration script](../tests/infra/verify-owner-postgres-ci.sh) also restores an
isolated Identity schema and checks active sessions, revoked sessions and
Operator permissions through the Identity HTTP handler. The WLT stage restores
the Customer balance projection and verifies that its reader still cannot
access the funding journal.

## Deployment boundary and security review

The DSH container is a **local public-read-only** service: non-root runtime,
read-only container root filesystem, all Linux capabilities dropped, no new
privileges and loopback-only published port. It has no application volume mounts,
and its PostgreSQL dependency is on the project's internal bridge network.

**Deployment boundary:** The isolated DSH runtime uses its dedicated
`bthwani_dsh_runtime` login and separate non-login owner. Before any protected
endpoint or non-synthetic deployment, independently verify production grants
and the retained-data migration/recovery epoch,
real Identity authorization, WLT integration and negative/recovery tests.
Do not change DB grants or handle real money through this setup.

The build script rejects uncommitted Go/SQL source so that its source-SHA image
label cannot silently certify a different working-tree revision. The image
build itself does not certify merchant scope, login, checkout or finance.
Identity and WLT require their genuine owner implementations and signed-off
security/ledger evidence; no placeholder service counts as readiness.

## Credentials and startup

`tools/dev/setup-env.mjs` is an idempotent local secret generator that never prints values.
An actual ignored `infra/.env` is required before starting; a missing or blocked
secret store is a BLOCKED state, **not** permission to use old credentials.
Necessary non-secret names are `REF_POSTGRES_USER`, `REF_POSTGRES_DB`,
`REF_MEDIA_BUCKET` and port variables; secrets are `REF_POSTGRES_PASSWORD`,
`REF_MEDIA_ACCESS_KEY` and `REF_MEDIA_SECRET_KEY`.

Once authorized private credentials exist, run from the Worktree root:

```powershell
node tools/dev/setup-env.mjs
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

### Isolated Captain admission

Layer compose.captain-development.yaml after the existing Merchant TLS overlay
only in the explicitly approved synthetic development project. DSH serves only
GET /v1/actors/me/captain-eligibility on its private TLS listener 3344; the same
DSH handler verifies the current Customer with the existing Identity TLS
listener. Identity accepts only https://dsh:3344 in container mode and uses a
dedicated DSH trust anchor, not insecure TLS or caller-supplied standing.
Provision the external captain-dsh-tls volume with server.pem (DNS SAN dsh)
and server-key.pem (readable only by UID 65532), and the captain-dsh-ca volume
with ca.pem. Keep CA signing material outside both runtime containers.
Do not publish 3344 or change the existing Identity TLS mounts. The overlay
does not create, approve, reactivate, or seed any Captain account.