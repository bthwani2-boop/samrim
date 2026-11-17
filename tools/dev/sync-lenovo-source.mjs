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
const targetRoot = "C:\\Users\\bthwa\\BThwaniAppRunner\\staging-session04-d469b3ffe778";
const expectedBaseline = "d469b3ffe7788206a3a186e3d48aba8f4bc4b748";
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
const hash = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").toUpperCase();
function allowed(rel) {
  if (typeof rel !== "string" || !rel || rel.includes("\\") ||
      rel.startsWith("/") || rel.includes("//") || rel.includes("\0")) return false;
  const parts = rel.split("/");
  if (parts.some(x => !x || x === "." || x === ".." || /[<>:"|?*]/.test(x) ||
      [...x].some(char => char.codePointAt(0) < 32) ||
      blockedDirs.has(x.toLowerCase()) || secret.test(x))) return false;
  return include.some(x => x === rel || rel.startsWith(x + "/"));
}
function run(which, args, timeout = 20000) {
  const result = spawnSync(exe[which], args, {
    cwd: root, encoding: "utf8", windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024
  });
  if (result.error || result.status !== 0) throw new Error(which + " failure: " +
    (result.error?.message || result.stderr || result.status).slice(0, 250));
  return (result.stdout || "").trim();
}
function remote(code) {
  return run("ssh", [
    "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    "-o", "ConnectTimeout=6", targetHost, "powershell.exe", "-NoProfile",
    "-NonInteractive", "-EncodedCommand", Buffer.from(code, "utf16le").toString("base64")
  ], 30000);
}
function logger(line) {
  fs.mkdirSync(stateDir, { recursive: true });
  if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1048576) {
    fs.rmSync(logFile + ".previous", { force: true });
    fs.renameSync(logFile, logFile + ".previous");
  }
  const message = new Date().toISOString() + " " + line;
  fs.appendFileSync(logFile, message + "\n");
  console.log(message);
}
function head() { return run("git", ["rev-parse", "HEAD"]); }
function branch() { return run("git", ["branch", "--show-current"]); }
function inventory() {
  const raw = run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...include]);
  const files = [...new Set(raw.split("\0").filter(allowed))].sort();
  const found = new Map();
  for (const rel of files) {
    const full = path.join(root, ...rel.split("/"));
    if (!fs.existsSync(full)) continue;
    const st = fs.lstatSync(full);
    if (!st.isFile() || st.isSymbolicLink()) throw new Error("UNSAFE_SOURCE_FILE " + rel);
    found.set(rel, hash(full));
  }
  return found;
}
function readState() {
  if (!fs.existsSync(stateFile)) return null;
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
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
function persist(state) {
  fs.mkdirSync(stateDir, { recursive: true });
  const pending = stateFile + "." + process.pid + ".tmp";
  try {
    fs.writeFileSync(pending, JSON.stringify(state), { flag: "wx" });
    fs.renameSync(pending, stateFile);
  } finally { if (fs.existsSync(pending)) fs.unlinkSync(pending); }
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
function publish(rel, expected) {
  const full = path.join(root, ...rel.split("/"));
  if (!fs.existsSync(full) || hash(full) !== expected) throw new Error("SOURCE_CHANGED_WHILE_READING " + rel);
  if (remoteHash(rel) === expected) return;
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
  if (head() !== "d469b3ffe7788206a3a186e3d48aba8f4bc4b748") throw new Error("BASELINE_HEAD_CHANGED");
  const checks = ["package.json", "pnpm-lock.yaml", "apps/customer/package.json",
    "apps/merchant/package.json", "apps/captain/package.json", "apps/control-panel/package.json"];
  for (const rel of checks) {
    const full = path.join(root, ...rel.split("/"));
    if (remoteHash(rel) !== hash(full)) throw new Error("BASELINE_HASH_MISMATCH " + rel);
  }
  const dirty = new Set(run("git", ["diff", "--name-only", "-z", "HEAD", "--", ...include]).split("\0").filter(Boolean));
  const untracked = new Set(run("git", ["ls-files", "--others", "--exclude-standard", "-z", "--", ...include]).split("\0").filter(Boolean));
  const files = Object.fromEntries([...current].filter(([rel]) => !dirty.has(rel) && !untracked.has(rel)));
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
    publish(rel, digest);
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
  cycle();
  if (process.argv.includes("--watch")) {
    logger("SOURCE_SYNC_WATCH_ACTIVE interval=3");
    let active = false;
    let lastError = "";
    setInterval(() => {
      if (active) return;
      active = true;
      try {
        cycle();
        if (lastError) { logger("SYNC_RECOVERED after=" + lastError); lastError = ""; }
      } catch (e) {
        if (e.message !== lastError) { logger("SYNC_ERROR " + e.message); lastError = e.message; }
      } finally {active = false;}
    }, 3000);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error("SOURCE_SYNC_ERROR " + e.message); process.exitCode = 1; }
}

export { allowed, isUnchanged };
