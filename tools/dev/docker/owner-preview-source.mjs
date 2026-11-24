// Shared identity of an isolated, uncommitted Go preview. Never writes Git.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { containsLikelySecret, forbiddenName } from "../../security/verify-secrets.mjs";

const gitExe = process.platform === "win32" ? "C:\\Program Files\\Git\\cmd\\git.exe" : "/usr/bin/git";
const owners = ["dsh", "identity", "wlt"];
const goPath = /^services\/(?:dsh|identity|wlt)\/backend\/(?:cmd|internal)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.go$/;
export function isPreviewGoPath(rel) { return goPath.test(rel); }
const wltComposeInput = "infra/compose.wlt.yaml";
function sourceOwner(rel) {
  if (rel === wltComposeInput) return "wlt";
  return owners.find(owner => rel.startsWith("services/" + owner + "/"));
}
export function isSharedRuntimeInput(rel) { return !sourceOwner(rel); }
// Client files are neither copied by the owner Dockerfiles nor present in
// the Go preview build context. Contracts and all other inputs stay guarded.
function isOwnerClientPath(rel) {
  return /^services\/(?:identity|dsh|wlt)\/clients\//.test(rel);
}
export function ownerSourceState(owner, changed, committed) {
  const prefix="services/"+owner+"/";
  const local=changed.filter(rel=>rel.startsWith(prefix));
  return {
    imageChanges:committed.filter(rel=>!isOwnerClientPath(rel)),
    previewChanges:local.filter(rel=>!isOwnerClientPath(rel)),
    clientPending:[...local,...committed].some(isOwnerClientPath),
    requiresCommittedRefresh:local.length===0 && committed.length>0,
  };
}

// The existing preview authority is intentionally Go-only. Partition review
// holds by owner, and propagate only actual runtime/contract dependency risk.
// A successful current-SHA disposable proof is necessary, never sufficient
// on its own: the runtime transaction still checks exact retained data.
export function ownerReconcilePlan({changed, committed, preview, captain, schemaReady=[], wltConfigDrift=false}) {
  const blocked = {};
  const runtimeChanges = {};
  const order = ["dsh", "identity", "wlt"];
  if (changed.some(isSharedRuntimeInput)) {
    return { eligible: [], blocked: Object.fromEntries(order.map(o => [o, "SHARED_INPUT_REVIEW_REQUIRED"])) };
  }
  for (const owner of order) {
    const prefix = "services/" + owner + "/";
    const local = changed.filter(rel => sourceOwner(rel) === owner);
    const saved = committed[owner] || [];
    const {imageChanges,previewChanges}=ownerSourceState(owner,changed,saved);
    runtimeChanges[owner] = [...previewChanges, ...imageChanges].some(rel =>
      !/^(?:package\.json$|tsconfig\.json$|README\.md$)/.test(rel.slice(prefix.length)));
    const schemaChanges=saved.filter(rel=>rel.startsWith(prefix+"database/"));
    const schemaAdmitted=schemaReady.includes(owner) && local.length===0 &&
      schemaChanges.every(rel=>new RegExp("^services/"+owner+"/database/"+(owner==="wlt"?"(?:schema|sandbox)":"schema")+"/[0-9]{2}_[a-z0-9_]+\\.sql$").test(rel));
    if (owner === "wlt" && (wltConfigDrift || local.includes(wltComposeInput))) {
      runtimeChanges[owner] = true;
      blocked[owner] = "CONFIG_REVIEW_REQUIRED";
    }
    else if (schemaChanges.length && !schemaAdmitted) blocked[owner] = "SCHEMA_REVIEW_REQUIRED";
    else if (previewChanges.some(rel => !isPreviewGoPath(rel))) blocked[owner] = "UNCOMMITTED_NON_GO";
    else if (!preview && (previewChanges.length || (local.length && imageChanges.length))) blocked[owner] = "PREVIEW_NOT_AUTHORIZED";
  }
  // DSH and WLT consume Identity; Captain-enabled Identity consumes DSH.
  // A blocked peer with no runtime input change is not a dependency hold.
  const edges = [["identity", "dsh"], ["identity", "wlt"], ...(captain ? [["dsh", "identity"]] : [])];
  for (let i = 0; i < order.length; i++) {
    for (const [peer, consumer] of edges) {
      if (blocked[peer] && runtimeChanges[peer] && !blocked[consumer]) blocked[consumer] = "PEER_REVIEW_REQUIRED:" + peer;
    }
  }
  return { eligible: order.filter(owner => !blocked[owner]), blocked };
}

