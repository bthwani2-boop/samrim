#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
// One-way live-source mirror: BTHWANI D:\samrim -> BTHWANI-DOCKER, verified SSH.
// Uses the existing Lenovo staging runtime and existing Surface scheduled task.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const targetHost = "bthwani-docker";
const targetIdentity = "BTHWANI-DOCKER";
const targetRoot = "C:\\Users\\bthwa\\BThwaniAppRunner\\source-runtime";
const include = [
  "apps/customer", "apps/merchant", "apps/captain", "apps/control-panel",
  "packages/design-system", "packages/push-device", "packages/tamagui-config",
  "tools/mobile", "tools/dev", "patches", "infra/Start-RefoundationApp.ps1",
  "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", ".node-version",
  "tsconfig.base.json", "nx.json", "biome.json"
];
const blockedDirs = new Set([
  ".git", "node_modules", ".expo", ".next", "dist", "build", "coverage",
  ".cache", ".turbo", "test-results", "private", ".ssh", ".secrets",
  "logs", ".pnpm-store", "tmp"
]);
const secret = /^(?:\.env(?:\..*)?|\.npmrc|\.git-credentials|google-services\.json|GoogleService-Info\.plist|credentials(?:\..*)?|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx|jks|keystore))$/i;
const exe = {
  git: "C:\\Program Files\\Git\\cmd\\git.exe",
  ssh: "C:\\Windows\\System32\\OpenSSH\\ssh.exe",
  scp: "C:\\Windows\\System32\\OpenSSH\\scp.exe"
};
const stateDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "BThwani", "Operations", "SourceSync");
const stateFile = path.join(stateDir, "manifest.json");
const logFile = path.join(stateDir, "sync.log");
const quote = v => "'" + v.replaceAll("'", "''") + "'";
const destination = rel => path.win32.join(targetRoot, ...rel.split("/"));
function hash(file) {
  // Open before validation and read through that descriptor: a path swap
  // cannot redirect the bytes we hash to a different file.
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    let pathEntry;
    try {
      pathEntry = fs.lstatSync(file, { bigint: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error("UNSAFE_SOURCE_FILE " + path.relative(root, file));
      }
      throw error;
    }
    if (!opened.isFile() || !pathEntry.isFile() || pathEntry.isSymbolicLink() ||
        opened.dev !== pathEntry.dev || opened.ino !== pathEntry.ino) {
      throw new Error("UNSAFE_SOURCE_FILE " + path.relative(root, file));
    }
    return crypto.createHash("sha256").update(fs.readFileSync(fd)).digest("hex").toUpperCase();
  } finally {
    fs.closeSync(fd);
  }
}
function allowed(rel) {
  if (typeof rel !== "string" || !rel || rel.includes("\\") ||
      rel.startsWith("/") || rel.includes("//") || rel.includes("\0")) return false;
  const parts = rel.split("/");
  if (parts.some(x => !x || x === "." || x === ".." || /[<>:"|?*]/.test(x) ||
      [...x].some(char => char.codePointAt(0) < 32) ||
      blockedDirs.has(x.toLowerCase()) || secret.test(x))) return false;
  return include.some(x => x === rel || rel.startsWith(x + "/"));
}
function failureDetail(result) {
  return String(result.error?.message || result.stderr || result.status).slice(0, 250);
}
function run(which, args, timeout = 20000) {
  const result = spawnSync(exe[which], args, {
    cwd: root, encoding: "utf8", windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024
  });
  if (result.error || result.status !== 0) throw new Error(which + " failure: " + failureDetail(result));
  return (result.stdout || "").trim();
}
function remote(code) {
  return run("ssh", [
    "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    "-o", "ConnectTimeout=6", targetHost, "powershell.exe", "-NoProfile",
    "-NonInteractive", "-EncodedCommand", Buffer.from(code, "utf16le").toString("base64")
  ], 30000);
}
function appendLogFile(file, message, limit = 1048576) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Use the same open descriptor for the size check and the normal append.
  let fd = fs.openSync(file, "a", 0o600);
  try {
    if (fs.fstatSync(fd).size <= limit) {
      fs.writeSync(fd, message + "\n");
      return;
    }
  } finally {
    fs.closeSync(fd);
  }
  fs.rmSync(file + ".previous", { force: true });
  try {
    fs.renameSync(file, file + ".previous");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  fd = fs.openSync(file, "a", 0o600);
  try {
    fs.writeSync(fd, message + "\n");
  } finally {
    fs.closeSync(fd);
  }
}
function logger(line) {
  const message = new Date().toISOString() + " " + line;
  appendLogFile(logFile, message);
  console.log(message);
}
function head() { return run("git", ["rev-parse", "HEAD"]); }
function branch() { return run("git", ["branch", "--show-current"]); }
function inventory() {
  const raw = run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...include]);
  const files = [...new Set(raw.split("\0").filter(allowed))]
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const found = new Map();
  for (const rel of files) {
    const full = path.join(root, ...rel.split("/"));
    try {
      found.set(rel, hash(full));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return found;
}
function readState() {
  let rawState;
  try {
    rawState = fs.readFileSync(stateFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const state = JSON.parse(rawState);
  if (state.version !== 1 || state.host !== targetIdentity ||
      state.target !== targetRoot || state.branch !== branch() ||
      !state.files || typeof state.files !== "object" || Array.isArray(state.files)) {
    throw new Error("SOURCE_SYNC_STATE_INVALID");
  }
  for (const [rel, digest] of Object.entries(state.files)) {
    if (!allowed(rel) || !/^[0-9A-F]{64}$/.test(digest)) throw new Error("SOURCE_SYNC_MANIFEST_INVALID");
  }
  return state;
}
function persistAt(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const pending = file + "." + process.pid + ".tmp";
  let created = false;
  try {
    fs.writeFileSync(pending, JSON.stringify(state), { flag: "wx" });
    created = true;
    fs.renameSync(pending, file);
  } catch (error) {
    // Never delete a temporary file that this invocation did not create.
    if (created) {
      try { fs.rmSync(pending, { force: true }); } catch {}
    }
    throw error;
  }
}
function persist(state) {
  persistAt(stateFile, state);
}
function remoteHash(rel) {
  const file = destination(rel);
  return remote("$p=" + quote(file) +
    ";if(Test-Path -LiteralPath $p -PathType Leaf){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash}else{'MISSING'}").toUpperCase();
}
function remoteReady() {
  if ((process.env.COMPUTERNAME || "").toUpperCase() !== "BTHWANI" ||
      path.win32.normalize(root).toLowerCase() !== "d:\\samrim") {
    throw new Error("SOURCE_SYNC_MUST_RUN_ON_SURFACE_CANONICAL");
  }
  const name = run("ssh", ["-T", "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=6", targetHost, "hostname"]);
  if (name.toUpperCase() !== targetIdentity) throw new Error("SOURCE_SYNC_SSH_IDENTITY_MISMATCH");
  if (remote("if(Test-Path -LiteralPath " + quote(path.win32.join(targetRoot, "node_modules", ".pnpm", "lock.yaml")) +
    "){'READY'}else{throw 'TARGET_DEPENDENCIES_MISSING'}") !== "READY") throw new Error("TARGET_NOT_READY");
}
function remoteConflict(actual, desired, previous) {
  return actual !== desired && actual !== "MISSING" && actual !== previous;
}
function publish(rel, expected, previous) {
  const full = path.join(root, ...rel.split("/"));
  let sourceDigest;
  try {
    sourceDigest = hash(full);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (sourceDigest !== expected) throw new Error("SOURCE_CHANGED_WHILE_READING " + rel);
  const actual = remoteHash(rel);
  if (actual === expected) return;
  if (remoteConflict(actual, expected, previous)) throw new Error("REMOTE_STALE_FILE_CONFLICT " + rel);
  const dest = destination(rel);
  const stage = dest + ".source-sync-" + process.pid + ".tmp";
  const backup = dest + ".source-sync-" + process.pid + ".bak";
  remote("New-Item -ItemType Directory -Force -Path " + quote(path.win32.dirname(dest)) + " | Out-Null");
  try {
    run("scp", ["-q", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
      "-o", "ConnectTimeout=6", full, targetHost + ":" + stage.replaceAll("\\", "/")], 45000);
    const stageHash = remote("(Get-FileHash -LiteralPath " + quote(stage) + " -Algorithm SHA256).Hash");
    if (stageHash.toUpperCase() !== expected) throw new Error("STAGE_HASH_MISMATCH " + rel);
    remote("$stage=" + quote(stage) + ";$dest=" + quote(dest) + ";$backup=" + quote(backup) +
      ";if(Test-Path -LiteralPath $dest -PathType Leaf){[IO.File]::Replace($stage,$dest,$backup)}else{[IO.File]::Move($stage,$dest)}");
    if (remoteHash(rel) !== expected) throw new Error("PUBLISHED_HASH_MISMATCH " + rel);
    remote("if(Test-Path -LiteralPath " + quote(backup) + "){Remove-Item -LiteralPath " + quote(backup) + " -Force}");
  } finally {
    try {remote("if(Test-Path -LiteralPath " + quote(stage) +
      "){Remove-Item -LiteralPath " + quote(stage) + " -Force}");} catch {}
  }
}
function managedDelete(rel, expected) {
  const actual = remoteHash(rel);
  if (actual === "MISSING") return;
  if (actual !== expected) throw new Error("REMOTE_STALE_FILE_CONFLICT " + rel);
  const dest = destination(rel);
  remote("$f=" + quote(dest) + ";Remove-Item -LiteralPath $f -Force; if(Test-Path -LiteralPath $f){throw 'DELETE_FAILED'}");
}
function baseline(current) {
  const checks = ["package.json", "pnpm-lock.yaml", "apps/customer/package.json",
    "apps/merchant/package.json", "apps/captain/package.json", "apps/control-panel/package.json"];
  for (const rel of checks) {
    const full = path.join(root, ...rel.split("/"));
    if (remoteHash(rel) !== hash(full)) throw new Error("BASELINE_HASH_MISMATCH " + rel);
  }
  // A missing manifest must not silently trust unverified remote files.
  const files = {};
  for (const [rel, digest] of current) {
    if (remoteHash(rel) === digest) files[rel] = digest;
  }
  logger("BASELINE_PASS pending=" + (current.size - Object.keys(files).length));
  return { version: 1, branch: branch(), host: targetIdentity, target: targetRoot, head: head(), files };
}
const remoteHeartbeatMs = 60_000;
let nextRemoteHeartbeat = 0;
function isUnchanged(state, current, currentHead) {
  return Boolean(
    state &&
      state.head === currentHead &&
      Object.keys(state.files).length === current.size &&
      [...current].every(([rel, digest]) => state.files[rel] === digest),
  );
}
function reconcile() {
  const current = inventory();
  const previous = readState();
  const currentHead = head();
  const unchanged = isUnchanged(previous, current, currentHead);
  // Avoid four SSH handshakes per 3-second idle poll; still check remote health
  // at least once per minute and immediately when source or HEAD changes.
  if (unchanged && Date.now() < nextRemoteHeartbeat) return;
  remoteReady();
  nextRemoteHeartbeat = Date.now() + remoteHeartbeatMs;
  if (unchanged) return;
  const state = previous || baseline(current);
  for (const rel of ["pnpm-lock.yaml", ".node-version"]) {
    if (!current.has(rel) || remoteHash(rel) !== current.get(rel)) {
      throw new Error("DEPENDENCIES_CHANGED_REQUIRES_INSTALL " + rel);
    }
  }
  const files = { ...state.files };
  let changed = 0;
  for (const [rel, digest] of current) {
    if (state.files[rel] === digest) continue;
    publish(rel, digest, state.files[rel]);
    files[rel] = digest;
    changed++;
    logger("SYNC " + rel);
  }
  for (const [rel, digest] of Object.entries(state.files)) {
    if (current.has(rel)) continue;
    managedDelete(rel, digest);
    delete files[rel];
    changed++;
    logger("MANAGED_DELETE " + rel);
  }
  if (changed || state.head !== currentHead) persist({ ...state, files, head: currentHead });
  if (changed) logger("SYNC_PASS files=" + changed + " head=" + currentHead.slice(0, 12));
}
function main() {
  const idx = process.argv.indexOf("--check-path");
  if (idx >= 0) {
    const name = process.argv[idx + 1] || "";
    console.log(allowed(name) ? "ACCEPT " + name : "REJECT " + name);
    process.exitCode = allowed(name) ? 0 : 2;
    return;
  }
  if (!process.argv.includes("--once") && !process.argv.includes("--watch")) {
    throw new Error("USAGE --once | --watch | --check-path <path>");
  }
  if (!fs.existsSync(path.join(root, "AGENTS.md"))) throw new Error("CANONICAL_SOURCE_MISSING");
  const initialBranch = branch();
  const cycle = () => {
    if (branch() !== initialBranch) throw new Error("BRANCH_CHANGED_SYNC_STOP");
    reconcile();
  };
  if (process.argv.includes("--watch")) {
    let active = false;
    let lastError = "";
    const attempt = () => {
      if (active) return;
      active = true;
      try {
        cycle();
        if (lastError) { logger("SYNC_RECOVERED after=" + lastError); lastError = ""; }
      } catch (e) {
        if (e.message !== lastError) { logger("SYNC_ERROR " + e.message); lastError = e.message; }
      } finally { active = false; }
    };
    attempt();
    logger("SOURCE_SYNC_WATCH_ACTIVE interval=3");
    setInterval(attempt, 3000);
  } else {
    cycle();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error("SOURCE_SYNC_ERROR " + e.message); process.exitCode = 1; }
}

export { allowed, appendLogFile, failureDetail, hash, isUnchanged, persistAt, remoteConflict };
