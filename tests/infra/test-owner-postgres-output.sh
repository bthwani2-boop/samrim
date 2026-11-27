#!/usr/bin/env bash
# Verify the CI owner-test output gate without Docker, network or SQL access.
set -euo pipefail
cd "$(dirname "$0")/../.."
script="tests/infra/verify-owner-postgres-ci.sh"
# Source the actual runner; importing must not start Docker, SQL or Go.
source "$script"
declare -f run_test >/dev/null

docker() {
  if [[ "$1" == cp ]]; then
    [[ "${FAKE_COPY_EXIT:-0}" == 0 ]] || return "$FAKE_COPY_EXIT"
    printf '%s\n' "${FAKE_PROFILE:-}" > "$3"
    return 0
  fi
  if [[ "${coverage_enabled:-no}" == yes ]]; then
    [[ " $* " == *" -test.coverprofile=/tmp/dummy.test-$coverage_sequence.out "* ]] || return 1
  fi
  printf '%s\n' "${FAKE_OWNER_OUTPUT:-}"
  return "${FAKE_OWNER_EXIT:-0}"
}

case_output() {
  local label="$1" should_pass="$2" fake_output="$3"
  local fake_exit="${4:-0}" actual=0
  FAKE_OWNER_OUTPUT="$fake_output"
  FAKE_OWNER_EXIT="$fake_exit"
  if run_test fake-pg /tmp /tmp/dummy.test '^(TestFirst|TestSecond)$' 'TestFirst,TestSecond' > /dev/null 2>&1; then
    actual=0
  else
    actual=$?
  fi
  if [[ "$should_pass" == pass && "$actual" -ne 0 ]] ||
     [[ "$should_pass" == fail && "$actual" -eq 0 ]]; then
    echo "OWNER_TEST_OUTPUT_GATE_FAIL scenario=$label exit=$actual wanted=$should_pass" >&2
    return 1
  fi
}

case_output complete pass $'=== RUN   TestFirst\n--- PASS: TestFirst (0.01s)\n=== RUN   TestSecond\n--- PASS: TestSecond (0.01s)\nPASS'
case_output missing fail $'=== RUN   TestFirst\n--- PASS: TestFirst (0.01s)\nPASS'
case_output skipped fail $'=== RUN   TestFirst\n--- PASS: TestFirst (0.01s)\n=== RUN   TestSecond\n--- SKIP: TestSecond (0.00s)\nPASS'
case_output wrong_test fail $'=== RUN   TestFirst\n--- PASS: TestFirst (0.01s)\n=== RUN   TestThird\n--- PASS: TestThird (0.01s)\nPASS'
case_output failed_test fail $'=== RUN   TestFirst\n--- PASS: TestFirst (0.01s)\n=== RUN   TestSecond\n--- FAIL: TestSecond (0.01s)\nFAIL'
case_output failing_exit fail $'=== RUN   TestFirst\n--- PASS: TestFirst (0.01s)\n=== RUN   TestSecond\n--- PASS: TestSecond (0.01s)\nPASS' 1
case_output duplicate_test fail $'=== RUN   TestFirst\n--- PASS: TestFirst (0.01s)\n=== RUN   TestFirst\n--- PASS: TestFirst (0.01s)\nPASS'
case_output contradictory_terminal fail $'--- PASS: TestFirst (0.01s)\n--- PASS: TestSecond (0.01s)\nPASS\nFAIL'
case_output duplicate_terminal fail $'--- PASS: TestFirst (0.01s)\n--- PASS: TestSecond (0.01s)\nPASS\nPASS'
case_output unexpected_extra fail $'--- PASS: TestFirst (0.01s)\n--- PASS: TestSecond (0.01s)\n--- PASS: TestThird (0.01s)\nPASS'
echo 'OWNER_TEST_OUTPUT_GATE_PASS positive=1 negative=9'

