// Canonical owner source classification and immutable Go preview.
// Workspace metadata, documentation and SDK code are not inputs to the Go
// Dockerfiles. Contract, schema and unknown source changes remain guarded.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { containsLikelySecret, forbiddenName } from "../../security/verify-secrets.mjs";

const owners=Object.freeze(["dsh","identity","wlt"]);
const gitExe=process.platform==="win32"?"C:\\Program Files\\Git\\cmd\\git.exe":"/usr/bin/git";
const goFile=/^backend\/(?:cmd|internal)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.go$/;
const schemaFile=/^database\/schema\/[A-Za-z0-9_-]+\.sql$/;
const workspaceFiles=new Set(["package.json","tsconfig.json","README.md","backend/README.md"]);
const buildFiles=new Set([".dockerignore","backend/Dockerfile","backend/go.mod","backend/go.sum"]);
const compare=(a,b)=>a<b?-1:a>b?1:0;

export const ownerComposeInputs=Object.freeze(["infra/compose.yaml"]);

function classify(rel) {
  const match=/^services\/(dsh|identity|wlt)\/(.+)$/.exec(rel);
  if(!match)return {owner:null,kind:"shared"};
  const [,owner,file]=match;
  const kind=file.startsWith("clients/")?"client":
    workspaceFiles.has(file)?"workspace":
    goFile.test(file)?(file.endsWith("_test.go")?"test":"go"):
    file.startsWith("database/")?"database":"guarded";
  return {owner,file,kind};
}
export function isPreviewGoPath(rel) {
  return ["go","test"].includes(classify(rel).kind);
}
export function isSharedRuntimeInput(rel) {
  return classify(rel).kind==="shared";
}
export function isOwnerNonRuntimePath(rel) {
  return ["client","workspace","test"].includes(classify(rel).kind);
}
export function sourceIdentity(labels,owner) {
  const revision=labels?.["org.opencontainers.image.revision"];
  const source=labels?.["com.bthwani.source-sha"];
  const base=labels?.["com.bthwani.preview-base"];
  const digest=labels?.["com.bthwani.preview-digest"];
  if(base||digest||revision?.startsWith("worktree-")){
    if(source||!/^[0-9a-f]{40}$/.test(base||"")||!/^[0-9a-f]{64}$/.test(digest||"")||revision!=="worktree-"+digest)
      throw new Error("Invalid preview provenance: "+owner);
    return {revision:base,digest};
  }
  if(revision&&source&&revision!==source)throw new Error("conflicting image source labels: "+owner);
  if(!/^[0-9a-f]{40}$/.test(revision||source||""))throw new Error("source revision absent or invalid: "+owner);
  return {revision:revision||source,digest:null};
}
export function ownerSourceState(owner,changed,committed) {
  if(!owners.includes(owner))throw new Error("PREVIEW_UNKNOWN_OWNER");
  const local=changed.filter(rel=>classify(rel).owner===owner);
  return {
    imageChanges:committed.filter(rel=>!isOwnerNonRuntimePath(rel)),
    previewChanges:local.filter(rel=>!isOwnerNonRuntimePath(rel)),
    clientPending:[...local,...committed].some(rel=>classify(rel).kind==="client"),
  };
}

