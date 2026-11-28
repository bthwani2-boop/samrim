// Source-mirror admission and reconciliation decisions. The existing watcher
// owns scheduling; the guarded reconciler owns terminal receipts.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { containsLikelySecret } from "../security/verify-secrets.mjs";
import { services } from "./check-go.mjs";

const surfaces = ["customer", "merchant", "captain", "control-panel"];
const applicationRoots = surfaces.map(name => "apps/" + name);
const serviceRoots = services.map(name => "services/" + name);
const ownerSet = new Set(services);
const rootInputs = ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", ".node-version", "tsconfig.base.json", "nx.json", "biome.json"];
const sharedName = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const privatePath = /^(?:\.env(?:\..*)?|\.npmrc|\.git-credentials|google-services\.json|GoogleService-Info\.plist|credentials(?:\..*)?|secrets\.local\..*|.*local.*\.secret\.json|id_rsa|id_ed25519|.*\.(?:pem|key|p12|p8|pfx|jks|keystore))$/i;
const generatedPath = new Set([".git", "node_modules", ".expo", ".next", ".next-dev", "dist", "build", "coverage", ".cache", ".turbo", "test-results", "private", ".ssh", ".secrets", "logs", ".pnpm-store", "tmp", ".tmp", ".nx", ".local", ".artifacts", ".diagnostics", ".bthwani-local", "graphify-out"]);
const windowsDevice = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

// Compare Git path identities in ordinal order, independent of locale and
// filesystem enumeration. Both inventories use this same order.
const comparePath = (left, right) => left < right ? -1 : left > right ? 1 : 0;
export const mirrorSourceRoots = Object.freeze([
  ...applicationRoots, "packages",
  ...serviceRoots.flatMap(root => ["package.json", "tsconfig.json", "clients"].map(entry => root + "/" + entry)),
  "tools/mobile", "tools/dev", "patches", ...rootInputs,
]);
export const branchTransitionPins = Object.freeze([
  ".node-version", "pnpm-lock.yaml", "package.json",
  ...[...applicationRoots, ...serviceRoots].map(root => root + "/package.json"),
]);
const dependencyPins = new Set([...branchTransitionPins, "pnpm-workspace.yaml"]);

function safeSegment(part) {
  return part && part !== "." && part !== ".." && !/[<>:"|?*]/.test(part) &&
    !/[ .]$/.test(part) && !windowsDevice.test(part) &&
    ![...part].some(char => char.codePointAt(0) < 32) &&
    !generatedPath.has(part.toLowerCase()) && !privatePath.test(part) &&
    !/\.tsbuildinfo$|\.log$/i.test(part);
}

// Lexical admission applies to both the live inventory and prior manifest
// entries so removed packages can be reconciled without admitting secrets.
export function mirrorPathAllowed(rel) {
  if (typeof rel !== "string" || !rel || rel.includes("\\") || containsLikelySecret(rel)) return false;
  const parts = rel.split("/");
  if (!parts.every(safeSegment)) return false;
  if (parts.length === 1) return rootInputs.includes(rel);
  const [group, name, entry] = parts;
  switch (group) {
    case "apps":
      return parts.length >= 3 && surfaces.includes(name) && rel !== "apps/control-panel/next-env.d.ts";
    case "packages":
      return parts.length >= 3 && sharedName.test(name) && !surfaces.includes(name) && !ownerSet.has(name);
    case "services":
      return ownerSet.has(name) && ((parts.length === 3 && ["package.json", "tsconfig.json"].includes(entry)) ||
        (entry === "clients" && parts.length >= 4));
    case "tools":
      return parts.length >= 3 && ["mobile", "dev"].includes(name) && !(name === "dev" && entry === "docker");
    case "patches":
      return parts.length === 2 && name.endsWith(".patch");
    default:
      return false;
  }
}

export function mirrorPackageName(rel) {
  return /^packages\/([^/]+)\//.exec(rel)?.[1] ?? null;
}
export function assertMirrorPackageManifest(name, bytes) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("MIRROR_PACKAGE_MANIFEST_INVALID " + name);
  }
  if (value?.name !== "@bthwani/" + name || value.private !== true)
    throw new Error("MIRROR_PACKAGE_MANIFEST_INVALID " + name);
}
export function mirrorCandidatePaths(paths) {
  const seen = new Map();
  for (const rel of paths) {
    if (!mirrorPathAllowed(rel)) continue;
    const folded = rel.toLowerCase();
    const previous = seen.get(folded);
    if (previous && previous !== rel) throw new Error("MIRROR_CASE_COLLISION " + previous + " " + rel);
    seen.set(folded, rel);
  }
  return [...seen.values()].sort(comparePath);
}
export function isDependencyInput(rel) {
  return dependencyPins.has(rel) || /^packages\/[a-z0-9-]+\/package\.json$/.test(rel) || /^patches\/[^/]+\.patch$/.test(rel);
}
export function dependencyInputChanges(previous, current) {
  if (!previous) return [];
  const paths = new Set([...Object.keys(previous.files), ...current.keys()]);
  return [...paths].filter(rel => isDependencyInput(rel) && previous.files[rel] !== current.get(rel)).sort(comparePath);
}
export function assertCompatibleBranchTransition(previous, current, currentBranch) {
  if (!currentBranch || currentBranch.startsWith("archive/")) throw new Error("SOURCE_SYNC_BRANCH_UNAUTHORIZED");
  return Boolean(previous && previous.branch !== currentBranch);
}

