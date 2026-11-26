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
cd "$(dirname "$0")/../.."
coverage_enabled=no
cover_flags=()
coverage_sequence=0
if [[ $# -eq 1 && "$1" == --coverage ]]; then
  coverage_enabled=yes
  cover_flags=(-covermode=atomic)
  [[ ! -e coverage/owner-postgres && ! -L coverage/owner-postgres ]] || {
    echo 'Refusing existing owner PostgreSQL coverage output' >&2; exit 2;
  }
elif [[ $# -ne 0 ]]; then
  echo 'Usage: verify-owner-postgres-ci.sh [--coverage]' >&2
  exit 2
fi
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
if [[ "$coverage_enabled" == yes ]]; then mkdir "$scratch/profiles"; fi

# An ephemeral credential prevents a checked-in reusable role password. Each
# stage exists only inside this network-disabled, volume-free CI runner.
ci_password="$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')"
[[ "$ci_password" =~ ^[a-f0-9]{64}$ ]] || { echo "Missing secure CI entropy" >&2; exit 2; }

# Static Go test executables run inside each isolated PostgreSQL container;
# no host DB connection or external test-network grant is necessary.
(cd services/identity/backend && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go test -c "${cover_flags[@]}" -o "$scratch/identity-session.test" ./internal/session && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go build -o "$scratch/identity" ./cmd/identity)
(cd services/dsh/backend && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go test -c "${cover_flags[@]}" -o "$scratch/dsh-discovery.test" ./internal/discovery && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go test -c "${cover_flags[@]}" -o "$scratch/dsh-storeavailability.test" ./internal/storeavailability && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go test -c "${cover_flags[@]}" -o "$scratch/dsh-captainstanding.test" ./internal/captainstanding && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go test -c "${cover_flags[@]}" -o "$scratch/dsh-customercart.test" ./internal/customercart && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go test -c "${cover_flags[@]}" -o "$scratch/dsh-employees.test" ./internal/employees && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go test -c -cover "${cover_flags[@]}" -o "$scratch/dsh-employee-mount.test" ./cmd/dsh && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go build -o "$scratch/dsh" ./cmd/dsh)
(cd services/wlt/backend && \
  CGO_ENABLED=0 GOTOOLCHAIN=local go test -c "${cover_flags[@]}" -o "$scratch/wlt-wallet.test" ./cmd/wlt)
[[ -s "$scratch/wlt-wallet.test" ]] || { echo "Missing compiled WLT owner test" >&2; exit 1; }
for executable in identity-session.test identity dsh-discovery.test dsh-storeavailability.test dsh-captainstanding.test dsh-customercart.test dsh-employees.test dsh-employee-mount.test dsh; do
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
    -c "CREATE ROLE $role LOGIN PASSWORD '$ci_password';"
  docker exec "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "CREATE DATABASE $db OWNER $role;"
  # The image's temporary init server accepts local Unix sockets before the
  # final TCP listener is ready. Prove the *target database and test role* over
  # the same loopback protocol that real owner binaries use; pg_isready alone
  # can report a bootstrap process that is about to restart.
  local tcp_ready=no
  for attempt in $(seq 1 45); do
    if [[ "$(docker exec -e PGPASSWORD="$ci_password" "$name" psql -X -A -t \
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
    /agent02/services/dsh/backend/internal/captainstanding \
    /agent02/services/dsh/backend/internal/employees \
    /agent02/services/dsh/backend/cmd/dsh
  docker cp services/identity/database/schema "$name:/agent02/services/identity/database/schema"
  docker cp services/dsh/database/schema "$name:/agent02/services/dsh/database/schema"
  for executable in identity-session.test identity dsh-discovery.test dsh-storeavailability.test dsh-captainstanding.test dsh-customercart.test dsh-employees.test dsh-employee-mount.test dsh; do
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
  local profile=""
  local -a profile_flags=()
  if [[ "${coverage_enabled:-no}" == yes ]]; then
    coverage_sequence=$((coverage_sequence+1))
    profile="${binary##*/}-$coverage_sequence.out"
    profile_flags=(-test.coverprofile="/tmp/$profile")
  fi
  if ! output="$(docker exec -w "$dir" "$@" "$name" "$binary" \
    -test.v -test.run "$pattern" -test.timeout 180s "${profile_flags[@]}" 2>&1)"; then
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
  if [[ -n "$profile" ]]; then
    local destination="$scratch/profiles/$profile"
    if ! docker cp "$name:/tmp/$profile" "$destination" || [[ ! -s "$destination" ]] ||
       ! awk 'NR==1 {if ($0!="mode: atomic") bad=1; next}
         NF!=3 || $2 !~ /^[0-9]+$/ || $3 !~ /^[0-9]+$/ {bad=1}
         $3>0 {hit=1} END {exit !(NR>1 && hit && !bad)}' "$destination"; then
      echo "Missing or invalid measured coverage for $binary" >&2
      return 1
    fi
    echo "OWNER_POSTGRES_COVERAGE_PROFILE=$profile"
  fi
  printf '%s\n' "$output" | grep -E '^--- (PASS|FAIL|SKIP):|^PASS$|^FAIL$' || true
}

start_stage bthwani-ci-discovery-pg bthwani_ci bthwani_refoundation
docker exec "$current" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE DATABASE bthwani_dsh_boundary_fixture OWNER bthwani_ci;" \
  -c "CREATE DATABASE bthwani_dsh_dev OWNER bthwani_ci;" \
  -c "CREATE DATABASE bthwani_refoundation_identity_restore OWNER bthwani_ci;" \
  -c "CREATE ROLE bthwani_dsh_runtime LOGIN NOINHERIT PASSWORD '$ci_password';" \
  -c "REVOKE ALL ON DATABASE bthwani_dsh_dev FROM PUBLIC;" \
  -c "GRANT CONNECT ON DATABASE bthwani_dsh_dev TO bthwani_dsh_runtime;"
for boundary_db in bthwani_dsh_boundary_fixture bthwani_dsh_dev; do
  docker exec "$current" sh -c \
    "set -e; for f in /agent02/services/dsh/database/schema/*.sql; do sed 's/__SCHEMA__/dsh_test_seed_boundary/g' \"\$f\" | psql -X -q -v ON_ERROR_STOP=1 -U bthwani_ci -d $boundary_db; done"
done
run_test "$current" /agent02/services/identity/backend/internal/session \
  /agent02/bin/identity-session.test '^TestPostgresIdentitySessionReadback$' 'TestPostgresIdentitySessionReadback' \
  -e BTHWANI_ISOLATED_TEST_MODE=true -e IDENTITY_RESTORE_CI_TEST=true \
  -e BTHWANI_CI_DISPOSABLE_PASSWORD="$ci_password" \
  -e IDENTITY_TEST_DATABASE_URL="postgres://bthwani_ci:${ci_password}@127.0.0.1:5432/bthwani_refoundation?sslmode=disable"
run_test "$current" /agent02/services/identity/backend/internal/session \
  /agent02/bin/identity-session.test '^TestPersistentIdentityPostgres$' 'TestPersistentIdentityPostgres' \
  -e BTHWANI_ISOLATED_TEST_MODE=true \
  -e IDENTITY_TEST_DATABASE_URL="postgres://bthwani_ci:${ci_password}@127.0.0.1:5432/bthwani_refoundation?sslmode=disable"
restored_identity="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_ci \
  -d bthwani_refoundation_identity_restore \
  -c "SELECT count(*) FROM pg_namespace WHERE nspname ~ '^identity_test_agent03_[a-f0-9]{16}$';")"
[[ "$restored_identity" == '1' ]] || { echo "Identity restore must produce one isolated schema" >&2; exit 1; }
echo 'IDENTITY_DISPOSABLE_RESTORE_PASS real_postgresql=true active_and_revoked_authorizations=true'
run_test "$current" /agent02/services/dsh/backend/internal/discovery \
  /agent02/bin/dsh-discovery.test '^(TestOwnerBacked|TestOwnerScoped|TestOwnerBootstrapFresh)' 'TestOwnerBackedMarketplaceVisibility,TestOwnerBackedPublicStoreOperationalStatus,TestOwnerBackedSyntheticImportDeniesAlternateDatabase,TestOwnerBackedDiscoveryDemoSeed,TestOwnerBackedOfferVisibilityAndCursorRecovery,TestOwnerBackedUnpublishedStoreRejectsOfferContinuation,TestOwnerBackedConcurrentReadsAndSafeFailures,TestOwnerScopedTransactionSearchPathResetsOnPooledConnection,TestOwnerBackedDiscoveryHealthRequiresInitializedSchema,TestOwnerBackedCaptainStandingFreshBaseline,TestOwnerBootstrapFreshRollsBackIncompleteSchema,TestOwnerBootstrapFreshInstallsRealDSHAndRefusesReapply,TestOwnerBackedActiveCityDirectory,TestOwnerBackedPublicVerticalDirectory,TestOwnerBackedVerticalFilter,TestOwnerBackedStoreSearch,TestOwnerBackedOfferSearch,TestOwnerBackedOfferEstimate,TestOwnerBackedPersistentSyntheticRegistrationSeed' \
  -e BTHWANI_ISOLATED_TEST_MODE=true -e DSH_TEST_SEED_BOUNDARY=true \
  -e REF_POSTGRES_USER=bthwani_ci -e REF_POSTGRES_PASSWORD="$ci_password" \
  -e REF_POSTGRES_DB=bthwani_refoundation \
  -e DSH_DB_HOST=127.0.0.1 -e DSH_DB_SCHEMA=dsh_test_ci
run_test "$current" /agent02/bin /agent02/bin/dsh-customercart.test \
  '^TestRealCustomerCartPostgres$' 'TestRealCustomerCartPostgres' \
  -e BTHWANI_ISOLATED_TEST_MODE=true -e DSH_CART_CI_TEST=true
run_test "$current" /agent02/services/dsh/backend/internal/employees \
  /agent02/bin/dsh-employees.test '^TestCompanyEmployeeDirectoryPostgres$' 'TestCompanyEmployeeDirectoryPostgres' \
  -e BTHWANI_ISOLATED_TEST_MODE=true -e DSH_EMPLOYEES_TEST=true \
  -e REF_POSTGRES_USER=bthwani_ci -e REF_POSTGRES_PASSWORD="$ci_password" \
  -e REF_POSTGRES_DB=bthwani_refoundation -e DSH_DB_HOST=127.0.0.1
run_test "$current" /agent02/services/dsh/backend/cmd/dsh \
  /agent02/bin/dsh-employee-mount.test '^(TestEmployeeDirectoryExplicitIsolatedTransport|TestEmployeeDirectoryMountPostgres)$' 'TestEmployeeDirectoryExplicitIsolatedTransport,TestEmployeeDirectoryMountPostgres' \
  -e BTHWANI_ISOLATED_TEST_MODE=true -e DSH_EMPLOYEES_TEST=true \
  -e REF_POSTGRES_USER=bthwani_ci -e REF_POSTGRES_PASSWORD="$ci_password" \
  -e REF_POSTGRES_DB=bthwani_refoundation -e DSH_DB_HOST=127.0.0.1
finish_stage

start_stage bthwani-session02-orderability-pg bthwani_agent02 orderability_agent02
run_test "$current" /agent02/services/dsh/backend/internal/storeavailability \
  /agent02/bin/dsh-storeavailability.test \
  '^(TestRealPostgresVersionIdempotencyAuditAndReadback|TestRealPostgresVersionedCityPolicyWriterAndConcurrency|TestIsolatedRealIdentityAndDshAvailability|TestMerchantCatalogRealPostgresOwnerReadback|TestMerchantCatalogImportRealPostgresOwnerReadback)$' 'TestRealPostgresVersionIdempotencyAuditAndReadback,TestRealPostgresVersionedCityPolicyWriterAndConcurrency,TestIsolatedRealIdentityAndDshAvailability,TestMerchantCatalogRealPostgresOwnerReadback,TestMerchantCatalogImportRealPostgresOwnerReadback' \
  -e BTHWANI_ISOLATED_TEST_MODE=true \
  -e BTHWANI_DSH_TEST_CONTAINER=bthwani-session02-orderability-pg \
  -e BTHWANI_DSH_TEST_DATABASE_URL="postgres://bthwani_agent02:${ci_password}@127.0.0.1:5432/orderability_agent02?sslmode=disable" \
  -e BTHWANI_IDENTITY_TEST_BINARY=/agent02/bin/identity \
  -e BTHWANI_IDENTITY_TEST_SQL_DIR=/agent02/services/identity/database/schema
finish_stage

start_stage bthwani-session02-captain-pg bt_cap_s02 refoundation_captain_agent02
run_test "$current" /agent02/services/identity/backend/internal/session \
  /agent02/bin/identity-session.test '^TestCaptainIdentityVerifiedAdmissionRealPostgres$' 'TestCaptainIdentityVerifiedAdmissionRealPostgres' \
  -e BTHWANI_ISOLATED_TEST_MODE=true \
  -e BTHWANI_CAPTAIN_TEST_CONTAINER=bthwani-session02-captain-pg \
  -e BTHWANI_CAPTAIN_TEST_DATABASE_URL="postgres://bt_cap_s02:${ci_password}@127.0.0.1:5432/refoundation_captain_agent02?sslmode=disable"
run_test "$current" /agent02/services/dsh/backend/internal/captainstanding \
  /agent02/bin/dsh-captainstanding.test \
  '^(TestCaptainStandingRealPostgresOwnerLifecycle|TestCaptainJoinedRealHTTPAndPostgres|TestCaptainInterestIsolatedPostgresDurability)$' 'TestCaptainStandingRealPostgresOwnerLifecycle,TestCaptainJoinedRealHTTPAndPostgres,TestCaptainInterestIsolatedPostgresDurability' \
  -e BTHWANI_ISOLATED_TEST_MODE=true -e BTHWANI_CAPTAIN_JOINED_HTTP_TEST=true \
  -e BTHWANI_CAPTAIN_TEST_CONTAINER=bthwani-session02-captain-pg \
  -e BTHWANI_CAPTAIN_TEST_DATABASE_URL="postgres://bt_cap_s02:${ci_password}@127.0.0.1:5432/refoundation_captain_agent02?sslmode=disable"
finish_stage

start_stage bthwani-session02-operator-pg bt_op_s02 refoundation_operator_agent02
run_test "$current" /agent02/services/identity/backend/internal/session \
  /agent02/bin/identity-session.test '^TestOperatorPermissionManagementRealPostgresAndHTTP$' 'TestOperatorPermissionManagementRealPostgresAndHTTP' \
  -e BTHWANI_ISOLATED_TEST_MODE=true -e BTHWANI_OPERATOR_ADMIN_TEST=true \
  -e BTHWANI_OPERATOR_TEST_CONTAINER=bthwani-session02-operator-pg \
  -e BTHWANI_OPERATOR_TEST_DATABASE_URL="postgres://bt_op_s02:${ci_password}@127.0.0.1:5432/refoundation_operator_agent02?sslmode=disable"
finish_stage

start_stage bthwani-session02-webauthn-pg bthwani_fido_s02 refoundation_webauthn_s02
run_test "$current" /agent02/services/identity/backend/internal/session \
  /agent02/bin/identity-session.test \
  '^(TestOperatorPasskeyRealWebAuthnSignatureSQL|TestInitialOperatorBootstrapRealPostgresAndWebAuthn)$' \
  'TestOperatorPasskeyRealWebAuthnSignatureSQL,TestInitialOperatorBootstrapRealPostgresAndWebAuthn' \
  -e BTHWANI_ISOLATED_TEST_MODE=true -e BTHWANI_OPERATOR_PASSKEY_INTEGRATION=true \
  -e BTHWANI_OPERATOR_PASSKEY_CONTAINER=bthwani-session02-webauthn-pg \
  -e BTHWANI_OPERATOR_PASSKEY_DATABASE_URL="postgres://bthwani_fido_s02:${ci_password}@127.0.0.1:5432/refoundation_webauthn_s02?sslmode=disable"
finish_stage

start_stage bthwani-session01-merchant-pg bthwani_session01 merchant_agent01
run_test "$current" /agent02/services/dsh/backend/internal/storeavailability \
  /agent02/bin/dsh-storeavailability.test '^(TestMerchantOwnedStoresRealPostgresAndHTTPReadback|TestMerchantStoreRegistrationIsolatedPostgresDurability|TestStoreRegistrationPolicyRealPostgresAuthorizationAndReconciliation)$' 'TestMerchantOwnedStoresRealPostgresAndHTTPReadback,TestMerchantStoreRegistrationIsolatedPostgresDurability,TestStoreRegistrationPolicyRealPostgresAuthorizationAndReconciliation' \
  -e BTHWANI_ISOLATED_TEST_MODE=true \
  -e BTHWANI_MERCHANT_TEST_CONTAINER=bthwani-session01-merchant-pg \
  -e BTHWANI_MERCHANT_TEST_DATABASE_URL="postgres://bthwani_session01:${ci_password}@127.0.0.1:5432/merchant_agent01?sslmode=disable"
finish_stage

start_stage bthwani-ci-wlt-pg bthwani_wlt_owner bthwani_wlt_test
docker exec "$current" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d bthwani_wlt_test \
  -c "CREATE ROLE bthwani_wlt_reader LOGIN PASSWORD '$ci_password';" \
  -c "CREATE ROLE bthwani_wlt_sandbox LOGIN PASSWORD '$ci_password';" \
  -c "CREATE ROLE bthwani_identity_fixture LOGIN PASSWORD '$ci_password';" \
  -c "GRANT CREATE ON DATABASE bthwani_wlt_test TO bthwani_identity_fixture;"
docker exec "$current" mkdir -p /agent02/services/wlt/database
docker cp services/wlt/database/schema "$current:/agent02/services/wlt/database/schema"
docker cp services/wlt/database/sandbox "$current:/agent02/services/wlt/database/sandbox"
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
  proposed_terms="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_owner -d "$db" \
    -c "SELECT string_agg(store_id || ':' || version || ':' || fee_model || ':' ||
          COALESCE(commission_basis_points::text,subscription_amount_yer::text), ',' ORDER BY store_id,version)
        FROM wlt.store_commercial_agreement_proposals;")"
  [[ "$proposed_terms" == 'store-a:1:COMMISSION:375,store-a:2:COMMISSION:425,store-b:1:SUBSCRIPTION:9007199254740993' ]] ||
    { echo "WLT restored commercial proposal versions differ" >&2; exit 1; }
  proposal_scope="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_reader -d "$db" \
    -c "SELECT NOT has_any_column_privilege('wlt.store_commercial_agreement_proposals','SELECT')
        AND NOT has_table_privilege('wlt.store_commercial_agreement_proposals','INSERT,UPDATE,DELETE,TRUNCATE')
        AND NOT has_function_privilege('wlt.append_commercial_agreement_proposal(text,bigint,text,text,text,text,integer,bigint,integer,text[],timestamptz,text,text)','EXECUTE');")"
  [[ "$proposal_scope" == 't' ]] || { echo "WLT restore exposed commercial proposals" >&2; exit 1; }
  agreement_decisions="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_owner -d "$db" \
    -c "SELECT string_agg(store_id || ':' || version || ':' || review_state, ',' ORDER BY store_id,version)
        FROM wlt.commercial_agreement_review_states;")"
  [[ "$agreement_decisions" == 'store-a:1:SUPERSEDED_PROPOSAL,store-a:2:REVIEW_APPROVED_PENDING_ACTIVATION,store-b:1:DECLINED' ]] ||
    { echo "WLT restored agreement review states differ" >&2; exit 1; }
  decision_count="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_owner -d "$db" \
    -c "SELECT count(*) FROM wlt.store_commercial_agreement_decisions;")"
  [[ "$decision_count" == '3' ]] || { echo "WLT restored decision history differs" >&2; exit 1; }
  decision_scope="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_reader -d "$db" \
    -c "SELECT NOT has_any_column_privilege('wlt.store_commercial_agreement_decisions','SELECT')
        AND NOT has_table_privilege('wlt.commercial_agreement_review_states','SELECT')
        AND NOT has_function_privilege('wlt.record_commercial_agreement_decision(text,bigint,text,text,text,text,text)','EXECUTE');")"
  [[ "$decision_scope" == 't' ]] || { echo "WLT restore exposed commercial decisions" >&2; exit 1; }
  reservation_proof="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_owner -d "$db" \
    -c "SELECT count(*) || ':' || count(r.checkout_id) || ':' || sum(h.wallet_yer) || ':' || sum(h.cash_yer)
        FROM wlt.order_payment_allocations h LEFT JOIN wlt.order_payment_releases r USING(checkout_id);")"
  [[ "$reservation_proof" == '4:4:9007199254741080:105' ]] || { echo "WLT restored reservation history differs" >&2; exit 1; }
  reservation_scope="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_reader -d "$db" \
    -c "SELECT NOT has_any_column_privilege('wlt.order_payment_allocations','SELECT')
        AND NOT has_any_column_privilege('wlt.order_payment_releases','SELECT')
        AND NOT has_function_privilege('wlt.allocate_order_payment(text,text,text,text,text,bigint,bigint)','EXECUTE')
        AND NOT has_function_privilege('wlt.release_order_payment(text,text,text,text)','EXECUTE')
        AND NOT has_function_privilege('wlt.available_order_wallet_yer(text)','EXECUTE');")"
  [[ "$reservation_scope" == 't' ]] || { echo "WLT restore exposed reservations" >&2; exit 1; }
  available_totals="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_owner -d "$db" \
    -c "SELECT string_agg(actor_id || ':' || wlt.available_order_wallet_yer(actor_id), ',' ORDER BY actor_id) FROM wlt.customer_wallet_balances;")"
  [[ "$available_totals" == 'wallet-one:9007199254741062,wallet-two:58' ]] || { echo "WLT restored available balance differs" >&2; exit 1; }
  available_projection="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_reader -d "$db" \
    -c "SELECT string_agg(actor_id || ':' || balance_yer || ':' || available_yer, ',' ORDER BY actor_id)
        FROM wlt.customer_wallet_availability;")"
  [[ "$available_projection" == 'wallet-one:9007199254741062:9007199254741062,wallet-two:58:58' ]] ||
    { echo "WLT restored wallet availability projection differs" >&2; exit 1; }
  availability_scope="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_reader -d "$db" \
    -c "SELECT has_table_privilege('wlt.customer_wallet_availability','SELECT')
        AND NOT has_any_column_privilege('wlt.customer_wallet_availability','UPDATE,INSERT')
        AND NOT has_any_column_privilege('wlt.order_payment_allocations','SELECT');")"
  [[ "$availability_scope" == 't' ]] || { echo "WLT restored availability privileges differ" >&2; exit 1; }
  totals="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_reader -d "$db" \
    -c "SELECT string_agg(actor_id || ':' || balance_yer, ',' ORDER BY actor_id) FROM wlt.customer_wallet_balances;")"
  [[ "$totals" == 'wallet-one:9007199254741062,wallet-two:58' ]] || { echo "WLT restored balances differ after verified sandbox provider credit" >&2; exit 1; }
  recent="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_reader -d "$db" \
    -c "SELECT string_agg(funding_id || ':' || amount_yer, ',' ORDER BY funding_id)
        FROM wlt.customer_funding_history WHERE actor_id = 'wallet-one'
          AND funding_id IN ('funding-0001', 'funding-0003');")"
  [[ "$recent" == 'funding-0001:9007199254740993,funding-0003:57' ]] ||
    { echo "WLT restored funding history differs" >&2; exit 1; }
  history_count="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_reader -d "$db" \
    -c "SELECT count(*) FROM wlt.customer_funding_history WHERE actor_id='wallet-one';")"
  [[ "$history_count" == '14' ]] || { echo "WLT restored paging journal differs" >&2; exit 1; }
  provider_credit="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_owner -d "$db" \
    -c "SELECT count(*) || ':' || coalesce(sum(amount_yer), 0)
        FROM wlt.customer_funding_journal WHERE provider_id='sandbox'
          AND provider_reference='cash-in-accepted-01' AND actor_id='wallet-two'
          AND amount_yer=17 AND currency='YER';")"
  [[ "$provider_credit" == '1:17' ]] || { echo "WLT verified provider posting missing or duplicated after restore" >&2; exit 1; }
  provider_legs="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_owner -d "$db" \
    -c "SELECT count(*) || ':' || sum(CASE side WHEN 'debit' THEN amount_yer ELSE -amount_yer END)
        FROM wlt.customer_funding_entries
        WHERE funding_id='sandbox-cash-in-accepted-01';")"
  [[ "$provider_legs" == '2:0' ]] || { echo "WLT verified provider journal was not balanced after restore" >&2; exit 1; }
  if docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U bthwani_wlt_reader -d "$db" \
    -c 'SELECT provider_reference FROM wlt.customer_funding_journal;' >/dev/null 2>"$scratch/wlt-reader-denial"; then
    echo "WLT restore exposed the private funding journal" >&2
    exit 1
  fi
  grep -q '42501' "$scratch/wlt-reader-denial" || exit 1
  journal_net="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_owner -d "$db" \
    -c "SELECT count(*) || ':' || sum(CASE side WHEN 'debit' THEN amount_yer ELSE -amount_yer END)
        FROM wlt.customer_funding_entries WHERE funding_id IN ('sandbox-concurrent-credit','sandbox-interrupted-credit',
          'sandbox_reversal-concurrent-credit','sandbox_reversal-interrupted-credit');")"
  [[ "$journal_net" == '8:0' ]] || { echo "WLT sandbox journal is not balanced" >&2; exit 1; }
  reversals="$(docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_reader -d "$db" \
    -c "SELECT string_agg(reverses_funding_id || ':' || amount_yer, ',' ORDER BY reverses_funding_id)
        FROM wlt.customer_funding_history WHERE actor_id='wallet-two' AND reverses_funding_id IS NOT NULL;")"
  [[ "$reversals" == 'sandbox-concurrent-credit:7,sandbox-interrupted-credit:9' ]] ||
    { echo "WLT restored reversal evidence differs" >&2; exit 1; }
done
if docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
  -U bthwani_wlt_sandbox -d bthwani_wlt_restore \
  -c "SELECT wlt.post_sandbox_customer_funding('restore-denial','wallet-two',9)" >/dev/null 2>"$scratch/wlt-sandbox-denial"; then
  echo "WLT sandbox accepted a posting in the restore database" >&2
  exit 1
fi
grep -q '42501' "$scratch/wlt-sandbox-denial" || exit 1
if docker exec "$current" psql -X -At -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
  -U bthwani_wlt_sandbox -d bthwani_wlt_restore \
  -c "SELECT wlt.reverse_sandbox_customer_funding('concurrent-credit','wallet-two')" >/dev/null 2>"$scratch/wlt-sandbox-denial"; then
  echo "WLT sandbox accepted a reversal in the restore database" >&2
  exit 1
fi
grep -q '42501' "$scratch/wlt-sandbox-denial" || exit 1
echo 'WLT_DISPOSABLE_RESTORE_PASS real_postgresql=true restored_balance=true reader_scope=true'
finish_stage

if [[ "$coverage_enabled" == yes ]]; then
  profiles=("$scratch"/profiles/*.out)
  [[ "$coverage_sequence" -gt 0 && "${#profiles[@]}" -eq "$coverage_sequence" ]] || {
    echo 'Incomplete isolated owner coverage inventory' >&2; exit 1;
  }
  mkdir -p coverage
  [[ ! -e coverage/owner-postgres && ! -L coverage/owner-postgres ]] || exit 1
  mv -- "$scratch/profiles" coverage/owner-postgres
  echo "OWNER_POSTGRES_COVERAGE_PASS profiles=$coverage_sequence"
fi
echo 'OWNER_POSTGRES_INTEGRATION_PASS network=none ephemeral_tmpfs=true durable_owner_readback=verified no_production_data=true'