function gitList(root, args) {
  return execFileSync(gitExe, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 20000, maxBuffer: 8*1024*1024 }).split("\0").filter(Boolean);
}
export function dirtyPaths(root, scope) {
  const records=gitList(root,["status","--porcelain=v1","-z","--no-renames","--untracked-files=all","--",...scope]);
  return [...new Set(records.map(record=>{
    if(!/^[ MADRCU?!][ MADRCU?!] /.test(record))throw new Error("PREVIEW_STATUS_INVALID");
    return record.slice(3);
  }))].sort();
}
function safeRead(root, rel, missing = false) {
  const parts = rel.split("/");
  if (parts.some(x=>!x || x==="." || x===".." || !/^[A-Za-z0-9_.-]+$/.test(x)) || forbiddenName(rel)) throw new Error("PREVIEW_PATH_INVALID");
  let full = root;
  for (let i=0;i<parts.length;i++) {
    full=path.join(full,parts[i]);
    let stat;
    try { stat=fs.lstatSync(full); }
    catch(e) { if(missing && e.code==="ENOENT") return null; throw e; }
    if(stat.isSymbolicLink() || (i===parts.length-1 ? !stat.isFile() : !stat.isDirectory())) throw new Error("PREVIEW_UNSAFE_PATH");
  }
  const fd=fs.openSync(full,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW??0));
  try {
    const a=fs.fstatSync(fd,{bigint:true});
    const b=fs.lstatSync(full,{bigint:true});
    if(!a.isFile() || b.isSymbolicLink() || a.dev!==b.dev || a.ino!==b.ino || a.nlink!==1n || a.size>BigInt(4*1024*1024)) throw new Error("PREVIEW_UNSAFE_FILE");
    const bytes=fs.readFileSync(fd);
    if(bytes.includes(0) || containsLikelySecret(bytes.toString("utf8"))) throw new Error("PREVIEW_SECRET_OR_BINARY_BLOCKED");
    return bytes;
  } finally { fs.closeSync(fd); }
}
export function digestEntries(entries) {
  const hash=createHash("sha256");
  for(const [rel,bytes] of [...entries].sort(([a],[b])=>a<b?-1:a>b?1:0)){
    hash.update(rel+"\0");
    hash.update(bytes===null?"MISSING":createHash("sha256").update(bytes).digest("hex"));
    hash.update("\0");
  }
  return hash.digest("hex");
}
export function previewChangeKey(root, paths) {
  if(paths.some(p=>!isPreviewGoPath(p))) throw new Error("PREVIEW_ONLY_GO_SOURCE_ALLOWED");
  return digestEntries(paths.map(p=>[p,safeRead(root,p,true)]));
}
export function captureOwner(root, owner) {
  if(!owners.includes(owner)) throw new Error("PREVIEW_UNKNOWN_OWNER");
  const prefix="services/"+owner+"/";
  const scope=[prefix+".dockerignore",prefix+"backend",prefix+"database/schema"];
  const changes=dirtyPaths(root,["services/"+owner]);
  if(changes.some(p=>!isPreviewGoPath(p) && !isOwnerClientPath(p))) throw new Error("PREVIEW_ONLY_GO_SOURCE_ALLOWED");
  const files=[...new Set(gitList(root,["ls-files","--cached","--others","--exclude-standard","-z","--",...scope]))].sort();
  const entries=[];
  for(const p of files){
    if(!p.startsWith(prefix)) throw new Error("PREVIEW_PATH_INVALID");
    const rel=p.slice(prefix.length);
    if(!isPreviewGoPath(p) && !/^(?:\.dockerignore|backend\/(?:Dockerfile|go\.mod|go\.sum|project\.json|README\.md)|database\/schema\/[A-Za-z0-9_-]+\.sql)$/.test(rel)) throw new Error("PREVIEW_UNREVIEWED_BUILD_INPUT");
    const bytes=safeRead(root,p,changes.includes(p));
    if(bytes!==null) entries.push([rel,bytes]);
  }
  if(new Set(entries.map(([p])=>p.toLowerCase())).size!==entries.length) throw new Error("PREVIEW_PATH_COLLISION");
  for(const p of [".dockerignore","backend/Dockerfile","backend/go.mod","backend/go.sum"]) if(!entries.some(([rel])=>rel===p)) throw new Error("PREVIEW_BUILD_INPUT_MISSING");
  // DSH's joined-owner test resolves Identity's committed schema relative to
  // services/dsh. Keep it as a sibling test input, outside the build context.
  const peerScope="services/identity/database/schema";
  const peers=[];
  if(owner==="dsh"){
    if(dirtyPaths(root,[peerScope]).length)throw new Error("PREVIEW_PEER_SCHEMA_CHANGED");
    for(const rel of gitList(root,["ls-files","--cached","-z","--",peerScope])){
      if(!/^services\/identity\/database\/schema\/[A-Za-z0-9_-]+\.sql$/.test(rel))throw new Error("PREVIEW_UNREVIEWED_PEER_INPUT");
      peers.push([rel,safeRead(root,rel)]);
    }
  }
  return {owner,digest:digestEntries(entries),entries,peers};
}
export function verifyMaterializedOwner(dir,snapshot) {
  const actual=[];
  function walk(folder,relative=""){
    for(const item of fs.readdirSync(folder,{withFileTypes:true})){
      const rel=relative?relative+"/"+item.name:item.name;
      if(item.isSymbolicLink())throw new Error("PREVIEW_SNAPSHOT_LINK");
      if(item.isDirectory())walk(path.join(folder,item.name),rel);
      else actual.push([rel,safeRead(dir,rel)]);
    }
  }
  walk(dir);
  if(digestEntries(actual)!==snapshot.digest)throw new Error("PREVIEW_SNAPSHOT_MUTATED");
  const temp=path.resolve(dir,"../..");
  for(const [rel,bytes] of snapshot.peers||[]) if(!safeRead(temp,rel).equals(bytes))throw new Error("PREVIEW_PEER_SNAPSHOT_MUTATED");
}
export function materializeOwner(snapshot) {
  if(!owners.includes(snapshot.owner))throw new Error("PREVIEW_UNKNOWN_OWNER");
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"bthwani-owner-preview-"));
  // Retain the owner path identity used by the existing SQL safety tests.
  const dir=path.join(temp,"services",snapshot.owner);
  try {
    for(const [rel,bytes] of snapshot.entries) {
      if(rel.split("/").some(x=>!x||x==="."||x===".."||!/^[A-Za-z0-9_.-]+$/.test(x)))throw new Error("PREVIEW_PATH_INVALID");
      const full=path.join(dir,...rel.split("/"));
      fs.mkdirSync(path.dirname(full),{recursive:true});
      fs.writeFileSync(full,bytes,{flag:"wx"});
    }
    for(const [rel,bytes] of snapshot.peers||[]){
      if(snapshot.owner!=="dsh" || !/^services\/identity\/database\/schema\/[A-Za-z0-9_-]+\.sql$/.test(rel))throw new Error("PREVIEW_UNREVIEWED_PEER_INPUT");
      const full=path.join(temp,...rel.split("/"));
      fs.mkdirSync(path.dirname(full),{recursive:true});
      fs.writeFileSync(full,bytes,{flag:"wx"});
    }
    verifyMaterializedOwner(dir,snapshot);
    return {dir,dispose:()=>fs.rmSync(temp,{recursive:true,force:true})};
  } catch(e) { fs.rmSync(temp,{recursive:true,force:true}); throw e; }
}
