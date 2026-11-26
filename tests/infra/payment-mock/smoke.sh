#!/usr/bin/env bash
set -euo pipefail

# One disposable, localhost-only simulator. Do not replace shared Compose services.
image="bthwani-payment-mock-ci:${GITHUB_SHA:-local}"
docker build --file tests/infra/payment-mock/Dockerfile --tag "$image" tests/infra/payment-mock
container="$(docker run --rm -d --publish '127.0.0.1::8080' "$image")"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT
[[ "$(docker exec "$container" id -u)" == '1000' ]] || { echo 'Simulator must run as non-root' >&2; exit 1; }
port="$(docker port "$container" '8080/tcp' | sed -n 's/^127\.0\.0\.1://p' | head -n 1)"
[[ "$port" =~ ^[0-9]+$ ]] || { echo 'Simulator not loopback-bound' >&2; exit 1; }
origin="http://127.0.0.1:$port/sandbox/v1/funding"

success=""
for attempt in {1..40}; do
  if success="$(curl --fail --silent --max-time 2 "$origin/cash-in-accepted-01")"; then
    break
  fi
  sleep 0.25
done
[[ -n "$success" ]] || { echo 'Simulator failed to boot with mappings' >&2; exit 1; }
node -e '
const obj = JSON.parse(process.argv[1]);
if (obj.reference !== "cash-in-accepted-01" ||
    obj.actorId !== "wallet-two" || obj.amountYer !== "17" ||
    obj.currency !== "YER" || obj.status !== "SUCCEEDED") {
  process.exit(1);
}
' "$success"

for entry in 'cash-in-pending-01:PENDING' 'cash-in-failed-01:FAILED'; do
  reference="${entry%%:*}"
  status="${entry#*:}"
  body="$(curl --fail --silent --max-time 2 "$origin/$reference")"
  node -e '
const obj = JSON.parse(process.argv[1]);
if (obj.reference !== process.argv[2] || obj.status !== process.argv[3]) {
  process.exit(1);
}
' "$body" "$reference" "$status"
done
for entry in 'cash-in-not-configured:404' 'cash-in-server-error:503' 'cash-in-redirect-01:302'; do
  reference="${entry%%:*}"
  expected="${entry#*:}"
  actual="$(curl --silent --output /dev/null --max-time 2 --write-out '%{http_code}' "$origin/$reference")"
  [[ "$actual" == "$expected" ]] || { echo "$reference returned $actual, expected $expected" >&2; exit 1; }
done

# Deterministic timeout fixture must not be accepted as a completed response.
if curl --silent --max-time 1 --output /dev/null "$origin/cash-in-delayed-01"; then
  echo 'Delayed provider response unexpectedly completed before deadline' >&2
  exit 1
fi
echo 'PAYMENT_MOCK_DOCKER_SMOKE_PASS local_only=true synthetic_only=true'