const lines = text => text.split(/\r?\n/);
export function parseRemoteHashes(output, expected) {
  const requested = new Set(expected);
  const result = new Map();
  for (const line of lines(output).filter(Boolean)) {
    const split = line.lastIndexOf("|");
    const rel = line.slice(0, split);
    const hash = line.slice(split + 1);
    if (split < 0 || !requested.has(rel) || result.has(rel) || (hash !== "MISSING" && !/^[0-9A-F]{64}$/.test(hash)))
      throw new Error("REMOTE_HASH_RESPONSE_INVALID");
    result.set(rel, hash);
  }
  if (result.size !== requested.size) throw new Error("REMOTE_HASH_RESPONSE_INCOMPLETE");
  return result;
}
export function isUnchanged(state, current, currentHead) {
  return Boolean(state && state.head === currentHead && Object.keys(state.files).length === current.size &&
    [...current].every(([rel, hash]) => state.files[rel] === hash));
}
export function needsReconcile(state, current, currentHead, remoteFiles, currentBranch = state?.branch) {
  return state?.branch !== currentBranch || !isUnchanged(state, current, currentHead) ||
    [...remoteFiles].some(([rel, hash]) => hash !== (current.get(rel) ?? "MISSING"));
}
export function remoteConflict(actual, desired, previous) {
  return ![desired, "MISSING", previous].includes(actual);
}
export function remoteAuditDue(previous, deadline, now = Date.now()) {
  return !previous || now >= deadline;
}

// One scheduler admission and one leased serving writer. The receipt records
// whether every previous serving write is verified, or a write may be in flight.
const sha = /^[a-f0-9]{64}$/;
const attemptId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const settledRuntimeStates = new Set(["pass", "review", "blocked", "retry"]);
const pending = state => ["running", "uncertain"].includes(state?.status);
const digest = text => createHash("sha256").update(text).digest("hex");
const readState = file => JSON.parse(readFileSync(file, "utf8"));
const validKey = (state, key) => state?.version === 1 && sha.test(key) && state.key === key;
const matchingAttempt = (state, key, attempt) => validKey(state, key) && pending(state) &&
  attemptId.test(attempt) && state.attempt === attempt;
