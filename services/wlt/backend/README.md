# WLT - isolated Go runtime

The serving binary `cmd/wlt` exposes the read-only
[owner contract](../contracts/openapi/README.md). The current owner
database is `bthwani_wlt_test`; the serving principal is
`bthwani_wlt_reader`. Startup checks the complete required baseline,
ownership, effective grants and denial of financial commands, including
unexpected owner objects. It permits retained isolated journal data.
Fresh provisioning separately verifies empty state and no-login owner roles.
When present, the isolated `bthwani_wlt_command` principal is dormant
(NOLOGIN, NOINHERIT, no database CONNECT and no role memberships). Its ACL is
limited to the latest agreement review projection and the two explicit
proposal/decision functions. The owner functions require the isolated
database, an admitted session principal and READ COMMITTED.

The current HTTP runtime remains read-only. If the command role is absent,
the guarded owner-baseline transaction creates it atomically with that exact
dormant ACL. An existing active, privileged, connected or membership-linked
command role is rejected before WLT is stopped. This does not activate command credentials or any serving HTTP write route.
The disposable owner integration fixture hosts the isolated agreement command
handler. Finance can record proposed terms, the Merchant can record consent or
refusal, and Finance can approve or reject the same proposal. The read-only
serving binary excludes these routes. Activation and application write consumers
require separate acceptance.

WLT compares bounded Identity and DSH observations around each Store-locked
transaction. A drift it observes rolls the command back. DSH and WLT commit
independently, so a proposal records the Store relation observed by the command.
Subsequent decision commands compare that relation to current DSH standing.

## Runtime configuration

Use the exact repository Go pin. Both modes require
`BTHWANI_ISOLATED_TEST_MODE=true`.

| Setting | Local preview | Canonical Compose |
| --- | --- | --- |
| `BTHWANI_ISOLATED_CONTAINER_MODE` | Not enabled | `true` |
| `WLT_DEV_LISTEN_ADDR` | `127.0.0.1:<port>` | `0.0.0.0:8080` inside the container |
| `WLT_TEST_DATABASE_URL` | PostgreSQL loopback URL | `postgres:5432` in the isolated network |
| `WLT_TEST_IDENTITY_ORIGIN` | Explicit HTTP loopback origin | `http://identity:3302` |
| `WLT_TEST_DSH_ORIGIN` | HTTP loopback origin when Merchant agreement reads are needed | `http://dsh:8080` |

In either mode the database URL requires the exact isolated database and
reader role, with `sslmode=disable`. Credentials are private, never
committed. A missing DSH peer origin leaves Merchant Store agreement reads
unavailable; an invalid origin is rejected. Compose publishes WLT on Lenovo
loopback port 3203, runs as UID 65532 with the owner-owned pinned image,
and does not grant a financial command or migration authority.
The [environment owner](../../../infra/README.md) describes provisioning,
native image build and guarded reconciliation. WLT is a default serving
service, not a separate application profile. Its development health check
uses the shared bounded direct owner HTTP transport and requires Identity's
exact uncached JSON readiness document in container mode. It does not attest
sessions, permissions or financial readiness. Never restart or replace an
existing service outside the authorized lifecycle.

Customer Web uses the configured same-origin preview adapter and existing
HttpOnly session. Android preview admission and the shared client boundary
are described in [clients/README.md](../clients/README.md). There is no
production or physical-device finance admission from these preview modes.

## Protected data and explicit synthetic commands

Provision only a verified new empty isolated database using the existing
`tools/dev/provision-wlt-test-db.ps1` workflow. It stages private credentials,
applies ordered owner schema and sandbox functions, proves roles/grants and
empty state, then publishes credentials atomically after durable readback.
Never replay this baseline over an existing database. Historical experimental
migrations remain in Git at `6db78a588760e21bab1d895eceab13cb8763590e`,
not in the active source. On an interrupted or ambiguous result inspect
durable state before recovery; never reset or rerun blindly.

The serving reader cannot run the commands below. For an explicitly
authorized synthetic funding exercise, the separate CLI requires
`BTHWANI_ISOLATED_TEST_MODE=true`, `WLT_SANDBOX_DATABASE_URL` with the
dedicated `bthwani_wlt_sandbox` role on loopback, and the isolated
`WLT_TEST_IDENTITY_ORIGIN`. Supply the current synthetic Customer bearer on
standard input, never in arguments or logs.

- `wlt post-sandbox-funding <reference> <whole-yemeni-riyals>` records
  synthetic funding through the immutable journal.
- `wlt verify-sandbox-provider-funding <reference> <whole-yemeni-riyals>`
  additionally requires the loopback `WLT_SANDBOX_PROVIDER_ORIGIN`.
  It verifies the fixed synthetic provider's
  `GET /sandbox/v1/funding/{reference}` before posting the same owner
  journal. Unknown, pending, failed, mismatched, redirected, malformed,
  oversized or unreachable evidence is rejected. It is not a production
  provider verification or external money transfer.
- `wlt reverse-sandbox-funding <original-reference>` appends an offsetting
  journal entry without deleting the original.

Funding reports POSTED or REPLAYED; reversal reports REVERSED or REPLAYED.
After an uncertain outcome repeat only the same authorized reference,
actor and amount (original reference and actor for reversal). Changed actor
or amount is denied; session validity is rechecked before commit. Verify
posted balance and linked history through the owner reads. The isolated
SQL agreement and allocation commands are not serving HTTP write routes.

## Evidence

Use the existing disposable PostgreSQL owner tests, which exercise the
baseline, read and write denial, actor and Store isolation, concurrency,
replay, conservation, recovery and durable readback. Verify generated
operations against OpenAPI and compare the actual image/source/configuration
with the selected candidate. Health, unauthenticated rejection and read-only
method rejection alone do not establish any financial journey or production
readiness.
