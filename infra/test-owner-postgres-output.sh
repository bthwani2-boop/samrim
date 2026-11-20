#!/usr/bin/env bash
# Verify the CI owner-test output gate without Docker, network or SQL access.
set -euo pipefail
cd "$(dirname "$0")/.."
script="infra/verify-owner-postgres-ci.sh"
# Only load the output gate; never source the top-level Docker/test operations.
source <(sed -n '/^run_test() {/,/^}/p' "$script")
declare -f run_test >/dev/null

docker() {
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
