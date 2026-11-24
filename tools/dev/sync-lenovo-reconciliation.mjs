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

function runtimeBaselineProofDue(key,last) {
  if(!key || ["running","uncertain"].includes(last?.status))return false;
  return last?.key!==key || last.status==="retry";
}

function runtimeAttemptResult(code, signal, stdout, stderr) {
  if(signal || /ROLLBACK_BLOCKED|ROLLBACK_READBACK_FAILED/.test(stderr))return "uncertain";
  const starts=[...stdout.matchAll(/^OWNER_APPLY_STARTED (.+)\r?$/gm)].map(m=>m[1].trim());
  const verified=[...stdout.matchAll(/^OWNER_APPLY_VERIFIED (.+)\r?$/gm)].map(m=>m[1].trim());
  if(/ROLLBACK_PASS/.test(stderr))return "blocked";
  if(starts.length!==verified.length || !starts.every((v,i)=>v===verified[i]))return "uncertain";
  const terminal=[...stdout.matchAll(/^RECONCILE_(PASS|PARTIAL) HEAD=[a-f0-9]{40}\r?$/gm)];
  if(terminal.length===1 && terminal[0][1]==="PARTIAL")return /BASELINE_PROOF_FAIL/.test(stderr)?"retry":"review";
  if(code===0 && terminal.length===1 && terminal[0][1]==="PASS")return "pass";
  return "retry";
}

// The watcher schedules the existing Graphify runner; the runner owns all
// fingerprinting, indexing and locking. Never treat unknown provenance as
// permission to initialize or replace an index.
function graphifyRefreshAction(assessment) {
  if (assessment?.refreshing === true) return "busy";
  if (assessment?.unsafeUntracked > 0) return "deferred";
  if (assessment?.status === "PASS" && assessment.queryable === true) return "current";
  if (assessment?.status === "INVALIDATED" && assessment.queryable === true) return "refresh";
  if (assessment?.status === "BLOCKED" && assessment.queryable === false &&
      assessment.reason === "indexed branch differs") return "refresh";
  return "blocked";
}

// Reload only committed watcher code, after all existing child work drains.
function watcherReloadAction({loaded,current,dirty,busy}) {
  if (loaded===current) return "current";
  if (dirty) return "defer";
  return busy ? "drain" : "reload";
}

// Ignore generated output, dependencies, credentials and internal Git noise.
function graphifySourceEvent(name) {
  if (!name) return true; // platform omitted filename: reconcile conservatively
  const rel=String(name).replaceAll("\\","/");
  if (/^\.git\/(?:HEAD|refs\/heads\/)/.test(rel)) return true;
  const parts=rel.split("/");
  if (parts.some(p=>!p || p===".." || /^(?:\.git|node_modules|graphify-out|\.next|\.expo|\.nx|dist|build|coverage|\.cache|\.pnpm-store|\.env(?:\..*)?|\.ssh|\.secrets)$/i.test(p))) return false;
  return /^(?:apps|services|packages|infra|tools|governance|specs|docs|tests|\.specify|\.agents|\.github)(?:\/|$)/.test(rel) || !rel.includes("/");
}
function graphifyPollDue({now,dirtySince,lastEvent,nextAudit,busy,debounce=3000,maxWait=15000}) {
  if (busy) return false;
  return now>=nextAudit || (dirtySince!==null && (now-lastEvent>=debounce || now-dirtySince>=maxWait));
}

export { assertCompatibleBranchTransition, branchTransitionPins, graphifyPollDue, graphifyRefreshAction, graphifySourceEvent, isUnchanged, needsReconcile, parseRemoteHashes, remoteAuditDue, remoteConflict, runtimeAttemptResult, runtimeBaselineProofDue, runtimePollDue, watcherReloadAction };
