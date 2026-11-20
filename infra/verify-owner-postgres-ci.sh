#!/usr/bin/env bash
# Disposable owner-backed PostgreSQL acceptance on an isolated CI runner only.
# No host ports, Docker networks, named volumes, retained schemas or real accounts.
set -euo pipefail

if [[ "$(printenv GITHUB_ACTIONS 2>/dev/null || true)" != "true" ]] ||
   [[ "$(printenv RUNNER_ENVIRONMENT 2>/dev/null || true)" != "github-hosted" ]] ||
   [[ "$(uname -s)" != "Linux" ]] ||
   [[ ! "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] ||
   [[ -n "$(printenv DOCKER_HOST 2>/dev/null || true)" ]]; then
  echo "Refusing owner SQL integration outside a local-Docker GitHub-hosted Linux runner" >&2
  exit 2
fi
if [[ "$(docker context show)" != "default" ]]; then
  echo "Refusing a nondefault or remote Docker context in CI" >&2
  exit 2
fi
cd "$(dirname "$0")/.."
image="$(awk '$1 == "image:" && $2 ~ /^postgis\/postgis:18-3\.6@sha256:/ {print $2}' infra/compose.yaml)"
if [[ ! "$image" =~ ^postgis/postgis:18-3\.6@sha256:[a-f0-9]{64}$ ]]; then
  echo "Refusing an unpinned or unexpected PostgreSQL image" >&2
  exit 2
fi
for program in go docker; do
  command -v "$program" >/dev/null || { echo "Missing $program" >&2; exit 2; }
done
scratch="$(mktemp -d)"
current=""
cleanup() {
  if [[ -n "$current" ]]; then
    label="$(docker inspect --format '{{index .Config.Labels "com.bthwani.ci-run"}}' "$current" 2>/dev/null || true)"
    if [[ "$label" == "$GITHUB_RUN_ID" ]]; then
      docker rm -f "$current" >/dev/null 2>&1 || true
    fi
  fi
  rm -rf -- "$scratch"
}
trap cleanup EXIT

# Static Go test executables run inside each isolated PostgreSQL container;
# no host DB connection or external test-network grant is necessary.
(cd services/identity/backend && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go test -c -o "$scratch/identity-session.test" ./internal/session && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go build -o "$scratch/identity" ./cmd/identity)
(cd services/dsh/backend && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go test -c -o "$scratch/dsh-discovery.test" ./internal/discovery && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go test -c -o "$scratch/dsh-storeavailability.test" ./internal/storeavailability && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go test -c -o "$scratch/dsh-captainstanding.test" ./internal/captainstanding && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go build -o "$scratch/dsh" ./cmd/dsh)
(cd services/wlt/backend && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go test -c -o "$scratch/wlt-wallet.test" ./cmd/wlt)
[[ -s "$scratch/wlt-wallet.test" ]] || { echo "Missing compiled WLT owner test" >&2; exit 1; }
for executable in identity-session.test identity dsh-discovery.test dsh-storeavailability.test dsh-captainstanding.test dsh; do
  [[ -s "$scratch/$executable" ]] || { echo "Missing compiled owner: $executable" >&2; exit 1; }
done

start_stage() {
  local name="$1" role="$2" db="$3"
  [[ -z "$current" ]] || { echo "Previous disposable DB still active" >&2; exit 1; }
  docker run --detach --rm --name "$name" --network none \
    --tmpfs /var/lib/postgresql:rw,size=536870912 \
    --label "com.bthwani.ci-run=$GITHUB_RUN_ID" \
    --env POSTGRES_HOST_AUTH_METHOD=trust \
    --env POSTGRES_USER=postgres --env POSTGRES_DB=postgres "$image" >/dev/null
  current="$name"
  [[ "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$name")" == "none" ]] || exit 1
  [[ "$(docker inspect --format '{{len .HostConfig.PortBindings}}' "$name")" == "0" ]] || exit 1
  if docker inspect --format '{{json .Mounts}}' "$name" | grep -q '"Type":"volume"'; then
    echo "Refusing persistent or anonymous Docker volume" >&2
    exit 1
  fi
  local ready=no
  for attempt in $(seq 1 45); do
    if docker exec "$name" pg_isready -q -U postgres -d postgres; then ready=yes; break; fi
    sleep 1
  done
  [[ "$ready" == yes ]] || { echo "Disposable PostgreSQL not ready" >&2; exit 1; }
  docker exec "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "CREATE ROLE $role LOGIN PASSWORD 'synthetic-only';"
  docker exec "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "CREATE DATABASE $db OWNER $role;"
  # The image's temporary init server accepts local Unix sockets before the
  # final TCP listener is ready. Prove the *target database and test role* over
  # the same loopback protocol that real owner binaries use; pg_isready alone
  # can report a bootstrap process that is about to restart.
  local tcp_ready=no
  for attempt in $(seq 1 45); do
    if [[ "$(docker exec -e PGPASSWORD=synthetic-only "$name" psql -X -A -t \
      -h 127.0.0.1 -p 5432 -U "$role" -d "$db" -v ON_ERROR_STOP=1 \
      -c 'SELECT 1' 2>/dev/null || true)" == "1" ]]; then
      tcp_ready=yes
      break
    fi
    sleep 1
  done
  [[ "$tcp_ready" == yes ]] || { echo "Final disposable PostgreSQL TCP database not ready" >&2; exit 1; }
  docker exec "$name" mkdir -p /agent02/bin \
    /agent02/services/identity/database \
    /agent02/services/identity/backend/internal/session \
    /agent02/services/dsh/database \
    /agent02/services/dsh/backend/internal/discovery \
    /agent02/services/dsh/backend/internal/storeavailability \
    /agent02/services/dsh/backend/internal/captainstanding
  docker cp services/identity/database/migrations "$name:/agent02/services/identity/database/migrations"
  docker cp services/dsh/database/migrations "$name:/agent02/services/dsh/database/migrations"
  for executable in identity-session.test identity dsh-discovery.test dsh-storeavailability.test dsh-captainstanding.test dsh; do
    docker cp "$scratch/$executable" "$name:/agent02/bin/$executable"
  done
  # Joined tests use only these fresh binaries and localhost within --network none.
  docker exec "$name" cp /agent02/bin/identity /agent02/services/dsh/backend/internal/captainstanding/identity-server
  docker exec "$name" cp /agent02/bin/dsh /agent02/services/dsh/backend/internal/captainstanding/dsh-server
  echo "ISOLATED_STAGE_READY name=$name database=$db network=none volumes=none"
}
finish_stage() {
  [[ -n "$current" ]] || exit 1
  docker rm -f "$current" >/dev/null
  current=""
}
run_test() {
  local name="$1" dir="$2" binary="$3" pattern="$4" expected="$5" output
  shift 5
  if ! output="$(docker exec -w "$dir" "$@" "$name" "$binary" \
    -test.v -test.run "$pattern" -test.timeout 180s 2>&1)"; then
    printf '%s\n' "$output"
    echo "Owner-backed integration failed; do not claim PASS" >&2
    return 1
  fi
  local -a expected_names=() passed_names=()
  IFS=',' read -r -a expected_names <<< "$expected"
  mapfile -t passed_names < <(printf '%s\n' "$output" | awk '/^--- PASS: Test[^ ]+ \(/ {print $3}')
  # A single PASS must not satisfy a pattern selecting multiple tests.
  # Reject missing, repeated, extra, skipped or renamed owner-backed tests.
  if [[ "$output" == *"--- SKIP:"* || "$output" == *"--- FAIL:"* ]] ||
     ! grep -Fxq 'PASS' <<< "$output" ||
     (( ${#expected_names[@]} == 0 || ${#passed_names[@]} != ${#expected_names[@]} )); then
    printf '%s\n' "$output"
    echo "Selected owner-backed tests missing, skipped or unexpectedly changed" >&2
    return 1
  fi
  local test_name
  for test_name in "${expected_names[@]}"; do
    if ! printf '%s\n' "${passed_names[@]}" | grep -Fxq -- "$test_name"; then
      printf '%s\n' "$output"
      echo "Selected owner-backed test absent: $test_name" >&2
      return 1
    fi
  done
  printf '%s\n' "$output" | grep -E '^--- (PASS|FAIL|SKIP):|^PASS$|^FAIL$' || true
}

start_stage bthwani-ci-discovery-pg bthwani_ci bthwani_refoundation
docker exec "$current" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE DATABASE bthwani_dsh_boundary_fixture OWNER bthwani_ci;"
docker exec "$current" sh -c \
  "sed 's/__SCHEMA__/dsh_test_seed_boundary/g' /agent02/services/dsh/database/migrations/001_public_discovery.sql | psql -X -q -v ON_ERROR_STOP=1 -U bthwani_ci -d bthwani_dsh_boundary_fixture"
run_test "$current" /agent02/services/identity/backend/internal/session \
  /agent02/bin/identity-session.test '^TestPostgresIdentitySessionReadback$' 'TestPostgresIdentitySessionReadback' \
  -e BTHWANI_ISOLATED_TEST_MODE=true \
  -e IDENTITY_TEST_DATABASE_URL='postgres://bthwani_ci:synthetic-only@127.0.0.1:5432/bthwani_refoundation?sslmode=disable'
run_test "$current" /agent02/services/dsh/backend/internal/discovery \
  /agent02/bin/dsh-discovery.test '^(TestOwnerBacked|TestOwnerScoped)' 'TestOwnerBackedMarketplaceVisibility,TestOwnerBackedPublicStoreOperationalStatus,TestOwnerBackedSyntheticImportDeniesAlternateDatabase,TestOwnerBackedOfferVisibilityAndCursorRecovery,TestOwnerBackedUnpublishedStoreRejectsOfferContinuation,TestOwnerBackedConcurrentReadsAndSafeFailures,TestOwnerScopedTransactionSearchPathResetsOnPooledConnection,TestOwnerBackedDiscoveryHealthRequiresInitializedSchema,TestOwnerBackedCaptainStandingMigration,TestOwnerBackedPublicVerticalDirectory,TestOwnerBackedVerticalFilter,TestOwnerBackedStoreSearch,TestOwnerBackedOfferSearch' \
  -e BTHWANI_ISOLATED_TEST_MODE=true -e DSH_TEST_SEED_BOUNDARY=true \
  -e REF_POSTGRES_USER=bthwani_ci -e REF_POSTGRES_PASSWORD=synthetic-only \
  -e REF_POSTGRES_DB=bthwani_refoundation \
  -e DSH_DB_HOST=127.0.0.1 -e DSH_DB_SCHEMA=dsh_test_ci
finish_stage

start_stage bthwani-session02-orderability-pg bthwani_agent02 orderability_agent02
run_test "$current" /agent02/services/dsh/backend/internal/storeavailability \
  /agent02/bin/dsh-storeavailability.test \
  '^(TestRealPostgresVersionIdempotencyAuditAndReadback|TestRealPostgresVersionedCityPolicyWriterAndConcurrency|TestIsolatedRealIdentityAndDshAvailability)$' 'TestRealPostgresVersionIdempotencyAuditAndReadback,TestRealPostgresVersionedCityPolicyWriterAndConcurrency,TestIsolatedRealIdentityAndDshAvailability' \
  -e BTHWANI_ISOLATED_TEST_MODE=true \
  -e BTHWANI_DSH_TEST_CONTAINER=bthwani-session02-orderability-pg \
  -e BTHWANI_DSH_TEST_DATABASE_URL='postgres://bthwani_agent02:synthetic-only@127.0.0.1:5432/orderability_agent02?sslmode=disable' \
  -e BTHWANI_IDENTITY_TEST_BINARY=/agent02/bin/identity \
  -e BTHWANI_IDENTITY_TEST_SQL_DIR=/agent02/services/identity/database/migrations
finish_stage

start_stage bthwani-session02-captain-pg bt_cap_s02 refoundation_captain_agent02
run_test "$current" /agent02/services/identity/backend/internal/session \
  /agent02/bin/identity-session.test '^TestCaptainIdentityVerifiedAdmissionRealPostgres$' 'TestCaptainIdentityVerifiedAdmissionRealPostgres' \
  -e BTHWANI_ISOLATED_TEST_MODE=true \
  -e BTHWANI_CAPTAIN_TEST_CONTAINER=bthwani-session02-captain-pg \
  -e BTHWANI_CAPTAIN_TEST_DATABASE_URL='postgres://bt_cap_s02:synthetic-only@127.0.0.1:5432/refoundation_captain_agent02?sslmode=disable'
run_test "$current" /agent02/services/dsh/backend/internal/captainstanding \
  /agent02/bin/dsh-captainstanding.test \
  '^(TestCaptainStandingRealPostgresOwnerLifecycle|TestCaptainJoinedRealHTTPAndPostgres)$' 'TestCaptainStandingRealPostgresOwnerLifecycle,TestCaptainJoinedRealHTTPAndPostgres' \
  -e BTHWANI_ISOLATED_TEST_MODE=true -e BTHWANI_CAPTAIN_JOINED_HTTP_TEST=true \
  -e BTHWANI_CAPTAIN_TEST_CONTAINER=bthwani-session02-captain-pg \
  -e BTHWANI_CAPTAIN_TEST_DATABASE_URL='postgres://bt_cap_s02:synthetic-only@127.0.0.1:5432/refoundation_captain_agent02?sslmode=disable'
finish_stage

start_stage bthwani-session02-operator-pg bt_op_s02 refoundation_operator_agent02
run_test "$current" /agent02/services/identity/backend/internal/session \
  /agent02/bin/identity-session.test '^TestOperatorPermissionManagementRealPostgresAndHTTP$' 'TestOperatorPermissionManagementRealPostgresAndHTTP' \
  -e BTHWANI_ISOLATED_TEST_MODE=true -e BTHWANI_OPERATOR_ADMIN_TEST=true \
  -e BTHWANI_OPERATOR_TEST_CONTAINER=bthwani-session02-operator-pg \
  -e BTHWANI_OPERATOR_TEST_DATABASE_URL='postgres://bt_op_s02:synthetic-only@127.0.0.1:5432/refoundation_operator_agent02?sslmode=disable'
finish_stage

start_stage bthwani-session02-webauthn-pg bthwani_fido_s02 refoundation_webauthn_s02
run_test "$current" /agent02/services/identity/backend/internal/session \
  /agent02/bin/identity-session.test '^TestOperatorPasskeyRealWebAuthnSignatureSQL$' 'TestOperatorPasskeyRealWebAuthnSignatureSQL' \
  -e BTHWANI_ISOLATED_TEST_MODE=true -e BTHWANI_OPERATOR_PASSKEY_INTEGRATION=true \
  -e BTHWANI_OPERATOR_PASSKEY_CONTAINER=bthwani-session02-webauthn-pg \
  -e BTHWANI_OPERATOR_PASSKEY_DATABASE_URL='postgres://bthwani_fido_s02:synthetic-only@127.0.0.1:5432/refoundation_webauthn_s02?sslmode=disable'
finish_stage

start_stage bthwani-session01-merchant-pg bthwani_session01 merchant_agent01
run_test "$current" /agent02/services/dsh/backend/internal/storeavailability \
  /agent02/bin/dsh-storeavailability.test '^TestMerchantOwnedStoresRealPostgresAndHTTPReadback$' 'TestMerchantOwnedStoresRealPostgresAndHTTPReadback' \
  -e BTHWANI_ISOLATED_TEST_MODE=true \
  -e BTHWANI_MERCHANT_TEST_CONTAINER=bthwani-session01-merchant-pg \
  -e BTHWANI_MERCHANT_TEST_DATABASE_URL='postgres://bthwani_session01:synthetic-only@127.0.0.1:5432/merchant_agent01?sslmode=disable'
finish_stage

start_stage bthwani-ci-wlt-pg bthwani_wlt_owner bthwani_wlt_test
docker exec "$current" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d bthwani_wlt_test \
  -c "CREATE ROLE bthwani_wlt_reader LOGIN PASSWORD 'synthetic-only';" \
  -c "CREATE ROLE bthwani_identity_fixture LOGIN PASSWORD 'synthetic-only';" \
  -c "GRANT CREATE ON DATABASE bthwani_wlt_test TO bthwani_identity_fixture;"
docker exec "$current" mkdir -p /agent02/services/wlt/database
docker cp services/wlt/database/migrations "$current:/agent02/services/wlt/database/migrations"
docker cp "$scratch/wlt-wallet.test" "$current:/agent02/bin/wlt-wallet.test"
run_test "$current" /agent02/bin /agent02/bin/wlt-wallet.test \
  '^TestWalletOwnerPostgresAndIdentity$' 'TestWalletOwnerPostgresAndIdentity' \
  -e BTHWANI_ISOLATED_TEST_MODE=true -e WLT_OWNER_CI_TEST=true
docker exec "$current" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE DATABASE bthwani_wlt_restore OWNER bthwani_wlt_owner;"
docker exec "$current" pg_dump --format=custom --schema=wlt --no-owner \
  -U bthwani_wlt_owner -d bthwani_wlt_test --file=/tmp/wlt-owner.dump
docker exec "$current" pg_restore --no-owner --exit-on-error --single-transaction \
  -U bthwani_wlt_owner -d bthwani_wlt_restore /tmp/wlt-owner.dump
for db in bthwani_wlt_test bthwani_wlt_restore; do
  totals="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_reader -d "$db" \
    -c "SELECT string_agg(actor_id || ':' || balance_yer, ',' ORDER BY actor_id) FROM wlt.customer_wallet_balances;")"
  [[ "$totals" == 'wallet-one:9007199254741050,wallet-two:41' ]] || { echo "WLT restored balances differ" >&2; exit 1; }
  if docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U bthwani_wlt_reader -d "$db" \
    -c 'SELECT provider_reference FROM wlt.customer_funding_journal;' >/dev/null 2>"$scratch/wlt-reader-denial"; then
    echo "WLT restore exposed the private funding journal" >&2
    exit 1
  fi
  grep -q '42501' "$scratch/wlt-reader-denial" || exit 1
done
echo 'WLT_DISPOSABLE_RESTORE_PASS real_postgresql=true restored_balance=true reader_scope=true'
finish_stage

echo 'OWNER_POSTGRES_INTEGRATION_PASS network=none ephemeral_tmpfs=true durable_owner_readback=verified no_production_data=true'
