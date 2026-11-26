#!/usr/bin/env bash
# Verify the CI owner-test output gate without Docker, network or SQL access.
set -euo pipefail
cd "$(dirname "$0")/../.."
script="tests/infra/verify-owner-postgres-ci.sh"
# Only load the output gate; never source the top-level Docker/test operations.
source <(sed -n '/^run_test() {/,/^}/p' "$script")
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
echo 'OWNER_TEST_OUTPUT_GATE_PASS positive=1 negative=6'

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
coverage_enabled=no
echo 'OWNER_COVERAGE_ADMISSION_GATE_PASS positive=1 negative=5'

# Compare the declared discovery inventory against native Go selection before
# starting any disposable Docker stage. Retain the explicit reviewed allowlist.
pattern="$(sed -n "s@^  /agent02/bin/dsh-discovery.test '\([^']*\)' '\([^']*\)'.*@\1@p" "$script")"
expected="$(sed -n "s@^  /agent02/bin/dsh-discovery.test '\([^']*\)' '\([^']*\)'.*@\2@p" "$script")"
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
