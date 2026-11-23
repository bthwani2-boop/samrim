/** Pure decisions for the single Surface-to-Lenovo source mirror. */

function parseRemoteHashes(output, expected) {
  const entries = new Map();
  const requested = new Set(expected);
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const divider = line.lastIndexOf("|");
    const rel = line.slice(0, divider);
    const digest = line.slice(divider + 1);
    if (divider < 0 || !requested.has(rel) || entries.has(rel) ||
        (digest !== "MISSING" && !/^[0-9A-F]{64}$/.test(digest))) {
      throw new Error("REMOTE_HASH_RESPONSE_INVALID");
    }
    entries.set(rel, digest);
  }
  if (entries.size !== requested.size) throw new Error("REMOTE_HASH_RESPONSE_INCOMPLETE");
  return entries;
}

function needsReconcile(state, current, currentHead, remoteFiles, currentBranch = state?.branch) {
  if (state && state.branch !== currentBranch) return true;
  if (!isUnchanged(state, current, currentHead)) return true;
  return [...remoteFiles].some(([rel, digest]) =>
    current.has(rel) ? current.get(rel) !== digest : digest !== "MISSING");
}

function remoteConflict(actual, desired, previous) {
  return actual !== desired && actual !== "MISSING" && actual !== previous;
}

function remoteAuditDue(previous, deadline, now = Date.now()) {
  // An active editing session must not indefinitely postpone full drift checks.
  return !previous || now >= deadline;
}
const branchTransitionPins = Object.freeze([
  ".node-version", "pnpm-lock.yaml", "package.json",
  "apps/customer/package.json", "apps/merchant/package.json",
  "apps/captain/package.json", "apps/control-panel/package.json",
  "services/identity/package.json", "services/dsh/package.json", "services/wlt/package.json",
]);

function assertCompatibleBranchTransition(previous, current, currentBranch) {
  if (!currentBranch || currentBranch.startsWith("archive/")) {
    throw new Error("SOURCE_SYNC_BRANCH_UNAUTHORIZED");
  }
  if (!previous || previous.branch === currentBranch) return false;
  // The mirror follows the active source branch; dependency installation is
  // a separate Lenovo operation, never a prerequisite for copying source.
  return true;
}
function isUnchanged(state, current, currentHead) {
  return Boolean(
    state &&
      state.head === currentHead &&
      Object.keys(state.files).length === current.size &&
      [...current].every(([rel, digest]) => state.files[rel] === digest),
  );
}

// One existing watcher owns the runtime attempt. Never retry an ambiguous
// or failed replacement for unchanged source; read-only/preflight failures
// may retry after the bounded interval.
function runtimePollDue({enabled, dirty, active, key, last, now, nextAudit}) {
  if (!enabled || dirty || active || !key || ["running", "uncertain"].includes(last?.status)) return false;
  if (last?.key !== key) return true;
  return last.status !== "blocked" && now >= nextAudit;
}

export { assertCompatibleBranchTransition, branchTransitionPins, isUnchanged, needsReconcile, parseRemoteHashes, remoteAuditDue, remoteConflict, runtimePollDue };
