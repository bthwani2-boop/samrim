# BThwani — isolated development infrastructure

This guide owns environment-specific operating procedures; it does not grant authority to mutate retained state or certify production readiness. Follow [AGENTS.md](../AGENTS.md), [engineering](../governance/engineering.md#repository-checks-and-isolated-runtime-acceptance) and [safety](../governance/safety.md). The [Surface-to-Lenovo development guide](../tools/dev/README-Lenovo-Development.md) owns application launch, source sync, tunnels, Android and recovery commands.

## Runtime identity and topology

Use PowerShell 7 from the canonical Surface checkout `D:\samrim` and the verified `bthwani-docker` SSH context to Lenovo. The canonical [compose.yaml](compose.yaml) defines the stable project `bthwani-refoundation`. Project identity and physical volume names are independent of Git branches. Never reuse donor images, `samrim-local` volumes, production data, credentials or applied history. Historical `com.bthwani.worktree` labels remain compatibility metadata in the current executable admission contract; they do not identify the current checkout. Do not recreate a healthy container solely to change a label.

| Service | Responsibility | Lenovo loopback | Memory / PIDs |
| --- | --- | ---: | ---: |
| `postgres` | Pinned PostgreSQL 18 + PostGIS, separate owner databases | not published | 2 GiB / 512 |
| `media` | Pinned SeaweedFS mini, dedicated volume and credentials | 3233 | 1536 MiB / 512 |
| `mailpit` | Pinned local test email capture | 3226 (HTTP UI) | 256 MiB / 256 |
| `payment-mock` | Synthetic funding-status evidence, no real payment rail | 3290 | 768 MiB / 256 |
| `identity` | Synthetic Identity authentication and authorization | 3201 | 512 MiB / 256 |
| `dsh` | DSH commerce and admitted capabilities | 3202 | 512 MiB / 256 |
| `wlt` | WLT read-only Customer wallet owner | 3203 | 512 MiB / 256 |
| `dsh-bootstrap` | Explicit one-shot fresh baseline only | not published | 512 MiB / 256 |

These are the authored initial development limits for an 8 GiB VM, not measured production sizing or proof of running configuration. Local log rotation is 10 MiB, three files per container. The seven serving services are default services; `bootstrap` is the only optional one-shot profile. No implicit migration or capability-specific Compose environment. The internal `isolated` bridge carries owner traffic; the second `loopback` bridge serves the six published services. PostgreSQL has no host publication. There are no host bind mounts in the canonical environment. Two base data volumes are project-scoped; external trust volumes retain their own physical identities.

Published ports are fixed loopback endpoints in Compose, not environment inputs. The six former port overrides cannot change the resolved model; do not regenerate or overwrite retained environment files to remove them. Any future port change requires a coordinated consumer migration. Identity uses container HTTP 3302, DSH and WLT 8080. The host bindings exist on Lenovo, not automatically on Surface; use the existing verified SSH loopback forwards where needed. Expo and Next run natively, not in Docker.

The Payment Mock uses the committed [Dockerfile and fixture context](../tests/infra/payment-mock/) with a digest-pinned WireMock base. Only admitted `GET /sandbox/v1/funding/{reference}` fixtures return evidence; unknown requests return 404. It never owns balances, posts money or exercises real rails, and has no mounted host data or provider credentials. Building a candidate and replacing a serving instance are distinct operations.

## Existing environment: one lifecycle

From Surface, use the existing unified launcher:

~~~powershell
pnpm dev
pnpm dev docker config
pnpm dev docker status
pnpm dev docker verify
pnpm dev docker reconcile
~~~

Daily `pnpm dev` opens existing application surfaces and checks readiness; `pnpm dev up` / `pnpm dev warm` start only already provisioned, verified containers through Compose start/wait, not up. The launcher and its existing Docker resource lease own scoped runtime operations; the existing source watcher alone schedules automatic reconciliation. Read-only status/verify/reconcile do not grant mutation authority. Missing or stale services require the guarded owner reconciliation or separately authorized first provisioning below.

The resource-only Compose transition plan is `pnpm dev docker reconcile -ConfigurationFrom <full-SHA>`, where the SHA is an exact reviewed ancestor. Add `-Apply` only after explicit authorization and a verified plan. The operation admits canonical resource/logging policy while preserving serving image identities, effective non-policy configuration, actual mounts/network identities and live owner database readback. Semantic configuration changes are rejected. It does not bootstrap, migrate, build, admit capabilities or remove volumes. Use ordinary guarded owner reconciliation and exact attempt recovery independently.

Never use raw Compose up to repair an existing service, unscoped up, down -v, blanket prune, donor copies, or label-only admission. Unknown effects require native owner readback before retry.

## Configuration and credentials

[.env.example](.env.example) enumerates authored environment inputs and leaves private credentials and unprovisioned owner settings empty. The ignored `infra/.env` is the private environment source; never print its contents or resolved secret-bearing Compose JSON. Use `pnpm dev docker config` for safe validation. Native [Compose config](https://docs.docker.com/reference/cli/docker/compose/config/) resolves interpolation and renders the effective model; a valid model is not an admission to start or modify containers.

`node tools/dev/setup-env.mjs` creates only first-use base configuration and randomized isolated credentials:

- Non-secret values: `REF_POSTGRES_USER`, `REF_POSTGRES_DB`, `REF_MEDIA_BUCKET`.
- Private values: `REF_POSTGRES_PASSWORD`, `REF_MEDIA_ACCESS_KEY`, `REF_MEDIA_SECRET_KEY`.

The generator atomically publishes an absent regular environment file without replacing an existing one. Existing file presence is not credential/configuration acceptance. Preserve existing bytes, permissions and owner settings. A missing or unsafe secret store is blocked, not permission to copy the example, substitute donor credentials or enable owner features. Owner roles, capability settings, image selection and TLS material require their respective admission.

The template's `dev` image-tag defaults are not source provenance or authority to run a mutable tag. Use the exact verified image selection and running image ID. Owner-specific values are provided only for the relevant admitted environment.

## Owner prerequisites and capability boundaries

All three Go owners have digest-pinned multi-stage Dockerfiles, the approved root `.go-version` and allowlisted owner build contexts. Their serving containers use a non-root user, read-only root filesystem, dropped Linux capabilities and no-new-privileges. The guarded immutable committed-source builder records the full SHA; local Go preview is a distinct admitted digest, never committed acceptance. SQL roles and namespaces remain baseline-first under [SQL-01](../governance/engineering.md#sql-01--safe-one-baseline-per-owner-fresh-bootstrap-protected-upgrades).

### DSH

The [DSH Dockerfile](../services/dsh/backend/Dockerfile) packages the owner binary and ordered SQL baseline; normal serving does not execute the baseline. DSH owns Store discovery and its admitted protected commerce capabilities. The existing owner database is `bthwani_dsh_dev` with dedicated runtime login `bthwani_dsh_runtime` and non-login owner.

Verify the dedicated database, least-privilege runtime role and exact admitted `dsh_test_*` namespace before configuring `REF_DSH_RUNTIME_DATABASE`, `REF_DSH_RUNTIME_USER`, `REF_DSH_RUNTIME_PASSWORD` and `REF_DSH_DISCOVERY_SCHEMA`. Set only approved browser origins in `REF_DSH_PUBLIC_CORS_ORIGINS`; the local Customer origins are `http://127.0.0.1:18101` and `http://localhost:18101`. DSH health requires a readable discovery revision; a fresh empty catalog may be ready without any Store or Order.

For a verified new empty namespace, separately authorize the `dsh-bootstrap` one-shot with the matching owner image and explicit isolated bootstrap credentials (`REF_DSH_BOOTSTRAP_USER`, `REF_DSH_BOOTSTRAP_PASSWORD`). It runs the ordered schema in one transaction, refuses an existing namespace and does not seed or upgrade by default. For the specifically approved new synthetic Sanaa Merchant registration baseline, the existing opt-in form is:

~~~powershell
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml --profile bootstrap run --rm --no-deps -e DSH_BOOTSTRAP_SYNTHETIC_REGISTRATION=true dsh-bootstrap
~~~

That opt-in installs only Sanaa, the synthetic grocery vertical, a nonbinding terms version and two audited version-1 registration policies in the same transaction. System provenance is not a human Operator. No Store, publication, Order, financial agreement or money is seeded. Never set the flag for serving or retained-data reconciliation. Preserve existing applied history; never use `--profile '*'` or `--profile bootstrap up` in normal startup.

Cart, employee, Merchant standing, Store availability, Captain standing and Captain interest flags are separately admitted; the template defaults them off. A successful discovery or health response is not permission, checkout or finance proof.

### Identity

The [Identity Dockerfile](../services/identity/backend/Dockerfile) packages the Go binary, not a SQL migration or serving schema loader. The owner database is `bthwani_identity_dev` with dedicated `bthwani_identity_runtime` login and non-login owner. Container listener `0.0.0.0:3302` is admitted only with both isolated-mode flags, a valid `identity_test_*` schema and the exact port; the host process default remains `127.0.0.1:3302`. Verify the reviewed schema, grants, owner-controlled session reads, denied and revoked permissions before setting `REF_IDENTITY_TEST_SCHEMA` and `REF_IDENTITY_RUNTIME_DATABASE_URL` against the isolated PostgreSQL endpoint. Never use admin, donor or production credentials.

Synthetic phone, Operator passkey, first-owner bootstrap and permission administration remain distinct explicit admissions. Before setting `REF_IDENTITY_SYNTHETIC_PHONE_AUTH=true`, verify the compatible phone baseline, limited role writes and exact Yemeni phone constraints in [10_verification.sql](../services/identity/database/schema/10_verification.sql). Set `REF_IDENTITY_SYNTHETIC_YEMEN_PHONES` only to approved test numbers in international format (template default `+967770000001`) and supply a fresh 32-byte hex `REF_IDENTITY_SYNTHETIC_PHONE_HMAC_KEY` through the authorized private environment. Do not infer permission from the feature flag.

Phone delivery uses implicit authenticated TLS 1.2+ to `mailpit:1025` with DNS identity `mailpit` and the dedicated CA; no plaintext or STARTTLS fallback. Mailpit requires TLS even when phone auth is disabled. The SMTP port is not published. Provision the dedicated trust volumes below before the affected first start or separately approved transition.

Identity `GET /health` is an isolated-development database readiness check, not proof of login, session revocation, Operator authority or real-user authentication. Merchant local Web admission uses Identity `127.0.0.1:3201` and DSH `127.0.0.1:3202`; alternate verified isolated hosts use `MERCHANT_SYNTHETIC_IDENTITY_ORIGIN` / `MERCHANT_SYNTHETIC_DSH_ORIGIN` explicitly. DSH must still verify the Merchant session independently with Identity.

### WLT

The [WLT owner guide](../services/wlt/backend/README.md) owns the wallet reader and sandbox contract. WLT runs as the isolated read-only Customer balance/history owner, with its own pinned [Dockerfile](../services/wlt/backend/Dockerfile). The existing database `bthwani_wlt_test` uses runtime login `bthwani_wlt_reader` and a non-login owner. A first provisioning via `pwsh -NoProfile -File tools/dev/provision-wlt-test-db.ps1` requires confirmed absence of that database and all four WLT roles (owner, reader, sandbox and dormant command), plus specific authorization. It verifies fresh schema and roles before publishing its private credential candidate atomically. Interrupted publication retains the candidate for owner review; no blind replay. The dormant command role stays NOLOGIN without CONNECT or membership. Never invoke provisioning automatically with Compose or replace credentials on retained data.

Set only the verified `REF_WLT_TEST_DATABASE_URL` for the reader, never a sandbox writer or administrator. WLT uses the synthetic Identity endpoint `http://identity:3302` and DSH `http://dsh:8080`; peer configuration does not grant money-mutation authority. The local executable loopback reader remains independently supported. No healthcheck, test-provider response or read-only wallet route proves financial delivery, checkout, ledger correctness or production activation.

## Private trust and semantic transition

Physical external volumes are defined by Compose. Keep each certificate's key readable only by its service runtime account; Go owner runtime UID is 65532. Verify chain, DNS SAN and server-auth usage. Keep CA signing material outside both runtime containers. Do not share private keys, disable verification, or publish private TLS or SMTP ports.

| Volume identity suffix (prefix `bthwani-refoundation-`) | Content | Sole consuming service |
| --- | --- | --- |
| `merchant-identity-tls` | `server.pem`, `server-key.pem` for DNS `identity` | Identity |
| `merchant-identity-ca` | `ca.pem`, no private key | DSH |
| `captain-dsh-tls` | `server.pem`, `server-key.pem` for DNS `dsh` | DSH |
| `captain-dsh-ca` | `ca.pem`, no private key | Identity |
| `phone-mailpit-tls` | `server.pem`, `server-key.pem` for DNS `mailpit` | Mailpit |
| `phone-mailpit-ca` | `ca.pem`, no private key | Identity |

All trust mounts are read-only. DSH verifies Identity at `https://identity:3343`. Merchant standing requires explicit `REF_DSH_ENABLE_ISOLATED_MERCHANT_STANDING` admission; Store availability remains separate. Captain admission requires coordinated Identity and DSH standing admission via the guarded owner reconciler (or verified first start), dedicated DSH TLS inputs and `https://dsh:3344`. DSH's private TLS standing endpoint `GET /v1/actors/me/captain-eligibility` verifies the current Customer with Identity; Identity uses the dedicated DSH CA, not caller-supplied standing. Neither endpoint creates, approves, reactivates or seeds a Captain account.

For an existing environment the Mailpit command and additional trust mounts are a **semantic** transition, not resource-only drift. Verify exact old/new configuration, trust pair, candidate image identity and rollback/readback under specific authorization. Do not bypass the current guarded refusal, create trust volumes merely to silence a failed check, or start an existing service using first provisioning. Verify authenticated encrypted delivery, denied invalid trust, failed-delivery compensation and actual owner database readback before acceptance.

## Separately authorized first provisioning

This is not daily startup or a repair of existing services. Before any write, verify the canonical checkout, strict Lenovo SSH identity, actual Compose project, container/volume/network inventory, specifically approved absent service, image and dependency identities, the owner namespace (new empty or compatible admitted retained data), role/grants and applicable private trust. Acquire the existing lifecycle ownership and specific authority for the first start; no conflicting writer. Absence of a container does not imply absence of retained data. Stop the operation if authorization, ownership or recovery evidence is missing.

1. For genuinely new base infrastructure, generate an absent environment as above. Separately provision approved trust. Validate the complete model. Pull only required digest-pinned PostgreSQL, SeaweedFS and Mailpit images. Build Payment Mock only from its committed context and when its candidate tag has no container consumers; verify exact image ID and source. No image build changes a running container.
2. For a new Identity, DSH or WLT serving service, complete the corresponding owner prerequisites and run `pnpm dev docker build <owner>` with exactly dsh, identity or wlt. Verify the returned full `build-<full SHA>` tag, immutable image ID and source labels. Through authorized configuration, select only that owner's `REF_DSH_IMAGE_TAG`, `REF_IDENTITY_IMAGE_TAG` or `REF_WLT_IMAGE_TAG`. Ordinary reconciliation uses `sha-<first nine SHA characters>` serving tags, but provenance is full SHA and actual image ID, not the tag.
3. After confirming dependencies ready and the exact target service absent under the lifecycle ownership, use the service-scoped native first-start form:

~~~powershell
docker --context bthwani-docker compose --env-file infra/.env -f infra/compose.yaml up -d --no-deps --no-build --pull never --no-recreate <approved-absent-service>
~~~

Replace the placeholder with the specifically approved absent service, never an unscoped command. Native [Compose up](https://docs.docker.com/reference/cli/docker/compose/up/) options prohibit dependency start, building, pulling and recreation here; they do not prove absence or protect an already existing stopped container from startup. If a service exists or an operation outcome is unknown, use the existing guarded lifecycle after actual readback, not this form. Verify exact new container ID, image, resolved effective definition, mounts/network identities, role/namespace, health and owner behavior with applicable negative tests.

## Read-only attestation and data proof

The unified `pnpm dev docker verify` invokes the [runtime attestation owner](../tools/dev/docker/verify-runtime-provenance.mjs). It reads the native resolved Compose definition, configuration hashes, actual complete project container inventory and image definitions. The shared [effective runtime contract](../tools/dev/docker/compose-runtime-transition.mjs) compares actual image defaults and container command, entrypoint, user, environment, health, resource/security policy and attachment identities. Owner source ancestry, relevant Git changes, lifecycle state and repeat readback are evaluated; a stale, unexpected or changing candidate fails. Ordinary verification, startup/seed admission and controlled configuration transitions share the effective-definition contract where applicable. Historical foundation metadata may be admitted only through the existing exact compatibility checks, not as a substitute for actual definition proof.

Private environment values are inspected and compared in memory; never print them or raw inspect/config records. The read-only verifier does not build, restart or replace services or establish SQL/business authorization. All three owners are required. A new candidate image does not update the running container. Readiness is attached to the actual running image, container, configuration and source identity, not to health, a tag or a Git commit alone.

The guarded owner reconciliation refuses shared, foreign or privileged database scope; it does not create databases, relocate retained rows to another database or append credentials. The existing watcher requests an isolated baseline rehearsal for a changed admitted owner schema input; the specifically authorized equivalent is `pnpm dev docker reconcile -Apply -PrepareBaseline`. For a rehearsal alone, use:

~~~powershell
pwsh -NoProfile -File tests/infra/verify-isolated-postgres.ps1 -DockerContext bthwani-docker
~~~

The native proof creates its own unique `bthwani-agent01-pgproof-*` container from the pinned PostGIS image with network none, no published ports, no external volumes and tmpfs-only storage. It verifies applicable fresh baselines, compatible synthetic data transfer, role isolation, restore parity and rollback; DSH compares columns, constraints, indexes, triggers and discovery revision, including denied reader update (SQLSTATE 42501). The three-owner rehearsal includes WLT ledger conservation. The PostgreSQL Integration CI job runs the isolated proof with its local context. The [owner integration script](../tests/infra/verify-owner-postgres-ci.sh) additionally exercises real owner SQL/HTTP behavior including revoked Identity sessions, Operator permissions and WLT balance projection with denied funding-journal access. Scratch proof is not live acceptance or authorization to change protected data.

Only successful current-source rehearsal and actual admission allow guarded compatible owner schema transition. The reconciler builds/verifies the immutable owner candidate, stops its exclusive writer and uses the admitted owner-local PostgreSQL transaction. The previous namespace is retained as a unique `bthwani_recovery_<owner>_<id>` with runtime access denied; the canonical namespace is reconstructed, retained rows/sequence state copied with constraints and triggers enabled and exact data/grant parity checked before commit. Incompatible transfer rolls back; original writer recovery requires proof of the original namespace identity. If SQL commit or replacement is uncertain, automatic writes stop: an old image must never serve a newly committed schema. No automatic recovery-namespace pruning, role resets or data/volume erasure.

`BASELINE_PROOF_PASS` means rehearsal only. `OWNER_SCHEMA_PASS`, `OWNER_RUNTIME_PASS` and the terminal result require actual corresponding live evidence. Independent eligible owners may proceed when another rehearsal fails. Recovery, source convergence, business acceptance, GitHub merge and production are separately proven.

## Acceptance and retention

Before and after an authorized change, verify actual project/resource identity, image ID and full source provenance, effective configuration, owner role/namespace and durable readback. Verify behavior and rejection, permissions, revocation, applicable concurrency/idempotency, data/ledger invariants, recovery and actual affected Web/Android experience. HTTP 200, Docker health, Compose validation, a successful build or isolated tests alone cannot establish those obligations. The [development guide](../tools/dev/README-Lenovo-Development.md) owns native application and device proof.

Inventory and remove only proven unnecessary owned artifacts with specific authority, actual nonuse and no retained rollback/restore/peer obligation. Preserve Root Owner, customers, sessions, grants, stores, orders, balances, media, applied history, credentials, useful synthetic data and unknown-origin resources. A reclaimable Docker object is not necessarily disposable. No broad prune or destructive reset. Production deployment/rail activation and protected migration require separate authorization and the applicable [safety](../governance/safety.md) gates. No separate reviewer signature is required merely for development, but actual technical risk assessment, required tests and protected-effect approval remain binding.
