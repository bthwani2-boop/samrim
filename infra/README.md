# BThwani refoundation — isolated development infrastructure

Canonical checkout: `D:\samrim` (current development branch changes).
Compose project: `bthwani-refoundation` is a stable runtime identity. Do not change it when switching Git branches or repurpose donor volumes.
This environment is synthetic development only, not production deployment. Legacy `com.bthwani.worktree` labels are retained as compatibility identifiers for running containers; they do **not** describe the current checkout. Do not recreate existing services or rename their volumes as part of a Git branch change.

## Compose topology (configuration, not live readiness)

| Service | Work | Lenovo loopback port |
| --- | --- | --- |
| `postgres` | PostgreSQL 18 + PostGIS, separate owner databases | internal 5432 only, not exposed |
| `media` | Fresh SeaweedFS mini, own media volume/credentials | 3233 |
| `mailpit` | Local inbound test email capture | 3226 |
| `payment-mock` | WireMock with fixed synthetic cash-in evidence (no production rails) | 3290 |
| `wlt` | Real WLT read-only Customer balance/history with new isolated PostgreSQL database | 3203 |
| `identity` | Isolated synthetic Identity authentication and authorization | 3201 |
| `dsh` | DSH owner; admitted capabilities depend on explicit configuration | 3202 |

The `payment-mock` image is built from `tests/infra/payment-mock/Dockerfile` using the existing
pinned WireMock base and fixed, synthetic funding-status mappings. Only the
listed `GET /sandbox/v1/funding/{reference}` test identities return evidence.
Unknown operations return 404. The simulator never owns wallets, posts money,
or exercises a production payment rail. It has no mounted host data or provider
secrets. The image build and any controlled replacement of the already-running
container are separate operations; merely editing Compose does not refresh it.

`compose.yaml` defines these four foundational dependencies and all three service owners. The project-scoped `isolated` bridge
is internal and keeps PostgreSQL inaccessible from the host. A second private
`loopback` bridge is used only by the services publishing 127.0.0.1 ports.
The two base volumes are project-scoped; The owner trust configuration references separately provisioned external volumes. No host bind mounts.
Existing `samrim-local` containers, historical customers/Root Owner, balances, orders,
secrets, applied migrations and media are never copied or changed.

The canonical Compose model sets explicit local log rotation (10 MiB, three files per container) and initial development memory/process ceilings: PostgreSQL 2 GiB/512, media 1536 MiB/512, Mailpit 256 MiB/256, payment mock 768 MiB/256, each Go owner and optional DSH bootstrap 512 MiB/256. These are initial ceilings for the observed 8 GiB Docker VM, not production sizing or peak-load guarantees. Running containers retain their previously admitted configuration until controlled replacement is separately authorized and proven. Never bypass configuration-drift refusal to activate these limits. Use the existing guarded reconciliation command with an exact, reviewed ancestor SHA: `pnpm dev docker reconcile -ConfigurationFrom <full-SHA>` is a read-only native Compose transition plan; add `-Apply` only after explicit authorization and a verified plan. The operation preserves each running image, actual environment, mounts and network identities, admits only the canonical resource/logging policy, and requires live owner database readback. Unrelated semantic configuration changes are rejected. It does not run bootstrap, migrations, builds, capability admission or volume removal. After policy convergence, use ordinary guarded owner image/schema reconciliation and exact attempt recovery separately.

## Owner services and explicit capabilities

