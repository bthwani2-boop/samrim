#!/usr/bin/env node
// One-way, source-only Windows development mirror: Surface -> Lenovo.
// Never copies the working tree's .git, secrets, generated outputs or dependencies.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Use fixed, ACL-protected Windows executables; never resolve SSH/Git through a writable PATH.
const executablePaths=Object.freeze({
  "git.exe":"C:\\Program Files\\Git\\cmd\\git.exe",
  "ssh.exe":"C:\\Windows\\System32\\OpenSSH\\ssh.exe",
  "scp.exe":"C:\\Windows\\System32\\OpenSSH\\scp.exe",
  "tar.exe":"C:\\Windows\\System32\\tar.exe",
});

const ownerConfig = JSON.parse(fs.readFileSync(path.join(root, "infra/local/runtime-owners.json"), "utf8"));
if (process.env.COMPUTERNAME?.toUpperCase() !== ownerConfig.sourceHost) {
  throw new Error("SYNC_SOURCE_HOST_REQUIRED: source changes must originate on the declared primary machine");
}
const target = ownerConfig.sshTarget;
const remoteRoot = ownerConfig.remoteRuntimeRoot.replaceAll("\\", "/");
const registeredRuntimeRoot="C:/Users/bthwa/BThwaniAppRunner";
if(remoteRoot.replace(/\/$/,"").toLowerCase()!==registeredRuntimeRoot.toLowerCase()){
  throw new Error("LENOVO_RUNTIME_ROOT_MISMATCH: update the launcher and scheduled tasks before changing the mirror root");
}

