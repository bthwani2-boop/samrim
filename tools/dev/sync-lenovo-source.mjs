#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
// One-way live-source mirror: BTHWANI D:\samrim -> BTHWANI-DOCKER, verified SSH.
// Uses the existing Lenovo staging runtime and existing Surface scheduled task.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, Worker } from "node:worker_threads";
import { containsLikelySecret } from "../security/verify-secrets.mjs";
import { dirtyPaths, isPreviewGoPath, isSharedRuntimeInput, ownerComposeInputs, ownerReconcilePlan, previewChangeKey } from "./docker/owner-preview-source.mjs";
import { mirrorPathAllowed as allowed, assertCompatibleBranchTransition, assertMirrorPackageManifest, beginRuntimeAttempt, dependencyInputChanges, graphifyPollDue, graphifyRefreshAction, graphifySourceEvent, isDependencyInput, isUnchanged, mirrorCandidatePaths, mirrorPackageName, mirrorSourceRoots, needsReconcile, parseRemoteHashes, remoteAuditDue, remoteConflict, runtimeAttemptPhase, runtimeAuditResult, runtimeBaselineProofDue, runtimeInterruptedStatus, runtimePollAction, runtimeReceiptStatus, sourceCycleDue, watcherReloadAction } from "./sync-lenovo-reconciliation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const targetHost = "bthwani-docker";
const targetIdentity = "BTHWANI-DOCKER";
const targetRoot = "C:\\Users\\bthwa\\BThwaniAppRunner\\source-runtime";
const exe = {
  pwsh: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  git: process.platform === "win32" ? "C:\\Program Files\\Git\\cmd\\git.exe" : "/usr/bin/git",
  ssh: "C:\\Windows\\System32\\OpenSSH\\ssh.exe",
  scp: "C:\\Windows\\System32\\OpenSSH\\scp.exe"
};
const stateDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "BThwani", "Operations", "SourceSync");
const stateFile = path.join(stateDir, "manifest.json");
const logFile = path.join(stateDir, "sync.log");
const sshOptions = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=6"];
const quote = v => "'" + v.replaceAll("'", "''") + "'";
const destination = rel => path.win32.join(targetRoot, ...rel.split("/"));
function readVerifiedFile(file) {
  // One descriptor, with identity readback; do not follow a substituted leaf.
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
  try{
    const opened=fs.fstatSync(fd,{bigint:true});
    let entry;
    try{entry=fs.lstatSync(file,{bigint:true});}
    catch(error){
      if(error.code==="ENOENT")throw new Error("UNSAFE_SOURCE_FILE "+path.relative(root,file));
      throw error;
    }
    if(!opened.isFile()||!entry.isFile()||entry.isSymbolicLink()||
      opened.dev!==entry.dev||opened.ino!==entry.ino)throw new Error("UNSAFE_SOURCE_FILE "+path.relative(root,file));
    return fs.readFileSync(fd);
  }finally{fs.closeSync(fd);}
}
function digestBytes(bytes){return crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase();}
function hash(file){return digestBytes(readVerifiedFile(file));}
function mirrorFile(rel) {
  if(!allowed(rel))throw new Error("MIRROR_PATH_INVALID");
  const parts=rel.split("/");
  const full=path.join(root,...parts);
  // A tracked file can have an untracked junction as its ancestor on Windows.
  // Check the source directory chain before reading any bytes.
  let parent=root;
  for(const part of parts.slice(0,-1)){
    parent=path.join(parent,part);
    const info=fs.lstatSync(parent);
    if(!info.isDirectory()||info.isSymbolicLink())throw new Error("UNSAFE_SOURCE_DIRECTORY "+path.relative(root,parent));
  }
  const bytes=readVerifiedFile(full);
  if(!bytes.includes(0)&&containsLikelySecret(bytes.toString("utf8")))throw new Error("MIRROR_SECRET_MARKER "+rel);
  return {bytes,digest:digestBytes(bytes)};
}
function failureDetail(result) {
  return String(result.error?.message || result.stderr || result.status).slice(0, 250);
}
function run(which, args, timeout = 20000, input) {
  const result = spawnSync(exe[which], args, {
    cwd: root, encoding: "utf8", windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024, input
  });
  if (result.error || result.status !== 0) throw new Error(which + " failure: " + failureDetail(result));
  return (result.stdout || "").trim();
}
function remoteInvocation(code) {
  const encoded = Buffer.from(code, "utf16le").toString("base64");
  const args = [
    "-T", ...sshOptions, targetHost, "pwsh.exe", "-NoProfile",
    "-NonInteractive", "-EncodedCommand"
  ];
  if (encoded.length <= 4500) return { args: [...args, encoded] };
  // Same bounded text-line transport as Invoke-Lenovo in dev.ps1.
  // File bytes still travel by SCP, never as binary stdin.
  const bootstrap = '$data=[Console]::In.ReadLine(); if(!$data){throw "SSH_STDIN_EMPTY"}; $cmd=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($data)); & ([ScriptBlock]::Create($cmd))';
  return { args: [...args, Buffer.from(bootstrap, "utf16le").toString("base64")],
    input: Buffer.from(code, "utf8").toString("base64") + "\n" };
}
function remote(code) {
  const {args, input} = remoteInvocation(code);
  return run("ssh", args, 30000, input);
}
function copyToRemote(local, remotePath) {
  run("scp", ["-q", ...sshOptions, local, targetHost + ":" + remotePath.replaceAll("\\", "/")], 45000);
}
function remoteHashes(paths) {
  if (!paths.length) return new Map();
  for (const rel of paths) if (!allowed(rel)) throw new Error("REMOTE_HASH_PATH_INVALID");
  const payload = JSON.stringify(paths);
  // Inline small lists in the PowerShell command; file bytes use SCP.
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
    copyToRemote(localStage, remoteStage);
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
function inventory(filter=()=>true) {
  const raw=run("git",["ls-files","--cached","--others","--exclude-standard","-z","--",...mirrorSourceRoots]);
  const paths=mirrorCandidatePaths(raw.split("\0"));
  const found=new Map(),admittedPackages=new Set();
  // Read actual package declarations first. A deleted package is absent;
  // a surviving package with no admitted manifest must not be partly mirrored.
  for(const rel of paths){
    const name=mirrorPackageName(rel);
    if(!name||rel!=="packages/"+name+"/package.json")continue;
    try{
      const file=mirrorFile(rel);
      assertMirrorPackageManifest(name,file.bytes);
      admittedPackages.add(name);
      if(filter(rel))found.set(rel,file.digest);
    }catch(error){if(error.code!=="ENOENT")throw error;}
  }
  for(const rel of paths){
    if(found.has(rel)||!filter(rel))continue;
    try{
      const file=mirrorFile(rel);
      const name=mirrorPackageName(rel);
      if(name&&!admittedPackages.has(name))throw new Error("MIRROR_PACKAGE_MANIFEST_REQUIRED "+name);
      found.set(rel,file.digest);
    }catch(error){if(error.code!=="ENOENT")throw error;}
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
function verifyManifest() {
  const currentHead = head();
  const currentBranch = branch();
  assertCompatibleBranchTransition(null, null, currentBranch);
  const state = readState();
  const mirrorHead = /^[a-f0-9]{40}$/.test(state?.head) ? state.head : "UNVERIFIED";
  const current = mirrorHead === currentHead && state.branch === currentBranch &&
    isUnchanged(state, inventory(), currentHead) && head() === currentHead && branch() === currentBranch;
  return { head: currentHead, mirrorHead, current };
}
function verifyDependencyInputs() {
  const currentBranch=branch();
  assertCompatibleBranchTransition(null,null,currentBranch);
  const state=readState();
  const files=inventory(isDependencyInput);
  const mirrored=Object.entries(state?.files||{}).filter(([rel])=>isDependencyInput(rel));
  const current=Boolean(state && state.branch===currentBranch && branch()===currentBranch &&
    mirrored.length===files.size && [...files].every(([rel,digest])=>state.files[rel]===digest));
  return {current,files:Object.fromEntries(files)};
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
  return remoteHashes([rel]).get(rel);
}
function remoteReady() {
  if ((process.env.COMPUTERNAME || "").toUpperCase() !== "BTHWANI" ||
      path.win32.normalize(root).toLowerCase() !== "d:\\samrim") {
    throw new Error("SOURCE_SYNC_MUST_RUN_ON_SURFACE_CANONICAL");
  }
}
const dependencyInputMutex = "Global\\BThwaniDependencyInputsV1";
// The installer holds this same Lenovo mutex until its receipt and rollback
// are settled. Ordinary source files never take the dependency mutex.
function withDependencyInputMutex(code, name, receiptPath, processName = "pnpm") {
  if (!name) return code;
  const receipt = receiptPath ? quote(receiptPath) : "(Join-Path $env:LOCALAPPDATA 'BThwani\\Operations\\SourceSync\\dependency-reconcile.json')";
  return [
    "$ErrorActionPreference='Stop'",
    "$dependencyInputLock=[Threading.Mutex]::new($false," + quote(name) + ")",
    "$dependencyInputHeld=$false",
    "try{",
    // WaitOne grants ownership even on abandonment; release it but never mutate
    // on that acquisition. A subsequent attempt must prove the durable state.
    "try{$dependencyInputHeld=$dependencyInputLock.WaitOne(0)}catch [Threading.AbandonedMutexException]{$dependencyInputHeld=$true;Write-Output 'DEPENDENCY_INPUT_RECOVERY_REQUIRED';return}",
    "if(!$dependencyInputHeld){Write-Output 'DEPENDENCY_INPUT_BUSY';return}",
    "try{",
    "$dependencyReceipt=" + receipt,
    "if(Test-Path -LiteralPath $dependencyReceipt -ErrorAction Stop){",
    "$dependencyLast=Get-Content -LiteralPath $dependencyReceipt -Raw -ErrorAction Stop|ConvertFrom-Json -AsHashtable -ErrorAction Stop",
    "if($dependencyLast -isnot [Collections.IDictionary] -or $dependencyLast.version -ne 1 -or $dependencyLast.key -isnot [string] -or $dependencyLast.key -notmatch '^[A-F0-9]{64}$' -or $dependencyLast.status -isnot [string] -or $dependencyLast.status -cnotin @('pass','failed')){Write-Output 'DEPENDENCY_INPUT_RECOVERY_REQUIRED';return}",
    "}",
    "$dependencyProcesses=@([Diagnostics.Process]::GetProcessesByName(" + quote(processName) + "))",
    "try{if($dependencyProcesses.Count){Write-Output 'DEPENDENCY_INPUT_BUSY';return}}finally{foreach($process in $dependencyProcesses){$process.Dispose()}}",
    "}catch{Write-Output 'DEPENDENCY_INPUT_RECOVERY_REQUIRED';return}",
    code,
    "}finally{if($dependencyInputHeld){$dependencyInputLock.ReleaseMutex()};$dependencyInputLock.Dispose()}"
  ].join(";");
}
// Keep the same reparse-point protection for publication and managed deletion.
function targetParentChecks(target) {
  return [
    "$part=Split-Path -Parent " + target,
    "while($part -and $part.Length -ge $root.Length){",
    "if(Test-Path -LiteralPath $part){",
    "$parent=Get-Item -LiteralPath $part -Force",
    "if($parent.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'UNSAFE_TARGET_DIRECTORY'}",
    "};if($part -ieq $root){break};$part=Split-Path -Parent $part",
    "}"
  ];
}
function conflictArchive(rel) {
  return path.win32.join("C:\\Users\\bthwa\\AppData\\Local", "BThwani",
    "Operations", "SourceSync", "conflicts",
    new Date().toISOString().replaceAll(":", "-") + "-" + crypto.randomUUID(),
    ...rel.split("/"));
}
function buildPublishCode({dest, stage, backup, archive, actual, expected, conflict, root = targetRoot, dependencyMutex, dependencyReceipt, dependencyProcessName}) {
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
    ...targetParentChecks("$dest"),
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
  return withDependencyInputMutex(code, dependencyMutex, dependencyReceipt, dependencyProcessName);
}
function publish(rel, expected, previous, observed) {
  const full = path.join(root, ...rel.split("/"));
  if (mirrorFile(rel).digest !== expected) throw new Error("SOURCE_CHANGED_WHILE_READING " + rel);
  const actual = observed ?? remoteHash(rel);
  if (actual === expected) return true;
  // The Windows SSH stdin pipe can stall on binary payloads. SFTP-backed scp
  // transports bytes; one SSH invocation verifies and commits the staged copy.
  const dest = destination(rel);
  const stage = path.win32.join(targetRoot, ".source-sync-" + crypto.randomUUID() + ".tmp");
  const backup = dest + ".source-sync-" + crypto.randomUUID() + ".bak";
  const conflict = remoteConflict(actual, expected, previous);
  const archive = conflictArchive(rel);
  const code = buildPublishCode({dest, stage, backup, archive, actual, expected, conflict, dependencyMutex: isDependencyInput(rel) ? dependencyInputMutex : undefined});
  let committed = false;
  try {
    copyToRemote(full, stage);
    if (mirrorFile(rel).digest !== expected) throw new Error("SOURCE_CHANGED_WHILE_COPYING " + rel);
    const result = remote(code);
    if (["DEPENDENCY_INPUT_BUSY", "DEPENDENCY_INPUT_RECOVERY_REQUIRED"].includes(result)) return false;
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
  return true;
}
function buildManagedDeleteCode({dest, actual, archive, conflict, quarantine, root = targetRoot, dependencyMutex, dependencyReceipt, dependencyProcessName}) {
  const code = [
    "$ErrorActionPreference='Stop'",
    "$p=" + quote(dest),
    "$root=" + quote(root),
    ...targetParentChecks("$p"),
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
  return withDependencyInputMutex(code, dependencyMutex, dependencyReceipt, dependencyProcessName);
}
function managedDelete(rel, expected, observed) {
  const actual = observed ?? remoteHash(rel);
  if (actual === "MISSING") return true;
  const dest = destination(rel);
  const conflict = actual !== expected;
  const archive = conflictArchive(rel);
  // Rename within the same directory before checking or removing bytes:
  // an editor's save after the initial hash must not be deleted unarchived.
  const quarantine = dest + ".source-sync-" + crypto.randomUUID() + ".quarantine";
  const code = buildManagedDeleteCode({dest, actual, archive, conflict, quarantine, dependencyMutex: isDependencyInput(rel) ? dependencyInputMutex : undefined});
  const result = remote(code);
  if (["DEPENDENCY_INPUT_BUSY", "DEPENDENCY_INPUT_RECOVERY_REQUIRED"].includes(result)) return false;
  if (result !== "DELETED" && result !== "DELETED_PRESERVED") {
    throw new Error("REMOTE_DELETE_RESPONSE_INVALID " + rel);
  }
  if (result === "DELETED_PRESERVED") logger("REMOTE_DRIFT_ARCHIVED " + rel);
  return true;
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
let nextRemoteAudit = 0;
let dependencySyncDeferred = false;
let sourcePending = true;
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
  const dependencyChanges = dependencyInputChanges(previous,current);
  const files = { ...state.files };
  let changed = 0;
  let deferred = false;
  for (const [rel, digest] of current) {
    if (state.files[rel] === digest && (!observed.has(rel) || observed.get(rel) === digest)) continue;
    if ((dependencyChild && isDependencyInput(rel)) || publish(rel, digest, state.files[rel], observed.get(rel)) === false) {
      deferred = true;
      continue;
    }
    files[rel] = digest;
    changed++;
    logger("SYNC " + rel);
  }
  for (const [rel, digest] of Object.entries(state.files)) {
    if (current.has(rel)) continue;
    if ((dependencyChild && isDependencyInput(rel)) || managedDelete(rel, digest, observed.get(rel)) === false) {
      deferred = true;
      continue;
    }
    delete files[rel];
    changed++;
    logger("MANAGED_DELETE " + rel);
  }
  // A checkout can change while the SCP/SSH operations are in progress.
  // Never certify a mixed branch revision in the persisted manifest.
  if (branch() !== currentBranch || head() !== currentHead) {
    throw new Error("SOURCE_REVISION_CHANGED_DURING_SYNC");
  }
  // Do not certify a newer revision while dependency inputs are deferred.
  const publishedHead = deferred ? state.head : currentHead;
  const publishedBranch = deferred ? state.branch : currentBranch;
  if (changed || state.head !== publishedHead || state.branch !== publishedBranch) {
    persist({ ...state, branch: publishedBranch, files, head: publishedHead });
  }
  if (auditDue) nextRemoteAudit = Date.now() + remoteAuditMs;
  if (changed) logger((deferred ? "SYNC_PARTIAL" : "SYNC_PASS") + " files=" + changed + " head=" + publishedHead.slice(0, 12));
  if (deferred !== dependencySyncDeferred) {
    logger(deferred ? "DEPENDENCY_SYNC_DEFERRED install active or recovery requires readback" : "DEPENDENCY_SYNC_RESUMED");
    dependencySyncDeferred = deferred;
  }
  if (!deferred && dependencyChanges.length) logger("DEPENDENCY_INSTALL_REQUIRED paths=" + dependencyChanges.join(","));
}
// Reuse the existing scheduled watcher; no second watcher or Docker daemon.
// Backend source is built from Surface, not copied into the app-only mirror.
const runtimeScope = [
  "services/identity", "services/dsh", "services/wlt", ".go-version",
  ...ownerComposeInputs, "tools/dev/docker/reconcile-owner-runtime.mjs", "tools/dev/docker/compose-runtime-transition.mjs", "tools/dev/docker/owner-baseline-transition.mjs", "tests/infra/verify-isolated-postgres.ps1", "tools/dev/provision-wlt-test-db.ps1",
  "tools/dev/docker/owner-preview-source.mjs", "tools/security/verify-secrets.mjs",
  "tools/dev/check-go.mjs", "tools/dev/dev.ps1", "tools/dev/dev-resource-admission.ps1", "tools/dev/sync-lenovo-source.mjs", "tools/dev/sync-lenovo-reconciliation.mjs"
];
const runtimeOptIn = path.join(stateDir, "runtime-reconcile.enabled");
const runtimeStateFile = path.join(stateDir, "runtime-reconcile.json");
const runtimeReceiptFile = path.join(stateDir, "runtime-reconcile.receipt.json");
let runtimeChild = null;
let dependencyChild = null;
let nextRuntimeAudit = 0;
let runtimeNotice = "";
function runtimeLogOnce(message) {
  if (message !== runtimeNotice) { logger(message); runtimeNotice = message; }
}
function runtimeState() {
  if (!fs.existsSync(runtimeStateFile)) return null;
  const v = JSON.parse(fs.readFileSync(runtimeStateFile, "utf8"));
  if (v.version !== 1 || !/^[a-f0-9]{64}$/.test(v.key) ||
      !["running","uncertain","blocked","retry","pass","review"].includes(v.status)) throw new Error("RUNTIME_ATTEMPT_STATE_INVALID");
  return v;
}
let nextDependencyAudit=0;
let dependencyKey="";
let dependencyNotice="";
function pollAppDependencies() {
  if(dependencyChild)return;
  const state=readState();
  if(!state||state.branch==="main"||state.branch.startsWith("archive/"))return;
  const paths=dependencyInputChanges({files:{}},new Map(Object.entries(state.files)));
  const key=crypto.createHash("sha256").update(JSON.stringify(paths.map(p=>[p,state.files[p]]))).digest("hex");
  if(key===dependencyKey&&Date.now()<nextDependencyAudit)return;
  if(run("git",["status","--porcelain","--","tools/dev/dev.ps1","tools/dev/dev-resource-admission.ps1","tools/dev/sync-lenovo-source.mjs","tools/dev/sync-lenovo-reconciliation.mjs"]))return;
  dependencyKey=key;
  nextDependencyAudit=Date.now()+60_000;
  const child=spawn(exe.pwsh,["-NoProfile","-File",path.join(root,"tools","dev","dev.ps1"),"Apps","reconcile","-Apply","-Automatic"],{cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  dependencyChild=child;
  let output="",errors="",settled=false;
  child.stdout.on("data",chunk=>{output=(output+chunk.toString()).slice(-65536);});
  child.stderr.on("data",chunk=>{errors=(errors+chunk.toString()).slice(-65536);});
  const finish=(code)=>{
    if(settled)return;settled=true;dependencyChild=null;sourcePending=true;
    const result=code===0&&output.includes("APP_DEPENDENCY_RECONCILE_PASS")?"DEPENDENCY_RECONCILE_PASS":
      code===0&&output.includes("APP_DEPENDENCY_CURRENT")?"DEPENDENCY_CURRENT":
      "DEPENDENCY_RECONCILE_BLOCKED "+(errors.match(/DEPENDENCY_[A-Z_]+|APP_SOURCE_SYNC_NOT_CURRENT|DEV_RESOURCE_BUSY|DEV_RESOURCE_RECOVERY_REQUIRED/i)?.[0]||"inspect unified dev log");
    if(result!==dependencyNotice){logger(result);dependencyNotice=result;}
  };
  child.on("error",()=>finish(1));
  child.on("close",code=>finish(code));
}
function launchRuntimeAttempt({key,attempt,args,recovery=false}) {
  nextRuntimeAudit=Date.now()+60_000;
  logger((recovery?"RUNTIME_SAFE_RECOVERY_STARTED":"RUNTIME_RECONCILE_STARTED")+" key="+key.slice(0,12));
  const child=spawn(exe.pwsh,["-NoProfile","-File",path.join(root,"tools","dev","dev.ps1"),"Docker","reconcile",...args],{
    cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"],
    env:recovery?process.env:{...process.env,BTHWANI_RUNTIME_ATTEMPT_KEY:key,BTHWANI_RUNTIME_ATTEMPT_ID:attempt}
  });
  runtimeChild=child;
  let output="",settled=false;
  child.stdout.on("data",chunk=>{output=(output+chunk.toString()).slice(-65536);});
  child.stderr.resume();
  const finish=()=>{
    if(settled)return;
    settled=true;runtimeChild=null;sourcePending=true;
    nextRuntimeAudit=Date.now()+60_000;
    try{
      const saved=runtimeState();
      if(saved?.key!==key||saved?.attempt!==attempt)throw new Error("RUNTIME_ATTEMPT_MISMATCH");
      const status=runtimeInterruptedStatus(runtimeStateFile,runtimeReceiptFile);
      persistAt(runtimeStateFile,{version:1,key,attempt,status});
      for(const line of output.split(/\r?\n/)){
        if(/^(?:dsh|identity|wlt) RUNTIME=BLOCKED revision=[a-f0-9]{40} reason=[A-Z_:a-z]+$/.test(line)||
           /^BASELINE_PROOF_PASS HEAD=[a-f0-9]{40} OWNERS=[a-z,]+ CUTOVER=ELIGIBLE_IF_COMPATIBLE$/.test(line))logger(line);
      }
      runtimeLogOnce("RUNTIME_RECONCILE_"+status.toUpperCase()+" key="+key.slice(0,12));
    }catch{runtimeLogOnce("RUNTIME_UPDATE_BLOCKED attempt state could not be persisted");}
  };
  child.on("error",finish);
  child.on("close",finish);
}

function pollOwnerRuntime() {
  if (runtimeChild || !fs.existsSync(runtimeOptIn)) return;
  const optIn=fs.readFileSync(runtimeOptIn,"utf8").trim();
  const preview=optIn==="isolated-owner-go-preview-v2";
  if(!preview && optIn!=="isolated-committed-owner-images-v1")throw new Error("RUNTIME_OPT_IN_INVALID");
  remoteReady();
  const currentBranch=branch();
  if(!currentBranch||currentBranch==="main"||currentBranch.startsWith("archive/")){
    runtimeLogOnce("RUNTIME_UPDATE_BLOCKED branch");return;
  }
  const changed=dirtyPaths(root,runtimeScope);
  let last=runtimeState();
  const recovered=last&&runtimeReceiptStatus(runtimeStateFile,runtimeReceiptFile);
  if(recovered){
    last={...last,status:recovered};
    persistAt(runtimeStateFile,last);
    runtimeLogOnce("RUNTIME_RECONCILE_RECOVERED key="+last.key.slice(0,12));
    nextRuntimeAudit=Date.now()+60_000;
  }
  if(last&&["running","uncertain"].includes(last.status)){
    // A proven stable boundary does not depend on desired source. Only the
    // recovery implementation must be committed. The existing Docker lease
    // and orphan check establish that the previous writer is gone.
    if(runtimeAttemptPhase(runtimeStateFile,runtimeReceiptFile)!=="ready"){
      runtimeLogOnce("RUNTIME_UPDATE_BLOCKED previous attempt needs reconciliation");return;
    }
    const recoveryInputs=["tools/dev/dev.ps1","tools/dev/dev-resource-admission.ps1","tools/dev/docker/reconcile-owner-runtime.mjs","tools/dev/sync-lenovo-source.mjs","tools/dev/sync-lenovo-reconciliation.mjs"];
    if(changed.some(p=>recoveryInputs.includes(p))){
      runtimeLogOnce("RUNTIME_UPDATE_PENDING_REVIEW (recovery input)");return;
    }
    if(Date.now()>=nextRuntimeAudit)
      launchRuntimeAttempt({key:last.key,attempt:last.attempt,args:["-RecoverRuntimeAttempt",last.key,"-Automatic"],recovery:true});
    return;
  }
  const dirty=changed.some(isSharedRuntimeInput);
  if(dirty){runtimeLogOnce("RUNTIME_UPDATE_PENDING_REVIEW (shared runtime input)");return;}
  const eligible=ownerReconcilePlan({changed,committed:{},preview,captain:false}).eligible;
  const go=changed.filter(p=>isPreviewGoPath(p)&&eligible.some(o=>p.startsWith("services/"+o+"/")));
  const key=crypto.createHash("sha256").update(run("git",["ls-tree","HEAD","--",...runtimeScope])).update("\0").update(JSON.stringify(changed)).update(previewChangeKey(root,go)).update(optIn).digest("hex");
  if(last?.key===key&&last.status==="blocked"){
    runtimeLogOnce("RUNTIME_UPDATE_BLOCKED previous attempt needs reconciliation");return;
  }
  const action=runtimePollAction({enabled:true,dirty,active:false,key,last,now:Date.now(),nextAudit:nextRuntimeAudit});
  if(!action)return;
  if(action==="audit"){
    // Reuse the native owner's read-only CLI, not the mutation launcher or a
    // second watcher. No attempt receipt, lifecycle lock or transcript for idle audits.
    const head=run("git",["rev-parse","HEAD"]);
    const child=spawn(process.execPath,[path.join(root,"tools","dev","docker","reconcile-owner-runtime.mjs"),"--check"],{
      cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"],
      env:{...process.env,Path:path.dirname(exe.ssh)+";"+process.env.Path}
    });
    runtimeChild=child;
    let output="",settled=false;
    child.stdout.on("data",chunk=>{output=(output+chunk.toString()).slice(-65536);});
    child.stderr.resume();
    const finish=(code,signal)=>{
      if(settled)return;settled=true;runtimeChild=null;sourcePending=true;
      nextRuntimeAudit=Date.now()+60_000;
      try{
        const saved=runtimeState();
        if(saved?.key!==key||saved?.attempt!==last?.attempt||saved?.status!==last?.status)throw new Error("RUNTIME_ATTEMPT_MISMATCH");
        const outcome=runtimeAuditResult(code,signal,output,head,eligible);
        if(outcome==="apply"){
          persistAt(runtimeStateFile,{...saved,status:"retry"});
          nextRuntimeAudit=0;
        }else if(outcome==="pass"||outcome==="review"){
          if(saved.status!==outcome)persistAt(runtimeStateFile,{...saved,status:outcome});
        }
        runtimeLogOnce("RUNTIME_AUDIT_"+outcome.toUpperCase()+" key="+key.slice(0,12));
      }catch{runtimeLogOnce("RUNTIME_AUDIT_BLOCKED state changed");}
    };
    child.on("error",()=>finish(1,null));
    child.on("close",finish);
    return;
  }
  const attempt=crypto.randomUUID();
  beginRuntimeAttempt(runtimeStateFile,runtimeReceiptFile,key,attempt);
  launchRuntimeAttempt({key,attempt,args:["-Apply",...(preview?["-Preview"]:[]),...(runtimeBaselineProofDue(key,last)?["-PrepareBaseline"]:[])]});
}
// Same process as the existing source mirror. The native Graphify runner
// remains the exclusive index writer; the event subscription only schedules it.
const graphOptIn = path.join(stateDir,"graphify-reconcile.enabled");
let graphChild = null;
let nextGraphAudit = 0;
let graphDirtySince = null;
let graphLastEvent = 0;
let graphNotice = "";
let sourceEvents = null;
let nextSourceEventRetry = 0;
let sourceEventNotice = '';
function graphLogOnce(message) {
  if(message!==graphNotice){logger(message);graphNotice=message;}
}
function signalSourceChange(name,now=Date.now()) {
  const rel=name ? String(name).replaceAll("\\","/") : null;
  // Ignore generated artifacts and internal Git writes. Git ref events and
  // unknown filenames wake the source cycle conservatively.
  const relevant=graphifySourceEvent(rel) || rel===".git/packed-refs";
  if(!relevant)return;
  sourcePending=true;
  if(graphifySourceEvent(rel)){
    graphDirtySince ??= now;
    graphLastEvent=now;
  }
}
function sourceEventLog(message) {
  if(message!==sourceEventNotice){logger(message);sourceEventNotice=message;}
}
function startSourceEvents() {
  if(sourceEvents || Date.now()<nextSourceEventRetry)return;
  nextSourceEventRetry=Date.now()+30_000;
  const degraded=()=>{
    sourceEvents?.close();sourceEvents=null;
    sourcePending=true;
    sourceEventLog("SOURCE_EVENTS_DEGRADED periodic audit remains active");
  };
  try{
    sourceEvents=fs.watch(root,{recursive:true},(_event,name)=>signalSourceChange(name));
    sourceEvents.on("error",degraded);
    sourcePending=true;
    sourceEventLog("SOURCE_EVENTS_ACTIVE");
  }catch{degraded();}
}
function pollGraphify() {
  if(!fs.existsSync(graphOptIn))return;
  if(!graphifyPollDue({now:Date.now(),dirtySince:graphDirtySince,lastEvent:graphLastEvent,nextAudit:nextGraphAudit,busy:Boolean(graphChild)}))return;
  nextGraphAudit=Date.now()+30_000;
  graphDirtySince=null;
  if(fs.readFileSync(graphOptIn,"utf8").trim()!=="local-graphify-reconcile-v1"){
    graphLogOnce("GRAPHIFY_RECONCILE_BLOCKED invalid opt-in");return;
  }
  if(process.env.COMPUTERNAME?.toUpperCase()!=="BTHWANI" || root.toLowerCase()!=="d:\\samrim"){
    graphLogOnce("GRAPHIFY_RECONCILE_BLOCKED wrong source checkout");return;
  }
  // Never execute a runner or authority file being edited by another session.
  const runnerUnderEdit=()=>Boolean(run("git",["status","--porcelain","--","tools/dev/graphify-local.mjs","AGENTS.md"]));
  if(runnerUnderEdit()){
    graphLogOnce("GRAPHIFY_RECONCILE_DEFERRED runner or authority under edit");return;
  }
  const runner=path.join(root,"tools","dev","graphify-local.mjs");
  const launch=(action,done)=>{
    const child=spawn(process.execPath,[runner,action],{cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    graphChild=child;
    let out="",settled=false;
    child.stdout.on("data",chunk=>{out=(out+chunk.toString()).slice(-65536);});
    child.stderr.resume(); // no raw native diagnostics in shared logs
    const finish=(code,signal)=>{
      if(settled)return;
      settled=true;graphChild=null;
      nextGraphAudit=Date.now()+30_000;
      try{done(code,signal,out);}catch{graphLogOnce("GRAPHIFY_RECONCILE_BLOCKED preflight or runner failure");}
    };
    child.on("error",()=>finish(-1,null));
    child.on("close",finish);
  };
  launch("status",(code,signal,out)=>{
    if(signal || ![0,2].includes(code)){
      graphLogOnce("GRAPHIFY_RECONCILE_BLOCKED status failed");return;
    }
    let state;
    try{state=JSON.parse(out);}catch{
      graphLogOnce("GRAPHIFY_RECONCILE_DEFERRED status unavailable or index locked");return;
    }
    const action=graphifyRefreshAction(state);
    if(action==="current"){graphLogOnce("GRAPHIFY_RECONCILE_CURRENT");return;}
    if(action==="busy"){graphLogOnce("GRAPHIFY_RECONCILE_DEFERRED existing refresh");return;}
    if(action==="deferred"){graphLogOnce("GRAPHIFY_RECONCILE_DEFERRED unsafe untracked source");return;}
    if(action!=="refresh" || state.branch?.startsWith("archive/")){
      graphLogOnce("GRAPHIFY_RECONCILE_BLOCKED index provenance");return;
    }
    if(runnerUnderEdit()){
      graphLogOnce("GRAPHIFY_RECONCILE_DEFERRED runner or authority under edit");return;
    }
    if(!fs.existsSync(graphOptIn))return;
    const started=Date.now();
    graphLogOnce("GRAPHIFY_RECONCILE_STARTED");
    launch("sync",(result,terminated)=>{
      if(result!==0 || terminated){
        graphLogOnce("GRAPHIFY_RECONCILE_RETRY native refresh not verified");return;
      }
      launch("status",(verified,interrupted,output)=>{
        let current;
        try{current=JSON.parse(output);}catch{}
        if(verified===0 && !interrupted && graphifyRefreshAction(current)==="current"){
          logger("GRAPHIFY_RECONCILE_PASS elapsedMs="+(Date.now()-started));
          graphNotice="GRAPHIFY_RECONCILE_CURRENT";
        }else{
          graphLogOnce("GRAPHIFY_RECONCILE_RETRY source advanced or index not verified");
        }
      });
    });
  });
}
// Verification is a read-only Git operation and runs on both CI and Surface.
// Only the canonical Surface process may enter the write-capable watch loop.
export function parseMirrorCommand(args) {
  if (args.length === 1 && ["--watch", "--verify-manifest", "--verify-dependency-inputs"].includes(args[0])) {
    return { action: args[0] };
  }
  if (args.length === 2 && args[0] === "--check-path" && args[1]) {
    return { action: args[0], name: args[1] };
  }
  throw new Error("USAGE --watch | --verify-manifest | --verify-dependency-inputs | --check-path <path>");
}
function main(command) {
  switch (command.action) {
    case "--verify-dependency-inputs":
      console.log(JSON.stringify(verifyDependencyInputs()));
      return;
    case "--verify-manifest":
      console.log(JSON.stringify(verifyManifest()));
      return;
    case "--check-path":
      console.log((allowed(command.name) ? "ACCEPT " : "REJECT ") + command.name);
      process.exitCode = allowed(command.name) ? 0 : 2;
      return;
    case "--watch":
      remoteReady();
      if (!fs.existsSync(path.join(root, "AGENTS.md"))) throw new Error("CANONICAL_SOURCE_MISSING");
      break;
    default:
      throw new Error("SOURCE_SYNC_COMMAND_INVALID");
  }
  const cycle = () => reconcile();
    let active = false;
    let lastError = "";
    const watcherInputs = [
      "tools/dev/sync-lenovo-source.mjs", "tools/dev/sync-lenovo-reconciliation.mjs",
      "tools/dev/docker/owner-preview-source.mjs", "tools/security/verify-secrets.mjs",
    ];
    const watcherDigest = () => crypto.createHash("sha256")
      .update(watcherInputs.map(rel=>hash(path.join(root,rel))).join("\0")).digest("hex");
    const loaded = watcherDigest();
    let reloadNotice = "";
    let nextReloadAudit = 0;
    let reloadAction = "current";
    let nextSourceCycle = 0;
    const attempt = () => {
      if (active) return;
      // Drain every child before returning a reload request to the same
      // task-owned process. Never run two source watchers concurrently.
      if (Date.now()>=nextReloadAudit || reloadAction==="drain") {
        nextReloadAudit=Date.now()+5_000;
        try {
          const current=watcherDigest();
          reloadAction=watcherReloadAction({loaded,current,
            dirty:Boolean(run("git",["status","--porcelain","--",...watcherInputs])),
            busy:Boolean(runtimeChild||dependencyChild||graphChild)});
        } catch {
          reloadAction="defer";
        }
        if(reloadAction!==reloadNotice){
          reloadNotice=reloadAction;
          if(reloadAction!=="current")logger("SOURCE_SYNC_WATCH_RELOAD_"+reloadAction.toUpperCase());
        }
      }
      if(reloadAction==="drain")return;
      if(reloadAction==="reload"){
        clearInterval(timer);
        sourceEvents?.close();sourceEvents=null;
        process.exitCode=75; // Only this worker exits; its parent reloads the committed code.
        return;
      }
      startSourceEvents();
      try { pollGraphify(); } catch { graphLogOnce("GRAPHIFY_RECONCILE_BLOCKED preflight"); }
      if(!sourceCycleDue({pending:sourcePending,now:Date.now(),nextAudit:nextSourceCycle}))return;
      active = true;
      sourcePending=false;
      try {
        cycle();
        try { pollAppDependencies(); } catch (e) { logger("DEPENDENCY_RECONCILE_BLOCKED "+e.message); }
        try { pollOwnerRuntime(); } catch (e) { runtimeLogOnce("RUNTIME_UPDATE_BLOCKED "+e.message); }
        if (lastError) { logger("SYNC_RECOVERED after=" + lastError); lastError = ""; }
        nextSourceCycle=Math.min(nextRemoteAudit,Date.now()+(dependencySyncDeferred?1000:remoteAuditMs));
      } catch (e) {
        nextSourceCycle=Date.now()+5000;
        if (e.message !== lastError) { logger("SYNC_ERROR " + e.message); lastError = e.message; }
      } finally { active = false; }
    };
    const timer=setInterval(attempt, 1000);
    logger("SOURCE_SYNC_WATCH_ACTIVE trigger=events timerSeconds=1 remoteAuditSeconds=30 watcherDigest="+loaded.slice(0,12));
    attempt();
}
// Task Scheduler continues to own exactly one Node process. A fresh worker
// loads the entire module graph; no stale ESM imports survive a planned reload.
// The previous worker must exit before another starts, including on failure.
export function watchInProcess(entry = new URL(import.meta.url)) {
  return new Promise((resolve, reject) => {
    const launch = () => {
      let worker;
      try { worker = new Worker(entry, { argv: ["--watch"] }); }
      catch (error) { reject(error); return; }
      let failure;
      worker.once("error", error => { failure = error; });
      worker.once("exit", code => {
        if (failure) reject(failure);
        else if (code === 75) launch();
        else resolve(code);
      });
    };
    launch();
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reportFailure = e => { console.error("SOURCE_SYNC_ERROR " + e.message); process.exitCode = 1; };
  try {
    const command = parseMirrorCommand(process.argv.slice(2));
    if (isMainThread && command.action === "--watch") {
      remoteReady();
      watchInProcess().then(code => { process.exitCode = code; }, reportFailure);
    } else {
      main(command);
    }
  } catch (e) { reportFailure(e); }
}

export { assertCompatibleBranchTransition, branchTransitionPins, isUnchanged, needsReconcile, parseRemoteHashes, remoteAuditDue, remoteConflict } from "./sync-lenovo-reconciliation.mjs";
export { allowed, appendLogFile, buildManagedDeleteCode, buildPublishCode, failureDetail, hash, persistAt, publish, remoteHashes, remoteInvocation };