The single canonical environment definition is [compose.yaml](compose.yaml), implementing the [environment-owned Compose policy](../governance/engineering.md#repository-checks-and-isolated-runtime-acceptance). It defines four foundational dependencies and the three real service owners (Identity, DSH, WLT), with a separately scoped DSH bootstrap role. All three serving owners are default services; `bootstrap` is the only optional one-shot role. Profiles never select applications or business capabilities. Starting/replacing one owner always names its service explicitly. No application-specific Compose files are needed.

For an already running environment, use the existing pnpm dev docker status, verify and guarded reconciliation commands. The three serving owners must use the canonical Compose file. Foundational containers may retain historical metadata until an authorized replacement; exact prior native configuration hashes remain mandatory. Never recreate a healthy container solely to change its historical labels. A replacement must preserve effective configuration, source provenance, data and peer ownership.

Private TLS material belongs to the corresponding service trust boundary. Preserve the existing physical external volume names and trust material. Owner admission is explicit in the single ignored .env; the public example does not grant credentials or enable admission. Provision each required private trust volume before starting its service. Mailpit uses a dedicated phone-delivery trust pair; it never mounts the Identity or DSH private keys.

DSH discovery and admitted protected capabilities use the same owner. Identity is the independent synthetic Go session/Operator-permission verifier. The [WLT Customer balance reader](../services/wlt/backend/README.md) runs as an isolated container or loopback process with its own read-only database role.

The fresh DSH bootstrap command uses its own `bootstrap` Compose profile,
separate from the default services. Normal startup cannot start
`dsh-bootstrap`; bootstrap remains an explicit, separately verified operation on a new empty schema.
Validate this invariant with `node --test tests/infra/compose-policy.test.mjs` and
`docker compose ... config --services`. Never use
`--profile '*'`, `--profile bootstrap up` or automatic schema changes in the normal
service-start path. Existing running containers and persisted volumes are not
recreated by this file change.
Never reuse donor images, production data or `samrim-local` volumes.

### WLT serving owner (current read-only contract)

WLT has its own service definition in `compose.yaml` and a pinned service-owned
Dockerfile. The existing owner databases used by Identity/DSH are
**not** renamed, erased or migrated. Provision `bthwani_wlt_test` explicitly
using `pwsh -NoProfile -File tools/dev/provision-wlt-test-db.ps1` only after
confirming it and all four WLT roles (owner, reader, sandbox and dormant command) do not already exist. That operation
creates a new isolated database plus its own read-only runtime credentials
inside ignored `infra/.env`. The fresh baseline and role setup are verified together; the command role remains NOLOGIN without CONNECT or membership and does not admit serving writes. The private credential candidate is published atomically only after durable SQL readback; an interrupted operation retains the candidate for explicit owner review, never blind replay. It must never be run automatically with Compose.

Use the separately authorized [first provisioning](#separately-authorized-first-provisioning) procedure for WLT; for existing WLT use guarded reconciliation. Port 3203 is bound to Lenovo loopback only.
WLT uses the existing synthetic Identity verifier `identity:3302` and the configured DSH peer origin `http://dsh:8080`, with a
separate read-only WLT database identity. The peer origin does not grant payment-mutation authority. A successful Docker healthcheck
indicates only local process/SQL readiness; financial delivery, checkout and
production remain disabled. The local executable loopback reader remains
supported independently.

### Build and run real public DSH inside the same Compose project

`services/dsh/backend/Dockerfile` is the canonical multi-stage Go build. Its
builder is pinned to the approved root `.go-version` and an immutable digest,
and the runtime Alpine image is also digest-pinned. The context is only
`services/dsh/` with an allowlisted `.dockerignore`; no local Go compiler or
Windows cross-compilation is required. The canonical Compose build, guarded by the existing reconciler, keeps
committed-source SHA checks and creates a tagged image without starting it,
modifying secrets, or executing SQL migrations. Add the **verified existing isolated** schema
and exact permitted browser origins only to the ignored `infra/.env`:

```dotenv
REF_DSH_DISCOVERY_SCHEMA=dsh_test_REPLACE_WITH_VERIFIED_SCHEMA
REF_DSH_PUBLIC_CORS_ORIGINS=http://127.0.0.1:18101,http://localhost:18101
```

Build through the unified committed-owner lifecycle and follow [first provisioning](#separately-authorized-first-provisioning) only for an approved absent DSH container. An image build does not change a running container; existing DSH uses guarded reconciliation.

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
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml --profile bootstrap run --rm --no-deps -e DSH_BOOTSTRAP_SYNTHETIC_REGISTRATION=true dsh-bootstrap
```

The opt-in installs only Sanaa, the synthetic grocery vertical, one
nonbinding terms version and two audited version-1 registration policies in
the same fresh transaction. System provenance is not a human operator.
No Stores, publication, orders, financial agreements or money are seeded.
Do not set this flag on serving or retained-data reconciliation commands.
A repeated bootstrap refuses the existing schema; changes made by Operators
remain untouched. Never run it against
retained state or as part of normal startup. A retained
schema must keep its existing applied history and any separately authorized
upgrade path until its compatibility obligations are resolved. Do not treat HTTP health as evidence of checkout,
merchant permissions, identity authentication or finance correctness.


### Isolated Identity verifier in the SAME Compose project

Identity is defined in the single `compose.yaml` alongside the other service owners. The project name remains `bthwani-refoundation`, and its published host port is loopback-only 3201.
The service is `identity`. It has no
automatic bootstrap, schema migrations, donor volumes or other service restarts.

`services/identity/backend/Dockerfile` now builds the real Go binary in a
pinned multi-stage Linux builder. The same guarded Compose builder checks
that the Docker builder matches `.go-version`, rejects uncommitted owner
source, and records the exact source SHA on the resulting image. The Docker
context is limited to reviewed Identity Go sources. SQL stays in the owner baseline and is not packaged or executed by the serving image. The container
uses non-root UID, read-only filesystem, dropped Linux capabilities and
no-new-privileges.

**Do not start it based on a passing Compose config alone.** The committed
Identity owner now permits `0.0.0.0:3302` only with both
`BTHWANI_ISOLATED_TEST_MODE=true` and `BTHWANI_ISOLATED_CONTAINER_MODE=true`,
a valid `identity_test_*` schema, and the exact container listener port.
The canonical service definition sets both explicit flags. The normal host default remains
`127.0.0.1:3302`. Owner Go negative tests cover the listener restriction,
but an actual networked verifier and its database permissions are separate
runtime gates. Before starting, verify an independently isolated synthetic
schema, least-privilege database role, reviewed applied SQL and protected
Identity session/permission denial and revocation readback. The guarded native committed-source build rejects uncommitted Identity Go/SQL input; no real-user or production authentication is enabled by these settings.

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
`mailpit:1025` network endpoint and uses mandatory implicit TLS 1.2 or newer.
The verified DNS identity is `mailpit`; Identity trusts only the dedicated
CA bundle. No plaintext SMTP or STARTTLS fallback is admitted.

Before starting the new Compose definition, separately provision the external
`bthwani-refoundation-phone-mailpit-tls` volume with `server.pem` (DNS SAN
`mailpit`, server-auth usage, valid chain) and `server-key.pem` (readable only
by the Mailpit runtime account), and `bthwani-refoundation-phone-mailpit-ca`
with `ca.pem` (the issuing CA certificate bundle, no private key).
Keep CA signing material outside both runtime containers. The former volume
is mounted read-only only by Mailpit; the latter only by Identity. Mailpit
requires TLS regardless of the phone feature flag; only its existing loopback
HTTP UI port is published. Missing or invalid trust fails closed. Do not
reuse another owner's private key, disable verification, or expose SMTP on the host.

For an existing environment, the new trust mounts and Mailpit command are
a semantic configuration transition, not resource-policy drift. Obtain
separate authorization, validate the trust pair and exact old/new Compose
configuration, and replace the affected isolated services under the existing
guarded runtime policy; do not bypass its configuration-drift refusal.
Verify encrypted delivery, failed-delivery compensation and independent
database readback before accepting the transition.

Verify the Yemeni phone format constraint from `database/schema/10_verification.sql`
and set `REF_IDENTITY_SYNTHETIC_YEMEN_PHONES` to the allowed test numbers in
international format. The Compose default is `+967770000001`.
The local Merchant development Web endpoint checks synthetic phone availability
at `127.0.0.1:3201` on each admission retry. For alternate isolated hosts, set
`MERCHANT_SYNTHETIC_IDENTITY_ORIGIN` and `MERCHANT_SYNTHETIC_DSH_ORIGIN` explicitly.
The default local DSH origin is `127.0.0.1:3202`. Its standing endpoint must
independently verify the Merchant session with Identity. For the containerized DSH verifier, the service trust endpoint is fixed at `https://identity:3343`.

For isolated Merchant standing, explicitly set `REF_DSH_ENABLE_ISOLATED_MERCHANT_STANDING=true` only after owner acceptance. The Identity TLS volume contains `server.pem` and `server-key.pem`, with the key readable only by Identity UID 65532. The separate DSH trust volume contains `ca.pem`. Issue the leaf for DNS name `identity`, keep the CA signing key off containers, and never publish port 3343. Store availability remains separately opt-in.

With the above verified trust, database and capability prerequisites, use the [first provisioning](#separately-authorized-first-provisioning) procedure for an explicitly approved absent Identity container, or the guarded reconciliation path for an existing one. Never use first start to bypass the semantic transition refusal.

The committed Identity verifier now exposes `GET /health` for isolated
development only. It checks a bounded PostgreSQL Ping without exposing actor,
session or credential details; its Docker healthcheck is **readiness only**.
A successful health response does not prove login, permissions or session
revocation. Require actual **Identity-owned** PostgreSQL session read,
permission denial/revocation proof and running image ID/source SHA matching
before changing DSH consumers. Existing containers must be rebuilt and
separately tested before the new healthcheck can be claimed live. No
production authentication or production permission administration is authorized by this isolated verifier.
Synthetic phone, WebAuthn and Operator permission capabilities remain explicitly admitted and independently verified.

Application launch, isolated verification and Lenovo Web/Android admission are documented in the [canonical development guide](../tools/dev/README-Lenovo-Development.md).

## Non-invasive runtime attestation and disposable PostgreSQL proof

Before trusting a previously running Docker service after a source change, use:

```powershell
node tools/dev/docker/verify-runtime-provenance.mjs --context bthwani-docker

pwsh -NoProfile -File tests/infra/verify-isolated-postgres.ps1 -DockerContext bthwani-docker
```

The runtime check reads the actual Compose container image ID, non-secret source
SHA labels, owner Git history/diff, health and owner worktree state. It fails on
missing labels, changed owner source or an unproven container. All three
serving owners are required; no optional WLT is admitted. The explicit Docker
context must identify the authorized Lenovo engine.
It **does not** rebuild/restart a service, examine secrets, run SQL or prove
login, session revocation, ledger correctness, published client UX or
production suitability. Building a
new `sha-<first nine SHA characters>` image is a separate operation and does **not** update the
container already running. Readiness always attaches to the *running* image ID.

The active environment uses three dedicated owner databases on the existing PostgreSQL instance:
DSH (bthwani_dsh_dev, bthwani_dsh_runtime), Identity (bthwani_identity_dev, bthwani_identity_runtime),
and WLT (bthwani_wlt_test, bthwani_wlt_reader). Each has its own non-login owner role.
The completed legacy relocations remain in Git history, not executable lifecycle commands.
The reconciler refuses shared, foreign or privileged database scope and never creates databases,
relocates retained rows or appends credentials. Unknown configuration changes require separately
verified compatible transitions; there are no historical one-field exceptions.

For a committed owner schema change, the existing source watcher requests one
isolated baseline rehearsal per new runtime input key through the unified
lifecycle mutex. The explicitly authorized equivalent is `pnpm dev docker reconcile -Apply -PrepareBaseline`, which may proceed to guarded live transition after successful compatible rehearsal; use the standalone disposable PostgreSQL proof above for rehearsal without serving mutation.
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
update in both databases. The PostgreSQL Integration CI job runs this rehearsal with its local Docker context. The script stops only its own verified container.

**Scope boundary:** This proves isolated fresh installation, compatible synthetic data transfer for all three owners, least-privilege access, rollback and WLT ledger conservation. It does not prove migration of protected real data, a live schema transition, service-to-service authentication, or production acceptance. Do not take the successful scratch proof as authority to
change shared database roles, alter protected volumes, restart active services
or run real schema upgrades.

The [owner integration script](../tests/infra/verify-owner-postgres-ci.sh) also restores an
isolated Identity schema and checks active sessions, revoked sessions and
Operator permissions through the Identity HTTP handler. The WLT stage restores
the Customer balance projection and verifies that its reader still cannot
access the funding journal.

## Deployment boundary and security review

The DSH container is an **isolated development owner** with explicitly admitted capabilities: non-root runtime,
read-only container root filesystem, all Linux capabilities dropped, no new
privileges and loopback-only published port. It has no application-data or host bind mounts; admitted TLS configuration mounts only the dedicated read-only trust and certificate volumes.
Its PostgreSQL dependency is on the project's internal bridge network.

**Deployment boundary:** The isolated DSH runtime uses its dedicated
`bthwani_dsh_runtime` login and separate non-login owner. Before any protected
endpoint or non-synthetic deployment, independently verify production grants
and the retained-data migration/recovery epoch,
real Identity authorization, WLT integration and negative/recovery tests.
Do not change DB grants or handle real money through this setup.

The guarded committed-source build uses an immutable source snapshot so that its full source-SHA image label cannot certify a different working-tree revision. The image
build itself does not certify merchant scope, login, checkout or finance.
Identity and WLT require genuine owner implementations, applicable security/ledger evidence and attributable internal adversarial risk assessment under governance/safety.md. No additional reviewer signature is required merely for development or acceptance; protected effects, legal obligations and production gates remain separately binding. No placeholder service counts as readiness.

## Credentials, first provisioning and startup

`tools/dev/setup-env.mjs` is the first-use isolated credential generator; an existing regular ignored `infra/.env` is left untouched. A missing or blocked secret store is BLOCKED, not permission to use old credentials. The tracked [.env.example](.env.example) enumerates Compose inputs and leaves private credentials and unprovisioned owner settings blank. The generator creates only base infrastructure credentials. Owner admission, database grants, image selection and dedicated TLS volumes require separately verified preparation. Never copy the example over an existing .env. Base non-secret names are REF_POSTGRES_USER, REF_POSTGRES_DB, REF_MEDIA_BUCKET and the port variables; private values are REF_POSTGRES_PASSWORD, REF_MEDIA_ACCESS_KEY and REF_MEDIA_SECRET_KEY.

### Existing environment

Use `pnpm dev` for daily app launch and `pnpm dev up` / `pnpm dev warm` to start only the seven already provisioned, verified containers. The native lifecycle uses Compose start/wait, not up. Missing/stale services require the existing guarded reconciliation or separately authorized first provisioning. `pnpm dev docker config` validates the admitted Compose model without printing credentials; `pnpm dev docker status`, `verify` and `reconcile` read actual runtime. Do not use a raw Compose up as an existing-service repair. A missing service is not evidence that its prior data, volume or identity is absent. No unscoped up, down -v, prune, donor volume copy or donor task change.

### Separately authorized first provisioning

The following is a native first-provisioning procedure, not daily startup or authority to replace an existing service. Before any write, verify the canonical Surface checkout and strict Lenovo SSH identity, exact project, actual container/volume/network inventory, required absent owner namespace (or compatible admitted retained data), image identities, and applicable private trust volumes and permissions. Obtain the specific first-provisioning authority and exclusive lifecycle ownership; do not run concurrently with a conflicting writer. Do not assume that an absent container means an empty database or that a running container may be recreated. If the required admission, inventory or rollback evidence is absent, stop that operation.

For new base infrastructure only, run `node tools/dev/setup-env.mjs` to prepare an absent ignored environment; provision approved external trust material separately. Validate the full model with `pnpm dev docker config`, obtain only the required digest-pinned PostgreSQL/SeaweedFS/Mailpit images through native Compose pull, and build the Payment Mock from its committed mapping/Dockerfile context only when its candidate tag has no existing consumers. Use the canonical project file and verified context throughout. Inspect the existing services first; provision only explicitly approved absent services, not all four by default. The native Compose build for Payment Mock does not update any existing container. Verify its exact built image ID and mapping source before starting.

For a new DSH, Identity or WLT serving container, first complete its owner-specific prerequisites above, then run the existing `pnpm dev docker build <owner>` (where owner is dsh, identity or wlt). Use the returned exact `build-<full SHA>` candidate tag, verify its immutable ID and source labels, and set only that owner's image selection (REF_DSH_IMAGE_TAG, REF_IDENTITY_IMAGE_TAG or REF_WLT_IMAGE_TAG) through the authorized environment. The ordinary reconciler's serving tag is `sha-<first nine SHA characters>`, not a build-only tag; provenance always uses the full SHA and actual image ID.

The only native first-start form is service-scoped, after the above admission and an exact absence check under the applicable lifecycle ownership:

    docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml up -d --no-deps --no-build --pull never --no-recreate <approved-absent-service>

Replace the placeholder with exactly the approved absent service; never run it literally or as an unscoped command. All necessary dependency containers and pinned images must already be verified ready or available. The explicit no-recreate flag is a defense against replacement, not proof of initial absence, ownership or data safety. If the service exists or the outcome is unknown, read back its actual state and use the guarded existing lifecycle; do not retry this form. Verify the exact new container ID, image, configuration, mounts/network, role/namespace and readiness, then owner behavior and required negative tests. No source build, config validation or startup success alone establishes production readiness.

## Development port map (configured ports are not readiness evidence)

| Owner service | Lenovo loopback | Container HTTP |
| --- | ---: | ---: |
| Identity | 3201 | 3302 |
| DSH | 3202 | 8080 |
| WLT | 3203 | 8080 |

For native application processes and tunnel ports, use [Lenovo development](../tools/dev/README-Lenovo-Development.md).

Mailpit 3226, SeaweedFS 3233, Payment Mock 3290. PostgreSQL is network-internal.
All published service ports bind to 127.0.0.1 **on Lenovo**. They are not
automatically reachable on Surface as localhost. Use separately verified SSH
loopback forwards when genuinely needed, without changing donor tunnels.
Expo and Next development processes are native, not Docker containers.

## What counts as proof

Check Docker project labels, existing project-scoped volume and network identities, required external TLS volumes, dependency health and the actual owner image IDs before and after a controlled change. A newly created empty owner database must be verified before bootstrap; after bootstrap, verify the owning schema, data constraints, grants and required baseline readback, not the absence of business tables.
HTTP 200 and healthy Docker containers do NOT prove Go implementation,
authorization, ledger invariants, Android/iOS journeys or production readiness.
Production and GitHub merge remain separately blocked until their gates pass.

### Isolated Captain admission

Enable Identity Captain admission and DSH standing only through guarded owner reconciliation, or explicitly configure the owner admission and private TLS inputs on first start, only in the approved synthetic development project. DSH serves only
GET /v1/actors/me/captain-eligibility on its private TLS listener 3344; the same
DSH handler verifies the current Customer with the existing Identity TLS
listener. Identity accepts only https://dsh:3344 in container mode and uses a
dedicated DSH trust anchor, not insecure TLS or caller-supplied standing.
Provision the external captain-dsh-tls volume with server.pem (DNS SAN dsh)
and server-key.pem (readable only by UID 65532), and the captain-dsh-ca volume
with ca.pem. Keep CA signing material outside both runtime containers.
Do not publish 3344 or change the existing Identity TLS mounts. The owner admission
does not create, approve, reactivate, or seed any Captain account.