const remoteSource = remoteRoot + "/source";
const mode = process.argv.includes("--watch") ? "watch" : "once";
const archiveInputs = [
  "apps/app-client", "apps/app-partner", "apps/app-captain", "apps/control-panel",
  "packages/design-system", "packages/push-device", "packages/tamagui-config",
  "services/identity/clients", "services/identity/package.json",
  "services/dsh/clients", "services/dsh/package.json",
  "tools/mobile", "tools/dev", "infra/local",
  "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml",
  "tsconfig.base.json", "nx.json", "patches"
];
const mirroredPrefixes = archiveInputs.filter(p => !path.posix.extname(p)).map(p => p + "/");
const ignoredNames = new Set([".git", ".ssh", ".secrets", "private", "node_modules", ".expo", ".next", ".next-dev", "dist", "build", "coverage", "test-results", ".cache", ".turbo", ".agent-device", ".maestro", ".mimosa"]);
const forbiddenBasename = /^(?:\.env(?:\..*)?|\.npmrc|\.git-credentials|google-services\.json|GoogleService-Info\.plist|credentials(?:\..*)?|id_rsa|id_ed25519|.*\.(?:pem|key|p12|pfx|jks|keystore))$/i;
const normalize = p => p.replaceAll("\\", "/");
function approved(relative) {
  const p = normalize(relative);
  if (!p || p.startsWith("/") || p.includes("//")) return false;
  const segments = p.split("/");
  if (segments.some(s => !s || s==="." || s===".." || /[<>:"|?*]/.test(s) || [...s].some(c => c.codePointAt(0) < 32))) return false;
  if (segments.some(s => ignoredNames.has(s.toLowerCase()) || forbiddenBasename.test(s))) return false;
  return archiveInputs.includes(p) || mirroredPrefixes.some(prefix => p.startsWith(prefix));
}
function call(exe, args, timeout=45000) {
  const fixedPath=executablePaths[exe];
  if(!fixedPath) throw new Error("EXECUTABLE_NOT_ALLOWLISTED");
  const r = spawnSync(fixedPath,args,{cwd:root,encoding:"utf8",timeout,windowsHide:true,maxBuffer:1024*1024});
  if(r.error || r.status!==0) throw new Error(exe+" failed: "+(r.error?.message||r.stderr||"exit "+r.status).slice(0,900));
  return (r.stdout||"").trim();
}
function remoteScript(code, timeout=25000) {
  return call("ssh.exe",["-T","-o","BatchMode=yes","-o","StrictHostKeyChecking=yes","-o","ConnectTimeout=8",target,"powershell.exe -NoProfile -NonInteractive -Command \""+code.replaceAll('"','\\\"')+"\""],timeout);
}
const win = p => p.replaceAll("/","\\");
const quote = s => "'"+s.replaceAll("'","''")+"'";
function remoteFile(rel) { return win(remoteSource + "/" + rel); }
function sha(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase(); }
function sourcePaths() {
  const included = new Set();
  for(const args of [
    ["ls-files","--cached","-z","--",...archiveInputs],
    ["ls-files","--others","--exclude-standard","-z","--",...archiveInputs]
  ]) {
    const buf = spawnSync(executablePaths["git.exe"],args,{cwd:root,encoding:"buffer",timeout:25000,windowsHide:true});
    if(buf.status!==0 || buf.error) throw new Error("GIT_FILE_INVENTORY_UNAVAILABLE");
    for(const name of buf.stdout.toString("utf8").split("\0")) if(approved(name)) included.add(normalize(name));
  }
  return [...included].sort((a,b)=>a.localeCompare(b,"en"));
}
function gitChangedPaths(args){
  const result=spawnSync(executablePaths["git.exe"],args,{cwd:root,encoding:"buffer",timeout:25000,windowsHide:true});
  if(result.error||result.status!==0) throw new Error("MIRROR_GIT_DELTA_UNAVAILABLE");
  return result.stdout.toString("utf8").split("\0").filter(Boolean).map(normalize);
}
function existingMirror(){
  const remoteProbe="$p="+quote(win(remoteSource+"/pnpm-workspace.yaml"))+
    ";if(Test-Path -LiteralPath $p -PathType Leaf){Write-Output 'PRESENT'}"+
    "else{$active=@(Get-NetTCPConnection -State Listen -LocalPort 18111,18112,18113,13010 -ErrorAction SilentlyContinue);"+
    "if($active.Count -gt 0){throw 'MIRROR_BOOTSTRAP_LIVE_RUNTIME_BLOCKED'};Write-Output 'MISSING'}";
  return remoteScript(remoteProbe).trim()==="PRESENT";
}
function resumeExisting(dryRun=false){
  const baseFile=win(remoteRoot+"/source-baseline-head.txt");
  const base=remoteScript("$f="+quote(baseFile)+";if(Test-Path $f){Get-Content -Raw -LiteralPath $f}else{Write-Output 'NONE'}").trim();
  if(!/^[0-9a-f]{40}$/i.test(base)) throw new Error("MIRROR_BASELINE_UNKNOWN: refusing to overwrite a running source tree");
  if(call("git.exe",["cat-file","-t",base])!=="commit") throw new Error("MIRROR_BASELINE_COMMIT_MISSING");
  const changes=new Set([
    ...gitChangedPaths(["diff","--name-only","-z",base,"HEAD","--",...archiveInputs]),
    ...gitChangedPaths(["diff","--name-only","-z","HEAD","--",...archiveInputs]),
    ...gitChangedPaths(["ls-files","--others","--exclude-standard","-z","--",...archiveInputs])
  ]);
  const selected=[...changes].filter(approved).sort((a,b)=>a.localeCompare(b,"en"));
  const current=call("git.exe",["rev-parse","HEAD"]);
  const managed=currentManaged();
  const previous=readManaged();
  console.log("LENOVO_RESUME_SOURCE base="+base+" head="+current+" delta="+selected.length);
  pruneFormerlyManaged(previous,managed,dryRun);
  if(dryRun) return;
  for(const rel of selected) syncFile(rel);
  remoteScript("Set-Content -NoNewline -LiteralPath "+quote(baseFile)+" -Value "+quote(current));
  writeManaged(managed);
  console.log("LENOVO_SOURCE_RECONCILE=PASS delta="+selected.length);
}
const stateFile=path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),"AppData","Local"),
  "BThwani","lenovo-source-manifest.json");
