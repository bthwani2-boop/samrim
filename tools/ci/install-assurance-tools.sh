#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT}/tools/ci/tool-versions.env"
BIN_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/samrim-assurance-bin"
mkdir -p "${BIN_DIR}"

install_tar_binary() {
  local name="$1" version="$2" url="$3" sha256="$4" binary="$5"
  local tmp archive found
  [[ -x "${BIN_DIR}/${binary}" ]] && return 0
  tmp="$(mktemp -d)"
  archive="${tmp}/${name}.tar.gz"
  curl --fail --silent --show-error --location --retry 3 --retry-all-errors "${url}" --output "${archive}"
  printf '%s  %s
' "${sha256}" "${archive}" | sha256sum --check --status || {
    echo "::error::Checksum verification failed for ${name} ${version}"
    exit 2
  }
  tar -xzf "${archive}" -C "${tmp}"
  found="$(find "${tmp}" -type f -name "${binary}" -print -quit)"
  [[ -n "${found}" ]] || { echo "::error::Binary ${binary} not found"; exit 2; }
  install -m 0755 "${found}" "${BIN_DIR}/${binary}"
  rm -rf "${tmp}"
}

requested=("$@")
[[ "${#requested[@]}" -gt 0 ]] || requested=(actionlint shellcheck zizmor pinact gitleaks)
for tool in "${requested[@]}"; do
  case "${tool}" in
    actionlint) install_tar_binary actionlint "${ACTIONLINT_VERSION}" "${ACTIONLINT_URL}" "${ACTIONLINT_SHA256}" actionlint ;;
    shellcheck) install_tar_binary shellcheck "${SHELLCHECK_VERSION}" "${SHELLCHECK_URL}" "${SHELLCHECK_SHA256}" shellcheck ;;
    zizmor) install_tar_binary zizmor "${ZIZMOR_VERSION}" "${ZIZMOR_URL}" "${ZIZMOR_SHA256}" zizmor ;;
    pinact) install_tar_binary pinact "${PINACT_VERSION}" "${PINACT_URL}" "${PINACT_SHA256}" pinact ;;
    gitleaks) install_tar_binary gitleaks "${GITLEAKS_VERSION}" "${GITLEAKS_URL}" "${GITLEAKS_SHA256}" gitleaks ;;
    *) echo "::error::Unknown assurance tool: ${tool}"; exit 2 ;;
  esac
done
[[ -n "${GITHUB_PATH:-}" ]] && printf '%s
' "${BIN_DIR}" >> "${GITHUB_PATH}" || printf '%s
' "${BIN_DIR}"