export function ownerReconcilePlan({changed,committed,preview,captain,schemaReady=[],wltConfigDrift=false}) {
  if(changed.some(isSharedRuntimeInput))
    return {eligible:[],blocked:Object.fromEntries(owners.map(owner=>[owner,"SHARED_INPUT_REVIEW_REQUIRED"]))};
  const blocked={}, runtimeChanges={};
  for(const owner of owners){
    const local=changed.filter(rel=>classify(rel).owner===owner);
    const saved=committed[owner]||[];
    const {imageChanges,previewChanges}=ownerSourceState(owner,changed,saved);
    runtimeChanges[owner]=Boolean(imageChanges.length||previewChanges.length);
    const database=saved.filter(rel=>classify(rel).kind==="database");
    const schemaPattern=new RegExp("^services/"+owner+"/database/"+(owner==="wlt"?"(?:schema|sandbox)":"schema")+"/[0-9]{2}_[a-z0-9_]+\\.sql$");
    const schemaAdmitted=schemaReady.includes(owner)&&local.length===0&&database.every(rel=>schemaPattern.test(rel));
    if(owner==="wlt"&&wltConfigDrift){
      runtimeChanges[owner]=true;
      blocked[owner]="CONFIG_REVIEW_REQUIRED";
    }else if(database.length&&!schemaAdmitted){
      blocked[owner]="SCHEMA_REVIEW_REQUIRED";
    }else if(previewChanges.some(rel=>!isPreviewGoPath(rel))){
      blocked[owner]="UNCOMMITTED_NON_GO";
    }else if(!preview&&(previewChanges.length||(local.length&&imageChanges.length))){
      blocked[owner]="PREVIEW_NOT_AUTHORIZED";
    }
  }
  // Each dependency hold is attributable to a blocked owner with actual
  // serving/contract/schema input changes, never workspace metadata alone.
  const edges=[["identity","dsh"],["identity","wlt"],["dsh","wlt"],...(captain?[["dsh","identity"]]:[])];
  for(let pass=0;pass<owners.length;pass++)
    for(const [peer,consumer] of edges)
      if(blocked[peer]&&runtimeChanges[peer]&&!blocked[consumer])blocked[consumer]="PEER_REVIEW_REQUIRED:"+peer;
  return {eligible:owners.filter(owner=>!blocked[owner]),blocked};
}