function currentManaged(){
  const entries=new Map();
  for(const rel of sourcePaths()){
    const file=path.join(root,rel);
    try{
      const st=fs.lstatSync(file);
      if(st.isSymbolicLink()) throw new Error("MIRROR_MANAGED_SYMLINK_REJECTED: "+rel);
      if(st.isFile()) entries.set(rel,sha(file));
    }catch(e){if(e?.code!=="ENOENT") throw e;}
  }
  return entries;
}
function readManaged(){
  if(!fs.existsSync(stateFile)) return new Map();
  const data=JSON.parse(fs.readFileSync(stateFile,"utf8"));
  if(data.version!==1 || data.host!==ownerConfig.remoteHost || typeof data.files!=="object")
    throw new Error("MIRROR_MANIFEST_INVALID");
  const managed=new Map();
  for(const [rel,digest] of Object.entries(data.files)){
    if(!approved(rel) || !/^[0-9A-F]{64}$/.test(digest)) throw new Error("MIRROR_MANIFEST_ENTRY_INVALID");
    managed.set(rel,digest);
  }
  return managed;
}
function writeManaged(current){
  fs.mkdirSync(path.dirname(stateFile),{recursive:true});
  const tmp=stateFile+".pending-"+process.pid;
  try{
    fs.writeFileSync(tmp,JSON.stringify({version:1,host:ownerConfig.remoteHost,
      files:Object.fromEntries(current)}),"utf8");
    fs.renameSync(tmp,stateFile);
  }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
function pruneFormerlyManaged(previous,current,dryRun=false){
  const stale=[...previous].filter(([rel])=>!current.has(rel));
  if(stale.length) console.log("LENOVO_MANAGED_STALE="+stale.length);
  if(dryRun) return;
  for(const [rel,digest] of stale){
    const dest=remoteFile(rel);
    const actual=remoteScript("$p="+quote(dest)+";if(Test-Path -LiteralPath $p -PathType Leaf){(Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash}else{Write-Output 'MISSING'}").trim().toUpperCase();
    if(actual==="MISSING") continue;
    if(actual!==digest) throw new Error("MIRROR_STALE_FILE_CONFLICT: "+rel);
    syncFile(rel,true);
  }
}
let last = new Map();
function filesWithStats() {
  const result = new Map();
  for (const rel of sourcePaths()) {
    const full = path.join(root, rel);
    try {
      const st=fs.lstatSync(full);
      if(st.isFile() && !st.isSymbolicLink()) result.set(rel,st.size+":"+st.mtimeMs);
    } catch {}
  }
  return result;
}
function syncFile(rel, deleted=false) {
  if(!approved(rel)) throw new Error("MIRROR_PATH_REJECTED");
  const full=path.join(root,rel);
  const dest=remoteFile(rel);
  if(deleted || !fs.existsSync(full)) {
    remoteScript("$p="+quote(dest)+"; if(Test-Path -LiteralPath $p -PathType Leaf){Remove-Item -LiteralPath $p -Force; Write-Output 'MIRROR_DELETED'}");
    return;
  }
  const stat=fs.lstatSync(full);
  if(!stat.isFile() || stat.isSymbolicLink()) throw new Error("MIRROR_NONREGULAR_FILE_REJECTED: "+rel);
  const digest=sha(full);
  const remoteHash=remoteScript("$p="+quote(dest)+";if(Test-Path -LiteralPath $p -PathType Leaf){(Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash}else{Write-Output 'MISSING'}");
  if(remoteHash.trim().toUpperCase()===digest) return;
  const staging=win(remoteRoot+"/sync-stage-"+crypto.createHash("sha256").update(rel).digest("hex").slice(0,20)+".tmp");
  const backup=win(remoteRoot+"/sync-backup-"+crypto.createHash("sha256").update(rel).digest("hex").slice(0,20)+".bak");
  const dir=path.dirname(dest);
  remoteScript("New-Item -ItemType Directory -Force -Path "+quote(dir)+" | Out-Null");
  call("scp.exe",["-q","-o","BatchMode=yes","-o","StrictHostKeyChecking=yes","-o","ConnectTimeout=8",full,target+":"+staging.replaceAll("\\","/")],40000);
  const actual=remoteScript("(Get-FileHash -Algorithm SHA256 -LiteralPath "+quote(staging)+").Hash");
  if(actual.trim().toUpperCase()!==digest) throw new Error("MIRROR_STAGE_HASH_MISMATCH: "+rel);
  remoteScript("$stage="+quote(staging)+"; $dest="+quote(dest)+"; $backup="+quote(backup)+"; if(Test-Path -LiteralPath $dest -PathType Leaf){[IO.File]::Replace($stage,$dest,$backup)}else{[IO.File]::Move($stage,$dest)}");
  const published=remoteScript("(Get-FileHash -Algorithm SHA256 -LiteralPath "+quote(dest)+").Hash");
  if(published.trim().toUpperCase()!==digest) throw new Error("MIRROR_PUBLISHED_HASH_MISMATCH: "+rel);
  remoteScript("$backup="+quote(backup)+";if(Test-Path -LiteralPath $backup -PathType Leaf){Remove-Item -LiteralPath $backup -Force}");
}
function assertArchiveInputsSafe() {
  // Archive reads from Git HEAD (not only changed files); reject any future accidentally tracked secret
  // before transferring the zip. An example template intentionally has no production values.
  const result=spawnSync(executablePaths["git.exe"],["ls-files","--cached","-z","--",...archiveInputs],{
    cwd:root,encoding:"buffer",timeout:25000,windowsHide:true
  });
  if(result.status!==0 || result.error) throw new Error("MIRROR_GIT_ARCHIVE_INVENTORY_UNAVAILABLE");
  for(const raw of result.stdout.toString("utf8").split("\0")){
    if(!raw) continue;
    const rel=normalize(raw);
    const leaf=rel.split("/").at(-1);
    if(rel.includes("..") || rel.split("/").includes(".git") ||
       (forbiddenBasename.test(leaf) && leaf!==".env.example")){
      throw new Error("MIRROR_SENSITIVE_TRACKED_FILE_REJECTED: "+rel);
    }
  }
}
function fullBaseline() {
  assertArchiveInputsSafe();
  const temp=path.join(os.tmpdir(),"bthwani-lenovo-source-"+process.pid+".zip");
  const remoteZip=remoteRoot+"/source-baseline.zip";
  try {
    // HEAD is the baseline; uncommitted tracked and new source files are sent separately.
    const excludedDirs=[...ignoredNames].map(dir=>":(exclude,glob)**/"+dir+"/**");
    const excludedSensitive=[":(exclude,glob)**/.env*",":(exclude,glob)**/*.jks",
      ":(exclude,glob)**/*.pem",":(exclude,glob)**/*.key",":(exclude,glob)**/*.p12",
      ":(exclude,glob)**/*.pfx",":(exclude,glob)**/*.keystore",
      ":(exclude,glob)**/google-services.json",":(exclude,glob)**/GoogleService-Info.plist",
      ":(exclude,glob)**/.npmrc",":(exclude,glob)**/.git-credentials"];
    call("git.exe",["archive","--format=zip","--output="+temp,"HEAD","--",...archiveInputs,...excludedDirs,...excludedSensitive],45000);
    const listed=call("tar.exe",["-tf",temp],45000);
    for(const entry of listed.split(/\r?\n/)){
      if(entry && !entry.endsWith("/") && !approved(entry)){
        throw new Error("MIRROR_UNSAFE_ARCHIVE_ENTRY: "+entry);
      }
    }
    const digest=sha(temp);
    call("scp.exe",["-q","-o","BatchMode=yes",temp,target+":"+remoteZip],45000);
    const got=remoteScript("(Get-FileHash -LiteralPath "+quote(win(remoteZip))+" -Algorithm SHA256).Hash");
    if(got.trim().toUpperCase()!==digest) throw new Error("BASELINE_ZIP_HASH_MISMATCH");
    // Fresh bootstrap only: extract off-path, then publish a complete tree in one same-volume directory move.
    // Never expand an archive over an existing tree that a running Expo/Next process may be reading.
    const stage=win(remoteRoot+"/source-bootstrap-stage");
    const dest=win(remoteSource);
    const bootstrap=[
      "$ErrorActionPreference='Stop'",
      "$source="+quote(dest),
      "$stage="+quote(stage),
      "$zip="+quote(win(remoteZip)),
      "if(Test-Path -LiteralPath $source){throw 'MIRROR_SOURCE_ALREADY_EXISTS'}",
      "if(Test-Path -LiteralPath $stage){throw 'MIRROR_BOOTSTRAP_STAGE_ALREADY_EXISTS'}",
      "$active=@(Get-NetTCPConnection -State Listen -LocalPort 18111,18112,18113,13010 -ErrorAction SilentlyContinue)",
      "if($active.Count -gt 0){throw 'MIRROR_BOOTSTRAP_LIVE_RUNTIME_BLOCKED'}",
      "New-Item -ItemType Directory -Path $stage -ErrorAction Stop | Out-Null",
      "tar.exe -xf $zip -C $stage",
      "if($LASTEXITCODE -ne 0){throw 'MIRROR_BOOTSTRAP_ARCHIVE_FAILED'}",
      "if(!(Test-Path -LiteralPath (Join-Path $stage 'pnpm-workspace.yaml') -PathType Leaf)){throw 'MIRROR_BOOTSTRAP_MANIFEST_MISSING'}",
      "[IO.Directory]::Move($stage,$source)"
    ].join("; ");
    remoteScript(bootstrap,60000);
  } finally {
    try{fs.unlinkSync(temp);}catch{}
  }
  const changes = new Set([
    ...call("git.exe",["diff","HEAD","--name-only","--",...archiveInputs]).split(/\r?\n/),
    ...call("git.exe",["ls-files","--others","--exclude-standard","--",...archiveInputs]).split(/\r?\n/)
  ]);
  for(const rel of changes) if(approved(rel)) syncFile(rel);
  const head=call("git.exe",["rev-parse","HEAD"]);
  remoteScript("Set-Content -NoNewline -LiteralPath "+quote(win(remoteRoot+"/source-baseline-head.txt"))+" -Value "+quote(head));
  writeManaged(currentManaged());
  console.log("LENOVO_SOURCE_BASELINE=PASS sha="+head+" copied_dirty="+[...changes].filter(approved).length);
}
function poll() {
  const now=filesWithStats();
  let updates=0;
  for(const [rel,st] of now) {
    if(last.get(rel)!==st) {syncFile(rel);updates++;}
  }
  for(const rel of last.keys()) if(!now.has(rel)) {syncFile(rel,true);updates++;}
  if(updates) writeManaged(currentManaged());
  last=now;
  if(updates) console.log("LENOVO_SOURCE_CHANGED=PASS count="+updates);
}
const checkAt=process.argv.indexOf("--check-path");
if(checkAt!==-1){
  const relative=normalize(process.argv[checkAt+1]||"");
  if(!approved(relative)) throw new Error("MIRROR_PATH_REJECTED");
  console.log("MIRROR_PATH_ACCEPTED="+relative);
  process.exit(0);
}
const verifyAt=process.argv.indexOf("--verify");
if(verifyAt!==-1){
  const relative=normalize(process.argv[verifyAt+1]||"");
  if(!approved(relative) || !fs.existsSync(path.join(root,relative))){
    throw new Error("MIRROR_VERIFY_PATH_REJECTED");
  }
  const dest=remoteFile(relative);
  const actual=remoteScript("(Get-FileHash -Algorithm SHA256 -LiteralPath "+quote(dest)+").Hash");
  if(actual.trim().toUpperCase()!==sha(path.join(root,relative))){
    throw new Error("MIRROR_VERIFY_MISMATCH: "+relative);
  }
  console.log("LENOVO_SOURCE_VERIFY=PASS file="+relative);
  process.exit(0);
}
if(existingMirror()){
  // Reconcile Git changes in place with individually staged, hash-verified file publication.
  // Never extract a full archive over live Metro/Next source or remove node_modules.
  resumeExisting(process.argv.includes("--dry-run"));
}else if(process.argv.includes("--dry-run")){
  console.log("LENOVO_SOURCE_FRESH_BOOTSTRAP_REQUIRED");
}else{
  fullBaseline(); // Empty derived workspace only.
}
last=filesWithStats();
if(mode==="watch"){
  console.log("LENOVO_SOURCE_WATCH=ACTIVE interval=1500ms source=Surface target=Lenovo");
  let busy=false;
  setInterval(()=>{
    if(busy) return;
    busy=true;
    try{poll();}catch(e){console.error("LENOVO_SOURCE_WATCH_FAILED="+e.message);}
    finally{busy=false;}
  },1500);
}