function optionalRecord(file) {
  try { return readState(file); }
  catch(error) {
    if(error.code==="ENOENT")return null;
    throw new Error("RUNTIME_RECORD_INVALID");
  }
}
function publishReceipt(file, record) {
  const temporary = file + "." + randomUUID() + ".tmp";
  let owned = false;
  try {
    writeFileSync(temporary, JSON.stringify(record), { flag: "wx", flush: true });
    owned = true;
    renameSync(temporary, file);
    owned = false;
  } finally {
    if (owned) rmSync(temporary, { force: true });
  }
}
export function runtimeAttemptPhase(stateFile, receiptFile, key, attempt) {
  try {
    const state=readState(stateFile), receipt=readState(receiptFile);
    if (receipt.version===1 && matchingAttempt(state,receipt.key,receipt.attempt) &&
        (key===undefined || key===receipt.key) && (attempt===undefined || attempt===receipt.attempt) &&
        receipt.status===undefined && receipt.reviewed===undefined &&
        ["ready","mutating"].includes(receipt.phase)) return receipt.phase;
  } catch { /* Unknown phase never proves a safe retry. */ }
  return null;
}
export function beginRuntimeAttempt(stateFile,receiptFile,key,attempt) {
  if(!sha.test(key)||!attemptId.test(attempt))throw new Error("RUNTIME_ATTEMPT_MISMATCH");
  const state=optionalRecord(stateFile), prior=optionalRecord(receiptFile);
  if(state && (!validKey(state,state.key)||!settledRuntimeStates.has(state.status)||state.attempt===attempt))
    throw new Error("RUNTIME_ATTEMPT_NOT_SETTLED");
  if(prior){
    const ready=prior.phase==="ready"&&attemptId.test(prior.attempt)&&prior.status===undefined&&prior.reviewed===undefined;
    const terminal=prior.phase===undefined&&settledRuntimeStates.has(prior.status)&&
      ((attemptId.test(prior.attempt)&&prior.reviewed===undefined)||
       (prior.status==="retry"&&prior.attempt===undefined&&sha.test(prior.reviewed)));
    if(!validKey(prior,prior.key)||prior.attempt===attempt||!(ready||terminal))
      throw new Error("RUNTIME_ATTEMPT_NOT_SETTLED");
  }
  // Publish the safe receipt first. A crash between files cannot strand a
  // pending state without proof; the next scheduler can admit a fresh ID.
  publishReceipt(receiptFile,{version:1,key,attempt,phase:"ready"});
  publishReceipt(stateFile,{version:1,key,attempt,status:"running"});
}
export function recordRuntimePhase(stateFile, receiptFile, key, attempt, phase) {
  if (!matchingAttempt(readState(stateFile),key,attempt)) throw new Error("RUNTIME_ATTEMPT_MISMATCH");
  const existing=runtimeAttemptPhase(stateFile,receiptFile,key,attempt);
  if(!((existing==="ready"&&phase==="mutating")||(existing==="mutating"&&phase==="ready")))
    throw new Error("RUNTIME_PHASE_TRANSITION_INVALID");
  publishReceipt(receiptFile,{version:1,key,attempt,phase});
}
export function acknowledgeRuntimeAttempt(stateFile, receiptFile, key, attempt, status) {
  if (!matchingAttempt(readState(stateFile), key, attempt)) throw new Error("RUNTIME_ATTEMPT_MISMATCH");
  if (!settledRuntimeStates.has(status)) throw new Error("RUNTIME_TERMINAL_STATUS_INVALID");
  const phase=runtimeAttemptPhase(stateFile,receiptFile,key,attempt);
  if(phase!=="ready"&&!(phase==="mutating"&&status==="blocked"))throw new Error("RUNTIME_PHASE_TRANSITION_INVALID");
  publishReceipt(receiptFile, { version: 1, key, attempt, status });
}
export function acknowledgeRuntimeRecovery(stateFile, receiptFile, key, reviewed, safeOnly=false) {
  const text = readFileSync(stateFile, "utf8");
  const state = JSON.parse(text);
  if (text !== reviewed || !validKey(state, key) || !pending(state)) throw new Error("RUNTIME_ATTEMPT_MISMATCH");
  if(safeOnly && runtimeAttemptPhase(stateFile,receiptFile,key,state.attempt)!=="ready")
    throw new Error("RUNTIME_SAFE_BOUNDARY_NOT_PROVEN");
  publishReceipt(receiptFile, { version: 1, key, status: "retry", reviewed: digest(text) });
}
export function runtimeReceiptStatus(stateFile, receiptFile) {
  try {
    const text = readFileSync(stateFile, "utf8");
    const state = JSON.parse(text);
    const receipt = readState(receiptFile);
    if (receipt.version !== 1 || receipt.phase!==undefined || !settledRuntimeStates.has(receipt.status)) return null;
    if (receipt.reviewed === undefined && matchingAttempt(state, receipt.key, receipt.attempt)) return receipt.status;
    if (receipt.attempt === undefined && receipt.status === "retry" && validKey(state, receipt.key) && pending(state) && receipt.reviewed === digest(text)) return "retry";
  } catch { /* Missing or corrupt proof cannot release a hold. */ }
  return null;
}
export function runtimeInterruptedStatus(stateFile,receiptFile) {
  return runtimeReceiptStatus(stateFile,receiptFile) ?? "uncertain";
}

// A serving mutation is settled only by verified rollback, never by an
// error message. At a proven ready boundary, a failed operation must first
// re-establish current eligibility through the read-only owner audit.
export class VerifiedRuntimeRollback extends Error {}
export function runtimeFailureStatus(phase, error) {
  if (phase === "ready") return "review";
  if (phase === "mutating" && error instanceof VerifiedRuntimeRollback) return "blocked";
  return null;
}