# These are tests of report admission, never measured coverage evidence.
scratch="$(mktemp -d)"
trap 'rm -rf -- "$scratch"' EXIT
mkdir "$scratch/profiles"
coverage_enabled=yes
coverage_sequence=0
FAKE_PROFILE=$'mode: atomic\nexample.invalid/fixture.go:1.1,1.2 1 1'
complete=$'=== RUN   TestFirst\n--- PASS: TestFirst (0.01s)\n=== RUN   TestSecond\n--- PASS: TestSecond (0.01s)\nPASS'
case_output measured pass "$complete"
[[ -s "$scratch/profiles/dummy.test-1.out" ]]
FAKE_PROFILE=$'mode: atomic\nexample.invalid/fixture.go:1.1,1.2 1 0'
case_output empty_hits fail "$complete"
FAKE_PROFILE=$'mode: set\nexample.invalid/fixture.go:1.1,1.2 1 1'
case_output invalid_mode fail "$complete"
FAKE_PROFILE=''
case_output empty_profile fail "$complete"
FAKE_COPY_EXIT=1
case_output missing_profile fail "$complete"
FAKE_COPY_EXIT=0
case_output skipped_report fail $'--- SKIP: TestFirst (0.00s)\nPASS'
[[ ! -e "$scratch/profiles/dummy.test-6.out" ]]
FAKE_PROFILE=$'mode: atomic\nnot-a-go-source-location 1 1'
case_output malformed_location fail "$complete"
FAKE_PROFILE=$'mode: atomic\nexample.invalid/fixture.go:2.1,1.2 1 1'
case_output reversed_location fail "$complete"
FAKE_PROFILE=$'mode: atomic\nexample.invalid/fixture.go:0.1,1.2 1 1'
case_output zero_coordinate fail "$complete"
FAKE_PROFILE=$'mode: atomic\nexample.invalid/fixture.go:1.1,1.2 0 1'
case_output no_measured_statements fail "$complete"
[[ "$(find "$scratch/profiles" -maxdepth 1 -type f | wc -l | tr -d '[:space:]')" == 1 ]]
coverage_enabled=no
echo 'OWNER_COVERAGE_ADMISSION_GATE_PASS positive=1 negative=9'

# Compare the declared discovery inventory against native Go selection before
# starting any disposable Docker stage. Retain the explicit reviewed allowlist.
pattern="$discovery_pattern"
expected="$discovery_expected"
[[ -n "$pattern" && -n "$expected" && "$pattern" != *$'\n'* && "$expected" != *$'\n'* ]] || {
  echo "Missing or ambiguous discovery test selection" >&2
  exit 1
}
listed="$(cd services/dsh/backend && GOTOOLCHAIN=local GOWORK=off go test ./internal/discovery -list "$pattern")"
actual="$(printf '%s\n' "$listed" | awk '/^Test[^[:space:]]+$/ {print}' | LC_ALL=C sort)"
declared="$(printf '%s\n' "$expected" | tr ',' '\n' | LC_ALL=C sort)"
if [[ -z "$actual" || "$actual" != "$declared" ]]; then
  echo "Discovery owner test inventory differs from native Go selection" >&2
  diff -u <(printf '%s\n' "$declared") <(printf '%s\n' "$actual") >&2 || true
  exit 1
fi
echo 'DISCOVERY_OWNER_TEST_INVENTORY_PASS'


# Exact snapshot admission is separate from actual PostgreSQL proof.
declare -f assert_wlt_snapshot_equal >/dev/null
original="$scratch/wlt-source.jsonl"
restored="$scratch/wlt-restored.jsonl"
printf '%s\n' '{"relation":"proposal","rows":[{"version":1,"amount":9007199254740993}]}' \
  '{"relation":"matrix","rows":[{"version":1}]}' > "$original"
cp -- "$original" "$restored"
assert_wlt_snapshot_equal "$original" "$restored" exact
reject_snapshot() {
  if assert_wlt_snapshot_equal "$original" "$restored" "$1" >/dev/null 2>&1; then
    echo "WLT_SNAPSHOT_GATE admitted $1" >&2
    return 1
  fi
}
head -n 1 "$original" > "$restored"
reject_snapshot missing_relation
cp -- "$original" "$restored"
printf '%s\n' '{"relation":"extra","rows":[]}' >> "$restored"
reject_snapshot extra_relation
sed 's/9007199254740993/9007199254740992/' "$original" > "$restored"
reject_snapshot changed_exact_amount
sed 's/"version":1/"version":2/' "$original" > "$restored"
reject_snapshot changed_version
: > "$restored"
reject_snapshot empty_snapshot
rm -- "$restored"
reject_snapshot missing_snapshot
echo 'WLT_COMPLETE_SNAPSHOT_GATE_PASS positive=1 negative=6'
