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
  ...["identity", "dsh", "wlt"].flatMap(owner =>
    ["package.json", "tsconfig.json", "clients"].map(entry => `services/${owner}/${entry}`)),
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
function remoteHashes(paths) {
  if (!paths.length) return new Map();
  for (const rel of paths) if (!allowed(rel)) throw new Error("REMOTE_HASH_PATH_INVALID");
  const payload = JSON.stringify(paths);
  // Inline small lists in the PowerShell command, never through SSH stdin.
  // Larger inventories use a verified SFTP staging file to stay under the
  // Windows command-line limit.
  const inline = Buffer.byteLength(payload, "utf8") <= 2048;
  const token = inline ? "" : crypto.randomUUID();
  const localStage = inline ? "" : path.join(stateDir, "audit-" + token + ".json");
  const remoteStage = inline ? "" :
    path.win32.join(targetRoot, ".source-sync-audit-" + token + ".json");
  const codeParts = [
    "$ErrorActionPreference='Stop'",
    "$ProgressPreference='SilentlyContinue'",
    "$root=" + quote(targetRoot),
    "if($env:COMPUTERNAME -ne 'BTHWANI-DOCKER'){throw 'TARGET_IDENTITY_MISMATCH'}"
  ];
  if (inline) {
    codeParts.push("$paths=ConvertFrom-Json -InputObject " + quote(payload));
  } else {
    const digest = crypto.createHash("sha256").update(payload).digest("hex").toUpperCase();
    codeParts.push(
      "$stage=" + quote(remoteStage),
      "$expected=" + quote(digest),
      "try{",
      "$item=Get-Item -LiteralPath $stage -Force",
      "if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'UNSAFE_AUDIT_STAGE'}",
      "if((Get-FileHash -LiteralPath $stage -Algorithm SHA256).Hash -ne $expected){throw 'AUDIT_STAGE_HASH_MISMATCH'}",
      "$paths=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($stage))"
    );
  }
  codeParts.push(
    "foreach($rel in $paths){",
    "$p=Join-Path $root $rel.Replace('/','\\')",
    "if(Test-Path -LiteralPath $p -PathType Leaf){",
    "$file=Get-Item -LiteralPath $p -Force",
    "if($file.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'UNSAFE_TARGET_FILE'}",
    "$h=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash",
    "}else{$h='MISSING'}",
    "Write-Output ($rel+'|'+$h)",
    "}"
  );
  if (!inline) {
    codeParts.push(
      "}finally{if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Force}}"
    );
  }
  const code = codeParts.join(";");
  if (inline) return parseRemoteHashes(remote(code), paths);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(localStage, payload, { flag: "wx", mode: 0o600 });
  let completed = false;
  try {
    run("scp", [
      "-q", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
      "-o", "ConnectTimeout=6", localStage, targetHost + ":" + remoteStage.replaceAll("\\", "/")
    ], 45000);
    const observed = parseRemoteHashes(remote(code), paths);
    completed = true;
    return observed;
  } finally {
    fs.rmSync(localStage, { force: true });
    if (!completed) {
      try {
        remote("if(Test-Path -LiteralPath " + quote(remoteStage) +
          "){Remove-Item -LiteralPath " + quote(remoteStage) + " -Force}");
      } catch {}
    }
  }
}
function needsReconcile(state, current, currentHead, remoteFiles, currentBranch = state?.branch) {
  if (state && state.branch !== currentBranch) return true;
  if (!isUnchanged(state, current, currentHead)) return true;
  return [...remoteFiles].some(([rel, digest]) =>
    current.has(rel) ? current.get(rel) !== digest : digest !== "MISSING");
}
function appendLogFile(file, message, limit = 1048576) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Rotate by truncating the same descriptor. Never re-open a path after
  // checking it: another process could swap the file in between.
  const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT, 0o600);
  try {
    const size = fs.fstatSync(fd).size;
    if (size > limit) {
      const count = Math.min(size, Math.max(limit, 65536));
      const previous = Buffer.alloc(count);
      let offset = 0;
      while (offset < count) {
        const bytes = fs.readSync(fd, previous, offset, count - offset, size - count + offset);
        if (bytes === 0) throw new Error("SYNC_LOG_READ_SHORT");
        offset += bytes;
      }
      const backup = file + ".previous";
      fs.rmSync(backup, { force: true });
      fs.writeFileSync(backup, previous, { flag: "wx", mode: 0o600 });
      fs.ftruncateSync(fd, 0);
    }
    fs.writeSync(fd, message + "\n", fs.fstatSync(fd).size);
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
      state.target !== targetRoot || typeof state.branch !== "string" || !state.branch ||
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
}
function remoteConflict(actual, desired, previous) {
  return actual !== desired && actual !== "MISSING" && actual !== previous;
}
function buildPublishCode({dest, stage, backup, archive, actual, expected, conflict, root = targetRoot}) {
  const code = [
    "$ErrorActionPreference='Stop'",
    "$root=" + quote(root),
    "$dest=" + quote(dest),
    "$stage=" + quote(stage),
    "$backup=" + quote(backup),
    "$archive=" + quote(archive),
    "$expectedOld=" + quote(actual),
    "$expectedNew=" + quote(expected),
    "$archiveConflict=" + (conflict ? "$true" : "$false"),
    "$part=Split-Path -Parent $dest",
    "while($part -and $part.Length -ge $root.Length){",
    "if(Test-Path -LiteralPath $part){",
    "$item=Get-Item -LiteralPath $part -Force;",
    "if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'UNSAFE_TARGET_DIRECTORY'}",
    "};if($part -ieq $root){break};$part=Split-Path -Parent $part",
    "}",
    "try{",
    "if((Get-FileHash -LiteralPath $stage -Algorithm SHA256).Hash -ne $expectedNew){throw 'STAGE_HASH_MISMATCH'}",
    "New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest)|Out-Null",
    "$current=if(Test-Path -LiteralPath $dest -PathType Leaf){",
    "$item=Get-Item -LiteralPath $dest -Force;",
    "if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'UNSAFE_TARGET_FILE'};",
    "(Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash",
    "}else{'MISSING'}",
    "if($current -ne $expectedOld){throw 'TARGET_CHANGED_DURING_PUBLISH'}",
    "if($archiveConflict){",
    "New-Item -ItemType Directory -Force -Path (Split-Path -Parent $archive)|Out-Null;",
    "Copy-Item -LiteralPath $dest -Destination $archive -ErrorAction Stop;",
    "if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedOld){throw 'TARGET_ARCHIVE_VERIFY_FAILED'}",
    "}",
    "if($current -eq 'MISSING'){[IO.File]::Move($stage,$dest)}else{",
    "[IO.File]::Replace($stage,$dest,$backup);",
    "$displaced=(Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash;",
    "$displacedConflict=$displaced -ne $expectedOld;",
    "if($displacedConflict){",
    "$preserved=$archive+'.replaced-'+[Guid]::NewGuid().ToString('N');",
    "New-Item -ItemType Directory -Force -Path (Split-Path -Parent $preserved)|Out-Null;",
    "[IO.File]::Move($backup,$preserved);",
    "if((Get-FileHash -LiteralPath $preserved -Algorithm SHA256).Hash -ne $displaced){throw 'TARGET_DISPLACED_ARCHIVE_VERIFY_FAILED'}",
    "}",
    "}",
    "if((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $expectedNew){throw 'PUBLISHED_HASH_MISMATCH'}",
    "if(Test-Path -LiteralPath $backup){Remove-Item -LiteralPath $backup -Force}",
    "Write-Output $(if($displacedConflict){'PUBLISHED_PRESERVED'}else{'PUBLISHED'})",
    "}finally{if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Force}}"
  ].join(";");
  return code;
}
function publish(rel, expected, previous, observed) {
  const full = path.join(root, ...rel.split("/"));
  if (hash(full) !== expected) throw new Error("SOURCE_CHANGED_WHILE_READING " + rel);
  const actual = observed ?? remoteHash(rel);
  if (actual === expected) return;
  // The Windows SSH stdin pipe can stall on binary payloads. SFTP-backed scp
  // transports bytes; one SSH invocation verifies and commits the staged copy.
  const dest = destination(rel);
  const stage = path.win32.join(targetRoot, ".source-sync-" + crypto.randomUUID() + ".tmp");
  const backup = dest + ".source-sync-" + crypto.randomUUID() + ".bak";
  const conflict = remoteConflict(actual, expected, previous);
  const archiveRoot = path.win32.join("C:\\Users\\bthwa\\AppData\\Local",
    "BThwani", "Operations", "SourceSync", "conflicts");
  const archive = path.win32.join(archiveRoot,
    new Date().toISOString().replaceAll(":", "-") + "-" + crypto.randomUUID(), ...rel.split("/"));
  const code = buildPublishCode({dest, stage, backup, archive, actual, expected, conflict});
  let committed = false;
  try {
    run("scp", [
      "-q", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
      "-o", "ConnectTimeout=6", full, targetHost + ":" + stage.replaceAll("\\", "/")
    ], 45000);
    if (hash(full) !== expected) throw new Error("SOURCE_CHANGED_WHILE_COPYING " + rel);
    const result = remote(code);
    if (result !== "PUBLISHED" && result !== "PUBLISHED_PRESERVED") {
      throw new Error("REMOTE_PUBLISH_RESPONSE_INVALID " + rel);
    }
    committed = true;
    if (result === "PUBLISHED_PRESERVED") logger("REMOTE_CONCURRENT_EDIT_ARCHIVED " + rel);
  } catch (error) {
    throw new Error("REMOTE_PUBLISH_FAILED " + rel + ": " + error.message);
  } finally {
    if (!committed) {
      // The random staging name is owned solely by this invocation.
      try {
        remote("if(Test-Path -LiteralPath " + quote(stage) +
          "){Remove-Item -LiteralPath " + quote(stage) + " -Force}");
      } catch {}
    }
  }
  if (conflict) logger("REMOTE_DRIFT_ARCHIVED " + rel);
}
function buildManagedDeleteCode({dest, actual, archive, conflict, quarantine, root = targetRoot}) {
  const code = [
    "$ErrorActionPreference='Stop'",
    "$p=" + quote(dest),
    "$root=" + quote(root),
    "$part=Split-Path -Parent $p",
    "while($part -and $part.Length -ge $root.Length){",
    "if(Test-Path -LiteralPath $part){",
    "$parent=Get-Item -LiteralPath $part -Force",
    "if($parent.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'UNSAFE_TARGET_DIRECTORY'}",
    "};if($part -ieq $root){break};$part=Split-Path -Parent $part",
    "}",
    "$quarantine=" + quote(quarantine),
    "$expected=" + quote(actual),
    "$archive=" + quote(archive),
    "$archiveConflict=" + (conflict ? "$true" : "$false"),
    "if(!(Test-Path -LiteralPath $p -PathType Leaf)){throw 'TARGET_CHANGED_DURING_DELETE'}",
    "$item=Get-Item -LiteralPath $p -Force",
    "if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'UNSAFE_TARGET_FILE'}",
    "[IO.File]::Move($p,$quarantine)",
    "try{",
    "$movedItem=Get-Item -LiteralPath $quarantine -Force",
    "if($movedItem.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'UNSAFE_QUARANTINED_FILE'}",
    "$movedHash=(Get-FileHash -LiteralPath $quarantine -Algorithm SHA256).Hash",
    "$preserve=$archiveConflict -or ($movedHash -ne $expected)",
    "if($preserve){",
    "New-Item -ItemType Directory -Force -Path (Split-Path -Parent $archive)|Out-Null",
    "Copy-Item -LiteralPath $quarantine -Destination $archive -ErrorAction Stop",
    "if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $movedHash){throw 'TARGET_ARCHIVE_VERIFY_FAILED'}",
    "}",
    "if(Test-Path -LiteralPath $p){throw 'TARGET_REPLACED_DURING_DELETE'}",
    "Remove-Item -LiteralPath $quarantine -Force",
    "Write-Output $(if($preserve){'DELETED_PRESERVED'}else{'DELETED'})",
    "}catch{",
    "if(Test-Path -LiteralPath $quarantine){",
    "if(!(Test-Path -LiteralPath $p)){[IO.File]::Move($quarantine,$p)}",
    "else{Write-Error ('QUARANTINE_RETAINED '+$quarantine) -ErrorAction Continue}",
    "};throw",
    "}"
  ].join(";");
  return code;
}
function managedDelete(rel, expected, observed) {
  const actual = observed ?? remoteHash(rel);
  if (actual === "MISSING") return;
  const dest = destination(rel);
  const conflict = actual !== expected;
  const archive = path.win32.join("C:\\Users\\bthwa\\AppData\\Local", "BThwani",
    "Operations", "SourceSync", "conflicts",
    new Date().toISOString().replaceAll(":", "-") + "-" + crypto.randomUUID(),
    ...rel.split("/"));
  // Rename within the same directory before checking or removing bytes:
  // an editor's save after the initial hash must not be deleted unarchived.
  const quarantine = dest + ".source-sync-" + crypto.randomUUID() + ".quarantine";
  const code = buildManagedDeleteCode({dest, actual, archive, conflict, quarantine});
  const result = remote(code);
  if (result !== "DELETED" && result !== "DELETED_PRESERVED") {
    throw new Error("REMOTE_DELETE_RESPONSE_INVALID " + rel);
  }
  if (result === "DELETED_PRESERVED") logger("REMOTE_DRIFT_ARCHIVED " + rel);
}
function baseline(current, observed) {
  const checks = ["package.json", "pnpm-lock.yaml", "apps/customer/package.json",
    "apps/merchant/package.json", "apps/captain/package.json", "apps/control-panel/package.json"];
  for (const rel of checks) {
    if (observed.get(rel) !== current.get(rel)) throw new Error("BASELINE_HASH_MISMATCH " + rel);
  }
  const files = {};
  for (const [rel, digest] of current) {
    if (observed.get(rel) === digest) files[rel] = digest;
  }
  logger("BASELINE_PASS pending=" + (current.size - Object.keys(files).length));
  return { version: 1, branch: branch(), host: targetIdentity, target: targetRoot, head: head(), files };
}
const remoteAuditMs = 30_000;
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
let nextRemoteAudit = 0;
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
function reconcile() {
  const currentBranch = branch();
  const currentHead = head();
  const current = inventory();
  const previous = readState();
  const branchTransition = assertCompatibleBranchTransition(previous, current, currentBranch);
  const sourceChanged = branchTransition || !isUnchanged(previous, current, currentHead);
  const auditDue = remoteAuditDue(previous, nextRemoteAudit);
  if (!sourceChanged && !auditDue) return;
  remoteReady();
  const remaining = new Set(current.keys());
  const previousFiles = Object.keys(previous?.files || {});
  const changedPaths = [...current].filter(([rel, digest]) => previous?.files[rel] !== digest)
    .map(([rel]) => rel);
  const removedPaths = previousFiles.filter(rel => !remaining.has(rel));
  const critical = ["pnpm-lock.yaml", ".node-version"];
  const inspected = auditDue ?
    [...new Set([...current.keys(), ...removedPaths])] :
    [...new Set([...changedPaths, ...removedPaths, ...critical])];
  const observed = remoteHashes(inspected);
  if (!needsReconcile(previous, current, currentHead, observed, currentBranch)) {
    if (auditDue) nextRemoteAudit = Date.now() + remoteAuditMs;
    return;
  }
  const state = previous || baseline(current, observed);
  const dependencyChanges = previous ? changedPaths.filter(rel => branchTransitionPins.includes(rel)) : [];
  const files = { ...state.files };
  let changed = 0;
  for (const [rel, digest] of current) {
    if (state.files[rel] === digest && (!observed.has(rel) || observed.get(rel) === digest)) continue;
    publish(rel, digest, state.files[rel], observed.get(rel));
    files[rel] = digest;
    changed++;
    logger("SYNC " + rel);
  }
  for (const [rel, digest] of Object.entries(state.files)) {
    if (current.has(rel)) continue;
    managedDelete(rel, digest, observed.get(rel));
    delete files[rel];
    changed++;
    logger("MANAGED_DELETE " + rel);
  }
  // A checkout can change while the SCP/SSH operations are in progress.
  // Never certify a mixed branch revision in the persisted manifest.
  if (branch() !== currentBranch || head() !== currentHead) {
    throw new Error("SOURCE_REVISION_CHANGED_DURING_SYNC");
  }
  if (changed || state.head !== currentHead || state.branch !== currentBranch) {
    persist({ ...state, branch: currentBranch, files, head: currentHead });
  }
  if (auditDue) nextRemoteAudit = Date.now() + remoteAuditMs;
  if (changed) logger("SYNC_PASS files=" + changed + " head=" + currentHead.slice(0, 12));
  if (dependencyChanges.length) logger("DEPENDENCY_INSTALL_REQUIRED paths=" + dependencyChanges.join(","));
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
  const cycle = () => reconcile();
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
    logger("SOURCE_SYNC_WATCH_ACTIVE interval=1 remoteAuditSeconds=30");
    setInterval(attempt, 1000);
  } else {
    cycle();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error("SOURCE_SYNC_ERROR " + e.message); process.exitCode = 1; }
}

export { buildManagedDeleteCode, buildPublishCode, remoteAuditDue, allowed, appendLogFile, assertCompatibleBranchTransition, branchTransitionPins, failureDetail, hash, isUnchanged, needsReconcile, parseRemoteHashes, persistAt, publish, remoteConflict, remoteHashes };