// A completed partial reconciliation is not success. Source-admission holds
// wait for a changed key; schema/configuration holds retain bounded review.
export function runtimeTerminalStatus({ partial, holds, baselineFailed }) {
  if (baselineFailed) return "retry";
  if (!partial) return "pass";
  const local = /^(?:PREVIEW_NOT_AUTHORIZED|UNCOMMITTED_NON_GO|SHARED_INPUT_REVIEW_REQUIRED)$/;
  const peer = /^PEER_REVIEW_REQUIRED:(?:dsh|identity|wlt)$/;
  return holds.some(reason => local.test(reason)) && holds.every(reason => local.test(reason) || peer.test(reason)) ? "blocked" : "review";
}

export function runtimePollAction({ enabled, dirty, active, key, last, now, nextAudit }) {
  if (!enabled || dirty || active || !key || pending(last)) return null;
  if (last?.key !== key) return "apply";
  if (last.status === "blocked" || now < nextAudit) return null;
  return last.status === "retry" ? "apply" : "audit";
}
export function runtimeBaselineProofDue(key, last) {
  return Boolean(key && !pending(last) && (last?.key !== key || last.status === "retry"));
}
function oneRecord(records, pattern) {
  const matches = records.map(line => pattern.exec(line)).filter(Boolean);
  return matches.length === 1 ? matches[0] : null;
}
function terminalResult(records) {
  const record = oneRecord(records, /^RECONCILE_(PASS|PARTIAL) HEAD=([a-f0-9]{40})$/);
  return record ? { status: record[1], head: record[2] } : null;
}
function selectedOwners(records, head) {
  const record = oneRecord(records, /^SELECTED=(NONE|[a-z,]+) HEAD=([a-f0-9]{40}) CAPTAIN_ADMISSION=(true|false)$/);
  if (!record || record[2] !== head) return null;
  const selected = record[1] === "NONE" ? [] : record[1].split(",");
  return selected.every(owner => ownerSet.has(owner)) && new Set(selected).size === selected.length ? selected : null;
}

// The read-only owner audit returns one disposition, including the durable
// scheduler status. Unverified evidence invalidates a previous pass without
// authorizing an apply; only proven eligible drift can re-admit mutation.
export function runtimeAuditResult(code, signal, stdout, head, eligible) {
  const unverified = { outcome: "unverified", status: "review" };
  const records = lines(stdout);
  if (signal || records.some(line => /^OWNER_APPLY_/.test(line))) return unverified;
  const terminal = terminalResult(records);
  const selected = selectedOwners(records, head);
  if (!terminal || terminal.head !== head || selected === null) return unverified;
  if (code === 0 && terminal.status === "PASS" && selected.length === 0)
    return { outcome: "pass", status: "pass" };
  if (code === 3 && terminal.status === "PARTIAL") {
    return selected.some(owner => eligible.includes(owner))
      ? { outcome: "apply", status: "retry" }
      : { outcome: "review", status: "review" };
  }
  return unverified;
}
export function watcherReloadAction({ loaded, current, dirty, busy }) {
  return loaded === current ? "current" : dirty ? "defer" : busy ? "drain" : "reload";
}
const excludedEvent = /^(?:\.git|node_modules|graphify-out|\.next|\.expo|\.nx|dist|build|coverage|\.cache|\.pnpm-store|\.env(?:\..*)?|\.ssh|\.secrets)$/i;
export function sourceChangeEvent(name) {
  if (!name) return true;
  const rel = String(name).replaceAll("\\", "/");
  if (/^\.git\/(?:HEAD|refs\/heads\/)/.test(rel)) return true;
  if (rel.split("/").some(part => !part || part === ".." || excludedEvent.test(part))) return false;
  return !rel.includes("/") || /^(?:apps|services|packages|infra|tools|governance|specs|docs|tests|\.specify|\.agents|\.github)(?:\/|$)/.test(rel);
}
export function sourceCycleDue({ pending, now, nextAudit }) {
  return pending || now >= nextAudit;
}
export function graphifyPollDue({ now, dirtySince, lastEvent, nextAudit, busy, debounce = 3000, maxWait = 15000 }) {
  return !busy && (now >= nextAudit || (dirtySince !== null && (now - lastEvent >= debounce || now - dirtySince >= maxWait)));
}