function gitList(root,args) {
  return execFileSync(gitExe,args,{cwd:root,encoding:"utf8",windowsHide:true,timeout:20000,maxBuffer:8*1024*1024}).split("\0").filter(Boolean);
}
export function dirtyPaths(root,scope) {
  const records=gitList(root,["status","--porcelain=v1","-z","--no-renames","--untracked-files=all","--",...scope]);
  return [...new Set(records.map(record=>{
    if(!/^[ MADRCU?!][ MADRCU?!] /.test(record))throw new Error("PREVIEW_STATUS_INVALID");
    return record.slice(3);
  }))].sort(compare);
}
function pathParts(rel) {
  const parts=rel.split("/");
  if(parts.some(part=>!part||part==="."||part===".."||!/^[A-Za-z0-9_.-]+$/.test(part))||forbiddenName(rel))
    throw new Error("PREVIEW_PATH_INVALID");
  return parts;
}
function safeRead(root,rel,missing=false) {
  const parts=pathParts(rel);
  let file=root;
  for(const [i,part] of parts.entries()){
    file=path.join(file,part);
    let stat;
    try{stat=fs.lstatSync(file);}catch(e){if(missing&&e.code==="ENOENT")return null;throw e;}
    if(stat.isSymbolicLink()||(i===parts.length-1?!stat.isFile():!stat.isDirectory()))throw new Error("PREVIEW_UNSAFE_PATH");
  }
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0)|(fs.constants.O_NONBLOCK??0));
  try{
    const opened=fs.fstatSync(fd,{bigint:true});
    const matches=stat=>stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1n&&
      ["dev","ino","size","mtimeNs","ctimeNs"].every(key=>stat[key]===opened[key]);
    if(opened.size>4194304n||!matches(opened)||!matches(fs.lstatSync(file,{bigint:true})))throw new Error("PREVIEW_UNSAFE_FILE");
    const buffer=Buffer.alloc(Number(opened.size)+1);
    let count=0;
    while(count<buffer.length){
      const n=fs.readSync(fd,buffer,count,buffer.length-count,null);
      if(!n)break;
      count+=n;
    }
    if(BigInt(count)!==opened.size||!matches(fs.fstatSync(fd,{bigint:true}))||!matches(fs.lstatSync(file,{bigint:true})))throw new Error("PREVIEW_UNSAFE_FILE");
    const bytes=buffer.subarray(0,count);
    if(bytes.includes(0)||containsLikelySecret(bytes.toString("utf8")))throw new Error("PREVIEW_SECRET_OR_BINARY_BLOCKED");
    return bytes;
  }finally{fs.closeSync(fd);}
}
export function digestEntries(entries) {
  const hash=createHash("sha256");
  for(const [rel,bytes] of [...entries].sort(([a],[b])=>compare(a,b))){
    hash.update(rel+"\0");
    hash.update(bytes===null?"MISSING":createHash("sha256").update(bytes).digest("hex"));
    hash.update("\0");
  }
  return hash.digest("hex");
}
export function previewChangeKey(root,paths) {
  if(paths.some(rel=>!isPreviewGoPath(rel)))throw new Error("PREVIEW_ONLY_GO_SOURCE_ALLOWED");
  return digestEntries(paths.map(rel=>[rel,safeRead(root,rel,true)]));
}
function snapshotInput(file) {
  return buildFiles.has(file)||goFile.test(file)||schemaFile.test(file);
}
function scopeFor(owner) {
  if(!owners.includes(owner))throw new Error("PREVIEW_UNKNOWN_OWNER");
  const prefix="services/"+owner+"/";
  return [prefix+".dockerignore",prefix+"backend",prefix+"database/schema"];
}
function ownerInput(owner,rel) {
  const info=classify(rel);
  if(info.owner!==owner)throw new Error("PREVIEW_PATH_INVALID");
  if(info.kind==="workspace"||info.file==="backend/project.json")return null;
  if(!snapshotInput(info.file))throw new Error("PREVIEW_UNREVIEWED_BUILD_INPUT");
  pathParts(rel);
  return info.file;
}
function checkedEntries(entries) {
  if(new Set(entries.map(([rel])=>rel.toLowerCase())).size!==entries.length)
    throw new Error("PREVIEW_PATH_COLLISION");
  for(const file of buildFiles)if(!entries.some(([rel])=>rel===file))
    throw new Error("PREVIEW_BUILD_INPUT_MISSING");
  return entries.sort(([a],[b])=>compare(a,b));
}
const peerScope="services/identity/database/schema";
function checkedPeer(rel) {
  if(!/^services\/identity\/database\/schema\/[A-Za-z0-9_-]+\.sql$/.test(rel))
    throw new Error("PREVIEW_UNREVIEWED_PEER_INPUT");
  pathParts(rel);
  return rel;
}
function assemble(owner,entries,peers,revision=null) {
  checkedEntries(entries);
  return {owner,revision,digest:digestEntries(entries),entries,peers};
}
export function captureOwner(root,owner) {
  const scope=scopeFor(owner);
  const changes=dirtyPaths(root,["services/"+owner]);
  if(changes.some(rel=>!isPreviewGoPath(rel)&&!isOwnerNonRuntimePath(rel)))
    throw new Error("PREVIEW_ONLY_GO_SOURCE_ALLOWED");
  const files=[...new Set(gitList(root,["ls-files","--cached","--others","--exclude-standard","-z","--",...scope]))].sort(compare);
  const entries=[];
  for(const rel of files){
    const file=ownerInput(owner,rel);
    if(file===null)continue;
    const bytes=safeRead(root,rel,changes.includes(rel));
    if(bytes!==null)entries.push([file,bytes]);
  }
  const peers=[];
  if(owner==="dsh"){
    if(dirtyPaths(root,[peerScope]).length)throw new Error("PREVIEW_PEER_SCHEMA_CHANGED");
    for(const rel of gitList(root,["ls-files","--cached","-z","--",peerScope]))
      peers.push([checkedPeer(rel),safeRead(root,rel)]);
  }
  return assemble(owner,entries,peers);
}
// Committed builds must never read mutable working-tree files, including
// files hidden by ignore rules or assume-unchanged. Read the exact tree and
// batch its immutable blob IDs, with strict mode, framing and size checks.
export function captureCommittedOwner(root,owner,revision) {
  if(!/^[a-f0-9]{40}$/.test(revision||""))throw new Error("COMMITTED_REVISION_INVALID");
  const scope=scopeFor(owner);
  const requested=[];
  for(const record of gitList(root,["ls-tree","-r","-z",revision,"--",...scope,...(owner==="dsh"?[peerScope]:[])])){
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(record);
    if(!match)throw new Error("COMMITTED_TREE_MODE_INVALID");
    const [, ,oid,rel]=match;
    const peer=owner==="dsh"&&rel.startsWith(peerScope+"/");
    const file=peer?checkedPeer(rel):ownerInput(owner,rel);
    if(file!==null)requested.push({oid,file,peer});
  }
  if(!requested.length)throw new Error("COMMITTED_TREE_EMPTY");
  const raw=execFileSync(gitExe,["cat-file","--batch"],{cwd:root,encoding:null,windowsHide:true,
    input:requested.map(x=>x.oid+"\n").join(""),timeout:30000,maxBuffer:64*1024*1024});
  let cursor=0;
  const entries=[],peers=[];
  for(const {oid,file,peer} of requested){
    const end=raw.indexOf(10,cursor);
    if(end<0)throw new Error("COMMITTED_BLOB_HEADER_INVALID");
    const header=/^([a-f0-9]{40}) blob ([0-9]+)$/.exec(raw.subarray(cursor,end).toString("ascii"));
    if(!header||header[1]!==oid)throw new Error("COMMITTED_BLOB_HEADER_INVALID");
    const size=Number(header[2]);
    if(!Number.isSafeInteger(size)||size>4194304||end+1+size>=raw.length||raw[end+1+size]!==10)
      throw new Error("COMMITTED_BLOB_SIZE_INVALID");
    const bytes=raw.subarray(end+1,end+1+size);
    if(bytes.includes(0)||containsLikelySecret(bytes.toString("utf8")))throw new Error("PREVIEW_SECRET_OR_BINARY_BLOCKED");
    (peer?peers:entries).push([file,Buffer.from(bytes)]);
    cursor=end+2+size;
  }
  if(cursor!==raw.length)throw new Error("COMMITTED_BLOB_TRAILING_DATA");
  return assemble(owner,entries,peers,revision);
}
function materializedEntries(root) {
  const actual=[];
  function walk(folder,relative=""){
    for(const item of fs.readdirSync(folder,{withFileTypes:true})){
      const rel=relative?relative+"/"+item.name:item.name;
      if(item.isSymbolicLink())throw new Error("PREVIEW_SNAPSHOT_LINK");
      if(item.isDirectory())walk(path.join(folder,item.name),rel);
      else actual.push([rel,safeRead(root,rel)]);
    }
  }
  walk(root);
  return actual;
}
export function verifyMaterializedOwner(dir,snapshot) {
  const prefix="services/"+snapshot.owner+"/";
  const root=path.resolve(dir,"../..");
  const expected=[...snapshot.entries.map(([rel,bytes])=>[prefix+rel,bytes]),...(snapshot.peers||[])];
  if(digestEntries(snapshot.entries)!==snapshot.digest||digestEntries(materializedEntries(root))!==digestEntries(expected))
    throw new Error("PREVIEW_SNAPSHOT_MUTATED");
}
function writeEntry(root,rel,bytes) {
  const file=path.join(root,...pathParts(rel));
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,bytes,{flag:"wx"});
}
export function materializeOwner(snapshot) {
  scopeFor(snapshot.owner);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"bthwani-owner-preview-"));
  const dir=path.join(temp,"services",snapshot.owner);
  const dispose=()=>fs.rmSync(temp,{recursive:true,force:true});
  try{
    for(const [rel,bytes] of snapshot.entries){
      if(!snapshotInput(rel))throw new Error("PREVIEW_PATH_INVALID");
      writeEntry(dir,rel,bytes);
    }
    for(const [rel,bytes] of snapshot.peers||[]){
      if(snapshot.owner!=="dsh")throw new Error("PREVIEW_UNREVIEWED_PEER_INPUT");
      writeEntry(temp,checkedPeer(rel),bytes);
    }
    verifyMaterializedOwner(dir,snapshot);
    return {dir,dispose};
  }catch(e){dispose();throw e;}
}
