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
const ownerConfig = JSON.parse(fs.readFileSync(path.join(root, "infra/local/runtime-owners.json"), "utf8"));
if (process.env.COMPUTERNAME?.toUpperCase() !== ownerConfig.sourceHost) {
  throw new Error("SYNC_SOURCE_HOST_REQUIRED: source changes must originate on the declared primary machine");
}
const target = ownerConfig.sshTarget;
const remoteRoot = ownerConfig.remoteRuntimeRoot.replace(/\\/g, "/");
const remoteSource = remoteRoot + "/source";
const mode = process.argv.includes("--watch") ? "watch" : "once";
const archiveInputs = [
  "apps/app-client", "apps/app-partner", "apps/app-captain", "apps/control-panel",
  "packages/design-system", "packages/push-device",
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
  if (segments.some(s => !s || s==="." || s===".." || /[<>:"|?*]/.test(s) || [...s].some(c => c.charCodeAt(0) < 32))) return false;
  if (segments.some(s => ignoredNames.has(s) || forbiddenBasename.test(s))) return false;
  return archiveInputs.includes(p) || mirroredPrefixes.some(prefix => p.startsWith(prefix));
}
function call(exe, args, timeout=45000) {
  const r = spawnSync(exe,args,{cwd:root,encoding:"utf8",timeout,windowsHide:true,maxBuffer:1024*1024});
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
    const buf = spawnSync("git.exe",args,{cwd:root,encoding:"buffer",timeout:25000,windowsHide:true});
    if(buf.status!==0 || buf.error) throw new Error("GIT_FILE_INVENTORY_UNAVAILABLE");
    for(const name of buf.stdout.toString("utf8").split("\0")) if(approved(name)) included.add(normalize(name));
  }
  return [...included].sort();
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
  const full=path.join(root, rel);
  const dest=remoteFile(rel);
  if(deleted || !fs.existsSync(full)) {
    remoteScript("$p="+quote(dest)+"; if(Test-Path -LiteralPath $p -PathType Leaf){Remove-Item -LiteralPath $p -Force; Write-Output 'MIRROR_DELETED'}");
    return;
  }
  const stat=fs.lstatSync(full);
  if(!stat.isFile() || stat.isSymbolicLink()) throw new Error("MIRROR_NONREGULAR_FILE_REJECTED: "+rel);
  const dir=path.dirname(dest);
  remoteScript("New-Item -ItemType Directory -Force -Path "+quote(dir)+" | Out-Null");
  call("scp.exe",["-q","-o","BatchMode=yes","-o","StrictHostKeyChecking=yes","-o","ConnectTimeout=8",full,target+":"+remoteSource+"/"+rel],40000);
  const actual=remoteScript("(Get-FileHash -Algorithm SHA256 -LiteralPath "+quote(dest)+").Hash");
  if(actual.trim().toUpperCase()!==sha(full)) throw new Error("MIRROR_HASH_MISMATCH: "+rel);
}
function assertArchiveInputsSafe() {
  // Archive reads from Git HEAD (not only changed files); reject any future accidentally tracked secret
  // before transferring the zip. An example template intentionally has no production values.
  const result=spawnSync("git.exe",["ls-files","--cached","-z","--",...archiveInputs],{
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
    call("git.exe",["archive","--format=zip","--output="+temp,"HEAD","--",...archiveInputs],45000);
    const digest=sha(temp);
    call("scp.exe",["-q","-o","BatchMode=yes",temp,target+":"+remoteZip],45000);
    const got=remoteScript("(Get-FileHash -LiteralPath "+quote(win(remoteZip))+" -Algorithm SHA256).Hash");
    if(got.trim().toUpperCase()!==digest) throw new Error("BASELINE_ZIP_HASH_MISMATCH");
    remoteScript("New-Item -ItemType Directory -Force -Path "+quote(win(remoteSource))+" | Out-Null; tar.exe -xf "+quote(win(remoteZip))+" -C "+quote(win(remoteSource))+"; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}",45000);
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
  console.log("LENOVO_SOURCE_BASELINE=PASS sha="+head+" copied_dirty="+[...changes].filter(approved).length);
}
function poll() {
  const now=filesWithStats();
  let updates=0;
  for(const [rel,st] of now) {
    if(last.get(rel)!==st) {syncFile(rel);updates++;}
  }
  for(const rel of last.keys()) if(!now.has(rel)) {syncFile(rel,true);updates++;}
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
fullBaseline();
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
